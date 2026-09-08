// Firestore helpers for table orders (waiter/kitchen area).
// See docs/comande-camerieri.md for the full data model.
//
// File loaded ONLY by the waiter/kitchen areas (Waiter.jsx/Kitchen.jsx,
// both lazy-loaded), never by the public site.
import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, query, where,
  orderBy, limit, startAfter, writeBatch,
  arrayUnion, serverTimestamp, Timestamp,
} from "firebase/firestore";
import { db } from "./firebase-db";
import { parsePriceToCents } from "./shared";

export const ORDERS_COLLECTION = "orders";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function ordersRef() {
  return collection(db, ORDERS_COLLECTION);
}

export function orderRef(orderId) {
  return doc(db, ORDERS_COLLECTION, orderId);
}

// Realtime subscription to all open orders (status "open"), used by both the
// waiter and kitchen areas. includeMetadataChanges:true is required because
// the "sending in progress" indicator (§7 of the doc) relies on each
// document's hasPendingWrites metadata, which otherwise wouldn't re-trigger
// the listener when the write is confirmed.
export function subscribeOpenOrders(onChange, onError) {
  const q = query(ordersRef(), where("status", "==", "open"));
  return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const orders = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      _hasPendingWrites: d.metadata.hasPendingWrites,
    }));
    onChange(orders);
  }, onError);
}

// Orders closed (manually or automatically) during the current service
// shift: unlike the history, these stay visible in the dining room without
// switching screens, and in realtime — another waiter sees them disappear
// from the open tables and show up here as soon as they're closed. closedAt
// >= shift start + orderBy on the same field: no composite index needed.
export function subscribeShiftClosedOrders(sinceDate, onChange, onError) {
  const q = query(
    ordersRef(),
    where("closedAt", ">=", Timestamp.fromDate(sinceDate)),
    orderBy("closedAt", "desc")
  );
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, onError);
}

// The cover charge (adults/children) is fixed when the table is opened, as a
// snapshot from the menu — if the price changes later in Gestione menù,
// orders already open or in the history stay consistent with what was
// actually charged that day.
export async function openOrder({ tableNumber, tableName, adults, children, notes, waiterUid, waiterName, coperto }) {
  return addDoc(ordersRef(), {
    tableNumber,
    tableName: tableName || "",
    covers: { adults: adults || 0, children: children || 0 },
    coperto: { adults: coperto?.adults || "0,00", children: coperto?.children || "0,00" },
    notes: notes || "",
    waiterUid,
    waiterName,
    status: "open",
    openedAt: serverTimestamp(),
    closedAt: null,
    expireAt: null,
    items: [],
  });
}

// Adds lines to an already-open order. Each line arrives already complete
// (snapshot of name/price/category, notes, quantity — see buildOrderLine).
export async function sendOrderLines(orderId, lines) {
  return updateDoc(orderRef(orderId), { items: arrayUnion(...lines) });
}

// A line's "course" is no longer a manual choice by the waiter (a source of
// errors: e.g. a dish added by mistake under "Drinks"), but the menu
// category the dish actually belongs to — categoryId/Name are a snapshot at
// send time, consistent with name/price.
//
// cost: the dish's internal cost (src/menuCosts.js), snapshotted here for
// the same reason as the price — if the cost changes later, the historical
// margin stays correct. null when the dish has no configured cost (or for
// orders sent before this field existed) — the statistics Dashboard excludes
// those lines from the margin instead of treating them as zero margin, and
// reports how much of the revenue has no known cost.
export function buildOrderLine({ lineId, menuItemId, name, price, quantity, categoryId, categoryName, notes, cost }) {
  return {
    lineId,
    menuItemId: menuItemId || null,
    name,
    price,
    quantity,
    categoryId: categoryId || null,
    categoryName: categoryName || "",
    notes: notes || "",
    cost: cost || null,
    status: "sent",
    // arrayUnion doesn't accept serverTimestamp() for individual elements: we
    // use a client timestamp, good enough for display ordering.
    sentAt: Timestamp.now(),
    outAt: null,
  };
}

// The kitchen marks a whole group (a menu category, e.g. all starters for
// the table) as "sent out" with a single tap (§5 point 3 of the doc).
// Firestore arrays don't support updating a single element, so we rewrite
// the entire `items` array with the updated status only on the lines of the
// chosen category that aren't already out.
export async function markCategoryOut(orderId, currentItems, categoryId) {
  const outAt = Timestamp.now();
  const updated = currentItems.map((line) =>
    line.categoryId === categoryId && line.status !== "out" ? { ...line, status: "out", outAt } : line
  );
  return updateDoc(orderRef(orderId), { items: updated });
}

// Changes the covers for an already-open table (people arriving/leaving
// after opening — not only at creation time).
export async function updateCovers(orderId, { adults, children }) {
  return updateDoc(orderRef(orderId), { covers: { adults: adults || 0, children: children || 0 } });
}

