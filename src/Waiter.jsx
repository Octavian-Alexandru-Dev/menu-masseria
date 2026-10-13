// Tavoli — digital order taking on phones (see docs/comande-camerieri.md):
// the "Tavoli" section of the phone app (PhoneApp.jsx), loaded only in the
// staff area, never from the public site.
//
// Inside the Windows till client the same area is shown with the
// full-screen POS layout of TillSala.jsx instead; data and rules are shared
// through sala-shared.jsx, and the order screen's pieces (line editor,
// covers, dish tiles) through OrderUi.jsx — so the phone works like the
// till, laid out for one hand:
//  - tables as tiles (number, name, covers, time, total, status written on
//    a fixed colour), "Nuovo tavolo" as a floating button in thumb reach;
//  - a table's order on its own full screen: dishes as tiles in two
//    columns (one tap = one more, the count on the tile, the dish's photo),
//    every category at a glance in a grid at the top (tap → its section);
//    once the grid has scrolled away, a "Categorie" button appears under the
//    search, shows the category in view and reopens the grid from anywhere;
//    and one bar at
//    the bottom that never moves — "Comanda" (the ticket) on the left,
//    "Invia comanda" (or "Preconto") on the right;
//  - the ticket and a line's editor open as full-screen pages, like the
//    till's side panel: tap a line to change quantity, price (offered,
//    discount, custom), note, or to remove it — applied only on "Salva".
import React, { useState, useEffect, useRef } from "react";
import { Plus, Minus, X, Utensils, Search, Send, Receipt, Lock, Trash2, Printer, ChevronUp, ChevronDown, Users, Clock, LayoutGrid } from "lucide-react";
import { THEMES, formatCentsAsPrice, parsePriceToCents, tableIdentity, currentShiftLabel, BackButton, scrollBehavior } from "./shared";
import { orderTotalCents, copertoTotalCents } from "./orders";
import { coversLabel } from "./reservationsData";
import { confirmAction } from "./confirmDialog";
import {
  formatTime, elapsedLabel, SyncBadge, useSalaData, useOrderDraft, tableStatus,
} from "./sala-shared";
import { LineEditor, CoversControl, DishTile, TicketLine, ReceiptPanel, ReservationCard } from "./OrderUi";
import { ClosedOrderRow } from "./TillHistory";
import {
  TOUCH, FONT, STATUS, TillButton, Stepper, SidePanel, SectionTitle, StatusPill, Field, tillInputStyle, CategoryGrid,
} from "./TillUi";

/* ---------------------------------- tables ---------------------------------- */

function TodaysReservations({ t, reservations, onOpen, onAvvia }) {
  if (reservations.length === 0) return null;
  return (
    <section aria-label="Prenotazioni di oggi" style={{ marginBottom: 22 }}>
      <SectionTitle t={t} color={t.secondary} style={{ marginBottom: 10 }}>Prenotazioni di oggi · {reservations.length}</SectionTitle>
      <div style={{ display: "grid", gap: 8 }}>
        {reservations.map((r) => <ReservationCard key={r.id} t={t} reservation={r} onOpen={onOpen} onAvvia={onAvvia} />)}
      </div>
    </section>
  );
}

function TableCard({ t, order, kitchenProblems, onOpen }) {
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
        position: "relative", display: "flex", flexDirection: "column", alignItems: "stretch", textAlign: "left", gap: 2,
        minHeight: 150, padding: "12px 12px 12px 18px", borderRadius: 16, border: `1.5px solid ${t.line}`,
        background: t.card, cursor: "pointer", fontFamily: FONT, color: t.ink, overflow: "hidden",
        boxShadow: "0 1px 4px rgba(0,0,0,0.05)", WebkitTapHighlightColor: "transparent",
      }}
    >
      <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: status.color }} />
      <span style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.15 }}>{id.primary}</span>
      {id.secondary && (
        <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{id.secondary}</span>
      )}
      <span style={{ display: "flex", gap: 10, fontSize: 13, color: t.inkSoft, marginTop: 2, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Users size={13} /> {covers}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={13} /> {elapsedLabel(order.openedAt)}</span>
      </span>
      <span style={{ marginTop: "auto", paddingTop: 8, fontSize: 19, fontWeight: 700 }}>€ {formatCentsAsPrice(orderTotalCents(order))}</span>
      <StatusPill color={status.color} style={{ alignSelf: "flex-start", marginTop: 4, whiteSpace: "normal", fontSize: 12, padding: "3px 8px" }}>{status.label}</StatusPill>
      {order._hasPendingWrites && <span style={{ marginTop: 4 }}><SyncBadge t={t} hasPendingWrites /></span>}
    </button>
  );
}

