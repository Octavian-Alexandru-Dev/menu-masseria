// Logic shared by the two presentations of the waiter area ("Sala"):
//  - Waiter.jsx: the phone layout (single column, mobile-first);
//  - TillSala.jsx: the till layout inside the Windows client (full-screen
//    POS grid, see docs/stampa-scontrini.md).
// Same data, same rules (draft, send, close, reservations, 24h auto-close):
// only the presentation differs, so a change in behaviour lands in both.
import React, { useState, useEffect, useRef } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import { uid, TYPE, parsePriceToCents, currentShiftStart, itemMatchesSearch } from "./shared";
import {
  subscribeOpenOrders, subscribeShiftClosedOrders, openOrder, sendOrderLines, buildOrderLine, closeOrder,
  autoCloseStaleOrders, orderTotalCents,
} from "./orders";
import { subscribeReservationsForDate, dateKey, startReservation, runDailyExpiredReservationsCleanup } from "./reservationsData";
import { subscribeMenuCosts } from "./menuCosts";

export function formatTime(ts) {
  return ts?.toDate ? ts.toDate().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : null;
}

const PENDING_WARNING_MS = 12_000;

export function elapsedLabel(openedAt) {
  const ms = openedAt?.toMillis ? Date.now() - openedAt.toMillis() : null;
  if (ms == null) return "appena aperto";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "appena aperto";
  if (min < 60) return `${min} min fa`;
  return `${Math.floor(min / 60)}h ${min % 60}min fa`;
}

