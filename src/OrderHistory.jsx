// Storico delle comande chiuse — condiviso tra area cameriere e area cucina
// (entrambe devono poter risalire alle comande dei giorni precedenti, non
// solo l'ultimo cameriere che le ha servite). Caricamento a pagine, non
// realtime: vedi loadClosedOrdersPage in orders.js.
import React, { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, Clock, CheckCircle2, Timer, Printer } from "lucide-react";
import { ital, TYPE, formatCentsAsPrice, tableIdentity } from "./shared";
import { loadClosedOrdersPage, orderTotalCents, copertoTotalCents } from "./orders";
import ReceiptOverlay from "./ReceiptOverlay";

function formatTime(ts) {
  return ts?.toDate ? ts.toDate().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "—";
}

function formatDayLabel(ts) {
  if (!ts?.toDate) return "";
  const d = ts.toDate();
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Oggi";
  if (sameDay(d, yesterday)) return "Ieri";
  return d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
}

export function OrderRow({ t, order, expanded, onToggle, onPrint }) {
  const total = orderTotalCents(order);
  return (
    <div style={{ border: `1px solid ${t.line}`, borderRadius: 8, background: t.card, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <button
          onClick={onToggle}
          className="mdp-btn"
          style={{
            flex: 1, textAlign: "left", padding: "10px 14px", background: "none", border: "none", cursor: "pointer",
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
          }}
        >
          <div>
            <div style={{ fontSize: TYPE.smallPlus, fontWeight: 600, color: t.ink }}>
              {tableIdentity(order).primary}
              {tableIdentity(order).secondary && (
                <span style={{ fontWeight: 400, color: t.inkSoft }}> · {tableIdentity(order).secondary}</span>
              )}
            </div>
            <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft, marginTop: 2 }}>
              {formatTime(order.openedAt)}–{formatTime(order.closedAt)} · {order.waiterName || "—"}
              {order.status === "auto_closed" && <span style={{ color: t.accent2 }}> · chiusura automatica</span>}
            </div>
          </div>
          <div style={{ fontSize: TYPE.smallPlus, fontWeight: 600, color: t.primary, whiteSpace: "nowrap" }}>
            € {formatCentsAsPrice(total)}
          </div>
        </button>
        {onPrint && (
          <button
            onClick={() => onPrint(order)}
            className="mdp-btn"
            title="Stampa preconto"
            style={{ padding: "0 14px", background: "none", border: "none", borderLeft: `1px solid ${t.line}`, color: t.inkSoft, cursor: "pointer", display: "flex", alignItems: "center" }}
          >
            <Printer size={14} />
          </button>
        )}
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${t.line}`, padding: "10px 14px" }}>
          <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft, marginBottom: 8 }}>
            {order.covers?.adults || 0} adulti, {order.covers?.children || 0} bambini
            {copertoTotalCents(order) > 0 && ` (coperto € ${formatCentsAsPrice(copertoTotalCents(order))})`}
            {order.notes ? ` · ${order.notes}` : ""}
            {order.receipt?.confirmedAt && (
              <span style={{ color: t.secondary }}> · preconto confermato alle {formatTime(order.receipt.confirmedAt)}</span>
            )}
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            {(order.items || []).map((l) => (
              <div key={l.lineId} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: TYPE.tinyPlus, color: t.ink }}>
                <span>{l.quantity}× {l.name}{l.notes ? ` (${l.notes})` : ""} <span style={{ color: t.inkSoft }}>· {l.categoryName}</span></span>
                <span style={{ color: t.inkSoft, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 8 }}>
                  <span title="Inviato" style={{ display: "flex", alignItems: "center", gap: 3 }}><Clock size={10} /> {formatTime(l.sentAt)}</span>
                  {l.outAt && <span title="Uscito" style={{ display: "flex", alignItems: "center", gap: 3, color: t.secondary }}><CheckCircle2 size={10} /> {formatTime(l.outAt)}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrderHistory({ t, menu, onBack }) {
  const [pages, setPages] = useState([]); // array di array di ordini (una per pagina caricata)
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [printingOrder, setPrintingOrder] = useState(null);

  const loadPage = useCallback(async (after) => {
    setLoading(true);
    setError("");
    try {
      const { orders, lastClosedAt, hasMore: more } = await loadClosedOrdersPage(after);
      setPages((prev) => [...prev, orders]);
      setCursor(lastClosedAt);
      setHasMore(more);
    } catch (err) {
      console.error("[storico] Caricamento fallito:", err);
      setError("Impossibile caricare lo storico. Riprova.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Guardia contro il doppio richiamo dell'effetto in React.StrictMode (solo
  // sviluppo): senza, la prima pagina verrebbe caricata due volte, con righe
  // duplicate (e chiavi React duplicate).
  const didLoadRef = useRef(false);
  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    loadPage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allOrders = pages.flat();

  // Raggruppa per giorno, in ordine (i risultati arrivano già dal più
  // recente al più vecchio, quindi i gruppi restano contigui).
  const groups = [];
  for (const order of allOrders) {
    const label = formatDayLabel(order.closedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.orders.push(order);
    } else {
      groups.push({ label, orders: [order] });
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 16px 60px" }}>
      <button onClick={onBack} className="mdp-btn" style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: t.inkSoft, cursor: "pointer", fontSize: TYPE.smallPlus, marginBottom: 14 }}>
        <ArrowLeft size={14} /> Indietro
      </button>
      <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.heading, fontWeight: 600, color: t.primary, marginBottom: 14 }}>
        Storico comande
      </div>

      {groups.length === 0 && !loading && (
        <div style={{ textAlign: "center", color: t.inkSoft, fontSize: TYPE.body, marginTop: 30 }}>
          Nessuna comanda chiusa ancora.
        </div>
      )}

      <div style={{ display: "grid", gap: 20 }}>
        {groups.map((g) => (
          <div key={g.label}>
            <div style={{ fontSize: TYPE.small, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 8 }}>
              {g.label}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {g.orders.map((order) => (
                <OrderRow
                  key={order.id}
                  t={t}
                  order={order}
                  expanded={expandedId === order.id}
                  onToggle={() => setExpandedId((id) => (id === order.id ? null : order.id))}
                  onPrint={setPrintingOrder}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && <div style={{ color: t.accent2, fontSize: TYPE.smallPlus, marginTop: 14 }}>{error}</div>}

      {hasMore && (
        <button
          onClick={() => loadPage(cursor)}
          disabled={loading}
          className="mdp-btn"
          style={{
            marginTop: 18, width: "100%", padding: "10px 0", background: "none", border: `1px solid ${t.line}`,
            borderRadius: 8, color: t.ink, fontSize: TYPE.smallPlus, cursor: loading ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <Timer size={13} /> {loading ? "Caricamento…" : "Carica altre"}
        </button>
      )}

      {printingOrder && (
        <ReceiptOverlay t={t} menu={menu} order={printingOrder} onClose={() => setPrintingOrder(null)} readOnly />
      )}
    </div>
  );
}
