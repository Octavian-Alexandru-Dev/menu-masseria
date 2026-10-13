// Storico: closed orders grouped by day, the selected one shown as its
// receipt (OrderUi.jsx > ReceiptPanel) with "Ristampa preconto" and, for
// admins, delete. The same screen at the till (list + side panel, inside
// TillSala.jsx) and on phones (PhoneApp.jsx: one column, the receipt as a
// full-screen page).
import React, { useState, useEffect, useCallback } from "react";
import { Trash2 } from "lucide-react";
import { formatCentsAsPrice, tableIdentity } from "./shared";
import { loadClosedOrdersPage, deleteOrder, deleteAllClosedOrders, orderTotalCents } from "./orders";
import { confirmAction } from "./confirmDialog";
import { formatTime } from "./sala-shared";
import { ReceiptPanel } from "./OrderUi";
import { FONT, STATUS, SIDE_PANEL_WIDTH, TillButton, SidePanel, SectionTitle, Notice, useCompactLayout } from "./TillUi";

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

// One closed order in a list (Storico, and "Chiusi nel turno" on the phone's
// Tavoli): tap → its receipt.
export function ClosedOrderRow({ t, order, selected, onSelect }) {
  const id = tableIdentity(order);
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className="mdp-btn"
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 64, padding: "8px 16px",
        borderRadius: 14, border: `1.5px solid ${selected ? t.primary : t.line}`, background: selected ? `${t.primary}12` : t.card,
        color: t.ink, textAlign: "left", cursor: "pointer", fontFamily: FONT, width: "100%",
      }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 17, fontWeight: 700 }}>{id.primary}{id.secondary ? ` · ${id.secondary}` : ""}</span>
        <span style={{ fontSize: 14, color: t.inkSoft }}>
          {formatTime(order.openedAt) || "—"}–{formatTime(order.closedAt) || "—"} · {order.waiterName || "—"}
          {order.status === "auto_closed" && <span style={{ color: STATUS.waiting, fontWeight: 600 }}> · chiusura automatica</span>}
        </span>
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, whiteSpace: "nowrap" }}>€ {formatCentsAsPrice(orderTotalCents(order))}</span>
    </button>
  );
}

export default function TillHistory({ t, menu, isAdmin }) {
  const compact = useCompactLayout();
  const [orders, setOrders] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [clearing, setClearing] = useState(false);

  const loadPage = useCallback(async (after, replace) => {
    setLoading(true);
    try {
      const page = await loadClosedOrdersPage(after);
      setOrders((cur) => (replace ? page.orders : [...cur, ...page.orders]));
      setCursor(page.lastClosedAt);
      setHasMore(page.hasMore);
    } catch (err) {
      console.error("[storico] Lettura storico fallita:", err);
      setNotice({ tone: "error", text: "Impossibile caricare lo storico. Riprova." });
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

  const remove = async (order) => {
    const id = tableIdentity(order);
    const confirmed = await confirmAction({
      title: `Eliminare ${id.primary} dallo storico?`,
      message: "La comanda sparisce dallo storico e dalle statistiche. L'operazione non si può annullare.",
      confirmLabel: "Elimina comanda",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteOrder(order.id);
      setOrders((cur) => cur.filter((o) => o.id !== order.id));
      setSelectedId(null);
    } catch (err) {
      console.error("[storico] Eliminazione comanda fallita:", err);
      setNotice({ tone: "error", text: "Eliminazione non riuscita. Riprova." });
    }
  };

  const clearAll = async () => {
    const confirmed = await confirmAction({
      title: "Svuotare tutto lo storico?",
      message: "Vengono eliminate tutte le comande chiuse, anche dalle statistiche. L'operazione non si può annullare.",
      confirmLabel: "Elimina tutto",
      danger: true,
    });
    if (!confirmed) return;
    setClearing(true);
    try {
      await deleteAllClosedOrders();
      setOrders([]);
      setHasMore(false);
      setSelectedId(null);
      setNotice({ tone: "ok", text: "Storico svuotato." });
    } catch (err) {
      console.error("[storico] Svuotamento fallito:", err);
      setNotice({ tone: "error", text: "Svuotamento non riuscito. Riprova." });
    } finally {
      setClearing(false);
    }
  };

  const list = (
    <section aria-label="Comande chiuse" style={compact
      ? { padding: "16px 16px 24px", fontFamily: FONT, color: t.ink }
      : { minHeight: 0, overflowY: "auto", padding: "18px 20px 96px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: compact ? 20 : 24, fontWeight: 700 }}>Storico comande</div>
        {isAdmin && orders.length > 0 && (
          <TillButton t={t} variant="danger" icon={Trash2} disabled={clearing} onClick={clearAll} style={{ fontSize: 15, padding: "0 14px" }}>
            {clearing ? "Eliminazione…" : "Svuota storico"}
          </TillButton>
        )}
      </div>
      <Notice notice={notice} />
      {!loading && orders.length === 0 && <div style={{ color: t.inkSoft, fontSize: 17, padding: "12px 0" }}>Nessuna comanda chiusa.</div>}
      {groups.map((g) => (
        <div key={g.label} style={{ marginBottom: 18 }}>
          <SectionTitle t={t} style={{ marginBottom: 8, textTransform: "capitalize" }}>{g.label}</SectionTitle>
          <div style={{ display: "grid", gap: 8 }}>
            {g.orders.map((o) => <ClosedOrderRow key={o.id} t={t} order={o} selected={o.id === selectedId} onSelect={() => setSelectedId(o.id)} />)}
          </div>
        </div>
      ))}
      {hasMore && (
        <TillButton t={t} disabled={loading} onClick={() => loadPage(cursor, false)} style={{ width: "100%" }}>
          {loading ? "Caricamento…" : "Carica altre"}
        </TillButton>
      )}
      {loading && orders.length === 0 && <div style={{ color: t.inkSoft, fontSize: 17 }}>Caricamento…</div>}
    </section>
  );

  const detail = selected && (
    <ReceiptPanel key={selected.id} t={t} menu={menu} order={selected} closed sheet={compact} label="Dettaglio comanda"
      backLabel="Storico" onClose={compact ? () => setSelectedId(null) : undefined}
      onDelete={isAdmin ? () => remove(selected) : undefined} />
  );

  if (compact) {
    return <div>{list}{detail}</div>;
  }
  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${SIDE_PANEL_WIDTH}`, fontFamily: FONT, color: t.ink }}>
      {list}
      {detail || (
        <SidePanel t={t} label="Dettaglio comanda">
          <div style={{ color: t.inkSoft, fontSize: 17, padding: "28px 0", lineHeight: 1.5 }}>
            Tocca una comanda a sinistra per vederne il dettaglio e ristamparne il preconto.
          </div>
        </SidePanel>
      )}
    </div>
  );
}