// Closed orders no longer expire: they remain the permanent history the
// statistics Dashboard is built on (src/Stats.jsx, src/statsData.js).
export async function closeOrder(orderId) {
  return updateDoc(orderRef(orderId), {
    status: "closed",
    closedAt: serverTimestamp(),
    expireAt: null,
  });
}

// Removes an already-sent line (fixing a typo, no longer recoverable via a
// "void" — used by the receipt flow).
export async function removeOrderLine(orderId, currentItems, lineId) {
  const updated = currentItems.filter((line) => line.lineId !== lineId);
  return updateDoc(orderRef(orderId), { items: updated });
}

// Receipt (not a fiscal receipt — see docs, §9): the waiter generates a
// printable summary via the browser, can correct the order (missing lines,
// mistakes) and then confirm a "final" state. Everything is saved on the
// order itself, synced in realtime to every client.
export async function markReceiptPrinted(orderId) {
  return updateDoc(orderRef(orderId), { "receipt.printedAt": serverTimestamp() });
}

export async function confirmFinalReceipt(orderId, order) {
  return updateDoc(orderRef(orderId), {
    "receipt.confirmedAt": serverTimestamp(),
    "receipt.items": order.items || [],
    "receipt.totalCents": orderTotalCents(order),
  });
}

// "Lazy" automatic closing on the client side (§6.2 of the doc): every time
// the waiter or kitchen area loads the list of open orders, it closes any
// that have been open for more than 24 hours. No scheduled job, no Blaze
// plan required — it converges to the correct result the next time the app
// is used.
export async function autoCloseStaleOrders(openOrders) {
  const now = Date.now();
  const stale = openOrders.filter((o) => {
    const openedAtMs = o.openedAt?.toMillis ? o.openedAt.toMillis() : null;
    return openedAtMs != null && now - openedAtMs > TWENTY_FOUR_HOURS_MS;
  });
  await Promise.all(
    stale.map((o) =>
      updateDoc(orderRef(o.id), {
        status: "auto_closed",
        closedAt: serverTimestamp(),
        expireAt: null,
      }).catch((err) => {
        console.error(`[orders] Chiusura automatica fallita per ${o.id}:`, err);
      })
    )
  );
  return stale.map((o) => o.id);
}

export function itemsTotalCents(order) {
  return (order.items || []).reduce((sum, line) => sum + parsePriceToCents(line.price) * line.quantity, 0);
}

export function copertoTotalCents(order) {
  const adults = order.covers?.adults || 0;
  const children = order.covers?.children || 0;
  return parsePriceToCents(order.coperto?.adults) * adults + parsePriceToCents(order.coperto?.children) * children;
}

export function orderTotalCents(order) {
  return itemsTotalCents(order) + copertoTotalCents(order);
}

/* ============================== HISTORY ============================== */
// Closed orders are no longer deleted: they stay forever as the history that
// backs the statistics Dashboard. The `expireAt` field stays in the schema
// (always null for new orders) only for compatibility with documents
// written before this change.
// Closed orders (manually or automatically), most recent first. Uses
// closedAt both for the filter (!= null → only closed ones) and the
// ordering: same field on both, so Firestore doesn't require a dedicated
// composite index. Paginated loading (not realtime: a history doesn't need
// to update itself) with "load more" via a cursor on closedAt.
export const HISTORY_PAGE_SIZE = 20;

export async function loadClosedOrdersPage(afterClosedAt) {
  const clauses = [where("closedAt", "!=", null), orderBy("closedAt", "desc"), limit(HISTORY_PAGE_SIZE)];
  const q = afterClosedAt
    ? query(ordersRef(), where("closedAt", "!=", null), orderBy("closedAt", "desc"), startAfter(afterClosedAt), limit(HISTORY_PAGE_SIZE))
    : query(ordersRef(), ...clauses);
  const snap = await getDocs(q);
  const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const lastClosedAt = orders.length > 0 ? orders[orders.length - 1].closedAt : null;
  return { orders, lastClosedAt, hasMore: orders.length === HISTORY_PAGE_SIZE };
}

// Deletes a single order from the history (targeted correction of an order
// created by mistake). Reserved for admins on the UI side — see
// OrderHistory.jsx.
export async function deleteOrder(orderId) {
  return deleteDoc(orderRef(orderId));
}

// Wipes the entire history (e.g. after trying out/demoing the app, when test
// orders are no longer distinguishable from real ones). Closed orders are
// otherwise never deleted (see note above), so this is a deliberately
// destructive and irreversible operation, reserved for admins on the UI
// side. writeBatch is limited to 500 writes: we proceed in chunks.
const DELETE_BATCH_SIZE = 400;

export async function deleteAllClosedOrders() {
  const snap = await getDocs(query(ordersRef(), where("closedAt", "!=", null)));
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += DELETE_BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const d of docs.slice(i, i + DELETE_BATCH_SIZE)) batch.delete(d.ref);
    await batch.commit();
  }
  return docs.length;
}