export function SyncBadge({ t, hasPendingWrites }) {
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

export function lineStatusLabel(status) {
  return status === "out" ? "Uscita" : status === "preparing" ? "In preparazione" : "Inviata";
}

export function lineStatusColor(t, status) {
  return status === "out" ? t.secondary : status === "preparing" ? t.accent : t.inkSoft;
}

// Distinct search-tag chips across the whole menu (not just the items
// currently visible), so the waiter can filter by tag ("Bibita", "Alcolico"…)
// without typing it. Deduped case-insensitively but keeps the casing the
// admin used the first time a tag appears.
export function distinctSearchTags(menu) {
  const seen = new Map();
  (menu?.categories || []).forEach((c) => {
    c.items.forEach((item) => {
      (item.searchTags || "").split(",").forEach((raw) => {
        const tag = raw.trim();
        if (!tag) return;
        const key = tag.toLowerCase();
        if (!seen.has(key)) seen.set(key, tag);
      });
    });
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "it"));
}

// Everything the Sala screen listens to: open tables, tables closed during
// the shift, today's confirmed reservations, dish costs — plus opening a
// table (directly or from a reservation).
export function useSalaData({ menu, session }) {
  const [orders, setOrders] = useState([]);
  const [ordersReady, setOrdersReady] = useState(false);
  const [shiftClosedOrders, setShiftClosedOrders] = useState([]);
  const [todaysReservations, setTodaysReservations] = useState([]);
  const [menuCosts, setMenuCosts] = useState({});
  const closingRef = useRef(new Set());

  // Dish costs (src/menuCosts.js), to snapshot them onto the order lines at
  // send time — see addToDraft in useOrderDraft.
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

  // Orders closed during the current shift (§9): the shift start is
  // computed once when the screen opens — if the app stays open across a
  // shift change (lunch→dinner), just reloading the page refreshes it,
  // consistent with the other "lazy" checks already in the app.
  useEffect(() => {
    const unsubscribe = subscribeShiftClosedOrders(currentShiftStart(), (list) => {
      setShiftClosedOrders(list);
    }, (err) => console.error("[waiter] Errore lettura comande chiuse nel turno:", err));
    return unsubscribe;
  }, []);

  useEffect(() => {
    runDailyExpiredReservationsCleanup();
  }, []);

  // Confirmed reservations for today: they show up as soon as the shift
  // starts, so the waiter can "start" them without retyping table/covers.
  useEffect(() => {
    const unsubscribe = subscribeReservationsForDate(dateKey(), (list) => {
      setTodaysReservations(list.filter((r) => r.status === "confirmed"));
    }, (err) => console.error("[waiter] Errore lettura prenotazioni:", err));
    return unsubscribe;
  }, []);

  // Lazy automatic closing after 24h (§6.2): on every list update, closes
  // orders that have been open too long.
  useEffect(() => {
    if (!ordersReady) return;
    const toClose = orders.filter((o) => !closingRef.current.has(o.id));
    toClose.forEach((o) => closingRef.current.add(o.id));
    autoCloseStaleOrders(toClose).catch(() => {});
  }, [orders, ordersReady]);

  // Both return the new order id, or null on failure (already logged).
  const createTable = async (fields) => {
    try {
      const ref = await openOrder({ ...fields, coperto: menu?.coperto, waiterUid: session.user.uid, waiterName: session.name });
      return ref.id;
    } catch (err) {
      console.error("[waiter] Apertura tavolo fallita:", err);
      return null;
    }
  };

  const startFromReservation = async (reservation, tableNumber) => {
    try {
      const ref = await startReservation(reservation, {
        waiterUid: session.user.uid, waiterName: session.name, coperto: menu?.coperto, tableNumber,
      });
      return ref.id;
    } catch (err) {
      console.error("[waiter] Avvio prenotazione fallito:", err);
      return null;
    }
  };

  return { orders, ordersReady, shiftClosedOrders, todaysReservations, menuCosts, createTable, startFromReservation };
}

// One table's order screen: the menu to pick from (with search and tag
// chips), the draft of lines not yet sent, sending, closing, and the lines
// already sent grouped by menu category.
export function useOrderDraft({ menu, menuCosts, order }) {
  const [draft, setDraft] = useState([]); // { lineId, menuItemId, name, price, categoryId, categoryName, quantity, notes }
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [closing, setClosing] = useState(false);

  const categories = menu?.categories || [];
  const normalItems = categories
    .map((c) => ({ ...c, items: c.items.filter((i) => i.visible !== false && !i.staffOnly) }))
    .filter((c) => c.items.length > 0);
  const offMenuItems = categories.flatMap((c) => c.items.filter((i) => i.staffOnly).map((i) => ({ ...i, _categoryId: c.id, _categoryName: c.name })));

  // Dish search: filters live as the waiter types, in whatever language an
  // entry has been translated into — useful when a foreign customer asks for
  // a dish in their own language. Can be disabled by the admin
  // (menu.searchEnabled): missing/true = enabled.
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

  // Clicking a tag chip just fills the same search box a waiter would type
  // into, so it goes through the exact same itemMatchesSearch matching as
  // manual typing. Clicking the already-selected chip clears it.
  const searchTagChips = distinctSearchTags(menu);
  const toggleSearchTag = (tag) => {
    setItemSearch((current) => (current.trim().toLowerCase() === tag.toLowerCase() ? "" : tag));
  };

  // A line's "course" is always the real menu category the dish belongs to,
  // never a manual choice.
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
  // Whole-line edit from the till's line editor (quantity, price, note).
  const updateDraftLine = (lineId, patch) => setDraft((d) => d.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)));

  const send = async () => {
    if (draft.length === 0) return;
    setSending(true);
    setSendError("");
    try {
      await sendOrderLines(order.id, draft.map((l) => buildOrderLine(l)));
      setDraft([]);
    } catch (err) {
      console.error("[waiter] Invio comanda fallito:", err);
      setSendError("Invio non riuscito. Verifica la connessione e riprova.");
    } finally {
      setSending(false);
    }
  };

  // Resolves true once closed (the caller navigates back).
  const closeTable = async () => {
    setClosing(true);
    try {
      await closeOrder(order.id);
      return true;
    } catch (err) {
      console.error("[waiter] Chiusura tavolo fallita:", err);
      setClosing(false);
      return false;
    }
  };

  // Already-sent lines grouped by the real menu category, in menu order.
  const sentByCategory = categories
    .map((c) => ({ categoryId: c.id, categoryName: c.name, lines: (order.items || []).filter((l) => l.categoryId === c.id) }))
    .filter((g) => g.lines.length > 0);
  const knownCategoryIds = new Set(categories.map((c) => c.id));
  const sentOther = (order.items || []).filter((l) => !knownCategoryIds.has(l.categoryId));
  if (sentOther.length > 0) {
    sentByCategory.push({ categoryId: "__other__", categoryName: sentOther[0].categoryName || "Altro", lines: sentOther });
  }

  const draftCount = draft.reduce((s, l) => s + l.quantity, 0);
  const totalCents = orderTotalCents(order) + draft.reduce((s, l) => s + parsePriceToCents(l.price) * l.quantity, 0);

  return {
    draft, draftCount, addToDraft, changeQty, removeDraftLine, setDraftNote, updateDraftLine,
    send, sending, sendError, closeTable, closing,
    normalItems, offMenuItems, searchEnabled, itemSearch, setItemSearch, isItemSearching,
    filteredNormalItems, filteredOffMenuItems, searchTagChips, toggleSearchTag,
    sentByCategory, totalCents,
  };
}
