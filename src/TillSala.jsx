// Sala (waiter area) for the till — the full-screen POS layout shown inside
// the Windows client (desktop-client/) instead of the phone layout of
// Waiter.jsx. Same data and rules, shared through sala-shared.jsx; so the
// till can also replace a waiter's phone (open tables, take and send
// orders, edit lines, receipts, closing) when nobody has one at hand.
// Storico and Prenotazioni have till versions too (TillHistory.jsx,
// TillReservations.jsx) and, for admin accounts, so do Menù and Statistiche
// (TillMenu.jsx, TillStats.jsx): every section built from the same pieces
// (TillUi.jsx) and reached from the same top bar — at the till there's no
// phone-style Dashboard to go back to (StaffHome.jsx).
//
// Layout follows established guidance (docs/stampa-scontrini.md §4.1):
//  - floor at a glance: every open table is a tile in a grid that fills the
//    screen — number, name, covers, elapsed time, running total, status
//    written on a fixed colour;
//  - order screen split like common restaurant POS: menu tiles on the left
//    (every category at once in a grid + search; dish tiles with their
//    photo), the ticket in the side panel on the right.
//    Tapping a ticket line opens its editor right there (quantity, price —
//    offered, discounted, custom — note, removal): editing in context, the
//    total stays in view; changes apply only on "Salva";
//  - touch targets ≥ 48px, on-screen keypads (no keyboard at the till),
//    confirmation before irreversible actions, no "Esci" (it lives in the
//    client's settings);
//  - optional PIN lock (TillLock.jsx): after some minutes without touches,
//    at startup, or with "Blocca" in the top bar.
//
// No kitchen states ("uscita"): the kitchen has no screen, lines are just
// "sent" (see the Cucina note in docs/stampa-scontrini.md).
import React, { useState, useEffect, Suspense, lazy } from "react";
import {
  Plus, X, Users, Clock, Search, Utensils, CalendarDays, History, LayoutGrid, BookOpen, BarChart3,
  Send, Lock, Printer, LogOut,
} from "lucide-react";
import {
  THEMES, GlobalStyle, Logo, formatCentsAsPrice, tableIdentity, currentShiftLabel, BackButton,
} from "./shared";
import { orderTotalCents, copertoTotalCents, markReceiptPrinted } from "./orders";
import { coversLabel } from "./reservationsData";
import { confirmAction } from "./confirmDialog";
import { staffLogout, logoutHiddenAtTill } from "./staff-shared";
import { formatTime, elapsedLabel, SyncBadge, useSalaData, useOrderDraft, tableStatus } from "./sala-shared";
import { LineEditor, CoversControl, DishTile, TicketLine, ReservationCard } from "./OrderUi";
import { usePrintJob } from "./usePrintJob";
import {
  TOUCH, FONT, STATUS, SIDE_PANEL_WIDTH, TillButton, Stepper, Keypad, SidePanel, SectionTitle, StatusPill, PrintStatusLine, CategoryGrid,
} from "./TillUi";
import { isAdminRole } from "./staffData";
import { useTillLock, TillLockScreen } from "./TillLock";

const TillHistory = lazy(() => import("./TillHistory"));
const TillReservations = lazy(() => import("./TillReservations"));
const TillMenu = lazy(() => import("./TillMenu"));
const TillStats = lazy(() => import("./TillStats"));

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

function TopBar({ t, session, tab, onTab, openCount, withAdmin, onLock }) {
  const now = useClock();
  const tabs = [
    { key: "floor", label: "Tavoli", icon: LayoutGrid, badge: openCount },
    { key: "reservations", label: "Prenotazioni", icon: CalendarDays },
    { key: "history", label: "Storico", icon: History },
    ...(withAdmin ? [
      { key: "menu", label: "Menù", icon: BookOpen },
      { key: "stats", label: "Statistiche", icon: BarChart3 },
    ] : []),
  ];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14, padding: "10px 16px", minHeight: 76, flexShrink: 0,
      background: t.card, borderBottom: `1px solid ${t.line}`,
    }}>
      <Logo width={withAdmin ? 52 : 64} />
      <nav aria-label="Sezioni della sala" style={{ display: "flex", gap: 6, minWidth: 0, overflowX: "auto" }}>
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
                display: "flex", alignItems: "center", gap: 8, minHeight: 56, padding: withAdmin ? "0 14px" : "0 20px", borderRadius: 12, flexShrink: 0, whiteSpace: "nowrap",
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
      {/* PIN lock on (Menù › Impostazioni › Blocco cassa): lock it now. */}
      {onLock && (
        <TillButton t={t} icon={Lock} size={TOUCH} onClick={onLock} style={{ fontSize: 15, flexShrink: 0 }}>Blocca</TillButton>
      )}
      {/* Only for clients older than 1.4.0, which have no "Esci
          dall'account" in their settings yet (confirmed, see staffLogout). */}
      {!logoutHiddenAtTill() && (
        <TillButton t={t} icon={LogOut} size={TOUCH} onClick={staffLogout} style={{ fontSize: 15, color: t.inkSoft }}>Esci</TillButton>
      )}
      <div style={{ marginLeft: "auto", textAlign: "right", fontFamily: FONT, flexShrink: 0, whiteSpace: "nowrap" }}>
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