function TableList({ t, menu, orders, kitchenProblemsByOrder = {}, shiftClosedOrders, onOpenNew, onOpenOrder, todaysReservations, onOpenReservation, onAvviaReservation }) {
  const [closedOrderId, setClosedOrderId] = useState(null);
  const closedOrder = shiftClosedOrders.find((o) => o.id === closedOrderId);
  const sorted = [...orders].sort((a, b) => (a.tableNumber || 0) - (b.tableNumber || 0));
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 16px 104px", fontFamily: FONT, color: t.ink }}>
      <TodaysReservations t={t} reservations={todaysReservations} onOpen={onOpenReservation} onAvvia={onAvviaReservation} />

      <SectionTitle t={t} color={t.secondary} style={{ marginBottom: 10 }}>Tavoli aperti · {sorted.length}</SectionTitle>
      {sorted.length === 0 && (
        <div style={{ textAlign: "center", color: t.inkSoft, fontSize: 16, padding: "28px 12px", border: `1.5px dashed ${t.line}`, borderRadius: 16 }}>
          Nessun tavolo aperto al momento.
          <div style={{ fontSize: 14, marginTop: 6 }}>Tocca «Nuovo tavolo» in basso per aprirne uno.</div>
        </div>
      )}
      <div data-testid="phone-tables-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
        {sorted.map((o) => (
          <TableCard key={o.id} t={t} order={o} kitchenProblems={kitchenProblemsByOrder[o.id] || 0} onOpen={() => onOpenOrder(o.id)} />
        ))}
      </div>

      {/* Tables closed during the current shift (§9 of the doc): they don't
          disappear from the screen entirely — they stay accessible here
          until the shift changes (afterwards, only from the History). */}
      {shiftClosedOrders.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <SectionTitle t={t} color={t.secondary} style={{ marginBottom: 10 }}>Chiusi nel turno — {currentShiftLabel()}</SectionTitle>
          <div style={{ display: "grid", gap: 8 }}>
            {shiftClosedOrders.map((o) => (
              <ClosedOrderRow key={o.id} t={t} order={o} selected={false} onSelect={() => setClosedOrderId(o.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Primary action of the screen, floating above the bottom bar: always
          in the same place, within reach of the thumb. */}
      <button type="button" onClick={onOpenNew} className="mdp-btn" style={{
        position: "fixed", right: 16, bottom: "calc(var(--mdp-bottom-nav, 0px) + 16px)", zIndex: 30,
        minHeight: 60, padding: "0 22px 0 18px", borderRadius: 18, border: "none", background: t.primary, color: t.bg,
        fontSize: 17, fontWeight: 700, fontFamily: FONT, cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
        boxShadow: "0 6px 18px rgba(0,0,0,0.22)",
      }}>
        <Plus size={24} strokeWidth={2.5} /> Nuovo tavolo
      </button>

      {closedOrder && (
        <ReceiptPanel t={t} menu={menu} order={closedOrder} closed sheet backLabel="Tavoli" onClose={() => setClosedOrderId(null)} />
      )}
    </div>
  );
}

// Opening a table (or starting a booked one, `reservation`): a full-screen
// page. The phone has its own keyboard, so the number is typed; covers with
// +/−; it warns when that table is already open.
function NewTableForm({ t, openOrders, reservation, onCancel, onCreate, onGoTo, busy }) {
  const [tableNumber, setTableNumber] = useState(reservation?.tableNumber ? String(reservation.tableNumber) : "");
  const [tableName, setTableName] = useState("");
  const [adults, setAdults] = useState(0);
  const [children, setChildren] = useState(0);
  const [notes, setNotes] = useState("");
  const number = parseInt(tableNumber, 10) || 0;
  const alreadyOpen = number ? openOrders.find((o) => o.tableNumber === number) : null;
  const input = tillInputStyle(t);

  const submit = () => {
    if (!number || busy) return;
    onCreate({ tableNumber: number, tableName: tableName.trim(), adults, children, notes });
  };

  return (
    <SidePanel
      t={t}
      sheet
      label={reservation ? `Avvia ${reservation.name || "prenotazione"}` : "Nuovo tavolo"}
      header={(
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BackButton t={t} onClick={onCancel} label="Tavoli" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 21, fontWeight: 700 }}>{reservation ? `Avvia ${reservation.name || "prenotazione"}` : "Nuovo tavolo"}</div>
            {reservation && <div style={{ fontSize: 14, color: t.inkSoft }}>{coversLabel(reservation.covers)}{reservation.notes ? ` · ${reservation.notes}` : ""}</div>}
          </div>
        </div>
      )}
      footer={(
        <TillButton t={t} variant="primary" size={60} disabled={!number || busy} onClick={submit}>
          {busy ? "Apertura…" : reservation ? "Apri comanda" : number ? `Apri tavolo ${number}` : "Apri tavolo"}
        </TillButton>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ display: "grid", gap: 20, paddingTop: 4 }}>
        <Field t={t} label="Numero tavolo">
          <input
            type="number" min="1" inputMode="numeric" enterKeyHint="done" value={tableNumber} autoFocus
            onChange={(e) => setTableNumber(e.target.value)} aria-label="Numero tavolo"
            style={{ ...input, minHeight: 64, fontSize: 30, fontWeight: 700, textAlign: "center", border: `2px solid ${t.primary}` }}
          />
        </Field>
        {alreadyOpen && (
          <div role="alert" style={{ padding: "10px 12px", borderRadius: 12, background: "#fff4e0", color: "#7a4a00", fontSize: 16, display: "grid", gap: 8 }}>
            Il tavolo {number} è già aperto.
            <button type="button" onClick={() => onGoTo(alreadyOpen.id)} className="mdp-btn" style={{
              minHeight: TOUCH, borderRadius: 10, border: "none", background: "#7a4a00", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
            }}>Vai al tavolo {number}</button>
          </div>
        )}
        {!reservation && (
          <>
            <div style={{ display: "grid", gap: 12 }}>
              <SectionTitle t={t}>Coperti</SectionTitle>
              <Stepper t={t} label="Adulti" value={adults} onChange={setAdults} size={TOUCH} />
              <Stepper t={t} label="Bambini" value={children} onChange={setChildren} size={TOUCH} />
            </div>
            <Field t={t} label="Nome (facoltativo)">
              <input style={input} placeholder="es. Famiglia Rossi, Compleanno…" value={tableName} onChange={(e) => setTableName(e.target.value)} />
            </Field>
            <Field t={t} label="Note (allergie, richieste…)">
              <textarea aria-label="Note (allergie, richieste…)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                style={{ ...input, minHeight: 80, padding: "12px 14px", resize: "vertical", lineHeight: 1.4 }} />
            </Field>
          </>
        )}
      </form>
    </SidePanel>
  );
}

/* ------------------------------- order screen ------------------------------- */

// Kitchen tickets of the table (useOrderKitchenTickets): the last one's print
// status and, for any that may not have reached the kitchen, "Ristampa" and
// "Ignora". Shown above the bottom bar and in the ticket's footer.
function KitchenTicketStatus({ t, kitchenTicket }) {
  const { status, problems, busy } = kitchenTicket;
  if (!status && problems.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {problems.length > 0 && (
        <div role="group" aria-label="Comande cucina non stampate" style={{ display: "grid", gap: 10, padding: 10, borderRadius: 12, border: `2px solid ${STATUS.danger}`, background: t.card }}>
          {problems.map((p) => (
            <div key={p.id} style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: STATUS.danger, lineHeight: 1.35 }}>⚠ {p.title}: {p.status.text}</div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
                <TillButton t={t} size={TOUCH} icon={Printer} disabled={busy} onClick={p.retry}>Ristampa</TillButton>
                <TillButton t={t} size={TOUCH} variant="ghost" disabled={busy} onClick={p.dismiss}>Ignora</TillButton>
              </div>
            </div>
          ))}
        </div>
      )}
      {status && (
        <div role="status" aria-label="Stampa comanda cucina" style={{
          fontSize: 14, fontWeight: 600, textAlign: "center",
          color: status.tone === "error" ? STATUS.danger : status.tone === "ok" ? STATUS.ok : t.inkSoft,
        }}>
          Comanda cucina: {status.text}
        </div>
      )}
    </div>
  );
}

