// Waiter area — digital order taking (see docs/comande-camerieri.md).
// Loaded only at /cameriere (lazy, see MenuApp.jsx), never from the public site.
//
// Phone layout. Inside the Windows till client the same area is shown with
// the full-screen POS layout of TillSala.jsx instead; data and rules are
// shared through sala-shared.jsx.
import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
import { Plus, Minus, X, LogOut, Clock, Utensils, History, Users, Receipt, CalendarDays, Play, Search } from "lucide-react";
import { THEMES, ital, GlobalStyle, Logo, TYPE, formatCentsAsPrice, tableIdentity, currentShiftLabel, BackButton } from "./shared";
import { orderTotalCents, copertoTotalCents, updateCovers } from "./orders";
import { coversLabel } from "./reservationsData";
import {
  useStaffSession, StaffLoginScreen, StaffMessageScreen, StaffLoadingScreen, staffLogout, logoutHiddenAtTill,
} from "./staff-shared";
import { getDesktopBridge } from "./desktop";
import {
  formatTime, elapsedLabel, SyncBadge, lineStatusLabel, lineStatusColor, useSalaData, useOrderDraft,
} from "./sala-shared";
import OrderHistory, { OrderRow } from "./OrderHistory";
import ReceiptOverlay from "./ReceiptOverlay";

const Reservations = lazy(() => import("./Reservations"));
const TillSala = lazy(() => import("./TillSala"));

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
          <button onClick={onCancel} className="mdp-btn" style={{ flex: 1, minHeight: 44, padding: "10px 0", background: "none", border: `1px solid ${t.line}`, borderRadius: 8, cursor: "pointer" }}>Annulla</button>
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

function TableList({ t, menu, orders, kitchenProblemsByOrder = {}, shiftClosedOrders, expandedClosedId, onToggleClosed, onOpenNew, onOpenOrder, todaysReservations, onAvviaReservation }) {
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
                {kitchenProblemsByOrder[o.id] > 0 && (
                  <div style={{ fontSize: TYPE.tinyPlus, color: t.accent2, fontWeight: 700 }}>⚠ Comanda cucina non stampata</div>
                )}
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

      {/* Tables closed during the current shift (§9 of the doc): they don't
          disappear from the screen entirely — they stay accessible here
          until the shift changes (afterwards, only from the History). */}
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
      <BackButton t={t} onClick={onCancel} style={{ marginBottom: 14 }} />
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
  // 44px: tapped at every table, often in a hurry (WCAG/Apple target size).
  const stepperStyle = { background: "none", border: `1px solid ${t.line}`, borderRadius: 8, width: 44, height: 44, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: t.ink };
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 18, rowGap: 8, fontSize: TYPE.smallPlus, color: t.inkSoft, marginTop: 6 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Users size={12} /> Adulti
        <button aria-label="Diminuisci adulti" disabled={busy} onClick={() => change("adults", -1)} className="mdp-btn" style={stepperStyle}><Minus size={16} /></button>
        <span style={{ minWidth: 20, textAlign: "center", color: t.ink, fontSize: TYPE.bodyPlus }}>{order.covers?.adults || 0}</span>
        <button aria-label="Aumenta adulti" disabled={busy} onClick={() => change("adults", 1)} className="mdp-btn" style={stepperStyle}><Plus size={16} /></button>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        Bambini
        <button aria-label="Diminuisci bambini" disabled={busy} onClick={() => change("children", -1)} className="mdp-btn" style={stepperStyle}><Minus size={16} /></button>
        <span style={{ minWidth: 20, textAlign: "center", color: t.ink, fontSize: TYPE.bodyPlus }}>{order.covers?.children || 0}</span>
        <button aria-label="Aumenta bambini" disabled={busy} onClick={() => change("children", 1)} className="mdp-btn" style={stepperStyle}><Plus size={16} /></button>
      </span>
      {(order.coperto?.adults || order.coperto?.children) && (
        <span style={{ color: t.inkSoft }}>
          (coperto € {order.coperto.adults}/€ {order.coperto.children})
        </span>
      )}
    </div>
  );
}

