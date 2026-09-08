// Area cameriere — presa comande digitale (vedi docs/comande-camerieri.md).
// Caricato solo su /cameriere (lazy, vedi MenuApp.jsx), mai dal sito pubblico.
import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
import { Plus, Minus, X, ArrowLeft, LogOut, CheckCircle2, Clock, Utensils, History, Users, Receipt, CalendarDays, Play, Search } from "lucide-react";
import { THEMES, ital, uid, GlobalStyle, Logo, TYPE, formatCentsAsPrice, tableIdentity, currentShiftStart, currentShiftLabel, itemMatchesSearch } from "./shared";
import {
  subscribeOpenOrders, subscribeShiftClosedOrders, openOrder, sendOrderLines, buildOrderLine, closeOrder,
  autoCloseStaleOrders, orderTotalCents, copertoTotalCents,
  updateCovers,
} from "./orders";
import {
  subscribeReservationsForDate, dateKey, startReservation, runDailyExpiredReservationsCleanup, coversLabel,
} from "./reservationsData";
import { subscribeMenuCosts } from "./menuCosts";
import {
  useStaffSession, StaffLoginScreen, StaffMessageScreen, StaffLoadingScreen, staffLogout,
} from "./staff-shared";
import OrderHistory, { OrderRow } from "./OrderHistory";
import ReceiptOverlay from "./ReceiptOverlay";

const Reservations = lazy(() => import("./Reservations"));

function formatTime(ts) {
  return ts?.toDate ? ts.toDate().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : null;
}

const PENDING_WARNING_MS = 12_000;

function elapsedLabel(openedAt) {
  const ms = openedAt?.toMillis ? Date.now() - openedAt.toMillis() : null;
  if (ms == null) return "appena aperto";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "appena aperto";
  if (min < 60) return `${min} min fa`;
  return `${Math.floor(min / 60)}h ${min % 60}min fa`;
}

function SyncBadge({ t, hasPendingWrites }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!hasPendingWrites) { setSlow(false); return; }
    const id = setTimeout(() => setSlow(true), PENDING_WARNING_MS);
    return () => clearTimeout(id);
  }, [hasPendingWrites]);

  if (!hasPendingWrites) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: TYPE.tinyPlus, color: t.secondary }}>
        <CheckCircle2 size={13} /> Sincronizzata
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: TYPE.tinyPlus, color: slow ? "#fff" : t.accent2, background: slow ? t.accent2 : "transparent", padding: slow ? "3px 8px" : 0, borderRadius: 20 }}>
      <Clock size={13} /> {slow ? "Connessione lenta: invio non confermato" : "Invio in corso…"}
    </span>
  );
}