// A line still to send, in the ticket: tap the name → its editor (note,
// price…); − / + right there for the quantity (− on the last one removes it).
function DraftLineRow({ t, line, onEdit, onChangeQty, onRemove }) {
  const qtyBtn = {
    width: TOUCH, height: TOUCH, borderRadius: 12, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink,
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
  };
  const total = parsePriceToCents(line.price) * line.quantity;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${t.line}` }}>
      <button type="button" onClick={onEdit} aria-label={`Modifica ${line.name}`} className="mdp-btn" style={{
        flex: 1, minWidth: 0, minHeight: 56, textAlign: "left", border: "none", background: "none", color: t.ink, cursor: "pointer", padding: "4px 2px", fontFamily: FONT,
      }}>
        <span style={{ display: "block", fontSize: 17, fontWeight: 600, lineHeight: 1.25 }}>{line.name}</span>
        <span style={{ display: "block", fontSize: 13, color: t.inkSoft, marginTop: 2 }}>
          {line.priceNote && <span style={{ color: STATUS.info, fontWeight: 700 }}>{line.priceNote} · </span>}
          {line.notes ? <span style={{ color: STATUS.waiting, fontWeight: 600 }}>{line.notes} · </span> : null}
          € {formatCentsAsPrice(total)} · tocca per nota e prezzo
        </span>
      </button>
      {line.quantity > 1 ? (
        <button type="button" aria-label={`Diminuisci quantità di ${line.name}`} onClick={() => onChangeQty(-1)} className="mdp-btn" style={qtyBtn}><Minus size={20} /></button>
      ) : (
        <button type="button" aria-label={`Rimuovi ${line.name} dalla comanda`} onClick={onRemove} className="mdp-btn" style={{ ...qtyBtn, color: STATUS.danger }}><Trash2 size={19} /></button>
      )}
      <span style={{ minWidth: 26, textAlign: "center", fontSize: 20, fontWeight: 800 }}>{line.quantity}</span>
      <button type="button" aria-label={`Aumenta quantità di ${line.name}`} onClick={() => onChangeQty(1)} className="mdp-btn" style={qtyBtn}><Plus size={20} /></button>
    </div>
  );
}

const HEADER_HEIGHT = 64;
// The "Categorie" button floating under the sticky bar (48px + 8px below, tucked under the search).
const PICKER_HEIGHT = 48;

function OrderDetail({ t, menu, menuCosts, order, senderName, onBack }) {
  const d = useOrderDraft({ menu, menuCosts, order, senderName });
  // null (the dishes) | { type: "ticket" } | { type: "line", lineId, sent } | { type: "receipt", from }
  const [panel, setPanel] = useState(null);
  const [activeCat, setActiveCat] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const sectionRefs = useRef({});
  // Height of the bars stuck at the top (header + search + "Categorie"):
  // where a section lands when jumped to, and which one counts as "in view".
  const stickyRef = useRef(null);
  const [stickyBottom, setStickyBottom] = useState(200);
  // The grid at the top is in view (no need for the "Categorie" button).
  const gridRef = useRef(null);
  const [gridInView, setGridInView] = useState(true);
  const id = tableIdentity(order);
  const locked = Boolean(order.receipt?.confirmedAt);
  const sentLines = order.items || [];
  const coperto = copertoTotalCents(order);

  const sections = [
    ...d.filteredNormalItems.map((c) => ({ id: c.id, name: c.name, items: c.items.map((item) => ({ item, categoryId: c.id, categoryName: c.name })), offMenu: false })),
    ...(d.filteredOffMenuItems.length > 0
      ? [{ id: "__offmenu__", name: "Fuori menù", offMenu: true, items: d.filteredOffMenuItems.map((item) => ({ item, categoryId: item._categoryId, categoryName: item._categoryName })) }]
      : []),
  ];
  const draftQty = (itemId) => d.draft.filter((l) => l.menuItemId === itemId).reduce((s, l) => s + l.quantity, 0);
  const categoryCards = sections.map((s) => {
    const inDraft = s.items.reduce((n, { item }) => n + draftQty(item.id), 0);
    return {
      id: s.id, name: s.name, highlight: inDraft > 0,
      detail: `${s.items.length} ${s.items.length === 1 ? "piatto" : "piatti"}${inDraft > 0 ? ` · ${inDraft} da inviare` : ""}`,
      ...(s.offMenu ? { accent: STATUS.waiting, icon: <Utensils size={15} /> } : null),
    };
  });
  const currentId = activeCat && sections.some((s) => s.id === activeCat) ? activeCat : sections[0]?.id;
  const currentName = sections.find((s) => s.id === currentId)?.name;

  useEffect(() => {
    const el = stickyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => setStickyBottom(Math.round(el.getBoundingClientRect().height + HEADER_HEIGHT + 1));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The category chip follows the scroll (the section under the sticky
  // bars) — except right after a chip was tapped: the last sections can't
  // scroll up to the top, and the scroll would otherwise light up the one
  // before. A scroll by the user (touch, wheel) hands it back to the scroll.
  const sectionKey = sections.map((s) => s.id).join("|");
  const chosenRef = useRef(false);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    // The first section whose bottom is still below the sticky bars.
    const follow = () => {
      if (chosenRef.current) return;
      const els = Object.values(sectionRefs.current).filter(Boolean);
      const current = els.find((el) => el.getBoundingClientRect().bottom > stickyBottom + PICKER_HEIGHT + 10) || els[els.length - 1];
      if (current) setActiveCat(current.dataset.sectionId);
    };
    const observer = new IntersectionObserver(follow, { rootMargin: `-${stickyBottom}px 0px -55% 0px` });
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    const release = () => { chosenRef.current = false; };
    const onScroll = () => follow();
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("touchmove", release);
      window.removeEventListener("wheel", release);
      window.removeEventListener("scroll", onScroll);
    };
  }, [sectionKey, stickyBottom]);

  const showGrid = !d.isItemSearching && sections.length > 0;
  useEffect(() => {
    const el = gridRef.current;
    if (!showGrid || !el || typeof IntersectionObserver === "undefined") { setGridInView(showGrid); return undefined; }
    const observer = new IntersectionObserver(([entry]) => setGridInView(entry.isIntersecting), { rootMargin: `-${stickyBottom}px 0px 0px 0px` });
    observer.observe(el);
    return () => observer.disconnect();
  }, [showGrid, stickyBottom]);
  const showPicker = showGrid && (!gridInView || pickerOpen);

  const jumpTo = (sectionId) => {
    chosenRef.current = true;
    setPickerOpen(false);
    setActiveCat(sectionId);
    sectionRefs.current[sectionId]?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  };

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setPickerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  const editingLine = panel?.type === "line"
    ? (panel.sent ? sentLines : d.draft).find((l) => l.lineId === panel.lineId)
    : null;

  const removeEditingLine = async () => {
    if (panel.sent) {
      const confirmed = await confirmAction({
        title: `Rimuovere ${editingLine.name}?`,
        message: "Il piatto è già stato inviato: viene tolto dalla comanda e dal conto.",
        confirmLabel: "Rimuovi", danger: true,
      });
      if (!confirmed) return;
    }
    if (await d.removeLine(panel)) setPanel({ type: "ticket" });
  };

  const doClose = async () => {
    const pending = d.draftCount > 0 ? ` Attenzione: ${d.draftCount} piatti non ancora inviati verranno persi.` : "";
    const confirmed = await confirmAction({
      title: `Chiudere ${id.primary}?`,
      message: `${sentLines.length} voci ordinate${coperto > 0 ? ` + coperto (${order.covers?.adults || 0} adulti, ${order.covers?.children || 0} bambini)` : ""} — totale € ${formatCentsAsPrice(orderTotalCents(order))}. Nessun preconto viene stampato: la comanda viene archiviata nello storico.${pending}`,
      confirmLabel: "Conferma chiusura",
      danger: true,
    });
    if (confirmed && await d.closeTable()) onBack();
  };

  const send = async () => {
    await d.send();
  };

  const draftTotal = d.draft.reduce((s, l) => s + parsePriceToCents(l.price) * l.quantity, 0);
  const ticketSummary = d.draftCount > 0
    ? `${d.draftCount} da inviare · € ${formatCentsAsPrice(draftTotal)}`
    : sentLines.length > 0
      ? `${sentLines.length} ${sentLines.length === 1 ? "voce" : "voci"} · totale € ${formatCentsAsPrice(d.totalCents)}`
      : "Ancora vuota";

  return (
    <div style={{ fontFamily: FONT, color: t.ink, minHeight: "100dvh", background: t.bg }}>
      {/* Top bar: back, which table, sync state. */}
      <header style={{
        position: "sticky", top: 0, zIndex: 30, background: t.card, borderBottom: `1px solid ${t.line}`,
        padding: "env(safe-area-inset-top) 16px 0",
      }}>
        <div style={{ height: HEADER_HEIGHT, display: "flex", alignItems: "center", gap: 12 }}>
          <BackButton t={t} onClick={onBack} label="Tavoli" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <span>{id.primary}</span>
              {id.secondary && <span style={{ fontSize: 15, fontWeight: 500, color: t.inkSoft }}> · {id.secondary}</span>}
            </div>
            <div style={{ fontSize: 13, color: t.inkSoft, display: "flex", gap: 8, alignItems: "center", whiteSpace: "nowrap" }}>
              <span>Aperto alle {formatTime(order.openedAt) || "—"}</span>
              <SyncBadge t={t} hasPendingWrites={order._hasPendingWrites} />
            </div>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "12px 16px 0" }}>
        <div style={{ padding: 12, borderRadius: 14, border: `1.5px solid ${t.line}`, background: t.card, display: "grid", gap: 8 }}>
          <CoversControl t={t} order={order} compact />
          {order.notes && <div style={{ fontSize: 15, color: STATUS.waiting, fontWeight: 600 }}>{order.notes}</div>}
          {coperto > 0 && <div style={{ fontSize: 13, color: t.inkSoft }}>Coperto € {order.coperto?.adults || "0,00"} adulti · € {order.coperto?.children || "0,00"} bambini</div>}
        </div>
      </div>

      {/* Search (+ "Categorie" once the grid has scrolled away): stay at the top while scrolling the dishes. */}
      <div ref={stickyRef} style={{
        position: "sticky", top: `calc(${HEADER_HEIGHT + 1}px + env(safe-area-inset-top))`, zIndex: 20, background: t.bg,
        padding: "10px 0 8px", borderBottom: `1px solid ${t.line}`, marginTop: 4,
      }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          {d.searchEnabled && (
            <div style={{ position: "relative", margin: "0 16px 8px" }}>
              <Search size={18} color={t.inkSoft} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              <input type="text" value={d.itemSearch} onChange={(e) => d.setItemSearch(e.target.value)} placeholder="Cerca un piatto…" aria-label="Cerca un piatto"
                enterKeyHint="search"
                style={{ width: "100%", minHeight: 48, padding: "0 48px 0 42px", borderRadius: 12, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink, fontSize: 17, fontFamily: FONT, boxSizing: "border-box", WebkitAppearance: "none" }} />
              {d.isItemSearching && (
                <button type="button" onClick={() => d.setItemSearch("")} aria-label="Cancella ricerca" className="mdp-btn" style={{
                  position: "absolute", right: 0, top: 0, width: TOUCH, height: TOUCH, border: "none", background: "none", color: t.inkSoft, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}><X size={20} /></button>
              )}
            </div>
          )}
        </div>
        {/* Floats under the bar (no layout jump when it appears). */}
        {showPicker && (
          <div style={{ position: "absolute", left: 0, right: 0, top: "100%", background: t.bg, borderBottom: `1px solid ${t.line}`, marginTop: -9, padding: "0 0 8px" }}>
            <div style={{ position: "relative", maxWidth: 640, margin: "0 auto", padding: "0 16px" }}>
              <button type="button" onClick={() => setPickerOpen((o) => !o)} aria-expanded={pickerOpen} aria-controls="phone-category-picker"
                aria-label={`Categorie: ${currentName}`} className="mdp-btn" style={{
                  width: "100%", minHeight: 48, padding: "0 14px", borderRadius: 12, cursor: "pointer", fontFamily: FONT,
                  border: `1.5px solid ${pickerOpen ? t.primary : t.line}`, background: t.card, color: t.ink,
                  display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                }}>
                <LayoutGrid size={19} color={t.inkSoft} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: t.inkSoft, flexShrink: 0 }}>Categorie</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentName}</span>
                <ChevronDown size={20} color={t.inkSoft} style={{ flexShrink: 0, transform: pickerOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
              </button>
              {pickerOpen && (
                <>
                  <button type="button" aria-label="Chiudi le categorie" onClick={() => setPickerOpen(false)} tabIndex={-1} style={{
                    position: "fixed", inset: 0, top: stickyBottom, zIndex: 1, border: "none", background: "rgba(0,0,0,0.25)", cursor: "default",
                  }} />
                  <div id="phone-category-picker" style={{
                    position: "absolute", left: 16, right: 16, top: "calc(100% + 6px)", zIndex: 2, padding: 10, borderRadius: 14,
                    background: t.bg, border: `1.5px solid ${t.line}`, boxShadow: "0 12px 28px rgba(0,0,0,0.18)",
                    maxHeight: "60dvh", overflowY: "auto",
                  }}>
                    <CategoryGrid t={t} label="Scegli una categoria" categories={categoryCards} activeId={currentId} onSelect={jumpTo} />
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "12px 16px calc(150px + env(safe-area-inset-bottom))" }}>
        {showGrid && (
          <div ref={gridRef} style={{ marginBottom: 18 }}>
            <CategoryGrid t={t} label="Categorie del menù" categories={categoryCards} activeId={currentId} onSelect={jumpTo} />
          </div>
        )}

        {d.searchEnabled && d.searchTagChips.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {d.searchTagChips.map((tag) => {
              const active = d.itemSearch.trim().toLowerCase() === tag.toLowerCase();
              return (
                <button key={tag} type="button" onClick={() => d.toggleSearchTag(tag)} className="mdp-btn" aria-pressed={active} style={{
                  minHeight: 40, padding: "0 14px", borderRadius: 20, fontSize: 14, cursor: "pointer", fontFamily: FONT,
                  border: `1.5px solid ${active ? t.ink : t.line}`, background: active ? t.ink : t.bg, color: active ? t.bg : t.inkSoft,
                }}>{tag}</button>
              );
            })}
          </div>
        )}

        {d.isItemSearching && sections.length === 0 && (
          <div style={{ textAlign: "center", color: t.inkSoft, fontSize: 16, padding: "24px 0" }}>Nessun piatto trovato.</div>
        )}

        {sections.map((s) => (
          <section key={s.id} ref={(el) => { sectionRefs.current[s.id] = el; }} data-section-id={s.id} aria-label={s.name}
            style={{ marginBottom: 20, scrollMarginTop: `calc(${stickyBottom + PICKER_HEIGHT + 8}px + env(safe-area-inset-top))` }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: s.offMenu ? STATUS.waiting : t.ink, display: "flex", alignItems: "center", gap: 6 }}>
              {s.offMenu && <Utensils size={16} />}{s.name}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              {s.items.map(({ item, categoryId, categoryName }) => (
                <DishTile key={`${categoryId}-${item.id}`} t={t} item={item} offMenu={s.offMenu} compact
                  quantityInDraft={draftQty(item.id)} onAdd={() => d.addToDraft(item, categoryId, categoryName)} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* The one bar that never moves: the ticket on the left, the next
          action on the right (send what's new, or the receipt). */}
      {!panel && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 30, background: t.card, borderTop: `1px solid ${t.line}`,
          padding: "10px 16px calc(10px + env(safe-area-inset-bottom))", boxShadow: "0 -6px 18px rgba(0,0,0,0.08)",
        }}>
          <div style={{ maxWidth: 640, margin: "0 auto", display: "grid", gap: 8 }}>
            {d.sendError && <div role="alert" style={{ color: STATUS.danger, fontSize: 15, fontWeight: 600 }}>{d.sendError}</div>}
            <KitchenTicketStatus t={t} kitchenTicket={d.kitchenTicket} />
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.15fr)", gap: 10 }}>
              <button type="button" onClick={() => setPanel({ type: "ticket" })} aria-label="Apri la comanda del tavolo" className="mdp-btn" style={{
                minHeight: 60, padding: "6px 12px", borderRadius: 12, border: `1.5px solid ${d.draftCount > 0 ? t.primary : t.line}`,
                background: t.card, color: t.ink, cursor: "pointer", textAlign: "left", fontFamily: FONT,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 16, fontWeight: 700 }}>Comanda</span>
                  <span style={{ display: "block", fontSize: 13, color: d.draftCount > 0 ? t.primary : t.inkSoft, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ticketSummary}</span>
                </span>
                <ChevronUp size={20} color={t.inkSoft} />
              </button>
              {d.draftCount > 0 || d.sending ? (
                <TillButton t={t} variant="primary" size={60} disabled={d.sending || d.draftCount === 0} onClick={send} style={{ padding: "0 8px", fontSize: 17, whiteSpace: "nowrap" }}>
                  {d.sending && d.draftCount === 0 ? "Invio…" : `Invia comanda (${d.draftCount})`}
                </TillButton>
              ) : (
                <TillButton t={t} size={60} icon={Receipt} onClick={() => setPanel({ type: "receipt", from: null })}>Preconto</TillButton>
              )}
            </div>
          </div>
        </div>
      )}

      {panel?.type === "ticket" && (
        <SidePanel
          t={t}
          sheet
          label="Comanda del tavolo"
          header={(
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <BackButton t={t} onClick={() => setPanel(null)} label="Piatti" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 800 }}>Comanda</div>
                <div style={{ fontSize: 14, color: t.inkSoft }}>{id.primary}{id.secondary ? ` · ${id.secondary}` : ""}</div>
              </div>
            </div>
          )}
          footer={(
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 18, fontWeight: 600 }}>Totale</span>
                <span data-testid="phone-order-total" style={{ fontSize: 28, fontWeight: 800 }}>€ {formatCentsAsPrice(d.totalCents)}</span>
              </div>
              {coperto > 0 && <div style={{ fontSize: 14, color: t.inkSoft, marginTop: -8, textAlign: "right" }}>di cui coperto € {formatCentsAsPrice(coperto)}</div>}
              {d.sendError && <div role="alert" style={{ color: STATUS.danger, fontSize: 15 }}>{d.sendError}</div>}
              {(d.draftCount > 0 || d.sending) && (
                <TillButton t={t} variant="primary" size={60} icon={Send} disabled={d.sending || d.draftCount === 0} onClick={send}>
                  {d.sending && d.draftCount === 0 ? "Invio…" : `Invia comanda (${d.draftCount})`}
                </TillButton>
              )}
              <KitchenTicketStatus t={t} kitchenTicket={d.kitchenTicket} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <TillButton t={t} icon={Receipt} onClick={() => setPanel({ type: "receipt", from: { type: "ticket" } })}>Preconto</TillButton>
                <TillButton t={t} variant="danger" icon={Lock} disabled={d.closing} onClick={doClose} style={{ padding: "0 8px", whiteSpace: "nowrap" }}>
                  {d.closing ? "Chiusura…" : "Chiudi tavolo"}
                </TillButton>
              </div>
            </>
          )}
        >
          {sentLines.length === 0 && d.draft.length === 0 && (
            <div style={{ color: t.inkSoft, fontSize: 17, padding: "16px 0", lineHeight: 1.5 }}>
              Ancora nulla per questo tavolo.<br />Torna ai piatti e toccane uno per aggiungerlo.
            </div>
          )}
          {d.draft.length > 0 && (
            <div role="group" aria-label="Da inviare" style={{ borderRadius: 14, border: `2px solid ${t.primary}`, padding: "8px 12px", background: `${t.primary}0d`, marginBottom: 16 }}>
              <SectionTitle t={t} color={t.primary} style={{ margin: "2px 0 2px" }}>Da inviare</SectionTitle>
              {d.draft.map((l) => (
                <DraftLineRow key={l.lineId} t={t} line={l}
                  onEdit={() => setPanel({ type: "line", lineId: l.lineId, sent: false })}
                  onChangeQty={(delta) => d.changeQty(l.lineId, delta)}
                  onRemove={() => d.removeDraftLine(l.lineId)} />
              ))}
            </div>
          )}
          {sentLines.length > 0 && (
            <div role="group" aria-label="Già inviato">
              <SectionTitle t={t} color={STATUS.ok} style={{ margin: "4px 0 2px" }}>Inviata{locked ? " · preconto confermato" : " · tocca una riga per modificarla"}</SectionTitle>
              {sentLines.map((l) => <TicketLine key={l.lineId} t={t} line={l} sent onSelect={() => setPanel({ type: "line", lineId: l.lineId, sent: true })} />)}
            </div>
          )}
        </SidePanel>
      )}

      {panel?.type === "line" && editingLine && (
        <LineEditor key={editingLine.lineId} t={t} sheet line={editingLine} sent={panel.sent} locked={panel.sent && locked}
          onSave={(patch) => d.saveLine(panel, patch)} onRemove={removeEditingLine} onClose={() => setPanel({ type: "ticket" })} />
      )}

      {panel?.type === "receipt" && (
        <ReceiptPanel t={t} menu={menu} order={order} sheet backLabel={panel.from ? "Comanda" : "Piatti"} onClose={() => setPanel(panel.from)} />
      )}
    </div>
  );
}

/* ---------------------------------- panel ---------------------------------- */

// The "Tavoli" section of the phone app (PhoneApp.jsx). setImmersive: hides
// the app's bars while a task screen (a table, a new table) is open.
// request: sent from Prenotazioni — { type: "avvia", reservation } starts a
// booked table, { type: "open", orderId } opens one already started.
// onOpenReservation: the other way, a reservation of today opened in
// Prenotazioni.
export function WaiterPanel({ menu, session, setImmersive = () => {}, request = null, onRequestHandled = () => {}, onOpenReservation = () => {} }) {
  const t = THEMES[menu?.theme] || THEMES.minimal;
  const { orders, ordersReady, shiftClosedOrders, todaysReservations, menuCosts, kitchenProblemsByOrder, createTable: openTable, startFromReservation } = useSalaData({ menu, session });
  const [view, setView] = useState({ mode: "list" }); // list | new (reservation?) | detail
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setImmersive(view.mode !== "list");
    window.scrollTo(0, 0);
  }, [view.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setImmersive(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const createTable = async (fields) => {
    setCreating(true);
    const id = view.reservation
      ? await startFromReservation(view.reservation, fields.tableNumber)
      : await openTable(fields);
    setCreating(false);
    if (id) setView({ mode: "detail", orderId: id });
  };

  const handleAvviaReservation = async (reservation) => {
    if (!reservation.tableNumber) { setView({ mode: "new", reservation }); return; }
    setCreating(true);
    const id = await startFromReservation(reservation, reservation.tableNumber);
    setCreating(false);
    if (id) setView({ mode: "detail", orderId: id });
  };

  useEffect(() => {
    if (!request || !ordersReady) return;
    onRequestHandled();
    if (request.type === "open") setView({ mode: "detail", orderId: request.orderId });
    else if (request.type === "avvia") handleAvviaReservation(request.reservation);
  }, [request, ordersReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentOrder = view.mode === "detail" ? orders.find((o) => o.id === view.orderId) : null;

  if (!ordersReady) {
    return <div style={{ textAlign: "center", padding: 40, color: t.inkSoft, fontFamily: FONT }}>Caricamento tavoli…</div>;
  }
  if (view.mode === "new") {
    return (
      <NewTableForm t={t} openOrders={orders} reservation={view.reservation} busy={creating}
        onCancel={() => setView({ mode: "list" })} onCreate={createTable}
        onGoTo={(orderId) => setView({ mode: "detail", orderId })} />
    );
  }
  if (view.mode === "detail" && currentOrder) {
    return <OrderDetail key={currentOrder.id} t={t} menu={menu} menuCosts={menuCosts} order={currentOrder} senderName={session.name} onBack={() => setView({ mode: "list" })} />;
  }
  if (view.mode === "detail") {
    return (
      <div style={{ textAlign: "center", padding: "60px 24px", color: t.inkSoft, fontFamily: FONT, fontSize: 17 }}>
        Questo tavolo non è più aperto.
        <div style={{ marginTop: 16 }}>
          <TillButton t={t} onClick={() => setView({ mode: "list" })}>Torna ai tavoli</TillButton>
        </div>
      </div>
    );
  }
  return (
    <TableList
      t={t}
      menu={menu}
      orders={orders}
      kitchenProblemsByOrder={kitchenProblemsByOrder}
      shiftClosedOrders={shiftClosedOrders}
      onOpenNew={() => setView({ mode: "new" })}
      onOpenOrder={(id) => setView({ mode: "detail", orderId: id })}
      todaysReservations={todaysReservations}
      onOpenReservation={onOpenReservation}
      onAvviaReservation={handleAvviaReservation}
    />
  );
}
