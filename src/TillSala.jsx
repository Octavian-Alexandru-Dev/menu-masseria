// Sala (waiter area) for the till — the full-screen POS layout shown inside
// the Windows client (desktop-client/) instead of the phone layout of
// Waiter.jsx. Same data and rules, shared through sala-shared.jsx; so the
// till can also replace a waiter's phone (open tables, take and send
// orders, receipts, closing) when nobody has one at hand.
//
// Layout follows established guidance rather than inventing anything (see
// docs/stampa-scontrini.md, "Interfaccia della cassa"):
//  - floor at a glance: every open table is a tile in a grid that fills the
//    screen, with number, name, covers, elapsed time, running total and
//    kitchen progress — status is always written, never colour alone;
//  - order screen split like common restaurant POS: menu tiles on the left
//    (category tabs + search), the ticket on the right with the primary
//    actions always in the same place at its bottom;
//  - touch targets of at least 48px (Material 48dp / Apple 44pt / WCAG
//    2.5.5), an on-screen numeric keypad for the table number (the till has
//    no keyboard), confirmation before irreversible actions;
//  - no "Esci": logging out lives in the client's settings.
import React, { useState, useEffect, Suspense, lazy } from "react";
import {
  Plus, Minus, X, Delete, Users, Clock, Receipt, Search, Utensils, CalendarDays, History, LayoutGrid,
  Play, Send, StickyNote, Lock, Printer, LogOut,
} from "lucide-react";
import {
  THEMES, GlobalStyle, Logo, formatCentsAsPrice, parsePriceToCents, tableIdentity, currentShiftLabel, BackButton,
} from "./shared";
import { orderTotalCents, copertoTotalCents, updateCovers } from "./orders";
import { coversLabel } from "./reservationsData";
import { confirmAction } from "./confirmDialog";
import { staffLogout, logoutHiddenAtTill } from "./staff-shared";
import {
  formatTime, elapsedLabel, SyncBadge, lineStatusLabel, useSalaData, useOrderDraft,
} from "./sala-shared";
import OrderHistory from "./OrderHistory";
import ReceiptOverlay from "./ReceiptOverlay";

const Reservations = lazy(() => import("./Reservations"));

const TOUCH = 48; // minimum touch target (px)

// Status colours fixed for the till, independent of the menu theme (some
// themes are nearly monochrome): POS screens rely on a small, stable,
// recognisable set — always paired with a written label, never alone.
const STATUS = {
  idle: "#7d7d7d",      // da ordinare
  kitchen: "#c77700",   // in cucina
  served: "#2e7d4f",    // tutto servito
  receipt: "#2f62a8",   // preconto confermato
  danger: "#b03a2e",    // azioni distruttive (chiudi tavolo, rimuovi)
};
const FONT = "'Work Sans', system-ui, sans-serif";

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const DATE_LABEL = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" });

/* --------------------------------- top bar --------------------------------- */