// Kitchen tickets of the table (useOrderKitchenTickets): the last one's print
// status and, for any that may not have reached the kitchen, "Ristampa" and
// "Ignora". Shown above both footers, so also while a new draft is open.
function KitchenTicketStatus({ t, kitchenTicket }) {
  const { status, problems, busy } = kitchenTicket;
  if (!status && problems.length === 0) return null;
  const smallBtn = {
    minHeight: 44, padding: "0 14px", background: "none", border: `1px solid ${t.line}`, color: t.ink,
    borderRadius: 8, fontSize: TYPE.smallPlus, cursor: "pointer", whiteSpace: "nowrap",
  };
  return (
    <div style={{ maxWidth: 640, margin: "0 auto 10px", display: "grid", gap: 8 }}>
      {problems.length > 0 && (
        <div role="group" aria-label="Comande cucina non stampate" style={{ display: "grid", gap: 8 }}>
          {problems.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 180px", fontSize: TYPE.smallPlus, fontWeight: 600, color: t.accent2 }}>
                ⚠ {p.title}: {p.status.text}
              </div>
              <button onClick={p.retry} disabled={busy} className="mdp-btn" style={smallBtn}>Ristampa</button>
              <button onClick={p.dismiss} disabled={busy} className="mdp-btn" style={{ ...smallBtn, color: t.inkSoft }}>Ignora</button>
            </div>
          ))}
        </div>
      )}
      {status && (
        <div role="status" aria-label="Stampa comanda cucina" style={{
          fontSize: TYPE.tinyPlus, fontWeight: 600,
          color: status.tone === "error" ? t.accent2 : status.tone === "ok" ? t.secondary : t.inkSoft,
        }}>
          Comanda cucina: {status.text}
        </div>
      )}
    </div>
  );
}