function TodaysReservations({ t, reservations, onAvvia }) {
  if (reservations.length === 0) return null;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: TYPE.small, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 8 }}>
        Prenotazioni di oggi — {reservations.length}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {reservations.map((r) => (
          <div key={r.id} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 10, border: `1px solid ${t.line}`, background: t.card,
          }}>
            <div>
              <div style={{ fontSize: TYPE.bodyPlus, fontWeight: 600, color: t.ink }}>
                {r.name || "Senza nome"}{r.time ? ` · ${r.time}` : ""}
              </div>
              <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft, marginTop: 2 }}>
                {coversLabel(r.covers)}{r.tableNumber ? ` · Tavolo ${r.tableNumber}` : ""}
              </div>
            </div>
            <button aria-label={`Avvia prenotazione di ${r.name || "senza nome"}`} onClick={() => onAvvia(r)} className="mdp-btn" style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: t.primary, color: t.bg,
              border: "none", borderRadius: 8, fontSize: TYPE.smallPlus, fontWeight: 600, cursor: "pointer", flexShrink: 0,
            }}>
              <Play size={13} /> Avvia
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AvviaReservationModal({ t, reservation, onCancel, onConfirm, busy }) {
  const [tableNumber, setTableNumber] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,15,10,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 100 }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: t.card, borderRadius: 12, padding: 24, maxWidth: 340, width: "100%" }}>
        <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.heading, fontWeight: 600, color: t.primary, marginBottom: 10 }}>
          Avvia {reservation.name || "prenotazione"}
        </div>
        <div style={{ fontSize: TYPE.body, color: t.inkSoft, marginBottom: 14 }}>
          {coversLabel(reservation.covers)}{reservation.notes ? ` · ${reservation.notes}` : ""}
        </div>
        <label style={{ fontSize: TYPE.tiny, letterSpacing: 0.8, textTransform: "uppercase", color: t.inkSoft, display: "block", marginBottom: 4 }}>Numero tavolo *</label>
        <input
          autoFocus type="number" min="1" inputMode="numeric" value={tableNumber} onChange={(e) => setTableNumber(e.target.value)}
          style={{ width: "100%", padding: "10px 12px", border: `1px solid ${t.line}`, borderRadius: 6, background: t.bg, color: t.ink, fontSize: TYPE.bodyLg, marginBottom: 20 }}
        />
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} className="mdp-btn" style={{ flex: 1, padding: "10px 0", background: "none", border: `1px solid ${t.line}`, borderRadius: 8, cursor: "pointer" }}>Annulla</button>
          <button
            disabled={!tableNumber || busy}
            onClick={() => onConfirm(parseInt(tableNumber, 10))}
            className="mdp-btn"
            style={{ flex: 1, padding: "10px 0", background: t.primary, color: t.bg, border: "none", borderRadius: 8, cursor: !tableNumber || busy ? "default" : "pointer", opacity: !tableNumber || busy ? 0.6 : 1 }}
          >
            {busy ? "Apertura…" : "Apri comanda"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TableList({ t, menu, orders, shiftClosedOrders, expandedClosedId, onToggleClosed, onOpenNew, onOpenOrder, todaysReservations, onAvviaReservation }) {
  const [printingOrder, setPrintingOrder] = useState(null);
  const sorted = [...orders].sort((a, b) => (a.openedAt?.toMillis?.() || 0) - (b.openedAt?.toMillis?.() || 0));
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 100px" }}>
      <TodaysReservations t={t} reservations={todaysReservations} onAvvia={onAvviaReservation} />

      <button
        onClick={onOpenNew}
        className="mdp-btn"
        style={{
          width: "100%", padding: "14px 0", background: t.primary, color: t.bg, border: "none",
          borderRadius: 10, fontSize: TYPE.bodyPlus, fontWeight: 600, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 20,
        }}
      >
        <Plus size={16} /> Nuovo tavolo
      </button>

      {sorted.length === 0 && (
        <div style={{ textAlign: "center", color: t.inkSoft, fontSize: TYPE.body, marginTop: 40 }}>
          Nessun tavolo aperto al momento.
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {sorted.map((o) => {
          const readyCount = (o.items || []).filter((l) => l.status === "out").length;
          const total = o.items?.length || 0;
          return (
            <button
              key={o.id}
              onClick={() => onOpenOrder(o.id)}
              className="mdp-btn"
              style={{
                textAlign: "left", padding: "14px 16px", borderRadius: 10, border: `1px solid ${t.line}`,
                background: t.card, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
              }}
            >
              <div>
                <div style={{ fontSize: TYPE.bodyPlus, fontWeight: 600, color: t.ink }}>
                  {tableIdentity(o).primary}
                  {tableIdentity(o).secondary && (
                    <span style={{ fontWeight: 400, color: t.inkSoft, fontSize: TYPE.tinyPlus }}> · {tableIdentity(o).secondary}</span>
                  )}
                </div>
                <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft, marginTop: 2 }}>
                  {elapsedLabel(o.openedAt)} · {total} {total === 1 ? "voce" : "voci"}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <SyncBadge t={t} hasPendingWrites={o._hasPendingWrites} />
                {total > 0 && (
                  <div style={{ fontSize: TYPE.tinyPlus, color: t.secondary, marginTop: 4 }}>
                    {readyCount}/{total} uscite
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Tavoli chiusi durante il turno in corso (§9 del documento): non
          spariscono del tutto dalla schermata — restano consultabili qui
          fino al cambio di turno (poi solo dallo Storico). */}
      {shiftClosedOrders.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: TYPE.small, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 8 }}>
            Chiusi nel turno — {currentShiftLabel()}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {shiftClosedOrders.map((o) => (
              <OrderRow
                key={o.id}
                t={t}
                order={o}
                expanded={expandedClosedId === o.id}
                onToggle={() => onToggleClosed(o.id)}
                onPrint={setPrintingOrder}
              />
            ))}
          </div>
        </div>
      )}

      {printingOrder && (
        <ReceiptOverlay t={t} menu={menu} order={printingOrder} onClose={() => setPrintingOrder(null)} readOnly />
      )}
    </div>
  );
}

function NewTableForm({ t, onCancel, onCreate, busy }) {
  const [tableNumber, setTableNumber] = useState("");
  const [tableName, setTableName] = useState("");
  const [adults, setAdults] = useState("");
  const [children, setChildren] = useState("");
  const [notes, setNotes] = useState("");
  const inputStyle = { width: "100%", padding: "10px 12px", border: `1px solid ${t.line}`, borderRadius: 6, background: t.bg, color: t.ink, fontSize: TYPE.bodyLg };
  const labelStyle = { fontSize: TYPE.tiny, letterSpacing: 0.8, textTransform: "uppercase", color: t.inkSoft, display: "block", marginBottom: 4, marginTop: 12 };

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: "20px 16px 100px" }}>
      <button onClick={onCancel} className="mdp-btn" style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: t.inkSoft, cursor: "pointer", fontSize: TYPE.smallPlus, marginBottom: 14 }}>
        <ArrowLeft size={14} /> Indietro
      </button>
      <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.heading, fontWeight: 600, color: t.primary, marginBottom: 10 }}>
        Nuovo tavolo
      </div>

      <label style={labelStyle}>Numero tavolo *</label>
      <input style={inputStyle} type="number" min="1" inputMode="numeric" value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} autoFocus />

      <label style={labelStyle}>Nome</label>
      <input style={inputStyle} placeholder="es. Famiglia Rossi, Compleanno…" value={tableName} onChange={(e) => setTableName(e.target.value)} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Adulti</label>
          <input style={inputStyle} type="number" min="0" inputMode="numeric" value={adults} onChange={(e) => setAdults(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Bambini</label>
          <input style={inputStyle} type="number" min="0" inputMode="numeric" value={children} onChange={(e) => setChildren(e.target.value)} />
        </div>
      </div>

      <label style={labelStyle}>Note (allergie, richieste…)</label>
      <textarea aria-label="Note (allergie, richieste…)" rows={2} style={{ ...inputStyle, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} />

      <button
        disabled={!tableNumber || busy}
        onClick={() => onCreate({ tableNumber: parseInt(tableNumber, 10), tableName: tableName.trim(), adults: parseInt(adults, 10) || 0, children: parseInt(children, 10) || 0, notes })}
        className="mdp-btn"
        style={{
          width: "100%", marginTop: 20, padding: "12px 0", background: t.primary, color: t.bg, border: "none",
          borderRadius: 8, fontSize: TYPE.bodyPlus, fontWeight: 600, cursor: !tableNumber || busy ? "default" : "pointer",
          opacity: !tableNumber || busy ? 0.6 : 1,
        }}
      >
        {busy ? "Apertura…" : "Apri tavolo"}
      </button>
    </div>
  );
}

function CoversEditor({ t, order }) {
  const [busy, setBusy] = useState(false);
  const change = async (field, delta) => {
    const next = {
      adults: order.covers?.adults || 0,
      children: order.covers?.children || 0,
      [field]: Math.max(0, (order.covers?.[field] || 0) + delta),
    };
    setBusy(true);
    try {
      await updateCovers(order.id, next);
    } catch (err) {
      console.error("[waiter] Modifica coperti fallita:", err);
    } finally {
      setBusy(false);
    }
  };
  const stepperStyle = { background: "none", border: `1px solid ${t.line}`, borderRadius: 4, width: 20, height: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: TYPE.tinyPlus, color: t.inkSoft, marginTop: 4 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Users size={12} /> Adulti
        <button aria-label="Diminuisci adulti" disabled={busy} onClick={() => change("adults", -1)} className="mdp-btn" style={stepperStyle}><Minus size={10} /></button>
        <span style={{ minWidth: 12, textAlign: "center", color: t.ink }}>{order.covers?.adults || 0}</span>
        <button aria-label="Aumenta adulti" disabled={busy} onClick={() => change("adults", 1)} className="mdp-btn" style={stepperStyle}><Plus size={10} /></button>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        Bambini
        <button aria-label="Diminuisci bambini" disabled={busy} onClick={() => change("children", -1)} className="mdp-btn" style={stepperStyle}><Minus size={10} /></button>
        <span style={{ minWidth: 12, textAlign: "center", color: t.ink }}>{order.covers?.children || 0}</span>
        <button aria-label="Aumenta bambini" disabled={busy} onClick={() => change("children", 1)} className="mdp-btn" style={stepperStyle}><Plus size={10} /></button>
      </span>
      {(order.coperto?.adults || order.coperto?.children) && (
        <span style={{ color: t.inkSoft }}>
          (coperto € {order.coperto.adults}/€ {order.coperto.children})
        </span>
      )}
    </div>
  );
}

function OrderDetail({ t, menu, menuCosts, order, onBack, staffName }) {
  const [draft, setDraft] = useState([]); // { lineId, menuItemId, name, price, categoryId, categoryName, quantity, notes }
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  const categories = menu?.categories || [];
  const normalItems = categories
    .map((c) => ({ ...c, items: c.items.filter((i) => i.visible !== false && !i.staffOnly) }))
    .filter((c) => c.items.length > 0);
  const offMenuItems = categories.flatMap((c) => c.items.filter((i) => i.staffOnly).map((i) => ({ ...i, _categoryId: c.id, _categoryName: c.name })));

  // Ricerca piatti: filtra dal vivo le liste sotto "Aggiungi piatti" mentre
  // il cameriere digita, in qualunque lingua sia stata tradotta la voce —
  // utile quando un cliente straniero chiede un piatto nella propria lingua
  // anche se il pannello cameriere lavora sul menù in italiano. Disattivabile
  // dall'admin (menu.searchEnabled): assente/true = attiva.
  const searchEnabled = menu?.searchEnabled !== false;
  const [itemSearch, setItemSearch] = useState("");
  const isItemSearching = searchEnabled && itemSearch.trim() !== "";
  const filteredNormalItems = isItemSearching
    ? normalItems
        .map((c) => ({ ...c, items: c.items.filter((i) => itemMatchesSearch(menu, c.id, i.id, itemSearch)) }))
        .filter((c) => c.items.length > 0)
    : normalItems;
  const filteredOffMenuItems = isItemSearching
    ? offMenuItems.filter((i) => itemMatchesSearch(menu, i._categoryId, i.id, itemSearch))
    : offMenuItems;

  // La "portata" non è più una scelta manuale (fonte di errori: un piatto
  // finito per sbaglio sotto la categoria selezionata in quel momento), ma
  // sempre la categoria reale del menù a cui il piatto appartiene.
  const addToDraft = (item, categoryId, categoryName) => {
    setDraft((d) => {
      const idx = d.findIndex((l) => l.menuItemId === item.id && !l.notes);
      if (idx >= 0) {
        const next = [...d];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...d, {
        lineId: uid(), menuItemId: item.id, name: item.name, price: item.price,
        cost: menuCosts?.[item.id] || null, categoryId, categoryName, quantity: 1, notes: "",
      }];
    });
  };

  const changeQty = (lineId, delta) => {
    setDraft((d) => d.map((l) => (l.lineId === lineId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l)));
  };
  const removeDraftLine = (lineId) => setDraft((d) => d.filter((l) => l.lineId !== lineId));
  const setDraftNote = (lineId, notes) => setDraft((d) => d.map((l) => (l.lineId === lineId ? { ...l, notes } : l)));

  const send = async () => {
    if (draft.length === 0) return;
    setSending(true);
    setSendError("");
    try {
      const lines = draft.map((l) => buildOrderLine(l));
      await sendOrderLines(order.id, lines);
      setDraft([]);
    } catch (err) {
      console.error("[waiter] Invio comanda fallito:", err);
      setSendError("Invio non riuscito. Verifica la connessione e riprova.");
    } finally {
      setSending(false);
    }
  };

  const doClose = async () => {
    setClosing(true);
    try {
      await closeOrder(order.id);
      onBack();
    } catch (err) {
      console.error("[waiter] Chiusura tavolo fallita:", err);
      setClosing(false);
    }
  };

  // Raggruppa le righe già inviate per categoria reale del menù, nello
  // stesso ordine in cui le categorie compaiono nel menù.
  const sentByCategory = categories
    .map((c) => ({ categoryId: c.id, categoryName: c.name, lines: (order.items || []).filter((l) => l.categoryId === c.id) }))
    .filter((g) => g.lines.length > 0);
  const sentCategoryIds = new Set(categories.map((c) => c.id));
  const sentOther = (order.items || []).filter((l) => !sentCategoryIds.has(l.categoryId));
  if (sentOther.length > 0) {
    sentByCategory.push({ categoryId: "__other__", categoryName: sentOther[0].categoryName || "Altro", lines: sentOther });
  }

  const totalCents = orderTotalCents(order) + draft.reduce((s, l) => {
    const n = parseFloat(String(l.price).replace(",", ".")) || 0;
    return s + Math.round(n * 100) * l.quantity;
  }, 0);

  const statusColor = (status) => (status === "out" ? t.secondary : status === "preparing" ? t.accent : t.inkSoft);
  const statusLabel = (status) => (status === "out" ? "Uscita" : status === "preparing" ? "In preparazione" : "Inviata");

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 16px 140px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={onBack} className="mdp-btn" style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: t.inkSoft, cursor: "pointer", fontSize: TYPE.smallPlus }}>
          <ArrowLeft size={14} /> Tavoli
        </button>
        <SyncBadge t={t} hasPendingWrites={order._hasPendingWrites} />
      </div>

      <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.heading, fontWeight: 600, color: t.primary }}>
        {tableIdentity(order).primary}
        {tableIdentity(order).secondary && (
          <span style={{ fontWeight: 400, fontSize: TYPE.body, color: t.inkSoft }}> · {tableIdentity(order).secondary}</span>
        )}
      </div>
      {order.notes && (
        <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft, marginBottom: 4 }}>{order.notes}</div>
      )}
      <CoversEditor t={t} order={order} />
      <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
        <Clock size={11} /> Aperto alle {formatTime(order.openedAt) || "—"}
      </div>

      {sentByCategory.length > 0 && (
        <div style={{ marginTop: 16, marginBottom: 20 }}>
          <div style={{ fontSize: TYPE.small, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 8 }}>
            Comanda inviata
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {sentByCategory.map(({ categoryId, categoryName, lines }) => (
              <div key={categoryId} style={{ border: `1px solid ${t.line}`, borderRadius: 8, padding: "8px 12px", background: t.card }}>
                <div style={{ fontSize: TYPE.tinyPlus, color: t.secondary, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>{categoryName}</div>
                {lines.map((l) => (
                  <div key={l.lineId} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: TYPE.smallPlus, padding: "3px 0" }}>
                    <span>{l.quantity}× {l.name}{l.notes ? ` (${l.notes})` : ""}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                      <span style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft }}>{formatTime(l.sentAt)}</span>
                      <span style={{ color: statusColor(l.status), fontWeight: 600, fontSize: TYPE.tinyPlus }}>
                        {statusLabel(l.status)}{l.outAt ? ` ${formatTime(l.outAt)}` : ""}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: TYPE.small, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 8 }}>
        Aggiungi piatti
      </div>

      {searchEnabled && (
        <div style={{ position: "relative", marginBottom: 14 }}>
          <Search size={15} color={t.inkSoft} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
          <input
            type="text"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            placeholder="Cerca un piatto…"
            aria-label="Cerca un piatto"
            style={{
              width: "100%", padding: "9px 34px", borderRadius: 8, border: `1px solid ${t.line}`,
              background: t.bg, color: t.ink, fontSize: TYPE.bodyLg, boxSizing: "border-box",
            }}
          />
          {isItemSearching && (
            <button
              onClick={() => setItemSearch("")}
              aria-label="Cancella ricerca"
              className="mdp-btn"
              style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer", color: t.inkSoft,
                display: "flex", alignItems: "center", padding: 4,
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}

      {isItemSearching && filteredNormalItems.length === 0 && filteredOffMenuItems.length === 0 && (
        <div style={{ textAlign: "center", color: t.inkSoft, fontSize: TYPE.body, padding: "16px 0" }}>
          Nessun piatto trovato.
        </div>
      )}

      {filteredNormalItems.map((cat) => (
        <div key={cat.id} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: TYPE.smallPlus, fontWeight: 600, color: t.ink, marginBottom: 6 }}>{cat.name}</div>
          <div style={{ display: "grid", gap: 6 }}>
            {cat.items.map((item) => (
              <button key={item.id} onClick={() => addToDraft(item, cat.id, cat.name)} className="mdp-btn" style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left",
                padding: "8px 12px", borderRadius: 6, border: `1px solid ${t.line}`, background: t.bg, cursor: "pointer",
              }}>
                <span style={{ fontSize: TYPE.smallPlus }}>{item.name}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft }}>€ {item.price}</span>
                  <Plus size={14} color={t.primary} />
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {filteredOffMenuItems.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: TYPE.smallPlus, fontWeight: 600, color: t.accent2, marginBottom: 6 }}>
            <Utensils size={13} /> Fuori menù
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {filteredOffMenuItems.map((item) => (
              <button key={item.id} onClick={() => addToDraft(item, item._categoryId, item._categoryName)} className="mdp-btn" style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left",
                padding: "8px 12px", borderRadius: 6, border: `1px dashed ${t.accent2}`, background: t.bg, cursor: "pointer",
              }}>
                <span style={{ fontSize: TYPE.smallPlus }}>{item.name}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft }}>€ {item.price}</span>
                  <Plus size={14} color={t.accent2} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {draft.length > 0 && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0, background: t.card, borderTop: `1px solid ${t.line}`,
          padding: "12px 16px", boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
        }}>
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            <div style={{ maxHeight: 160, overflowY: "auto", marginBottom: 10 }}>
              {draft.map((l) => (
                <div key={l.lineId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                  <span style={{ flex: 1, fontSize: TYPE.smallPlus }}>{l.name} <span style={{ color: t.inkSoft, fontSize: TYPE.tinyPlus }}>· {l.categoryName}</span></span>
                  <button aria-label={`Diminuisci quantità di ${l.name}`} onClick={() => changeQty(l.lineId, -1)} className="mdp-btn" style={{ background: "none", border: `1px solid ${t.line}`, borderRadius: 4, width: 22, height: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={11} /></button>
                  <span style={{ fontSize: TYPE.smallPlus, minWidth: 14, textAlign: "center" }}>{l.quantity}</span>
                  <button aria-label={`Aumenta quantità di ${l.name}`} onClick={() => changeQty(l.lineId, 1)} className="mdp-btn" style={{ background: "none", border: `1px solid ${t.line}`, borderRadius: 4, width: 22, height: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={11} /></button>
                  <input
                    placeholder="nota"
                    value={l.notes}
                    onChange={(e) => setDraftNote(l.lineId, e.target.value)}
                    style={{ width: 70, fontSize: TYPE.tinyPlus, padding: "3px 6px", border: `1px solid ${t.line}`, borderRadius: 4, background: t.bg, color: t.ink }}
                  />
                  <button aria-label={`Rimuovi ${l.name} dalla comanda`} onClick={() => removeDraftLine(l.lineId)} className="mdp-btn" style={{ background: "none", border: "none", cursor: "pointer", color: t.accent2 }}><X size={14} /></button>
                </div>
              ))}
            </div>
            {sendError && <div style={{ color: t.accent2, fontSize: TYPE.tinyPlus, marginBottom: 8 }}>{sendError}</div>}
            <button onClick={send} disabled={sending} className="mdp-btn" style={{
              width: "100%", padding: "12px 0", background: t.primary, color: t.bg, border: "none", borderRadius: 8,
              fontSize: TYPE.bodyPlus, fontWeight: 600, cursor: sending ? "default" : "pointer", opacity: sending ? 0.7 : 1,
            }}>
              {sending ? "Invio…" : `Invia comanda (${draft.reduce((s, l) => s + l.quantity, 0)})`}
            </button>
          </div>
        </div>
      )}

      {draft.length === 0 && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0, background: t.card, borderTop: `1px solid ${t.line}`,
          padding: "12px 16px",
        }}>
          <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: TYPE.bodyPlus, fontWeight: 600, color: t.ink }}>Totale € {formatCentsAsPrice(totalCents)}</div>
              {copertoTotalCents(order) > 0 && (
                <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft }}>
                  di cui coperto € {formatCentsAsPrice(copertoTotalCents(order))}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowReceipt(true)} className="mdp-btn" style={{
                padding: "10px 12px", background: "none", border: `1px solid ${t.line}`, color: t.ink,
                borderRadius: 8, fontSize: TYPE.smallPlus, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <Receipt size={14} /> Preconto
              </button>
              <button onClick={() => setConfirmClose(true)} className="mdp-btn" style={{
                padding: "10px 16px", background: "none", border: `1px solid ${t.accent2}`, color: t.accent2,
                borderRadius: 8, fontSize: TYPE.smallPlus, cursor: "pointer",
              }}>
                Chiudi tavolo
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmClose && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(20,15,10,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 100 }} onClick={() => setConfirmClose(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: t.card, borderRadius: 12, padding: 24, maxWidth: 360, width: "100%" }}>
            <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.heading, fontWeight: 600, color: t.primary, marginBottom: 10 }}>
              Chiudere {tableIdentity(order).primary}?
            </div>
            <div style={{ fontSize: TYPE.body, color: t.inkSoft, marginBottom: 6 }}>
              {(order.items || []).length} voci ordinate
              {copertoTotalCents(order) > 0 && ` + coperto (${(order.covers?.adults || 0)} adulti, ${(order.covers?.children || 0)} bambini)`}
              {" "}— totale € {formatCentsAsPrice(orderTotalCents(order))}.
            </div>
            <div style={{ fontSize: TYPE.smallPlus, color: t.inkSoft, marginBottom: 20 }}>
              Nessun preconto verrà stampato: questa azione archivia solo la comanda.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmClose(false)} className="mdp-btn" style={{ flex: 1, padding: "10px 0", background: "none", border: `1px solid ${t.line}`, borderRadius: 8, cursor: "pointer" }}>Annulla</button>
              <button onClick={doClose} disabled={closing} className="mdp-btn" style={{ flex: 1, padding: "10px 0", background: t.accent2, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
                {closing ? "Chiusura…" : "Conferma chiusura"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReceipt && (
        <ReceiptOverlay t={t} menu={menu} order={order} onClose={() => setShowReceipt(false)} />
      )}
    </div>
  );
}

function WaiterPanel({ menu, session }) {
  const t = THEMES[menu?.theme] || THEMES.minimal;
  const [orders, setOrders] = useState([]);
  const [ordersReady, setOrdersReady] = useState(false);
  const [shiftClosedOrders, setShiftClosedOrders] = useState([]);
  const [expandedClosedId, setExpandedClosedId] = useState(null);
  const [view, setView] = useState({ mode: "list" }); // list | new | detail | history | reservations
  const [creating, setCreating] = useState(false);
  const [todaysReservations, setTodaysReservations] = useState([]);
  const [avviaTarget, setAvviaTarget] = useState(null);
  const [avviaBusy, setAvviaBusy] = useState(false);
  const [menuCosts, setMenuCosts] = useState({});
  const closingRef = useRef(new Set());

  // Costi dei piatti (src/menuCosts.js), per fotografarli sulle righe della
  // comanda al momento dell'invio — vedi addToDraft in OrderDetail.
  useEffect(() => {
    const unsubscribe = subscribeMenuCosts(setMenuCosts, (err) => console.error("[waiter] Errore lettura costi piatti:", err));
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOpenOrders((list) => {
      setOrders(list);
      setOrdersReady(true);
    }, (err) => console.error("[waiter] Errore lettura comande:", err));
    return unsubscribe;
  }, []);

  // Comande chiuse nel turno in corso (§9): l'inizio turno si calcola una
  // volta all'apertura della schermata — se l'app resta aperta a cavallo
  // del cambio turno (pranzo→cena), basta ricaricare la pagina per
  // aggiornarlo, coerente con gli altri controlli "pigri" già nell'app.
  useEffect(() => {
    const unsubscribe = subscribeShiftClosedOrders(currentShiftStart(), (list) => {
      setShiftClosedOrders(list);
    }, (err) => console.error("[waiter] Errore lettura comande chiuse nel turno:", err));
    return unsubscribe;
  }, []);

  useEffect(() => {
    runDailyExpiredReservationsCleanup();
  }, []);

  // Prenotazioni confermate per oggi: appaiono qui appena inizia il turno,
  // così il cameriere può "avviarle" senza dover ridigitare tavolo/coperti.
  useEffect(() => {
    const unsubscribe = subscribeReservationsForDate(dateKey(), (list) => {
      setTodaysReservations(list.filter((r) => r.status === "confirmed"));
    }, (err) => console.error("[waiter] Errore lettura prenotazioni:", err));
    return unsubscribe;
  }, []);

  // Chiusura automatica pigra dopo 24h (§6.2): ad ogni aggiornamento della
  // lista, chiude le comande rimaste aperte troppo a lungo.
  useEffect(() => {
    if (!ordersReady) return;
    const toClose = orders.filter((o) => !closingRef.current.has(o.id));
    toClose.forEach((o) => closingRef.current.add(o.id));
    autoCloseStaleOrders(toClose).catch(() => {});
  }, [orders, ordersReady]);

  const createTable = async (fields) => {
    setCreating(true);
    try {
      const ref = await openOrder({ ...fields, coperto: menu?.coperto, waiterUid: session.user.uid, waiterName: session.name });
      setView({ mode: "detail", orderId: ref.id });
    } catch (err) {
      console.error("[waiter] Apertura tavolo fallita:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleAvviaReservation = (reservation) => {
    if (reservation.tableNumber) {
      doAvviaReservation(reservation, reservation.tableNumber);
    } else {
      setAvviaTarget(reservation);
    }
  };

  const doAvviaReservation = async (reservation, tableNumber) => {
    setAvviaBusy(true);
    try {
      const ref = await startReservation(reservation, {
        waiterUid: session.user.uid, waiterName: session.name, coperto: menu?.coperto, tableNumber,
      });
      setAvviaTarget(null);
      setView({ mode: "detail", orderId: ref.id });
    } catch (err) {
      console.error("[waiter] Avvio prenotazione fallito:", err);
    } finally {
      setAvviaBusy(false);
    }
  };

  const currentOrder = view.mode === "detail" ? orders.find((o) => o.id === view.orderId) : null;

  return (
    <div className="mdp-root" style={{ minHeight: "100vh" }}>
      <GlobalStyle t={t} />
      <div style={{
        position: "sticky", top: 0, zIndex: 20, background: t.card, borderBottom: `1px solid ${t.line}`,
        padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo width={40} />
          <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.subhead, fontWeight: 600 }}>Sala — {session.name}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={() => setView({ mode: "reservations" })} className="mdp-btn" style={{ background: "none", border: "none", color: t.inkSoft, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: TYPE.smallPlus, padding: "6px 8px" }}>
            <CalendarDays size={14} /> Prenotazioni
          </button>
          <button onClick={() => setView({ mode: "history" })} className="mdp-btn" style={{ background: "none", border: "none", color: t.inkSoft, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: TYPE.smallPlus, padding: "6px 8px" }}>
            <History size={14} /> Storico
          </button>
          <button onClick={staffLogout} className="mdp-btn" style={{ background: "none", border: "none", color: t.inkSoft, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: TYPE.smallPlus, padding: "6px 8px" }}>
            <LogOut size={14} /> Esci
          </button>
        </div>
      </div>

      {!ordersReady && (
        <div style={{ textAlign: "center", padding: 40, color: t.inkSoft }}>Caricamento tavoli…</div>
      )}

      {ordersReady && view.mode === "list" && (
        <TableList
          t={t}
          menu={menu}
          orders={orders}
          shiftClosedOrders={shiftClosedOrders}
          expandedClosedId={expandedClosedId}
          onToggleClosed={(id) => setExpandedClosedId((cur) => (cur === id ? null : id))}
          onOpenNew={() => setView({ mode: "new" })}
          onOpenOrder={(id) => setView({ mode: "detail", orderId: id })}
          todaysReservations={todaysReservations}
          onAvviaReservation={handleAvviaReservation}
        />
      )}
      {ordersReady && view.mode === "new" && (
        <NewTableForm t={t} onCancel={() => setView({ mode: "list" })} onCreate={createTable} busy={creating} />
      )}
      {ordersReady && view.mode === "detail" && currentOrder && (
        <OrderDetail t={t} menu={menu} menuCosts={menuCosts} order={currentOrder} onBack={() => setView({ mode: "list" })} staffName={session.name} />
      )}
      {ordersReady && view.mode === "detail" && !currentOrder && (
        <div style={{ textAlign: "center", padding: 40, color: t.inkSoft }}>
          Questo tavolo non è più aperto.
          <div style={{ marginTop: 12 }}>
            <button onClick={() => setView({ mode: "list" })} className="mdp-btn" style={{ padding: "8px 16px", border: `1px solid ${t.line}`, borderRadius: 6, background: "none", cursor: "pointer" }}>
              Torna ai tavoli
            </button>
          </div>
        </div>
      )}
      {view.mode === "history" && (
        <OrderHistory t={t} menu={menu} onBack={() => setView({ mode: "list" })} />
      )}
      {view.mode === "reservations" && (
        <Suspense fallback={<div style={{ textAlign: "center", padding: 40, color: t.inkSoft }}>Caricamento…</div>}>
          <Reservations menu={menu} onBack={() => setView({ mode: "list" })} />
        </Suspense>
      )}

      {avviaTarget && (
        <AvviaReservationModal
          t={t} reservation={avviaTarget}
          onCancel={() => setAvviaTarget(null)}
          onConfirm={(tableNumber) => doAvviaReservation(avviaTarget, tableNumber)}
          busy={avviaBusy}
        />
      )}
    </div>
  );
}

export default function Waiter({ menu }) {
  const session = useStaffSession();
  const theme = menu?.theme;

  if (session.status === "loading") return <StaffLoadingScreen theme={theme} />;
  if (session.status === "signed-out") {
    return <StaffLoginScreen title="Area cameriere" subtitle="Accedi con il tuo account personale" theme={theme} />;
  }
  if (session.status === "no-role") {
    return (
      <StaffMessageScreen
        theme={theme}
        title="Account senza ruolo"
        message="Il tuo account non ha ancora un ruolo assegnato. Contatta l'amministratore per essere abilitato come cameriere."
        onLogout={staffLogout}
      />
    );
  }
  if (session.role !== "waiter" && session.role !== "admin") {
    return (
      <StaffMessageScreen
        theme={theme}
        title="Accesso non consentito"
        message="Questo account non è abilitato all'area cameriere."
        onLogout={staffLogout}
      />
    );
  }

  if (!menu) return <StaffLoadingScreen theme={theme} />;

  return <WaiterPanel menu={menu} session={session} />;
}