function TableTile({ t, order, kitchenProblems, onOpen }) {
  const id = tableIdentity(order);
  const status = tableStatus(order, kitchenProblems);
  const covers = (order.covers?.adults || 0) + (order.covers?.children || 0);
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
      <span style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.05 }}>{order.tableNumber}</span>
      {order.tableName && (
        <span style={{ fontSize: 16, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{order.tableName}</span>
      )}
      <span style={{ display: "flex", gap: 12, fontSize: 14, color: t.inkSoft, marginTop: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Users size={14} /> {covers}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={14} /> {elapsedLabel(order.openedAt)}</span>
      </span>
      <span style={{ marginTop: "auto", paddingTop: 10, fontSize: 22, fontWeight: 700 }}>€ {formatCentsAsPrice(orderTotalCents(order))}</span>
      <StatusPill color={status.color} style={{ alignSelf: "flex-start", marginTop: 6 }}>{status.label}</StatusPill>
    </button>
  );
}

function FloorView({ t, orders, kitchenProblemsByOrder, todaysReservations, onNew, onOpen, onOpenReservation, onAvvia }) {
  const sorted = [...orders].sort((a, b) => (a.tableNumber || 0) - (b.tableNumber || 0));
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "18px 20px 96px" }}>
        <div data-testid="till-floor-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14 }}>
          <button type="button" onClick={onNew} className="mdp-btn" style={{
            minHeight: 190, borderRadius: 16, border: `2px dashed ${t.primary}`, background: t.bg, color: t.primary,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
            fontSize: 19, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
          }}>
            <Plus size={40} strokeWidth={2.5} /> Nuovo tavolo
          </button>
          {sorted.map((o) => <TableTile key={o.id} t={t} order={o} kitchenProblems={kitchenProblemsByOrder[o.id] || 0} onOpen={() => onOpen(o.id)} />)}
        </div>
      </div>

      {todaysReservations.length > 0 && (
        <aside aria-label="Prenotazioni di oggi" style={{
          width: 320, flexShrink: 0, overflowY: "auto", padding: "18px 16px 96px", borderLeft: `1px solid ${t.line}`, background: t.card, fontFamily: FONT,
        }}>
          <SectionTitle t={t} color={t.secondary} style={{ marginBottom: 12 }}>Prenotazioni di oggi · {todaysReservations.length}</SectionTitle>
          <div style={{ display: "grid", gap: 10 }}>
            {todaysReservations.map((r) => <ReservationCard key={r.id} t={t} reservation={r} onOpen={onOpenReservation} onAvvia={onAvvia} stacked />)}
          </div>
        </aside>
      )}
    </div>
  );
}

/* ------------------------- table number keypad dialog ------------------------- */

// Opening a table: table number from the on-screen keypad, covers with
// steppers, optional name/notes. With `reservation`: starting a booked
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
        width: "100%", maxWidth: reservation ? 440 : 820, maxHeight: "100%", overflowY: "auto", background: t.bg, borderRadius: 20,
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
            <Keypad t={t} onKey={press} />
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
          <TillButton t={t} size={60} onClick={onCancel} style={{ flex: 1 }}>Annulla</TillButton>
          <TillButton t={t} variant="primary" size={60} disabled={!number || busy} style={{ flex: 2 }}
            onClick={() => onCreate({ tableNumber: number, tableName: tableName.trim(), adults, children, notes })}>
            {busy ? "Apertura…" : reservation ? "Apri comanda" : number ? `Apri tavolo ${number}` : "Apri tavolo"}
          </TillButton>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- order screen ------------------------------- */