function TopBar({ t, session, tab, onTab, openCount }) {
  const now = useClock();
  const tabs = [
    { key: "floor", label: "Tavoli", icon: LayoutGrid, badge: openCount },
    { key: "reservations", label: "Prenotazioni", icon: CalendarDays },
    { key: "history", label: "Storico", icon: History },
  ];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 18, padding: "10px 20px", minHeight: 76, flexShrink: 0,
      background: t.card, borderBottom: `1px solid ${t.line}`,
    }}>
      <Logo width={64} />
      <nav aria-label="Sezioni della sala" style={{ display: "flex", gap: 8 }}>
        {tabs.map((tb) => {
          const active = tab === tb.key;
          return (
            <button
              key={tb.key}
              type="button"
              onClick={() => onTab(tb.key)}
              aria-current={active ? "page" : undefined}
              className="mdp-btn"
              style={{
                display: "flex", alignItems: "center", gap: 8, minHeight: 56, padding: "0 20px", borderRadius: 12,
                border: `1.5px solid ${active ? t.primary : t.line}`, background: active ? t.primary : t.bg,
                color: active ? t.bg : t.ink, fontSize: 17, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
              }}
            >
              <tb.icon size={20} /> {tb.label}
              {tb.badge > 0 && (
                <span style={{
                  minWidth: 26, height: 26, borderRadius: 13, padding: "0 7px", fontSize: 14, fontWeight: 700,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: active ? t.bg : t.primary, color: active ? t.primary : t.bg,
                }}>{tb.badge}</span>
              )}
            </button>
          );
        })}
      </nav>
      {/* Only for clients older than 1.4.0, which have no "Esci
          dall'account" in their settings yet (confirmed, see staffLogout). */}
      {!logoutHiddenAtTill() && (
        <button type="button" onClick={staffLogout} className="mdp-btn" style={{
          display: "flex", alignItems: "center", gap: 6, minHeight: TOUCH, padding: "0 14px", borderRadius: 10,
          border: `1.5px solid ${t.line}`, background: t.bg, color: t.inkSoft, fontSize: 15, cursor: "pointer", fontFamily: FONT,
        }}><LogOut size={18} /> Esci</button>
      )}
      <div style={{ marginLeft: "auto", textAlign: "right", fontFamily: FONT }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: t.ink, lineHeight: 1.1 }}>
          {now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
        </div>
        <div style={{ fontSize: 14, color: t.inkSoft, textTransform: "capitalize" }}>
          {DATE_LABEL.format(now)} · {currentShiftLabel()} · {session.name}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- floor ---------------------------------- */

// Status of an open table, as text + colour (never colour alone).
function tableStatus(order) {
  const items = order.items || [];
  if (order.receipt?.confirmedAt) return { label: "Preconto confermato", color: STATUS.receipt };
  if (items.length === 0) return { label: "Da ordinare", color: STATUS.idle };
  const out = items.filter((l) => l.status === "out").length;
  if (out === items.length) return { label: "Tutto servito", color: STATUS.served };
  return { label: `In cucina · ${out}/${items.length} uscite`, color: STATUS.kitchen };
}

function TableTile({ t, order, onOpen }) {
  const id = tableIdentity(order);
  const status = tableStatus(order);
  const covers = (order.covers?.adults || 0) + (order.covers?.children || 0);
  const number = order.tableNumber;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${id.primary}${id.secondary ? ` (${id.secondary})` : ""} — ${status.label} — totale € ${formatCentsAsPrice(orderTotalCents(order))}`}
      className="mdp-btn"
      style={{
        position: "relative", display: "flex", flexDirection: "column", alignItems: "stretch", textAlign: "left",
        minHeight: 190, padding: "14px 16px 14px 22px", borderRadius: 16, border: `1.5px solid ${t.line}`,
        background: t.card, cursor: "pointer", fontFamily: FONT, color: t.ink, overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
      }}
    >
      <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 8, background: status.color }} />
      <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 15, color: t.inkSoft, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>Tavolo</span>
        {order._hasPendingWrites && <SyncBadge t={t} hasPendingWrites />}
      </span>
      <span style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.05 }}>{number}</span>
      {order.tableName && (
        <span style={{ fontSize: 16, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{order.tableName}</span>
      )}
      <span style={{ display: "flex", gap: 12, fontSize: 14, color: t.inkSoft, marginTop: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Users size={14} /> {covers}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={14} /> {elapsedLabel(order.openedAt)}</span>
      </span>
      <span style={{ marginTop: "auto", paddingTop: 10, fontSize: 22, fontWeight: 700 }}>€ {formatCentsAsPrice(orderTotalCents(order))}</span>
      <span style={{
        alignSelf: "flex-start", marginTop: 6, padding: "4px 10px", borderRadius: 8, fontSize: 13, fontWeight: 700,
        color: "#fff", background: status.color,
      }}>{status.label}</span>
    </button>
  );
}

function ClosedTile({ t, order, onPrint }) {
  const id = tableIdentity(order);
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 6, minHeight: 150, padding: 16, borderRadius: 16,
      border: `1.5px dashed ${t.line}`, background: t.bgAlt || t.bg, fontFamily: FONT, color: t.ink,
    }}>
      <span style={{ fontSize: 15, color: t.inkSoft, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>Chiuso {formatTime(order.closedAt) || ""}</span>
      <span style={{ fontSize: 22, fontWeight: 700 }}>{id.primary}</span>
      {id.secondary && <span style={{ fontSize: 14, color: t.inkSoft }}>{id.secondary}</span>}
      <span style={{ fontSize: 18, fontWeight: 700, marginTop: "auto" }}>€ {formatCentsAsPrice(orderTotalCents(order))}</span>
      <button type="button" onClick={onPrint} aria-label={`Preconto di ${id.primary}`} className="mdp-btn" style={{
        minHeight: TOUCH, borderRadius: 10, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink,
        fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      }}>
        <Printer size={18} /> Preconto
      </button>
    </div>
  );
}

function FloorView({ t, menu, orders, shiftClosedOrders, todaysReservations, onNew, onOpen, onAvvia }) {
  const [showClosed, setShowClosed] = useState(false);
  const [printingOrder, setPrintingOrder] = useState(null);
  const sorted = [...orders].sort((a, b) => (a.tableNumber || 0) - (b.tableNumber || 0));
  const segment = (key, label, active) => (
    <button type="button" onClick={() => setShowClosed(key === "closed")} aria-pressed={active} className="mdp-btn" style={{
      minHeight: TOUCH, padding: "0 18px", borderRadius: 10, border: `1.5px solid ${active ? t.ink : t.line}`,
      background: active ? t.ink : t.card, color: active ? t.bg : t.ink, fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
    }}>{label}</button>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "18px 20px 96px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {segment("open", `Aperti (${orders.length})`, !showClosed)}
          {segment("closed", `Chiusi nel turno (${shiftClosedOrders.length})`, showClosed)}
        </div>

        <div data-testid="till-floor-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14 }}>
          {!showClosed && (
            <button type="button" onClick={onNew} className="mdp-btn" style={{
              minHeight: 190, borderRadius: 16, border: `2px dashed ${t.primary}`, background: t.bg, color: t.primary,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
              fontSize: 19, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
            }}>
              <Plus size={40} strokeWidth={2.5} /> Nuovo tavolo
            </button>
          )}
          {!showClosed && sorted.map((o) => <TableTile key={o.id} t={t} order={o} onOpen={() => onOpen(o.id)} />)}
          {showClosed && shiftClosedOrders.map((o) => <ClosedTile key={o.id} t={t} order={o} onPrint={() => setPrintingOrder(o)} />)}
        </div>
        {showClosed && shiftClosedOrders.length === 0 && (
          <div style={{ color: t.inkSoft, fontSize: 17, padding: "30px 4px", fontFamily: FONT }}>Nessun tavolo chiuso in questo turno.</div>
        )}
      </div>

      {todaysReservations.length > 0 && (
        <aside aria-label="Prenotazioni di oggi" style={{
          width: 320, flexShrink: 0, overflowY: "auto", padding: "18px 16px 96px", borderLeft: `1px solid ${t.line}`, background: t.card, fontFamily: FONT,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: t.secondary, marginBottom: 12 }}>
            Prenotazioni di oggi · {todaysReservations.length}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {todaysReservations.map((r) => (
              <div key={r.id} style={{ padding: 12, borderRadius: 12, border: `1px solid ${t.line}`, background: t.bg }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: t.ink }}>{r.name || "Senza nome"}{r.time ? ` · ${r.time}` : ""}</div>
                <div style={{ fontSize: 14, color: t.inkSoft, margin: "2px 0 10px" }}>
                  {coversLabel(r.covers)}{r.tableNumber ? ` · Tavolo ${r.tableNumber}` : ""}
                </div>
                <button type="button" onClick={() => onAvvia(r)} aria-label={`Avvia prenotazione di ${r.name || "senza nome"}`} className="mdp-btn" style={{
                  width: "100%", minHeight: TOUCH, borderRadius: 10, border: "none", background: t.primary, color: t.bg,
                  fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}>
                  <Play size={18} /> Avvia
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}

      {printingOrder && <ReceiptOverlay t={t} menu={menu} order={printingOrder} onClose={() => setPrintingOrder(null)} readOnly />}
    </div>
  );
}

/* ------------------------- table number keypad dialog ------------------------- */

function Stepper({ t, label, value, onChange }) {
  const btn = {
    width: 56, height: 56, borderRadius: 12, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink,
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 17, fontWeight: 600 }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" aria-label={`Diminuisci ${label.toLowerCase()}`} onClick={() => onChange(Math.max(0, value - 1))} className="mdp-btn" style={btn}><Minus size={22} /></button>
        <span aria-label={label} style={{ minWidth: 36, textAlign: "center", fontSize: 26, fontWeight: 700 }}>{value}</span>
        <button type="button" aria-label={`Aumenta ${label.toLowerCase()}`} onClick={() => onChange(value + 1)} className="mdp-btn" style={btn}><Plus size={22} /></button>
      </span>
    </div>
  );
}

// Opening a table: table number from an on-screen keypad, covers with
// steppers, optional name/notes. `fixedReservation` = starting a booked
// table (only the number is asked).
function NewTableDialog({ t, openOrders, onCancel, onCreate, onGoTo, busy, reservation }) {
  const [digits, setDigits] = useState(reservation?.tableNumber ? String(reservation.tableNumber) : "");
  const [adults, setAdults] = useState(0);
  const [children, setChildren] = useState(0);
  const [tableName, setTableName] = useState("");
  const [notes, setNotes] = useState("");
  const number = parseInt(digits, 10) || 0;
  const alreadyOpen = number ? openOrders.find((o) => o.tableNumber === number) : null;

  const press = (k) => {
    if (k === "C") setDigits("");
    else if (k === "⌫") setDigits((d) => d.slice(0, -1));
    else setDigits((d) => (d.length >= 4 ? d : (d + k).replace(/^0+/, "")));
  };
  const keyStyle = {
    minHeight: 68, borderRadius: 14, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink,
    fontSize: 28, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT,
  };
  const inputStyle = {
    width: "100%", minHeight: 52, padding: "0 14px", borderRadius: 12, border: `1.5px solid ${t.line}`,
    background: t.card, color: t.ink, fontSize: 17, fontFamily: FONT, boxSizing: "border-box",
  };

  return (
    <div role="presentation" onClick={onCancel} style={{
      position: "fixed", inset: 0, zIndex: 100, background: "rgba(20,15,10,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div role="dialog" aria-modal="true" aria-label={reservation ? `Avvia ${reservation.name || "prenotazione"}` : "Nuovo tavolo"} onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 820, maxHeight: "100%", overflowY: "auto", background: t.bg, borderRadius: 20,
        padding: 24, fontFamily: FONT, color: t.ink, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}>
        <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>
          {reservation ? `Avvia ${reservation.name || "prenotazione"}` : "Nuovo tavolo"}
        </div>
        {reservation && (
          <div style={{ fontSize: 16, color: t.inkSoft, marginBottom: 8 }}>{coversLabel(reservation.covers)}{reservation.notes ? ` · ${reservation.notes}` : ""}</div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: reservation ? "1fr" : "minmax(260px, 1fr) minmax(280px, 1.1fr)", gap: 24, marginTop: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: t.inkSoft, marginBottom: 6 }}>Numero tavolo</div>
            <div aria-label="Numero tavolo" role="textbox" aria-readonly="true" style={{
              minHeight: 72, borderRadius: 14, border: `2px solid ${t.primary}`, background: t.card, marginBottom: 12,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44, fontWeight: 700,
              color: digits ? t.ink : t.inkSoft,
            }}>{digits || "—"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map((k) => (
                <button key={k} type="button" onClick={() => press(k)} className="mdp-btn"
                  aria-label={k === "C" ? "Cancella numero" : k === "⌫" ? "Cancella ultima cifra" : `Cifra ${k}`}
                  style={{ ...keyStyle, ...(k === "C" || k === "⌫" ? { fontSize: 20, color: t.inkSoft } : null) }}>
                  {k === "⌫" ? <Delete size={26} /> : k}
                </button>
              ))}
            </div>
          </div>
          {!reservation && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: t.inkSoft }}>Coperti</div>
              <Stepper t={t} label="Adulti" value={adults} onChange={setAdults} />
              <Stepper t={t} label="Bambini" value={children} onChange={setChildren} />
              <label style={{ fontSize: 15, fontWeight: 600, color: t.inkSoft }}>
                Nome (facoltativo)
                <input style={{ ...inputStyle, marginTop: 6 }} placeholder="es. Famiglia Rossi" value={tableName} onChange={(e) => setTableName(e.target.value)} />
              </label>
              <label style={{ fontSize: 15, fontWeight: 600, color: t.inkSoft }}>
                Note (allergie, richieste…)
                <input style={{ ...inputStyle, marginTop: 6 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>
          )}
        </div>

        {alreadyOpen && (
          <div role="alert" style={{ marginTop: 16, padding: "10px 14px", borderRadius: 12, background: "#fff4e0", color: "#7a4a00", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span>Il tavolo {number} è già aperto.</span>
            <button type="button" onClick={() => onGoTo(alreadyOpen.id)} className="mdp-btn" style={{
              minHeight: TOUCH, padding: "0 16px", borderRadius: 10, border: "none", background: "#7a4a00", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer",
            }}>Vai al tavolo {number}</button>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <button type="button" onClick={onCancel} className="mdp-btn" style={{
            flex: 1, minHeight: 60, borderRadius: 14, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink,
            fontSize: 18, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
          }}>Annulla</button>
          <button type="button" disabled={!number || busy}
            onClick={() => onCreate({ tableNumber: number, tableName: tableName.trim(), adults, children, notes })}
            className="mdp-btn" style={{
              flex: 2, minHeight: 60, borderRadius: 14, border: "none", background: t.primary, color: t.bg,
              fontSize: 19, fontWeight: 700, cursor: !number || busy ? "default" : "pointer", opacity: !number || busy ? 0.5 : 1, fontFamily: FONT,
            }}>
            {busy ? "Apertura…" : reservation ? "Apri comanda" : number ? `Apri tavolo ${number}` : "Apri tavolo"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- order screen ------------------------------- */

function CoversControl({ t, order }) {
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
      console.error("[till] Modifica coperti fallita:", err);
    } finally {
      setBusy(false);
    }
  };
  const btn = {
    width: TOUCH, height: TOUCH, borderRadius: 10, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink,
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
  };
  const group = (field, label) => (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 15, color: t.inkSoft }}>{label}</span>
      <button type="button" aria-label={`Diminuisci ${label.toLowerCase()}`} disabled={busy} onClick={() => change(field, -1)} className="mdp-btn" style={btn}><Minus size={18} /></button>
      <span style={{ minWidth: 24, textAlign: "center", fontSize: 20, fontWeight: 700 }}>{order.covers?.[field] || 0}</span>
      <button type="button" aria-label={`Aumenta ${label.toLowerCase()}`} disabled={busy} onClick={() => change(field, 1)} className="mdp-btn" style={btn}><Plus size={18} /></button>
    </span>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <Users size={18} color={t.inkSoft} />
      {group("adults", "Adulti")}
      {group("children", "Bambini")}
    </div>
  );
}

function DishTile({ t, item, quantityInDraft, offMenu, onAdd }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={`Aggiungi ${item.name}, € ${item.price}`}
      className="mdp-btn"
      style={{
        position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", textAlign: "left",
        minHeight: 104, padding: "12px 14px", borderRadius: 14, cursor: "pointer", fontFamily: FONT, color: t.ink,
        border: offMenu ? `2px dashed ${t.accent2}` : `1.5px solid ${quantityInDraft ? t.primary : t.line}`,
        background: quantityInDraft ? `${t.primary}14` : t.card,
      }}
    >
      <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.25, paddingRight: quantityInDraft ? 34 : 0 }}>{item.name}</span>
      <span style={{ fontSize: 16, color: t.inkSoft, marginTop: 8 }}>€ {item.price}</span>
      {quantityInDraft > 0 && (
        <span aria-hidden="true" style={{
          position: "absolute", top: 10, right: 10, minWidth: 30, height: 30, borderRadius: 15, padding: "0 8px",
          background: t.primary, color: t.bg, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
        }}>{quantityInDraft}</span>
      )}
    </button>
  );
}

function OrderView({ t, menu, menuCosts, order, onBack }) {
  const d = useOrderDraft({ menu, menuCosts, order });
  const [categoryId, setCategoryId] = useState(null);
  const [noteOpen, setNoteOpen] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const id = tableIdentity(order);

  const tabs = [
    ...d.normalItems.map((c) => ({ id: c.id, name: c.name })),
    ...(d.offMenuItems.length > 0 ? [{ id: "__offmenu__", name: "Fuori menù" }] : []),
  ];
  const activeTab = categoryId && tabs.some((tb) => tb.id === categoryId) ? categoryId : tabs[0]?.id;

  // Which tiles to show: the selected category, or — while searching —
  // every match across the menu.
  let tiles;
  if (d.isItemSearching) {
    tiles = [
      ...d.filteredNormalItems.flatMap((c) => c.items.map((item) => ({ item, categoryId: c.id, categoryName: c.name, offMenu: false }))),
      ...d.filteredOffMenuItems.map((item) => ({ item, categoryId: item._categoryId, categoryName: item._categoryName, offMenu: true })),
    ];
  } else if (activeTab === "__offmenu__") {
    tiles = d.offMenuItems.map((item) => ({ item, categoryId: item._categoryId, categoryName: item._categoryName, offMenu: true }));
  } else {
    const cat = d.normalItems.find((c) => c.id === activeTab);
    tiles = (cat?.items || []).map((item) => ({ item, categoryId: cat.id, categoryName: cat.name, offMenu: false }));
  }
  const draftQty = (itemId) => d.draft.filter((l) => l.menuItemId === itemId).reduce((s, l) => s + l.quantity, 0);

  const doClose = async () => {
    const pending = d.draftCount > 0 ? ` Attenzione: ${d.draftCount} piatti non ancora inviati verranno persi.` : "";
    const confirmed = await confirmAction({
      title: `Chiudere ${id.primary}?`,
      message: `${(order.items || []).length} voci ordinate — totale € ${formatCentsAsPrice(orderTotalCents(order))}. La comanda viene archiviata (nessun preconto stampato).${pending}`,
      confirmLabel: "Chiudi tavolo",
      danger: true,
    });
    if (confirmed && await d.closeTable()) onBack();
  };

  const chip = (active) => ({
    flexShrink: 0, minHeight: 52, padding: "0 20px", borderRadius: 12, fontSize: 17, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
    border: `1.5px solid ${active ? t.primary : t.line}`, background: active ? t.primary : t.card, color: active ? t.bg : t.ink,
  });
  const smallBtn = {
    width: TOUCH, height: TOUCH, borderRadius: 10, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink,
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
  };
  const coperto = copertoTotalCents(order);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(360px, 34%)", fontFamily: FONT, color: t.ink }}>
      {/* ------------------------------ menu side ------------------------------ */}
      <section aria-label="Menu" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", borderBottom: `1px solid ${t.line}`, flexWrap: "wrap" }}>
          <BackButton t={t} onClick={onBack} label="Tavoli" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>
              {id.primary}{id.secondary && <span style={{ fontSize: 17, fontWeight: 500, color: t.inkSoft }}> · {id.secondary}</span>}
            </div>
            <div style={{ fontSize: 14, color: t.inkSoft, display: "flex", gap: 10, alignItems: "center", marginTop: 2 }}>
              <span>Aperto alle {formatTime(order.openedAt) || "—"}</span>
              <SyncBadge t={t} hasPendingWrites={order._hasPendingWrites} />
            </div>
            {order.notes && <div style={{ fontSize: 14, color: STATUS.kitchen, marginTop: 2, fontWeight: 600 }}>{order.notes}</div>}
          </div>
          <div style={{ marginLeft: "auto" }}><CoversControl t={t} order={order} /></div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px 0" }}>
          <div role="tablist" aria-label="Categorie del menù" style={{ display: "flex", gap: 8, overflowX: "auto", flex: 1, minWidth: 0, paddingBottom: 4 }}>
            {tabs.map((tb) => {
              const active = !d.isItemSearching && tb.id === activeTab;
              return (
                <button key={tb.id} type="button" role="tab" aria-selected={active}
                  onClick={() => { d.setItemSearch(""); setCategoryId(tb.id); }}
                  className="mdp-btn" style={{ ...chip(active), ...(tb.id === "__offmenu__" && !active ? { color: t.accent2, borderColor: t.accent2 } : null) }}>
                  {tb.id === "__offmenu__" && <Utensils size={16} style={{ marginRight: 6, verticalAlign: "-2px" }} />}{tb.name}
                </button>
              );
            })}
          </div>
          {d.searchEnabled && (
            <div style={{ position: "relative", width: 260, flexShrink: 0 }}>
              <Search size={18} color={t.inkSoft} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              <input type="text" value={d.itemSearch} onChange={(e) => d.setItemSearch(e.target.value)} placeholder="Cerca un piatto…" aria-label="Cerca un piatto"
                style={{ width: "100%", minHeight: 52, padding: "0 48px 0 42px", borderRadius: 12, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink, fontSize: 17, fontFamily: FONT, boxSizing: "border-box" }} />
              {d.isItemSearching && (
                <button type="button" onClick={() => d.setItemSearch("")} aria-label="Cancella ricerca" className="mdp-btn" style={{
                  position: "absolute", right: 2, top: 2, width: TOUCH, height: TOUCH, border: "none", background: "none", color: t.inkSoft, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}><X size={20} /></button>
              )}
            </div>
          )}
        </div>
        {d.searchEnabled && d.searchTagChips.length > 0 && (
          <div style={{ display: "flex", gap: 8, padding: "10px 20px 0", flexWrap: "wrap" }}>
            {d.searchTagChips.map((tag) => {
              const active = d.itemSearch.trim().toLowerCase() === tag.toLowerCase();
              return (
                <button key={tag} type="button" aria-pressed={active} onClick={() => d.toggleSearchTag(tag)} className="mdp-btn" style={{
                  minHeight: 44, padding: "0 16px", borderRadius: 22, fontSize: 15, cursor: "pointer", fontFamily: FONT,
                  border: `1.5px solid ${active ? t.ink : t.line}`, background: active ? t.ink : t.bg, color: active ? t.bg : t.inkSoft,
                }}>{tag}</button>
              );
            })}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 20px 96px" }}>
          {d.isItemSearching && tiles.length === 0 && (
            <div style={{ color: t.inkSoft, fontSize: 17, padding: "24px 0" }}>Nessun piatto trovato.</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
            {tiles.map(({ item, categoryId: cId, categoryName, offMenu }) => (
              <DishTile key={`${cId}-${item.id}`} t={t} item={item} offMenu={offMenu} quantityInDraft={draftQty(item.id)}
                onAdd={() => d.addToDraft(item, cId, categoryName)} />
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------ ticket side ------------------------------ */}
      <section aria-label="Comanda del tavolo" style={{ display: "flex", flexDirection: "column", minHeight: 0, borderLeft: `1px solid ${t.line}`, background: t.card }}>
        <div style={{ padding: "16px 18px 10px", fontSize: 15, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: t.inkSoft }}>
          Comanda — {id.primary}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 18px 12px" }}>
          {d.sentByCategory.length === 0 && d.draft.length === 0 && (
            <div style={{ color: t.inkSoft, fontSize: 17, padding: "24px 0", lineHeight: 1.5 }}>
              Ancora nulla per questo tavolo.<br />Tocca un piatto a sinistra per aggiungerlo.
            </div>
          )}

          {d.sentByCategory.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.secondary, textTransform: "uppercase", letterSpacing: 0.6, margin: "4px 0 6px" }}>Già inviato</div>
              {d.sentByCategory.map(({ categoryId: cId, categoryName, lines }) => (
                <div key={cId} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 13, color: t.inkSoft, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{categoryName}</div>
                  {lines.map((l) => (
                    <div key={l.lineId} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "6px 0", borderBottom: `1px solid ${t.line}` }}>
                      <span style={{ fontSize: 16 }}>
                        <strong>{l.quantity}×</strong> {l.name}{l.notes ? <span style={{ color: t.inkSoft }}> ({l.notes})</span> : null}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: l.status === "out" ? STATUS.served : l.status === "preparing" ? STATUS.kitchen : STATUS.idle, whiteSpace: "nowrap" }}>
                        {lineStatusLabel(l.status)} {formatTime(l.outAt || l.sentAt) || ""}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {d.draft.length > 0 && (
            <div aria-label="Da inviare" role="group" style={{ borderRadius: 14, border: `2px solid ${t.primary}`, padding: "8px 12px", background: `${t.primary}0d` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.primary, textTransform: "uppercase", letterSpacing: 0.6, margin: "2px 0 4px" }}>Da inviare</div>
              {d.draft.map((l) => (
                <div key={l.lineId} style={{ padding: "8px 0", borderBottom: `1px solid ${t.line}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 17, fontWeight: 600 }}>{l.name}</span>
                      <span style={{ fontSize: 13, color: t.inkSoft }}>{l.categoryName} · € {formatCentsAsPrice(parsePriceToCents(l.price) * l.quantity)}</span>
                    </span>
                    <button type="button" aria-label={`Diminuisci quantità di ${l.name}`} onClick={() => d.changeQty(l.lineId, -1)} className="mdp-btn" style={smallBtn}><Minus size={18} /></button>
                    <span style={{ minWidth: 26, textAlign: "center", fontSize: 20, fontWeight: 700 }}>{l.quantity}</span>
                    <button type="button" aria-label={`Aumenta quantità di ${l.name}`} onClick={() => d.changeQty(l.lineId, 1)} className="mdp-btn" style={smallBtn}><Plus size={18} /></button>
                    <button type="button" aria-label={`Nota per ${l.name}`} aria-pressed={noteOpen === l.lineId} onClick={() => setNoteOpen((cur) => (cur === l.lineId ? null : l.lineId))} className="mdp-btn" style={{ ...smallBtn, color: l.notes ? t.primary : t.inkSoft }}><StickyNote size={18} /></button>
                    <button type="button" aria-label={`Rimuovi ${l.name} dalla comanda`} onClick={() => d.removeDraftLine(l.lineId)} className="mdp-btn" style={{ ...smallBtn, color: STATUS.danger }}><X size={18} /></button>
                  </div>
                  {(noteOpen === l.lineId || l.notes) && (
                    <input autoFocus={noteOpen === l.lineId} value={l.notes} onChange={(e) => d.setDraftNote(l.lineId, e.target.value)}
                      placeholder="Nota per la cucina (es. senza glutine)" aria-label={`Nota di ${l.name}`}
                      style={{ width: "100%", minHeight: TOUCH, marginTop: 8, padding: "0 12px", borderRadius: 10, border: `1.5px solid ${t.line}`, background: t.bg, color: t.ink, fontSize: 16, fontFamily: FONT, boxSizing: "border-box" }} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: "14px 18px 18px", borderTop: `1px solid ${t.line}`, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>Totale</span>
            <span data-testid="till-order-total" style={{ fontSize: 30, fontWeight: 800 }}>€ {formatCentsAsPrice(d.totalCents)}</span>
          </div>
          {coperto > 0 && <div style={{ fontSize: 14, color: t.inkSoft, marginTop: -8, textAlign: "right" }}>di cui coperto € {formatCentsAsPrice(coperto)}</div>}
          {d.sendError && <div role="alert" style={{ color: STATUS.danger, fontSize: 15 }}>{d.sendError}</div>}
          <button type="button" onClick={d.send} disabled={d.sending || d.draftCount === 0} className="mdp-btn" style={{
            minHeight: 64, borderRadius: 14, border: "none", background: t.primary, color: t.bg, fontSize: 20, fontWeight: 700,
            cursor: d.sending || d.draftCount === 0 ? "default" : "pointer", opacity: d.sending || d.draftCount === 0 ? 0.45 : 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontFamily: FONT,
          }}>
            <Send size={22} /> {d.sending ? "Invio…" : `Invia comanda (${d.draftCount})`}
          </button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button type="button" onClick={() => setShowReceipt(true)} className="mdp-btn" style={{
              minHeight: 56, borderRadius: 12, border: `1.5px solid ${t.line}`, background: t.bg, color: t.ink, fontSize: 17, fontWeight: 600,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: FONT,
            }}><Receipt size={20} /> Preconto</button>
            <button type="button" onClick={doClose} disabled={d.closing} className="mdp-btn" style={{
              minHeight: 56, borderRadius: 12, border: `1.5px solid ${STATUS.danger}`, background: t.bg, color: STATUS.danger, fontSize: 17, fontWeight: 600,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: FONT,
            }}><Lock size={20} /> {d.closing ? "Chiusura…" : "Chiudi tavolo"}</button>
          </div>
        </div>
      </section>

      {showReceipt && <ReceiptOverlay t={t} menu={menu} order={order} onClose={() => setShowReceipt(false)} />}
    </div>
  );
}

