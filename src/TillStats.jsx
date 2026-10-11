// Statistiche for the till (a section of TillSala.jsx, admin accounts only),
// built from the same data as the phone/desktop version (statsData.js) and
// the same pieces as the other till screens (TillUi.jsx):
//  - the period is chosen with big buttons (no date fields to type into on
//    a touch screen); the comparison with the previous period of the same
//    length is one switch away;
//  - the numbers that matter at a glance (incasso, scontrino medio, coperti…)
//    as large tiles, each with its change when comparing — written as text
//    with an arrow, never colour alone;
//  - rankings as plain lists with a bar (name and value readable without a
//    tooltip, which a touch screen can't hover), details in the side panel.
import React, { useState, useEffect, useMemo } from "react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { formatCentsAsPrice } from "./shared";
import { PRESET_LABELS, resolvePresetRange, previousEquivalentRange, fetchClosedOrdersInRange, aggregateOrders, compareAggregates } from "./statsData";
import { FONT, STATUS, SIDE_PANEL_WIDTH, SidePanel, SectionTitle, SwitchRow, Segmented } from "./TillUi";

const PERIODS = ["today", "yesterday", "last7days", "currentMonth", "lastMonth", "currentYear"];

function useClosedOrders(range) {
  const [state, setState] = useState({ orders: [], loading: true, error: "" });
  useEffect(() => {
    if (!range) { setState({ orders: [], loading: false, error: "" }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: "" }));
    fetchClosedOrdersInRange(range.start, range.end)
      .then((orders) => { if (!cancelled) setState({ orders, loading: false, error: "" }); })
      .catch((err) => {
        console.error("[till] Lettura statistiche fallita:", err);
        if (!cancelled) setState({ orders: [], loading: false, error: "Impossibile caricare le comande di questo periodo." });
      });
    return () => { cancelled = true; };
  }, [range]);
  return state;
}

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

function Kpi({ t, id, label, value, note, delta }) {
  return (
    <div style={{ padding: "14px 16px", borderRadius: 14, border: `1.5px solid ${t.line}`, background: t.card, minHeight: 112 }}>
      <SectionTitle t={t}>{label}</SectionTitle>
      <div data-testid={`till-kpi-${id}`} style={{ fontSize: 30, fontWeight: 800, marginTop: 6, color: t.ink }}>{value}</div>
      {note && <div style={{ fontSize: 13, color: t.inkSoft, marginTop: 2 }}>{note}</div>}
      {delta && <div style={{ marginTop: 4 }}><Delta t={t} info={delta} /></div>}
    </div>
  );
}

