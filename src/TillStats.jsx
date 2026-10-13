// Statistiche (admin accounts only): the same screen at the till (a section
// of TillSala.jsx: numbers on the left, details in the side panel) and on
// phones (PhoneApp.jsx: one column). Data from statsData.js, pieces from
// TillUi.jsx:
//  - the period with big buttons, or two dates ("Personalizzato");
//  - comparison with the previous period of the same length, or with any
//    other period — changes written as text with an arrow, never colour alone;
//  - rankings as plain lists with a bar (name and value readable without a
//    tooltip, which a touch screen can't hover): dishes, categories,
//    waiters, revenue by hour and by weekday, dishes ordered less;
//  - visits to the public menu (menuViews.js): total, average a day, best
//    day, and a column a day (a month for long periods) — tap a column for
//    its number, or switch to the list to read them all as text.
//
// Sections in a fixed order, each with its title: Vendite, Visite al menù,
// Piatti più venduti, then the details (side panel at the till).
import React, { useState, useEffect, useMemo } from "react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { formatCentsAsPrice } from "./shared";
import { PRESETS, PRESET_LABELS, resolvePresetRange, previousEquivalentRange, fetchClosedOrdersInRange, aggregateOrders, compareAggregates } from "./statsData";
import { fetchMenuViews, groupMenuViews } from "./menuViews";
import { FONT, STATUS, SIDE_PANEL_WIDTH, SidePanel, SectionTitle, SwitchRow, Segmented, Field, tillInputStyle, useCompactLayout } from "./TillUi";

function useClosedOrders(range) {
  const [state, setState] = useState({ orders: [], loading: true, error: "" });
  useEffect(() => {
    if (!range) { setState({ orders: [], loading: false, error: "" }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: "" }));
    fetchClosedOrdersInRange(range.start, range.end)
      .then((orders) => { if (!cancelled) setState({ orders, loading: false, error: "" }); })
      .catch((err) => {
        console.error("[stats] Lettura statistiche fallita:", err);
        if (!cancelled) setState({ orders: [], loading: false, error: "Impossibile caricare le comande di questo periodo." });
      });
    return () => { cancelled = true; };
  }, [range]);
  return state;
}

function useMenuViews(range) {
  const [state, setState] = useState({ days: [], loading: true, error: "" });
  useEffect(() => {
    if (!range) { setState({ days: [], loading: false, error: "" }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: "" }));
    fetchMenuViews(range.start, range.end)
      .then((days) => { if (!cancelled) setState({ days, loading: false, error: "" }); })
      .catch((err) => {
        console.error("[stats] Lettura visite al menù fallita:", err);
        if (!cancelled) setState({ days: [], loading: false, error: "Impossibile caricare le visite al menù." });
      });
    return () => { cancelled = true; };
  }, [range]);
  return state;
}

// "YYYY-MM-DD" (input type=date) ↔ local Date.
const toInput = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromInput = (v) => { const [y, m, d] = v.split("-").map(Number); return new Date(y, m - 1, d); };

function Delta({ t, info }) {
  if (!info) return null;
  const flat = info.delta === 0;
  const up = info.delta > 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const text = flat ? "invariato" : info.deltaPct === Infinity ? "nuovo" : `${up ? "+" : "−"}${Math.round(Math.abs(info.deltaPct) * 100)}%`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 15, fontWeight: 700, color: flat ? t.inkSoft : up ? STATUS.ok : STATUS.danger }}>
      <Icon size={17} /> {text}
    </span>
  );
}

function Kpi({ t, id, label, value, note, delta, compact }) {
  return (
    <div style={{ padding: compact ? "12px 14px" : "14px 16px", borderRadius: 14, border: `1.5px solid ${t.line}`, background: t.card, minHeight: compact ? 96 : 112 }}>
      <SectionTitle t={t} style={compact ? { fontSize: 12 } : null}>{label}</SectionTitle>
      <div data-testid={`kpi-${id}`} style={{ fontSize: compact ? 24 : 30, fontWeight: 800, marginTop: 6, color: t.ink }}>{value}</div>
      {note && <div style={{ fontSize: 13, color: t.inkSoft, marginTop: 2 }}>{note}</div>}
      {delta && <div style={{ marginTop: 4 }}><Delta t={t} info={delta} /></div>}
    </div>
  );
}

