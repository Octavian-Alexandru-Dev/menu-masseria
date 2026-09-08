// Dashboard statistiche vendite — area riservata solo admin (vedi
// StaffHome.jsx: canAdmin gate). Raggiunta solo dalla Dashboard interna,
// nessuna URL diretta (a differenza di Waiter/Kitchen/Reservations): non
// gestisce da sé login o ruolo, si affida al gate di StaffHome (stesso
// principio di Admin.jsx).
import React, { useState, useEffect, useMemo } from "react";
import { BarChart3, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { THEMES, ital, GlobalStyle, TYPE, formatCentsAsPrice } from "./shared";
import {
  PRESETS, PRESET_LABELS, resolvePresetRange, previousEquivalentRange,
  fetchClosedOrdersInRange, aggregateOrders, compareAggregates,
} from "./statsData";

/* ============================== STILE (locale, come Reservations.jsx) ============================== */

function cardStyle(t) {
  return { background: t.card, border: `1px solid ${t.line}`, borderRadius: 10, padding: 20 };
}
function btnGhost(t, active) {
  return {
    padding: "8px 13px", background: active ? t.primary : "none", color: active ? t.bg : t.ink,
    border: `1px solid ${active ? t.primary : t.line}`, borderRadius: 6, fontSize: TYPE.smallPlus,
    fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  };
}
function dateInputStyle(t) {
  return { padding: "6px 10px", border: `1px solid ${t.line}`, borderRadius: 6, background: t.bg, color: t.ink, fontSize: TYPE.smallPlus };
}
function sectionTitleStyle(t) {
  return { fontSize: TYPE.subhead, fontWeight: 600, color: t.ink };
}

function EmptyNote({ t, text }) {
  return <div style={{ textAlign: "center", color: t.inkSoft, fontSize: TYPE.body, padding: "24px 0" }}>{text}</div>;
}

/* ============================== DATE HELPERS (solo UI: input type=date) ============================== */

function toInputDateValue(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseInputDateValue(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/* ============================== SELETTORE PERIODO ============================== */

function PeriodPicker({ t, preset, onPresetChange, customStart, customEnd, onCustomChange }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {PRESETS.map((p) => (
        <button key={p} onClick={() => onPresetChange(p)} className="mdp-btn" style={btnGhost(t, preset === p)}>
          {PRESET_LABELS[p]}
        </button>
      ))}
      {preset === "custom" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="date" value={toInputDateValue(customStart)} onChange={(e) => onCustomChange("start", parseInputDateValue(e.target.value))} style={dateInputStyle(t)} />
          <span style={{ color: t.inkSoft }}>→</span>
          <input type="date" value={toInputDateValue(customEnd)} onChange={(e) => onCustomChange("end", parseInputDateValue(e.target.value))} style={dateInputStyle(t)} />
        </div>
      )}
    </div>
  );
}

function CompareToggle({ t, enabled, onToggle, compareStart, compareEnd, onCompareChange }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: TYPE.smallPlus, color: t.ink, cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        Confronta con un altro periodo
      </label>
      {enabled && compareStart && compareEnd && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft }}>Periodo A:</span>
          <input type="date" value={toInputDateValue(compareStart)} onChange={(e) => onCompareChange("start", parseInputDateValue(e.target.value))} style={dateInputStyle(t)} />
          <span style={{ color: t.inkSoft }}>→</span>
          <input type="date" value={toInputDateValue(compareEnd)} onChange={(e) => onCompareChange("end", parseInputDateValue(e.target.value))} style={dateInputStyle(t)} />
        </div>
      )}
    </div>
  );
}

function AutoClosedToggle({ t, checked, onChange, autoClosedCount }) {
  if (autoClosedCount === 0) return null;
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: TYPE.tinyPlus, color: t.inkSoft, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Includi {autoClosedCount} {autoClosedCount === 1 ? "comanda chiusa automaticamente" : "comande chiuse automaticamente"} (tavoli dimenticati aperti)
    </label>
  );
}