function OrderView({ t, menu, menuCosts, order, senderName, onBack }) {
  const d = useOrderDraft({ menu, menuCosts, order, senderName });
  const [categoryId, setCategoryId] = useState(null);
  const [editing, setEditing] = useState(null); // { lineId, sent }
  const printer = usePrintJob();
  const id = tableIdentity(order);
  const locked = Boolean(order.receipt?.confirmedAt);

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
  // Every category at once (CategoryGrid): how many dishes, how many already
  // picked and not sent yet.
  const categoryCards = tabs.map((tb) => {
    const items = tb.id === "__offmenu__" ? d.offMenuItems : d.normalItems.find((c) => c.id === tb.id)?.items || [];
    const inDraft = items.reduce((n, item) => n + draftQty(item.id), 0);
    return {
      id: tb.id, name: tb.name, highlight: inDraft > 0,
      detail: `${items.length} ${items.length === 1 ? "piatto" : "piatti"}${inDraft > 0 ? ` · ${inDraft} da inviare` : ""}`,
      ...(tb.id === "__offmenu__" ? { accent: STATUS.waiting, icon: <Utensils size={16} /> } : null),
    };
  });

  const sentLines = order.items || [];
  const editingLine = editing
    ? (editing.sent ? sentLines : d.draft).find((l) => l.lineId === editing.lineId)
    : null;

  const saveLine = (patch) => d.saveLine(editing, patch);
  const removeLine = async () => {
    if (editing.sent) {
      const confirmed = await confirmAction({
        title: `Rimuovere ${editingLine.name}?`,
        message: "Il piatto è già stato inviato: viene tolto dalla comanda e dal conto.",
        confirmLabel: "Rimuovi", danger: true,
      });
      if (!confirmed) return;
    }
    if (await d.removeLine(editing)) setEditing(null);
  };

  const printReceipt = async () => {
    if (d.draftCount > 0) {
      const go = await confirmAction({
        title: "Ci sono piatti non inviati",
        message: `${d.draftCount} piatti nella sezione "Da inviare" non sono ancora nella comanda e non compariranno sul preconto.`,
        confirmLabel: "Stampa comunque",
      });
      if (!go) return;
    }
    printer.print(order, menu);
    markReceiptPrinted(order.id).catch((err) => console.error("[till] Registrazione stampa fallita:", err));
  };

  const doClose = async () => {
    const pending = d.draftCount > 0 ? ` Attenzione: ${d.draftCount} piatti non ancora inviati verranno persi.` : "";
    const confirmed = await confirmAction({
      title: `Chiudere ${id.primary}?`,
      message: `${sentLines.length} voci ordinate — totale € ${formatCentsAsPrice(orderTotalCents(order))}. La comanda viene archiviata nello storico.${pending}`,
      confirmLabel: "Chiudi tavolo",
      danger: true,
    });
    if (confirmed && await d.closeTable()) onBack();
  };

  const coperto = copertoTotalCents(order);

  const ticket = (
    <SidePanel
      t={t}
      label="Comanda del tavolo"
      header={<SectionTitle t={t}>Comanda — {id.primary}</SectionTitle>}
      footer={(
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>Totale</span>
            <span data-testid="till-order-total" style={{ fontSize: 30, fontWeight: 800 }}>€ {formatCentsAsPrice(d.totalCents)}</span>
          </div>
          {coperto > 0 && <div style={{ fontSize: 14, color: t.inkSoft, marginTop: -8, textAlign: "right" }}>di cui coperto € {formatCentsAsPrice(coperto)}</div>}
          {d.sendError && <div role="alert" style={{ color: STATUS.danger, fontSize: 15 }}>{d.sendError}</div>}
          <TillButton t={t} variant="primary" size={64} icon={Send} disabled={d.sending || d.draftCount === 0} onClick={d.send}>
            {d.sending ? "Invio…" : `Invia comanda (${d.draftCount})`}
          </TillButton>
          <PrintStatusLine status={d.kitchenTicket.status} label="Stampa comanda cucina" prefix="Comanda cucina" />
          {d.kitchenTicket.problems.length > 0 && (
            <div role="group" aria-label="Comande cucina non stampate" style={{ display: "grid", gap: 10, padding: 12, borderRadius: 12, border: `2px solid ${STATUS.danger}` }}>
              {d.kitchenTicket.problems.map((p) => (
                <div key={p.id} style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: STATUS.danger, lineHeight: 1.35 }}>⚠ {p.title}: {p.status.text}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
                    <TillButton t={t} icon={Printer} disabled={d.kitchenTicket.busy} onClick={p.retry} style={{ padding: "0 8px", whiteSpace: "nowrap" }}>Ristampa comanda cucina</TillButton>
                    <TillButton t={t} variant="ghost" disabled={d.kitchenTicket.busy} onClick={p.dismiss}>Ignora</TillButton>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <TillButton t={t} icon={Printer} disabled={printer.busy} onClick={printReceipt} style={{ padding: "0 8px", whiteSpace: "nowrap" }}>{printer.failed ? "Riprova stampa" : "Stampa preconto"}</TillButton>
            <TillButton t={t} variant="danger" icon={Lock} disabled={d.closing} onClick={doClose} style={{ padding: "0 8px", whiteSpace: "nowrap" }}>{d.closing ? "Chiusura…" : "Chiudi tavolo"}</TillButton>
          </div>
          <PrintStatusLine status={printer.status} />
        </>
      )}
    >
      {sentLines.length === 0 && d.draft.length === 0 && (
        <div style={{ color: t.inkSoft, fontSize: 17, padding: "16px 0", lineHeight: 1.5 }}>
          Ancora nulla per questo tavolo.<br />Tocca un piatto a sinistra per aggiungerlo.
        </div>
      )}
      {d.draft.length > 0 && (
        <div role="group" aria-label="Da inviare" style={{ borderRadius: 14, border: `2px solid ${t.primary}`, padding: "8px 12px", background: `${t.primary}0d`, marginBottom: 14 }}>
          <SectionTitle t={t} color={t.primary} style={{ margin: "2px 0 2px" }}>Da inviare · tocca una riga per modificarla</SectionTitle>
          {d.draft.map((l) => <TicketLine key={l.lineId} t={t} line={l} sent={false} onSelect={() => setEditing({ lineId: l.lineId, sent: false })} />)}
        </div>
      )}
      {sentLines.length > 0 && (
        <div role="group" aria-label="Già inviato">
          <SectionTitle t={t} color={STATUS.ok} style={{ margin: "4px 0 2px" }}>Già inviato{locked ? " · preconto confermato" : ""}</SectionTitle>
          {sentLines.map((l) => <TicketLine key={l.lineId} t={t} line={l} sent onSelect={() => setEditing({ lineId: l.lineId, sent: true })} />)}
        </div>
      )}
    </SidePanel>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${SIDE_PANEL_WIDTH}`, fontFamily: FONT, color: t.ink }}>
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
            {order.notes && <div style={{ fontSize: 14, color: STATUS.waiting, marginTop: 2, fontWeight: 600 }}>{order.notes}</div>}
          </div>
          <div style={{ marginLeft: "auto" }}><CoversControl t={t} order={order} /></div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 20px 0" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <CategoryGrid t={t} label="Categorie del menù" minWidth={150} categories={categoryCards}
              activeId={d.isItemSearching ? null : activeTab} onSelect={(cid) => { d.setItemSearch(""); setCategoryId(cid); }} />
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

      {editingLine
        ? <LineEditor key={editingLine.lineId} t={t} line={editingLine} sent={editing.sent} locked={editing.sent && locked}
            onSave={saveLine} onRemove={removeLine} onClose={() => setEditing(null)} />
        : ticket}
    </div>
  );
}

/* ---------------------------------- shell ---------------------------------- */

// admin: menu editing props from StaffHome/MenuApp (onPatch, onRestore,
// onExit) — present only for admin accounts, and it adds the Menù and
// Statistiche sections.
export default function TillSala({ menu, session, initialTab = "floor", admin = null }) {
  const t = THEMES[menu?.theme] || THEMES.minimal;
  const sala = useSalaData({ menu, session });
  const tillLock = useTillLock();
  const withAdmin = Boolean(admin);
  const [tab, setTab] = useState(() => (!withAdmin && (initialTab === "menu" || initialTab === "stats") ? "floor" : initialTab)); // floor | reservations | history | menu | stats
  const [openOrderId, setOpenOrderId] = useState(null);
  const [dialog, setDialog] = useState(null); // { reservation? }
  // A reservation of today tapped in Tavoli: Prenotazioni opens on it.
  const [reservationToOpen, setReservationToOpen] = useState(null);
  const [busy, setBusy] = useState(false);

  const currentOrder = openOrderId ? sala.orders.find((o) => o.id === openOrderId) : null;
  const goToOrder = (orderId) => { setTab("floor"); setOpenOrderId(orderId); };

  const create = async (fields) => {
    setBusy(true);
    const newId = dialog?.reservation
      ? await sala.startFromReservation(dialog.reservation, fields.tableNumber)
      : await sala.createTable(fields);
    setBusy(false);
    if (newId) { setDialog(null); goToOrder(newId); }
  };

  const onAvvia = async (reservation) => {
    if (!reservation.tableNumber) { setDialog({ reservation }); return; }
    setBusy(true);
    const newId = await sala.startFromReservation(reservation, reservation.tableNumber);
    setBusy(false);
    if (newId) goToOrder(newId);
  };

  const goTab = (key) => {
    setTab(key);
    setOpenOrderId(null);
    setReservationToOpen(null);
  };
  const openReservation = (reservation) => {
    goTab("reservations");
    setReservationToOpen(reservation);
  };
  const loading = <div style={{ padding: 40, color: t.inkSoft, fontSize: 18, fontFamily: FONT }}>Caricamento…</div>;

  return (
    <div className="mdp-root" style={{ height: "100vh", display: "flex", flexDirection: "column", background: t.bg, overflow: "hidden" }}>
      <GlobalStyle t={t} />
      <TopBar t={t} session={session} tab={tab} onTab={goTab} openCount={sala.orders.length} withAdmin={withAdmin} onLock={tillLock.active ? tillLock.lock : null} />

      {tab === "menu" && withAdmin && (
        <Suspense fallback={loading}>
          <TillMenu t={t} menu={menu} admin={admin} />
        </Suspense>
      )}

      {tab === "stats" && withAdmin && (
        <Suspense fallback={loading}>
          <TillStats t={t} />
        </Suspense>
      )}

      {tab === "history" && (
        <Suspense fallback={loading}>
          <TillHistory t={t} menu={menu} isAdmin={isAdminRole(session.role)} />
        </Suspense>
      )}

      {tab === "reservations" && (
        <Suspense fallback={loading}>
          <TillReservations t={t} session={session} initialReservation={reservationToOpen} onAvvia={onAvvia} onGoToTable={goToOrder} />
        </Suspense>
      )}

      {tab === "floor" && !sala.ordersReady && (
        <div style={{ padding: 40, color: t.inkSoft, fontSize: 18, fontFamily: FONT }}>Caricamento tavoli…</div>
      )}

      {tab === "floor" && sala.ordersReady && openOrderId && currentOrder && (
        <OrderView key={currentOrder.id} t={t} menu={menu} menuCosts={sala.menuCosts} order={currentOrder} senderName={session.name} onBack={() => setOpenOrderId(null)} />
      )}

      {tab === "floor" && sala.ordersReady && openOrderId && !currentOrder && (
        <div style={{ padding: 40, fontFamily: FONT, fontSize: 18, color: t.inkSoft, display: "grid", gap: 16, justifyItems: "start" }}>
          Questo tavolo non è più aperto.
          <BackButton t={t} onClick={() => setOpenOrderId(null)} label="Tavoli" />
        </div>
      )}

      {tab === "floor" && sala.ordersReady && !openOrderId && (
        <FloorView
          t={t} orders={sala.orders} kitchenProblemsByOrder={sala.kitchenProblemsByOrder} todaysReservations={sala.todaysReservations}
          onNew={() => setDialog({})} onOpen={setOpenOrderId} onOpenReservation={openReservation} onAvvia={onAvvia}
        />
      )}

      {dialog && (
        <NewTableDialog
          t={t} openOrders={sala.orders} reservation={dialog.reservation} busy={busy}
          onCancel={() => setDialog(null)} onCreate={create}
          onGoTo={(orderId) => { setDialog(null); goToOrder(orderId); }}
        />
      )}

      {tillLock.locked && <TillLockScreen t={t} config={tillLock.config} sessionName={session.name} onUnlock={tillLock.unlock} />}
    </div>
  );
}