// A ranking row: name, value, and a bar proportional to the largest value.
function RankRow({ t, rank, name, detail, value, ratio }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: rank != null ? "28px minmax(0, 1fr) auto" : "minmax(0, 1fr) auto", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${t.line}` }}>
      {rank != null && <span style={{ fontSize: 16, fontWeight: 700, color: t.inkSoft }}>{rank}</span>}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 17, fontWeight: 600 }}>{name}{detail && <span style={{ fontSize: 14, fontWeight: 500, color: t.inkSoft }}> · {detail}</span>}</span>
        <span aria-hidden="true" style={{ display: "block", height: 8, borderRadius: 4, marginTop: 6, background: t.line }}>
          <span style={{ display: "block", height: 8, borderRadius: 4, width: `${Math.max(2, Math.round(ratio * 100))}%`, background: t.primary }} />
        </span>
      </span>
      <span style={{ fontSize: 17, fontWeight: 700, whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

// Visits as columns on one baseline, one colour (a single series: its title
// names it, no legend). Every column is a button: tap → its day and number
// in the line above (a touch screen can't hover). Days with no visits keep
// a thin stub, so "zero" is visibly a value, not a gap.
const fmtBar = (bar, unit) => (unit === "month"
  ? bar.date.toLocaleDateString("it-IT", { month: "long", year: "numeric" })
  : bar.date.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" }));

function ViewsChart({ t, grouped }) {
  const [picked, setPicked] = useState(null);
  const { bars, unit } = grouped;
  const max = Math.max(1, ...bars.map((b) => b.count));
  const shown = bars.find((b) => b.key === picked) || grouped.best && bars.find((b) => b.count === max) || bars[bars.length - 1];
  const tickEvery = Math.ceil(bars.length / 6);
  return (
    <div>
      <div aria-live="polite" style={{ fontSize: 15, color: t.inkSoft, minHeight: 22 }}>
        {shown && <><span style={{ textTransform: "capitalize" }}>{fmtBar(shown, unit)}</span>: <strong style={{ color: t.ink }}>{shown.count} {shown.count === 1 ? "visita" : "visite"}</strong></>}
      </div>
      <div role="group" aria-label="Visite al menù nel tempo" style={{ display: "flex", alignItems: "flex-end", gap: bars.length > 40 ? 1 : 2, height: 140, marginTop: 8, borderBottom: `1px solid ${t.line}` }}>
        {bars.map((b) => {
          const active = shown?.key === b.key;
          return (
            <button key={b.key} type="button" onClick={() => setPicked(b.key)} aria-pressed={active}
              aria-label={`${fmtBar(b, unit)}: ${b.count} ${b.count === 1 ? "visita" : "visite"}`} title={`${fmtBar(b, unit)}: ${b.count}`}
              style={{ flex: 1, minWidth: 0, height: "100%", padding: 0, border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "flex-end" }}>
              <span style={{
                display: "block", width: "100%", maxWidth: 28, margin: "0 auto", borderRadius: "4px 4px 0 0",
                height: b.count ? `${Math.max(3, (b.count / max) * 100)}%` : 2,
                background: b.count ? t.primary : t.line, opacity: active || !picked ? 1 : 0.55,
                outline: active ? `2px solid ${t.ink}` : "none", outlineOffset: 1,
              }} />
            </button>
          );
        })}
      </div>
      <div aria-hidden="true" style={{ display: "flex", gap: bars.length > 40 ? 1 : 2, marginTop: 4 }}>
        {bars.map((b, i) => (
          <span key={b.key} style={{ flex: 1, minWidth: 0, fontSize: 11, color: t.inkSoft, textAlign: "center", whiteSpace: "nowrap", overflow: "visible" }}>
            {i % tickEvery === 0 ? (unit === "month" ? b.date.toLocaleDateString("it-IT", { month: "short" }) : b.date.getDate()) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children, right }) {
  return (
    <section aria-label={title}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ fontSize: 19, fontWeight: 700 }}>{title}</div>
        {right}
      </div>
      {children}
    </section>
  );
}

const euro = (cents) => `€ ${formatCentsAsPrice(cents)}`;
const fmtDay = (d) => d.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
const fmtRange = (r) => `${fmtDay(r.start)}${r.start.toDateString() !== r.end.toDateString() ? ` – ${fmtDay(r.end)}` : ""}`;

function DateRange({ t, label, start, end, onChange }) {
  const input = { ...tillInputStyle(t), background: t.card };
  return (
    <div role="group" aria-label={label} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <Field t={t} label="Dal">
        <input type="date" aria-label={`${label}: dal`} value={toInput(start)} max={toInput(end)} style={input}
          onChange={(e) => e.target.value && onChange(fromInput(e.target.value), end)} />
      </Field>
      <Field t={t} label="Al">
        <input type="date" aria-label={`${label}: al`} value={toInput(end)} min={toInput(start)} style={input}
          onChange={(e) => e.target.value && onChange(start, fromInput(e.target.value))} />
      </Field>
    </div>
  );
}

export default function TillStats({ t }) {
  const compact = useCompactLayout();
  const [preset, setPreset] = useState("today");
  const [custom, setCustom] = useState(() => ({ start: new Date(), end: new Date() }));
  const [compareMode, setCompareMode] = useState("none"); // none | previous | custom
  const [compareCustom, setCompareCustom] = useState(null);
  const [includeAutoClosed, setIncludeAutoClosed] = useState(true);
  const [dishMode, setDishMode] = useState("qty");

  const range = useMemo(() => resolvePresetRange(preset, { customStart: custom.start, customEnd: custom.end }), [preset, custom]);
  const compareRange = useMemo(() => {
    if (compareMode === "previous") return previousEquivalentRange(range.start, range.end);
    if (compareMode === "custom" && compareCustom) return resolvePresetRange("custom", { customStart: compareCustom.start, customEnd: compareCustom.end });
    return null;
  }, [compareMode, compareCustom, range]);
  const current = useClosedOrders(range);
  const previous = useClosedOrders(compareRange);
  const views = useMenuViews(range);
  const viewsPrev = useMenuViews(compareRange);
  const [viewsMode, setViewsMode] = useState("chart");

  const agg = useMemo(() => aggregateOrders(current.orders, { includeAutoClosed }), [current.orders, includeAutoClosed]);
  const aggPrev = useMemo(() => (compareRange ? aggregateOrders(previous.orders, { includeAutoClosed }) : null), [compareRange, previous.orders, includeAutoClosed]);
  const comparison = compareRange && aggPrev && !previous.loading ? compareAggregates(aggPrev, agg) : null;
  const kpiDelta = comparison?.kpi || null;

  const chooseCompare = (mode) => {
    // "Altro periodo" starts from the previous one, then any dates.
    if (mode === "custom" && !compareCustom) setCompareCustom(previousEquivalentRange(range.start, range.end));
    setCompareMode(mode);
  };

  const hasMargin = !!agg.marginCoverage;
  const dishes = { qty: agg.topDishesByQty, revenue: agg.topDishesByRevenue, margin: agg.topDishesByMargin }[dishMode] || [];
  const dishValue = (d) => (dishMode === "qty" ? d.qty : dishMode === "revenue" ? d.revenueCents : d.marginCents);
  const maxOf = (list, f) => Math.max(1, ...list.map(f));
  const maxDish = maxOf(dishes, dishValue);
  const hours = agg.hourlyDistribution.filter((h) => h.ordersCount > 0);
  const declining = comparison ? comparison.dishDeltas.filter((d) => d.qtyDelta < 0).slice(0, 10) : [];
  const empty = !current.loading && !current.error && agg.ordersCount === 0;
  const hasData = !current.loading && !current.error && agg.ordersCount > 0;

  const controls = (
    <div style={{ display: "grid", gap: 14 }}>
      <Segmented t={t} label="Periodo" value={preset} onChange={setPreset} options={PRESETS.map((p) => ({ value: p, label: PRESET_LABELS[p] }))} />
      {preset === "custom" && <DateRange t={t} label="Periodo" start={custom.start} end={custom.end} onChange={(start, end) => setCustom({ start, end })} />}
    </div>
  );

  const compareControls = (
    <div style={{ display: "grid", gap: 12 }}>
      <SectionTitle t={t}>Confronto</SectionTitle>
      <Segmented t={t} label="Confronta con" value={compareMode} onChange={chooseCompare}
        options={[{ value: "none", label: "Nessuno" }, { value: "previous", label: "Periodo precedente" }, { value: "custom", label: "Altro periodo" }]} />
      {compareMode === "custom" && compareCustom && (
        <DateRange t={t} label="Periodo di confronto" start={compareCustom.start} end={compareCustom.end} onChange={(start, end) => setCompareCustom({ start, end })} />
      )}
      {compareRange && <div style={{ fontSize: 14, color: t.inkSoft }}>Le variazioni sotto i numeri sono rispetto a {fmtRange(compareRange)}.</div>}
      {agg.autoClosedCount > 0 && (
        <SwitchRow t={t} label="Includi chiusure automatiche" checked={includeAutoClosed} onChange={setIncludeAutoClosed}
          description={`${agg.autoClosedCount} ${agg.autoClosedCount === 1 ? "tavolo dimenticato aperto e chiuso" : "tavoli dimenticati aperti e chiusi"} dopo 24 ore.`} />
      )}
    </div>
  );

  const grouped = useMemo(() => groupMenuViews(views.days), [views.days]);
  const groupedPrev = useMemo(() => (compareRange && !viewsPrev.loading ? groupMenuViews(viewsPrev.days) : null), [compareRange, viewsPrev]);
  const deltaOf = (a, b) => (b == null ? null : { delta: a - b, deltaPct: b === 0 ? (a === 0 ? 0 : Infinity) : (a - b) / b });
  const viewsSection = (
    <Section title="Visite al menù"
      right={grouped.bars.length > 1 && <Segmented t={t} label="Mostra le visite" value={viewsMode} onChange={setViewsMode}
        options={[{ value: "chart", label: "Grafico" }, { value: "list", label: "Elenco" }]} />}>
      {views.loading && <div style={{ fontSize: 16, color: t.inkSoft, padding: "8px 0" }}>Caricamento…</div>}
      {views.error && <div role="alert" style={{ fontSize: 16, color: STATUS.danger }}>{views.error}</div>}
      {!views.loading && !views.error && (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: compact ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(190px, 1fr))", gap: compact ? 10 : 12 }}>
            <Kpi t={t} compact={compact} id="views" label="Visite" value={grouped.total} delta={deltaOf(grouped.total, groupedPrev?.total)} />
            {grouped.bars.length > 1 && <Kpi t={t} compact={compact} id="views-avg" label="Media al giorno" value={grouped.avgPerDay.toLocaleString("it-IT", { maximumFractionDigits: 1 })} />}
            {grouped.bars.length > 1 && grouped.best && (
              <Kpi t={t} compact={compact} id="views-best" label="Giorno migliore" value={grouped.best.count}
                note={grouped.best.date.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })} />
            )}
          </div>
          {grouped.total === 0 && <div style={{ fontSize: 16, color: t.inkSoft }}>Nessuna visita al menù in questo periodo.</div>}
          {grouped.total > 0 && grouped.bars.length > 1 && (viewsMode === "chart"
            ? <ViewsChart t={t} grouped={grouped} />
            : (
              <div role="list" aria-label="Visite al menù per giorno">
                {grouped.bars.map((b) => (
                  <div role="listitem" key={b.key}>
                    <RankRow t={t} name={fmtBar(b, grouped.unit)} value={`${b.count}`} ratio={b.count / Math.max(1, ...grouped.bars.map((x) => x.count))} />
                  </div>
                ))}
              </div>
            ))}
          <div style={{ fontSize: 13, color: t.inkSoft, lineHeight: 1.4 }}>
            Una visita = un telefono che apre il menù in un giorno. Non si contano i dispositivi dello staff né la cassa.
          </div>
        </div>
      )}
    </Section>
  );

  const kpis = (
    <div style={{ display: "grid", gridTemplateColumns: compact ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(190px, 1fr))", gap: compact ? 10 : 12 }}>
      <Kpi t={t} compact={compact} id="revenue" label="Incasso" value={euro(agg.revenueCents)} delta={kpiDelta?.revenueCents} />
      <Kpi t={t} compact={compact} id="avg-receipt" label="Scontrino medio" value={euro(agg.avgReceiptCents)} delta={kpiDelta?.avgReceiptCents} />
      <Kpi t={t} compact={compact} id="covers" label="Coperti" value={agg.coversCount} delta={kpiDelta?.coversCount} />
      <Kpi t={t} compact={compact} id="orders" label="Comande" value={agg.ordersCount} delta={kpiDelta?.ordersCount} />
      <Kpi t={t} compact={compact} id="dishes" label="Piatti venduti" value={agg.dishesCount} delta={kpiDelta?.dishesCount} />
      <Kpi t={t} compact={compact} id="margin" label="Margine piatti" value={hasMargin ? euro(agg.marginCents) : "—"}
        note={!hasMargin ? "costi non impostati nel menù" : agg.marginCoverage < 0.999 ? `su ${Math.round(agg.marginCoverage * 100)}% dell'incasso piatti` : null}
        delta={hasMargin ? kpiDelta?.marginCents : null} />
    </div>
  );

  const dishesSection = (
    <Section title="Piatti più venduti"
      right={<Segmented t={t} label="Ordina i piatti" value={dishMode} onChange={setDishMode}
        options={[{ value: "qty", label: "Quantità" }, { value: "revenue", label: "Incasso" }, { value: "margin", label: "Margine" }]} />}>
      {dishes.length === 0 && <div style={{ fontSize: 16, color: t.inkSoft, padding: "12px 0" }}>{dishMode === "margin" ? "Nessun piatto con un costo impostato in questo periodo." : "Nessun piatto in questo periodo."}</div>}
      <div role="list" aria-label="Classifica dei piatti">
        {dishes.map((d, i) => (
          <div role="listitem" key={d.key || d.name}>
            <RankRow t={t} rank={i + 1} name={d.name} detail={d.categoryName}
              value={dishMode === "qty" ? `${d.qty}` : euro(dishValue(d))} ratio={dishValue(d) / maxDish} />
          </div>
        ))}
      </div>
    </Section>
  );

  const details = hasData && (
    <>
      {declining.length > 0 && (
        <Section title="Piatti ordinati meno">
          {declining.map((d) => (
            <div key={d.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 0", borderBottom: `1px solid ${t.line}`, fontSize: 16 }}>
              <span>{d.name} <span style={{ color: t.inkSoft, fontSize: 14 }}>· {d.categoryName}</span></span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: STATUS.danger, fontWeight: 700, whiteSpace: "nowrap" }}>
                <ArrowDownRight size={16} /> {d.qtyDelta}{d.qtyB === 0 ? " · non più ordinato" : ""}
              </span>
            </div>
          ))}
        </Section>
      )}
      {agg.categoryBreakdown.length > 0 && (
        <Section title="Incasso per categoria">
          {agg.categoryBreakdown.map((c, i) => (
            <RankRow key={c.categoryName} t={t} rank={i + 1} name={c.categoryName || "Altro"} value={euro(c.revenueCents)} ratio={c.revenueCents / maxOf(agg.categoryBreakdown, (x) => x.revenueCents)} />
          ))}
        </Section>
      )}
      {agg.perWaiter.length > 0 && (
        <Section title="Per cameriere">
          {agg.perWaiter.map((w, i) => (
            <RankRow key={w.waiterName} t={t} rank={i + 1} name={w.waiterName} detail={`${w.coversCount} coperti · medio ${euro(w.avgReceiptCents)}`}
              value={euro(w.revenueCents)} ratio={w.revenueCents / maxOf(agg.perWaiter, (x) => x.revenueCents)} />
          ))}
        </Section>
      )}
      {hours.length > 0 && (
        <Section title="Incasso per ora di apertura del tavolo">
          {hours.map((h) => (
            <RankRow key={h.hour} t={t} name={`${String(h.hour).padStart(2, "0")}:00`} detail={`${h.ordersCount} ${h.ordersCount === 1 ? "tavolo" : "tavoli"}`}
              value={euro(h.revenueCents)} ratio={h.revenueCents / maxOf(hours, (x) => x.revenueCents)} />
          ))}
        </Section>
      )}
      <Section title="Incasso per giorno della settimana">
        {agg.weekdayDistribution.map((w) => (
          <RankRow key={w.label} t={t} name={w.label} detail={w.ordersCount ? `${w.ordersCount} ${w.ordersCount === 1 ? "tavolo" : "tavoli"}` : null}
            value={euro(w.revenueCents)} ratio={w.revenueCents / maxOf(agg.weekdayDistribution, (x) => x.revenueCents)} />
        ))}
      </Section>
    </>
  );

  const status = (
    <>
      <div style={{ fontSize: 15, color: t.inkSoft }}>{fmtRange(range)}</div>
      {current.loading && <div style={{ fontSize: 17, color: t.inkSoft }}>Caricamento…</div>}
      {current.error && <div role="alert" style={{ fontSize: 17, color: STATUS.danger }}>{current.error}</div>}
      {empty && (
        <div style={{ fontSize: 17, color: t.inkSoft, lineHeight: 1.5 }}>
          Nessuna comanda chiusa in questo periodo.
          {agg.autoClosedCount > 0 && ` (${agg.autoClosedCount} chiuse automaticamente sono escluse: le puoi includere con «Includi chiusure automatiche».)`}
        </div>
      )}
    </>
  );

  if (compact) {
    return (
      <div style={{ padding: "16px 16px 24px", display: "grid", gap: 20, fontFamily: FONT, color: t.ink }}>
        {controls}
        <Section title="Vendite">
          <div style={{ display: "grid", gap: 12 }}>
            {status}
            {hasData && kpis}
          </div>
        </Section>
        {viewsSection}
        {compareControls}
        {hasData && dishesSection}
        {details}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${SIDE_PANEL_WIDTH}`, fontFamily: FONT, color: t.ink }}>
      <section aria-label="Statistiche" style={{ minHeight: 0, overflowY: "auto", padding: "18px 20px 96px", display: "grid", gap: 18, alignContent: "start" }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>Statistiche</div>
        {controls}
        <Section title="Vendite">
          <div style={{ display: "grid", gap: 12 }}>
            {status}
            {hasData && kpis}
          </div>
        </Section>
        {viewsSection}
        {hasData && dishesSection}
      </section>
      <SidePanel t={t} label="Dettagli delle statistiche" header={<SectionTitle t={t}>Dettagli</SectionTitle>}>
        <div style={{ display: "grid", gap: 22, paddingTop: 4 }}>
          {compareControls}
          {details}
        </div>
      </SidePanel>
    </div>
  );
}