/* ============================== KPI ============================== */

// Colori di stato già usati altrove nell'app (OrderRow.jsx: t.secondary per
// stati positivi/confermati, t.accent2 per l'avviso "chiusura automatica") —
// riusati qui per lo stesso significato, sempre affiancati da un'icona,
// mai solo colore.
function DeltaBadge({ t, deltaInfo, positiveIsGood = true }) {
  if (!deltaInfo) return null;
  const isFlat = deltaInfo.delta === 0;
  const isUp = deltaInfo.delta > 0;
  const good = isFlat ? null : isUp === positiveIsGood;
  const color = isFlat ? t.inkSoft : good ? t.secondary : t.accent2;
  const Icon = isFlat ? Minus : isUp ? ArrowUpRight : ArrowDownRight;
  // deltaPct è Infinity quando il periodo di confronto parte da zero (una
  // percentuale finita non avrebbe senso) — mostrato come "nuovo" invece di
  // un'assurda "+Infinity%".
  const label = isFlat ? "invariato" : deltaInfo.deltaPct === Infinity ? "nuovo" : `${isUp ? "+" : "-"}${Math.round(Math.abs(deltaInfo.deltaPct) * 100)}%`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: TYPE.tinyPlus, fontWeight: 600, color }}>
      <Icon size={13} /> {label}
    </span>
  );
}

function KpiCard({ t, id, label, value, deltaInfo }) {
  return (
    <div style={{ ...cardStyle(t), padding: 16, minWidth: 140, flex: "1 1 140px" }}>
      <div style={{ fontSize: TYPE.tiny, letterSpacing: 0.8, textTransform: "uppercase", color: t.inkSoft, marginBottom: 6 }}>{label}</div>
      <div data-testid={`kpi-value-${id}`} style={{ fontSize: TYPE.heading, fontWeight: 700, color: t.ink }}>{value}</div>
      {deltaInfo && <div style={{ marginTop: 4 }}><DeltaBadge t={t} deltaInfo={deltaInfo} /></div>}
    </div>
  );
}

function KpiCardsRow({ t, agg, comparisonKpi }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      <KpiCard t={t} id="revenue" label="Incasso totale" value={`€ ${formatCentsAsPrice(agg.revenueCents)}`} deltaInfo={comparisonKpi?.revenueCents} />
      <KpiCard t={t} id="avg-receipt" label="Scontrino medio" value={`€ ${formatCentsAsPrice(agg.avgReceiptCents)}`} deltaInfo={comparisonKpi?.avgReceiptCents} />
      <KpiCard t={t} id="covers" label="Coperti" value={agg.coversCount} deltaInfo={comparisonKpi?.coversCount} />
      <KpiCard t={t} id="dishes" label="Piatti venduti" value={agg.dishesCount} deltaInfo={comparisonKpi?.dishesCount} />
      <KpiCard t={t} id="orders" label="Comande" value={agg.ordersCount} deltaInfo={comparisonKpi?.ordersCount} />
    </div>
  );
}

/* ============================== GRAFICI A BARRE (magnitudine, tinta unica) ==============================
   Forma scelta seguendo la skill dataviz: classifiche/ripartizioni per
   grandezza -> barre a tinta unica (t.primary), mai un colore per categoria
   (l'identità è già portata dall'etichetta sull'asse, non serve una palette
   categoriale). Assi/griglia/tooltip sempre sui token del tema, non i
   default di Recharts, così restano leggibili anche sul tema scuro "ciro". */