function OrderDetail({ t, menu, menuCosts, order, senderName, onBack }) {
  const {
    draft, draftCount, addToDraft, changeQty, removeDraftLine, setDraftNote, send, sending, sendError, closeTable, closing,
    searchEnabled, itemSearch, setItemSearch, isItemSearching, filteredNormalItems, filteredOffMenuItems,
    searchTagChips, toggleSearchTag, sentByCategory, totalCents, kitchenTicket,
  } = useOrderDraft({ menu, menuCosts, order, senderName });
  const [confirmClose, setConfirmClose] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  const doClose = async () => {
    if (await closeTable()) onBack();
  };

  // The bottom bar (draft, kitchen tickets, totals) grows with its content:
  // the page leaves that much room, so the last dishes (and "Fuori menù")
  // can always be scrolled out from under it.
  const footerRef = useRef(null);
  const [footerHeight, setFooterHeight] = useState(140);
  const draftOpen = draft.length > 0 || sending; // which of the two bars is shown
  useEffect(() => {
    const el = footerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setFooterHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [draftOpen]);

  const draftBtn = {
    background: "none", border: `1px solid ${t.line}`, borderRadius: 8, width: 44, height: 44, flexShrink: 0,
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: t.ink,
  };
  const statusColor = (status) => lineStatusColor(t, status);
  const statusLabel = lineStatusLabel;
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: `16px 16px ${footerHeight + 24}px` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <BackButton t={t} onClick={onBack} label="Tavoli" />
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

      {searchEnabled && searchTagChips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14, marginTop: -6 }}>
          {searchTagChips.map((tag) => {
            const active = itemSearch.trim().toLowerCase() === tag.toLowerCase();
            return (
              <button
                key={tag}
                onClick={() => toggleSearchTag(tag)}
                className="mdp-btn"
                aria-pressed={active}
                style={{
                  padding: "4px 10px", borderRadius: 999, fontSize: TYPE.tinyPlus, cursor: "pointer",
                  border: `1px solid ${active ? t.primary : t.line}`,
                  background: active ? t.primary : t.bg,
                  color: active ? t.card : t.inkSoft,
                }}
              >
                {tag}
              </button>
            );
          })}
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
                minHeight: 44, padding: "8px 12px", borderRadius: 6, border: `1px solid ${t.line}`, background: t.bg, cursor: "pointer",
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
                minHeight: 44, padding: "8px 12px", borderRadius: 6, border: `1px dashed ${t.accent2}`, background: t.bg, cursor: "pointer",
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

      {draftOpen && (
        <div ref={footerRef} style={{
          position: "fixed", left: 0, right: 0, bottom: 0, background: t.card, borderTop: `1px solid ${t.line}`,
          padding: "12px 16px", boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
        }}>
          <KitchenTicketStatus t={t} kitchenTicket={kitchenTicket} />
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            <div style={{ maxHeight: "min(36vh, 260px)", overflowY: "auto", marginBottom: 10 }}>
              {draft.map((l) => (
                <div key={l.lineId} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "4px 0", borderBottom: `1px solid ${t.line}` }}>
                  <span style={{ flex: "1 1 140px", fontSize: TYPE.smallPlus }}>{l.name} <span style={{ color: t.inkSoft, fontSize: TYPE.tinyPlus }}>· {l.categoryName}</span></span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button aria-label={`Diminuisci quantità di ${l.name}`} onClick={() => changeQty(l.lineId, -1)} className="mdp-btn" style={draftBtn}><Minus size={16} /></button>
                    <span style={{ fontSize: TYPE.bodyPlus, fontWeight: 600, minWidth: 20, textAlign: "center" }}>{l.quantity}</span>
                    <button aria-label={`Aumenta quantità di ${l.name}`} onClick={() => changeQty(l.lineId, 1)} className="mdp-btn" style={draftBtn}><Plus size={16} /></button>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flex: "1 1 160px" }}>
                    <input
                      placeholder="nota"
                      aria-label={`Nota per ${l.name}`}
                      value={l.notes}
                      onChange={(e) => setDraftNote(l.lineId, e.target.value)}
                      style={{ flex: 1, minWidth: 0, minHeight: 44, fontSize: 16, padding: "0 10px", border: `1px solid ${t.line}`, borderRadius: 8, background: t.bg, color: t.ink, boxSizing: "border-box" }}
                    />
                    <button aria-label={`Rimuovi ${l.name} dalla comanda`} onClick={() => removeDraftLine(l.lineId)} className="mdp-btn" style={{ ...draftBtn, border: "none", color: t.accent2 }}><X size={18} /></button>
                  </span>
                </div>
              ))}
            </div>
            {sendError && <div style={{ color: t.accent2, fontSize: TYPE.tinyPlus, marginBottom: 8 }}>{sendError}</div>}
            <button onClick={send} disabled={sending} className="mdp-btn" style={{
              width: "100%", minHeight: 48, padding: "12px 0", background: t.primary, color: t.bg, border: "none", borderRadius: 8,
              fontSize: TYPE.bodyPlus, fontWeight: 600, cursor: sending ? "default" : "pointer", opacity: sending ? 0.7 : 1,
            }}>
              {sending && draft.length === 0 ? "Invio…" : `Invia comanda (${draftCount})`}
            </button>
          </div>
        </div>
      )}

      {!draftOpen && (
        <div ref={footerRef} style={{
          position: "fixed", left: 0, right: 0, bottom: 0, background: t.card, borderTop: `1px solid ${t.line}`,
          padding: "12px 16px",
        }}>
          <KitchenTicketStatus t={t} kitchenTicket={kitchenTicket} />
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
                minHeight: 44, padding: "10px 12px", background: "none", border: `1px solid ${t.line}`, color: t.ink,
                borderRadius: 8, fontSize: TYPE.smallPlus, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <Receipt size={14} /> Preconto
              </button>
              <button onClick={() => setConfirmClose(true)} className="mdp-btn" style={{
                minHeight: 44, padding: "10px 16px", background: "none", border: `1px solid ${t.accent2}`, color: t.accent2,
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
              <button onClick={() => setConfirmClose(false)} className="mdp-btn" style={{ flex: 1, minHeight: 44, padding: "10px 0", background: "none", border: `1px solid ${t.line}`, borderRadius: 8, cursor: "pointer" }}>Annulla</button>
              <button onClick={doClose} disabled={closing} className="mdp-btn" style={{ flex: 1, minHeight: 44, padding: "10px 0", background: t.accent2, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
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
  const { orders, ordersReady, shiftClosedOrders, todaysReservations, menuCosts, kitchenProblemsByOrder, createTable: openTable, startFromReservation } = useSalaData({ menu, session });
  const [expandedClosedId, setExpandedClosedId] = useState(null);
  const [view, setView] = useState({ mode: "list" }); // list | new | detail | history | reservations
  const [creating, setCreating] = useState(false);
  const [avviaTarget, setAvviaTarget] = useState(null);
  const [avviaBusy, setAvviaBusy] = useState(false);

  const createTable = async (fields) => {
    setCreating(true);
    const id = await openTable(fields);
    setCreating(false);
    if (id) setView({ mode: "detail", orderId: id });
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
    const id = await startFromReservation(reservation, tableNumber);
    setAvviaBusy(false);
    if (id) {
      setAvviaTarget(null);
      setView({ mode: "detail", orderId: id });
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
          {!logoutHiddenAtTill() && (
            <button onClick={staffLogout} className="mdp-btn" style={{ background: "none", border: "none", color: t.inkSoft, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: TYPE.smallPlus, padding: "6px 8px" }}>
              <LogOut size={14} /> Esci
            </button>
          )}
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
          kitchenProblemsByOrder={kitchenProblemsByOrder}
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
        <OrderDetail t={t} menu={menu} menuCosts={menuCosts} order={currentOrder} senderName={session.name} onBack={() => setView({ mode: "list" })} />
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
        <OrderHistory t={t} menu={menu} onBack={() => setView({ mode: "list" })} isAdmin={session.role === "admin"} />
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

  // Till client: full-screen POS layout (TillSala.jsx), same data and rules.
  if (getDesktopBridge()) {
    return (
      <Suspense fallback={<StaffLoadingScreen theme={theme} />}>
        <TillSala menu={menu} session={session} />
      </Suspense>
    );
  }

  return <WaiterPanel menu={menu} session={session} />;
}