// A ranking row: name, value, and a bar proportional to the largest value.
function RankRow({ t, rank, name, detail, value, ratio }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "32px 1fr auto", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${t.line}` }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: t.inkSoft }}>{rank}</span>
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

const euro = (cents) => `€ ${formatCentsAsPrice(cents)}`;

export default function TillStats({ t }) {
  const [preset, setPreset] = useState("today");
  const [compare, setCompare] = useState(false);
  const [includeAutoClosed, setIncludeAutoClosed] = useState(true);
  const [dishMode, setDishMode] = useState("qty");

  const range = useMemo(() => resolvePresetRange(preset), [preset]);
  const compareRange = useMemo(() => (compare ? previousEquivalentRange(range.start, range.end) : null), [compare, range]);
  const current = useClosedOrders(range);
  const previous = useClosedOrders(compareRange);

  const agg = useMemo(() => aggregateOrders(current.orders, { includeAutoClosed }), [current.orders, includeAutoClosed]);
  const aggPrev = useMemo(() => (compareRange ? aggregateOrders(previous.orders, { includeAutoClosed }) : null), [compareRange, previous.orders, includeAutoClosed]);
  const kpiDelta = compare && aggPrev && !previous.loading ? compareAggregates(aggPrev, agg).kpi : null;

  const hasMargin = !!agg.marginCoverage;
  const dishes = { qty: agg.topDishesByQty, revenue: agg.topDishesByRevenue, margin: agg.topDishesByMargin }[dishMode] || [];
  const dishValue = (d) => (dishMode === "qty" ? d.qty : dishMode === "revenue" ? d.revenueCents : d.marginCents);
  const maxDish = Math.max(1, ...dishes.map(dishValue));
  const maxCat = Math.max(1, ...agg.categoryBreakdown.map((c) => c.revenueCents));
  const maxWaiter = Math.max(1, ...agg.perWaiter.map((w) => w.revenueCents));
  const fmtDay = (d) => d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
  const empty = !current.loading && !current.error && agg.ordersCount === 0;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${SIDE_PANEL_WIDTH}`, fontFamily: FONT, color: t.ink }}>
      <section aria-label="Statistiche" style={{ minHeight: 0, overflowY: "auto", padding: "18px 20px 96px", display: "grid", gap: 18, alignContent: "start" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Statistiche</div>
          <div style={{ fontSize: 15, color: t.inkSoft }}>
            {fmtDay(range.start)}{range.start.toDateString() !== range.end.toDateString() ? ` – ${fmtDay(range.end)}` : ""}
            {compareRange ? ` · confronto con ${fmtDay(compareRange.start)}${compareRange.start.toDateString() !== compareRange.end.toDateString() ? ` – ${fmtDay(compareRange.end)}` : ""}` : ""}
          </div>
        </div>
        <Segmented t={t} label="Periodo" value={preset} onChange={setPreset} options={PERIODS.map((p) => ({ value: p, label: PRESET_LABELS[p] }))} />

        {current.loading && <div style={{ fontSize: 17, color: t.inkSoft }}>Caricamento…</div>}
        {current.error && <div role="alert" style={{ fontSize: 17, color: STATUS.danger }}>{current.error}</div>}
        {empty && (
          <div style={{ fontSize: 17, color: t.inkSoft, lineHeight: 1.5 }}>
            Nessuna comanda chiusa in questo periodo.
            {agg.autoClosedCount > 0 && ` (${agg.autoClosedCount} chiuse automaticamente sono escluse: le puoi includere dalla barra a destra.)`}
          </div>
        )}

        {!current.loading && !current.error && agg.ordersCount > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
              <Kpi t={t} id="revenue" label="Incasso" value={euro(agg.revenueCents)} delta={kpiDelta?.revenueCents} />
              <Kpi t={t} id="avg-receipt" label="Scontrino medio" value={euro(agg.avgReceiptCents)} delta={kpiDelta?.avgReceiptCents} />
              <Kpi t={t} id="covers" label="Coperti" value={agg.coversCount} delta={kpiDelta?.coversCount} />
              <Kpi t={t} id="orders" label="Comande" value={agg.ordersCount} delta={kpiDelta?.ordersCount} />
              <Kpi t={t} id="dishes" label="Piatti venduti" value={agg.dishesCount} delta={kpiDelta?.dishesCount} />
              <Kpi t={t} id="margin" label="Margine piatti" value={hasMargin ? euro(agg.marginCents) : "—"}
                note={!hasMargin ? "costi non impostati nel menù" : agg.marginCoverage < 0.999 ? `su ${Math.round(agg.marginCoverage * 100)}% dei piatti` : null}
                delta={hasMargin ? kpiDelta?.marginCents : null} />
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>Piatti più venduti</div>
                <Segmented t={t} label="Ordina i piatti" value={dishMode} onChange={setDishMode}
                  options={[{ value: "qty", label: "Quantità" }, { value: "revenue", label: "Incasso" }, { value: "margin", label: "Margine" }]} />
              </div>
              {dishes.length === 0 && <div style={{ fontSize: 16, color: t.inkSoft, padding: "12px 0" }}>Nessun piatto con un costo impostato in questo periodo.</div>}
              <div role="list" aria-label="Classifica dei piatti">
                {dishes.map((d, i) => (
                  <div role="listitem" key={d.key || d.name}>
                    <RankRow t={t} rank={i + 1} name={d.name} detail={d.categoryName}
                      value={dishMode === "qty" ? `${d.qty}` : euro(dishValue(d))} ratio={dishValue(d) / maxDish} />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      <SidePanel t={t} label="Dettagli delle statistiche" header={<SectionTitle t={t}>Dettagli</SectionTitle>}>
        <div style={{ display: "grid", gap: 18, paddingTop: 4 }}>
          <SwitchRow t={t} label="Confronta con il periodo precedente" checked={compare} onChange={setCompare}
            description="Stessa durata, subito prima (es. ieri per oggi). Le variazioni compaiono sotto i numeri." />
          {agg.autoClosedCount > 0 && (
            <SwitchRow t={t} label="Includi chiusure automatiche" checked={includeAutoClosed} onChange={setIncludeAutoClosed}
              description={`${agg.autoClosedCount} ${agg.autoClosedCount === 1 ? "tavolo dimenticato aperto e chiuso" : "tavoli dimenticati aperti e chiusi"} dopo 24 ore.`} />
          )}
          {agg.categoryBreakdown.length > 0 && (
            <div>
              <SectionTitle t={t} style={{ marginBottom: 2 }}>Incasso per categoria</SectionTitle>
              {agg.categoryBreakdown.map((c, i) => (
                <RankRow key={c.categoryName} t={t} rank={i + 1} name={c.categoryName || "Altro"} value={euro(c.revenueCents)} ratio={c.revenueCents / maxCat} />
              ))}
            </div>
          )}
          {agg.perWaiter.length > 0 && (
            <div>
              <SectionTitle t={t} style={{ marginBottom: 2 }}>Per cameriere</SectionTitle>
              {agg.perWaiter.map((w, i) => (
                <RankRow key={w.waiterName} t={t} rank={i + 1} name={w.waiterName} detail={`${w.coversCount} coperti · medio ${euro(w.avgReceiptCents)}`}
                  value={euro(w.revenueCents)} ratio={w.revenueCents / maxWaiter} />
              ))}
            </div>
          )}
        </div>
      </SidePanel>
    </div>
  );
}
