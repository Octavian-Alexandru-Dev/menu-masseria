// Storico for the till (inside TillSala.jsx): closed orders on the left,
// grouped by day, the selected one in the side panel with its lines and
// "Ristampa preconto" — same layout as the Sala (list + side panel), in
// place of the phone's OrderHistory.jsx.
import React, { useState, useEffect, useCallback } from "react";
import { Printer, Trash2 } from "lucide-react";
import { formatCentsAsPrice, parsePriceToCents, tableIdentity } from "./shared";
import { loadClosedOrdersPage, deleteOrder, orderTotalCents, copertoTotalCents } from "./orders";
import { confirmAction } from "./confirmDialog";
import { formatTime } from "./sala-shared";
import { usePrintJob } from "./usePrintJob";
import { FONT, STATUS, SIDE_PANEL_WIDTH, TillButton, SidePanel, SectionTitle, PrintStatusLine } from "./TillUi";

const DAY_LABEL = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" });

function dayLabel(ts) {
  if (!ts?.toDate) return "—";
  const d = ts.toDate();
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Oggi";
  if (d.toDateString() === yesterday.toDateString()) return "Ieri";
  return DAY_LABEL.format(d);
}

function OrderDetail({ t, menu, order, isAdmin, onDeleted }) {
  const printer = usePrintJob();
  const id = tableIdentity(order);
  const coperto = copertoTotalCents(order);

  const remove = async () => {
    const confirmed = await confirmAction({
      title: `Eliminare ${id.primary} dallo storico?`,
      message: "La comanda sparisce dallo storico e dalle statistiche. L'operazione non si può annullare.",
      confirmLabel: "Elimina",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteOrder(order.id);
      onDeleted();
    } catch (err) {
      console.error("[till] Eliminazione comanda fallita:", err);
    }
  };

  return (
    <SidePanel
      t={t}
      label="Dettaglio comanda"
      header={(
        <>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{id.primary}{id.secondary && <span style={{ fontSize: 16, fontWeight: 500, color: t.inkSoft }}> · {id.secondary}</span>}</div>
          <div style={{ fontSize: 14, color: t.inkSoft, marginTop: 2 }}>
            {dayLabel(order.closedAt)} · {formatTime(order.openedAt) || "—"}–{formatTime(order.closedAt) || "—"} · {order.waiterName || "—"}
            {order.status === "auto_closed" ? " · chiusura automatica" : ""}
          </div>
        </>
      )}
      footer={(
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>Totale</span>
            <span style={{ fontSize: 28, fontWeight: 800 }}>€ {formatCentsAsPrice(orderTotalCents(order))}</span>
          </div>
          <TillButton t={t} variant="primary" size={60} icon={Printer} disabled={printer.busy} onClick={() => printer.print(order, menu)}>
            {printer.failed ? "Riprova stampa" : "Ristampa preconto"}
          </TillButton>
          <PrintStatusLine status={printer.status} />
          {isAdmin && <TillButton t={t} variant="danger" icon={Trash2} onClick={remove}>Elimina dallo storico</TillButton>}
        </>
      )}
    >
      {(order.items || []).length === 0 && <div style={{ color: t.inkSoft, fontSize: 16, padding: "12px 0" }}>Nessun piatto.</div>}
      {(order.items || []).map((l) => (
        <div key={l.lineId} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 0", borderBottom: `1px solid ${t.line}`, fontSize: 16 }}>
          <span>
            <strong>{l.quantity}×</strong> {l.name}
            {l.priceNote && <span style={{ color: STATUS.info, fontWeight: 600 }}> · {l.priceNote}</span>}
            {l.notes && <span style={{ color: t.inkSoft }}> ({l.notes})</span>}
          </span>
          <span style={{ whiteSpace: "nowrap", fontWeight: 600 }}>€ {formatCentsAsPrice(parsePriceToCents(l.price) * l.quantity)}</span>
        </div>
      ))}
      {coperto > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 16, color: t.inkSoft }}>
          <span>Coperto ({order.covers?.adults || 0} adulti, {order.covers?.children || 0} bambini)</span>
          <span>€ {formatCentsAsPrice(coperto)}</span>
        </div>
      )}
    </SidePanel>
  );
}

export default function TillHistory({ t, menu, isAdmin }) {
  const [orders, setOrders] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  const loadPage = useCallback(async (after, replace) => {
    setLoading(true);
    try {
      const page = await loadClosedOrdersPage(after);
      setOrders((cur) => (replace ? page.orders : [...cur, ...page.orders]));
      setCursor(page.lastClosedAt);
      setHasMore(page.hasMore);
    } catch (err) {
      console.error("[till] Lettura storico fallita:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPage(null, true); }, [loadPage]);

  const selected = orders.find((o) => o.id === selectedId) || null;
  const groups = [];
  for (const o of orders) {
    const label = dayLabel(o.closedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.orders.push(o);
    else groups.push({ label, orders: [o] });
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${SIDE_PANEL_WIDTH}`, fontFamily: FONT, color: t.ink }}>
      <section aria-label="Comande chiuse" style={{ minHeight: 0, overflowY: "auto", padding: "18px 20px 96px" }}>
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>Storico comande</div>
        {!loading && orders.length === 0 && <div style={{ color: t.inkSoft, fontSize: 17 }}>Nessuna comanda chiusa.</div>}
        {groups.map((g) => (
          <div key={g.label} style={{ marginBottom: 18 }}>
            <SectionTitle t={t} style={{ marginBottom: 8, textTransform: "capitalize" }}>{g.label}</SectionTitle>
            <div style={{ display: "grid", gap: 8 }}>
              {g.orders.map((o) => {
                const id = tableIdentity(o);
                const active = o.id === selectedId;
                return (
                  <button key={o.id} type="button" onClick={() => setSelectedId(o.id)} aria-pressed={active} className="mdp-btn" style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 64, padding: "0 18px",
                    borderRadius: 14, border: `1.5px solid ${active ? t.primary : t.line}`, background: active ? `${t.primary}12` : t.card,
                    color: t.ink, textAlign: "left", cursor: "pointer", fontFamily: FONT,
                  }}>
                    <span>
                      <span style={{ display: "block", fontSize: 18, fontWeight: 700 }}>{id.primary}{id.secondary ? ` · ${id.secondary}` : ""}</span>
                      <span style={{ fontSize: 14, color: t.inkSoft }}>{formatTime(o.openedAt) || "—"}–{formatTime(o.closedAt) || "—"} · {o.waiterName || "—"}</span>
                    </span>
                    <span style={{ fontSize: 19, fontWeight: 700, whiteSpace: "nowrap" }}>€ {formatCentsAsPrice(orderTotalCents(o))}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {hasMore && (
          <TillButton t={t} disabled={loading} onClick={() => loadPage(cursor, false)} style={{ width: "100%" }}>
            {loading ? "Caricamento…" : "Carica altre"}
          </TillButton>
        )}
      </section>
      {selected
        ? <OrderDetail key={selected.id} t={t} menu={menu} order={selected} isAdmin={isAdmin}
            onDeleted={() => { setOrders((cur) => cur.filter((o) => o.id !== selected.id)); setSelectedId(null); }} />
        : (
          <SidePanel t={t} label="Dettaglio comanda">
            <div style={{ color: t.inkSoft, fontSize: 17, padding: "28px 0", lineHeight: 1.5 }}>
              Tocca una comanda a sinistra per vederne il dettaglio e ristamparne il preconto.
            </div>
          </SidePanel>
        )}
    </div>
  );
}