function HorizontalBarChart({ t, data, valueKey, valueFormatter }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke={t.line} />
        <XAxis type="number" tick={{ fill: t.inkSoft, fontSize: TYPE.tiny }} axisLine={{ stroke: t.line }} tickLine={false} />
        <YAxis type="category" dataKey="name" width={140} tick={{ fill: t.ink, fontSize: TYPE.tinyPlus }} axisLine={{ stroke: t.line }} tickLine={false} />
        <Tooltip
          formatter={(value) => [valueFormatter(value), ""]}
          contentStyle={{ background: t.card, border: `1px solid ${t.line}`, borderRadius: 8, fontSize: TYPE.tinyPlus, color: t.ink }}
          labelStyle={{ color: t.ink, fontWeight: 600 }}
          cursor={{ fill: t.line }}
        />
        <Bar dataKey={valueKey} fill={t.primary} radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function VerticalBarChart({ t, data, xKey, valueKey, valueFormatter }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={t.line} />
        <XAxis dataKey={xKey} tick={{ fill: t.inkSoft, fontSize: TYPE.tiny }} axisLine={{ stroke: t.line }} tickLine={false} />
        <YAxis tick={{ fill: t.inkSoft, fontSize: TYPE.tiny }} axisLine={false} tickLine={false} width={30} />
        <Tooltip
          formatter={(value) => [valueFormatter(value), ""]}
          contentStyle={{ background: t.card, border: `1px solid ${t.line}`, borderRadius: 8, fontSize: TYPE.tinyPlus, color: t.ink }}
          labelStyle={{ color: t.ink, fontWeight: 600 }}
          cursor={{ fill: t.line }}
        />
        <Bar dataKey={valueKey} fill={t.primary} radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ============================== SEZIONI ============================== */

function TopDishesSection({ t, topDishesByQty, topDishesByRevenue }) {
  const [mode, setMode] = useState("qty");
  const data = (mode === "qty" ? topDishesByQty : topDishesByRevenue).map((d) => ({ name: d.name, qty: d.qty, revenueCents: d.revenueCents }));
  return (
    <div style={cardStyle(t)}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={sectionTitleStyle(t)}>Piatti più venduti</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setMode("qty")} className="mdp-btn" style={btnGhost(t, mode === "qty")}>Per quantità</button>
          <button onClick={() => setMode("revenue")} className="mdp-btn" style={btnGhost(t, mode === "revenue")}>Per incasso</button>
        </div>
      </div>
      {data.length === 0 ? (
        <EmptyNote t={t} text="Nessun piatto in questo periodo." />
      ) : (
        <HorizontalBarChart
          t={t} data={data} valueKey={mode === "qty" ? "qty" : "revenueCents"}
          valueFormatter={(v) => (mode === "qty" ? `${v} venduti` : `€ ${formatCentsAsPrice(v)}`)}
        />
      )}
    </div>
  );
}

// Solo quando è attivo il confronto tra periodi (comparison non nullo).
// dishDeltas è già ordinato per qtyDelta crescente da compareAggregates.
function DecliningDishesTable({ t, dishDeltas }) {
  const declining = dishDeltas.filter((d) => d.qtyDelta < 0).slice(0, 10);
  if (declining.length === 0) return null;
  return (
    <div style={cardStyle(t)}>
      <div style={sectionTitleStyle(t)}>Piatti in calo rispetto al Periodo A</div>
      <div style={{ display: "grid", gap: 0, marginTop: 10 }}>
        {declining.map((d) => (
          <div key={d.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: TYPE.bodyPlus, padding: "8px 0", borderBottom: `1px solid ${t.line}` }}>
            <span style={{ color: t.ink }}>
              {d.name} <span style={{ color: t.inkSoft, fontSize: TYPE.tinyPlus }}>· {d.categoryName}</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4, color: t.accent2, fontWeight: 600, whiteSpace: "nowrap" }}>
              <ArrowDownRight size={13} /> {d.qtyDelta}{d.qtyB === 0 ? " · non più ordinato" : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryBreakdownChart({ t, categoryBreakdown }) {
  if (categoryBreakdown.length === 0) return null;
  const data = categoryBreakdown.map((c) => ({ name: c.categoryName, revenueCents: c.revenueCents }));
  return (
    <div style={cardStyle(t)}>
      <div style={sectionTitleStyle(t)}>Incasso per categoria</div>
      <div style={{ marginTop: 10 }}>
        <HorizontalBarChart t={t} data={data} valueKey="revenueCents" valueFormatter={(v) => `€ ${formatCentsAsPrice(v)}`} />
      </div>
    </div>
  );
}

function HourlyWeekdayCharts({ t, hourlyDistribution, weekdayDistribution }) {
  const hourly = hourlyDistribution.map((h) => ({ label: String(h.hour).padStart(2, "0"), revenueCents: h.revenueCents }));
  const weekday = weekdayDistribution.map((w) => ({ label: w.label, revenueCents: w.revenueCents }));
  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
      <div style={cardStyle(t)}>
        <div style={sectionTitleStyle(t)}>Incasso per ora di apertura tavolo</div>
        <VerticalBarChart t={t} data={hourly} xKey="label" valueKey="revenueCents" valueFormatter={(v) => `€ ${formatCentsAsPrice(v)}`} />
      </div>
      <div style={cardStyle(t)}>
        <div style={sectionTitleStyle(t)}>Incasso per giorno della settimana</div>
        <VerticalBarChart t={t} data={weekday} xKey="label" valueKey="revenueCents" valueFormatter={(v) => `€ ${formatCentsAsPrice(v)}`} />
      </div>
    </div>
  );
}

function WaiterBreakdownTable({ t, perWaiter }) {
  if (perWaiter.length === 0) return null;
  return (
    <div style={cardStyle(t)}>
      <div style={sectionTitleStyle(t)}>Per cameriere</div>
      <div style={{ display: "grid", gap: 0, marginTop: 10 }}>
        {perWaiter.map((w) => (
          <div key={w.waiterName} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: TYPE.bodyPlus, padding: "8px 0", borderBottom: `1px solid ${t.line}` }}>
            <span style={{ color: t.ink, fontWeight: 600 }}>{w.waiterName}</span>
            <span style={{ color: t.inkSoft, whiteSpace: "nowrap" }}>
              {w.coversCount} coperti · scontrino medio € {formatCentsAsPrice(w.avgReceiptCents)} ·{" "}
              <strong style={{ color: t.primary }}>€ {formatCentsAsPrice(w.revenueCents)}</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== ROOT ============================== */

export default function Stats({ menu }) {
  const t = THEMES[menu?.theme] || THEMES.minimal;

  const [preset, setPreset] = useState("today");
  const [customStart, setCustomStart] = useState(() => new Date());
  const [customEnd, setCustomEnd] = useState(() => new Date());
  const [includeAutoClosed, setIncludeAutoClosed] = useState(true);

  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareStart, setCompareStart] = useState(null);
  const [compareEnd, setCompareEnd] = useState(null);

  const range = useMemo(() => resolvePresetRange(preset, { customStart, customEnd }), [preset, customStart, customEnd]);

  // Periodo A di default = periodo precedente equivalente, solo alla prima
  // attivazione del confronto — resta poi liberamente modificabile (range
  // arbitrario, non ricalcolato automaticamente ad ogni cambio di Periodo B).
  useEffect(() => {
    if (compareEnabled && !compareStart && !compareEnd) {
      const prev = previousEquivalentRange(range.start, range.end);
      setCompareStart(prev.start);
      setCompareEnd(prev.end);
    }
  }, [compareEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const compareRange = useMemo(() => {
    if (!compareEnabled || !compareStart || !compareEnd) return null;
    return resolvePresetRange("custom", { customStart: compareStart, customEnd: compareEnd });
  }, [compareEnabled, compareStart, compareEnd]);

  const [rawOrders, setRawOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchClosedOrdersInRange(range.start, range.end)
      .then((orders) => { if (!cancelled) setRawOrders(orders); })
      .catch((err) => {
        console.error("[stats] Errore lettura comande:", err);
        if (!cancelled) setError("Impossibile caricare le comande per questo periodo.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  const [rawOrdersCompare, setRawOrdersCompare] = useState([]);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [errorCompare, setErrorCompare] = useState("");

  useEffect(() => {
    if (!compareRange) { setRawOrdersCompare([]); return; }
    let cancelled = false;
    setLoadingCompare(true);
    setErrorCompare("");
    fetchClosedOrdersInRange(compareRange.start, compareRange.end)
      .then((orders) => { if (!cancelled) setRawOrdersCompare(orders); })
      .catch((err) => {
        console.error("[stats] Errore lettura comande (confronto):", err);
        if (!cancelled) setErrorCompare("Impossibile caricare il periodo di confronto.");
      })
      .finally(() => { if (!cancelled) setLoadingCompare(false); });
    return () => { cancelled = true; };
  }, [compareRange]);

  // Il toggle "includi auto-chiuse" ricalcola solo queste useMemo: nessuna
  // nuova richiesta a Firestore (rawOrders/rawOrdersCompare non cambiano).
  const agg = useMemo(() => aggregateOrders(rawOrders, { includeAutoClosed }), [rawOrders, includeAutoClosed]);
  const aggCompare = useMemo(
    () => (compareRange ? aggregateOrders(rawOrdersCompare, { includeAutoClosed }) : null),
    [rawOrdersCompare, includeAutoClosed, compareRange]
  );
  const comparison = useMemo(() => (aggCompare ? compareAggregates(aggCompare, agg) : null), [aggCompare, agg]);

  return (
    <div className="mdp-root" style={{ minHeight: "100vh", background: t.bg }}>
      <GlobalStyle t={t} />
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 60px", display: "grid", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BarChart3 size={24} color={t.primary} />
          <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.heading, fontWeight: 600, color: t.primary }}>
            Statistiche
          </div>
        </div>

        <div style={cardStyle(t)}>
          <div style={{ display: "grid", gap: 12 }}>
            <PeriodPicker
              t={t} preset={preset} onPresetChange={setPreset} customStart={customStart} customEnd={customEnd}
              onCustomChange={(which, date) => (which === "start" ? setCustomStart(date) : setCustomEnd(date))}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
              <CompareToggle
                t={t} enabled={compareEnabled} onToggle={setCompareEnabled}
                compareStart={compareStart} compareEnd={compareEnd}
                onCompareChange={(which, date) => (which === "start" ? setCompareStart(date) : setCompareEnd(date))}
              />
              <AutoClosedToggle t={t} checked={includeAutoClosed} onChange={setIncludeAutoClosed} autoClosedCount={agg.autoClosedCount} />
            </div>
          </div>
        </div>

        {(loading || loadingCompare) && <EmptyNote t={t} text="Caricamento…" />}
        {error && <div style={{ color: t.accent2, fontSize: TYPE.smallPlus }}>{error}</div>}
        {errorCompare && <div style={{ color: t.accent2, fontSize: TYPE.smallPlus }}>{errorCompare}</div>}

        {!loading && !error && agg.ordersCount === 0 && (
          <EmptyNote
            t={t}
            text={
              agg.autoClosedCount > 0
                ? `Nessuna comanda chiusa in questo periodo (ci sono ${agg.autoClosedCount} comande chiuse automaticamente escluse: attiva l'opzione qui sopra per includerle).`
                : "Nessuna comanda chiusa in questo periodo."
            }
          />
        )}

        {!loading && !error && agg.ordersCount > 0 && (
          <>
            <KpiCardsRow t={t} agg={agg} comparisonKpi={comparison?.kpi} />
            <TopDishesSection t={t} topDishesByQty={agg.topDishesByQty} topDishesByRevenue={agg.topDishesByRevenue} />
            {comparison && <DecliningDishesTable t={t} dishDeltas={comparison.dishDeltas} />}
            <CategoryBreakdownChart t={t} categoryBreakdown={agg.categoryBreakdown} />
            <HourlyWeekdayCharts t={t} hourlyDistribution={agg.hourlyDistribution} weekdayDistribution={agg.weekdayDistribution} />
            <WaiterBreakdownTable t={t} perWaiter={agg.perWaiter} />
          </>
        )}
      </div>
    </div>
  );
}