/* ---------------------------------- shell ---------------------------------- */

export default function TillSala({ menu, session }) {
  const t = THEMES[menu?.theme] || THEMES.minimal;
  const sala = useSalaData({ menu, session });
  const [tab, setTab] = useState("floor"); // floor | reservations | history
  const [openOrderId, setOpenOrderId] = useState(null);
  const [dialog, setDialog] = useState(null); // { reservation? }
  const [busy, setBusy] = useState(false);

  const currentOrder = openOrderId ? sala.orders.find((o) => o.id === openOrderId) : null;

  const create = async (fields) => {
    setBusy(true);
    const newId = dialog?.reservation
      ? await sala.startFromReservation(dialog.reservation, fields.tableNumber)
      : await sala.createTable(fields);
    setBusy(false);
    if (newId) { setDialog(null); setOpenOrderId(newId); }
  };

  const onAvvia = async (reservation) => {
    if (!reservation.tableNumber) { setDialog({ reservation }); return; }
    setBusy(true);
    const newId = await sala.startFromReservation(reservation, reservation.tableNumber);
    setBusy(false);
    if (newId) setOpenOrderId(newId);
  };

  const goTab = (key) => { setTab(key); setOpenOrderId(null); };

  // Prenotazioni keeps its own screen (with its own "Sala" back button).
  if (tab === "reservations") {
    return (
      <Suspense fallback={<div style={{ padding: 40 }}>Caricamento…</div>}>
        <Reservations menu={menu} onBack={() => setTab("floor")} />
      </Suspense>
    );
  }

  return (
    // Full screen, minus StaffHome's "Cambia area" bar when an admin account
    // is at the till (--mdp-area-bar, 0 otherwise).
    <div className="mdp-root" style={{ height: "calc(100vh - var(--mdp-area-bar, 0px))", display: "flex", flexDirection: "column", background: t.bg, overflow: "hidden" }}>
      <GlobalStyle t={t} />
      <TopBar t={t} session={session} tab={tab} onTab={goTab} openCount={sala.orders.length} />

      {tab === "history" && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <OrderHistory t={t} menu={menu} onBack={() => setTab("floor")} isAdmin={session.role === "admin"} />
        </div>
      )}

      {tab === "floor" && !sala.ordersReady && (
        <div style={{ padding: 40, color: t.inkSoft, fontSize: 18, fontFamily: FONT }}>Caricamento tavoli…</div>
      )}

      {tab === "floor" && sala.ordersReady && openOrderId && currentOrder && (
        <OrderView key={currentOrder.id} t={t} menu={menu} menuCosts={sala.menuCosts} order={currentOrder} onBack={() => setOpenOrderId(null)} />
      )}

      {tab === "floor" && sala.ordersReady && openOrderId && !currentOrder && (
        <div style={{ padding: 40, fontFamily: FONT, fontSize: 18, color: t.inkSoft, display: "grid", gap: 16, justifyItems: "start" }}>
          Questo tavolo non è più aperto.
          <BackButton t={t} onClick={() => setOpenOrderId(null)} label="Tavoli" />
        </div>
      )}

      {tab === "floor" && sala.ordersReady && !openOrderId && (
        <FloorView
          t={t} menu={menu} orders={sala.orders} shiftClosedOrders={sala.shiftClosedOrders}
          todaysReservations={sala.todaysReservations}
          onNew={() => setDialog({})} onOpen={setOpenOrderId} onAvvia={onAvvia}
        />
      )}

      {dialog && (
        <NewTableDialog
          t={t} openOrders={sala.orders} reservation={dialog.reservation} busy={busy}
          onCancel={() => setDialog(null)} onCreate={create}
          onGoTo={(orderId) => { setDialog(null); setOpenOrderId(orderId); }}
        />
      )}
    </div>
  );
}
