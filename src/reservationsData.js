// Firestore helpers for table reservations (waiter/admin area).
// See docs/prenotazioni.md for the full data model.
//
// File loaded ONLY by the waiter/reservations areas (Waiter.jsx/
// Reservations.jsx, both lazy-loaded), never by the public site.
//
// Name deliberately different from Reservations.jsx: a name that only
// differs by case creates an ambiguous import on case-insensitive
// filesystems (macOS/Windows), where Vite could resolve "./Reservations"
// to this file instead of the component.
import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, query, where,
  orderBy, serverTimestamp, Timestamp,
} from "firebase/firestore";
import { db } from "./firebase-db";
import { openOrder } from "./orders";

export const RESERVATIONS_COLLECTION = "reservations";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function reservationsRef() {
  return collection(db, RESERVATIONS_COLLECTION);
}

export function reservationRef(id) {
  return doc(db, RESERVATIONS_COLLECTION, id);
}

// Local "YYYY-MM-DD" (not UTC): the calendar reasons in days, not instants,
// so we store the date as a string instead of a Timestamp — this avoids
// timezone bugs and makes querying a range of days a simple where/orderBy on
// the same field, without a composite index (same trick already used for
// closedAt in orders.js).
export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function expireAtFromNow() {
  return Timestamp.fromMillis(Date.now() + THIRTY_DAYS_MS);
}

// Text summary of a reservation's covers ("3 adults, 1 child"), used both in
// Reservations.jsx and in the "Today's reservations" section of Waiter.jsx.
export function coversLabel(covers) {
  const adults = covers?.adults || 0;
  const children = covers?.children || 0;
  const parts = [];
  if (adults > 0) parts.push(`${adults} ${adults === 1 ? "adulto" : "adulti"}`);
  if (children > 0) parts.push(`${children} ${children === 1 ? "bambino" : "bambini"}`);
  return parts.length > 0 ? parts.join(", ") : "0 coperti";
}

/* ============================== WRITES ============================== */

export async function createReservation({ date, time, name, phone, covers, notes, tableNumber, createdByUid, createdByName }) {
  return addDoc(reservationsRef(), {
    date,
    time: time || "",
    name: name || "",
    phone: phone || "",
    covers: { adults: covers?.adults || 0, children: covers?.children || 0 },
    notes: notes || "",
    tableNumber: tableNumber || null,
    status: "pending",
    createdBy: { uid: createdByUid, name: createdByName },
    createdAt: serverTimestamp(),
    confirmedBy: null, confirmedAt: null,
    rejectedBy: null, rejectedAt: null,
    cancelledBy: null, cancelledAt: null,
    noShowAt: null,
    orderId: null, startedAt: null,
    expireAt: null,
  });
}

// Edits the fields of a still-active reservation (pending/confirmed): same
// form used to create it, reused for editing.
export async function updateReservation(id, fields) {
  return updateDoc(reservationRef(id), fields);
}

export async function confirmReservation(id, by) {
  return updateDoc(reservationRef(id), {
    status: "confirmed", confirmedBy: by, confirmedAt: serverTimestamp(),
  });
}

export async function rejectReservation(id, by) {
  return updateDoc(reservationRef(id), {
    status: "rejected", rejectedBy: by, rejectedAt: serverTimestamp(), expireAt: expireAtFromNow(),
  });
}

export async function cancelReservation(id, by) {
  return updateDoc(reservationRef(id), {
    status: "cancelled", cancelledBy: by, cancelledAt: serverTimestamp(), expireAt: expireAtFromNow(),
  });
}

// "Start": reuses orders.js's openOrder() with the data already on the
// reservation (table/covers/notes), so the waiter doesn't have to retype
// anything, then links the newly opened order to the reservation.
export async function startReservation(reservation, { waiterUid, waiterName, coperto, tableNumber }) {
  const orderDocRef = await openOrder({
    tableNumber: tableNumber ?? reservation.tableNumber,
    tableName: reservation.name,
    adults: reservation.covers?.adults,
    children: reservation.covers?.children,
    notes: reservation.notes,
    waiterUid,
    waiterName,
    coperto,
  });
  await updateDoc(reservationRef(reservation.id), {
    status: "started", orderId: orderDocRef.id, startedAt: serverTimestamp(),
  });
  return orderDocRef;
}

/* ============================== READS ============================== */

// A single listener for a date range (e.g. the visible month in the
// calendar): filter and ordering on the same `date` field, so no composite
// index is needed.
export function subscribeReservationsForRange(startDateKey, endDateKey, onChange, onError) {
  const q = query(
    reservationsRef(),
    where("date", ">=", startDateKey),
    where("date", "<=", endDateKey),
    orderBy("date")
  );
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, onError);
}

// Special case (a single day) — used both by Reservations.jsx and by
// Waiter.jsx ("today's reservations" in the dining room view).
export function subscribeReservationsForDate(dateStr, onChange, onError) {
  return subscribeReservationsForRange(dateStr, dateStr, onChange, onError);
}

// "To confirm" count, for the badge in the Dashboard (StaffHome.jsx).
export function subscribePendingReservations(onChange, onError) {
  const q = query(reservationsRef(), where("status", "==", "pending"));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, onError);
}

/* ======================= "LAZY" AUTOMATIC CLEANUP ======================= */

// Automatic no-show (lazy, same pattern as autoCloseStaleOrders in
// orders.js): "confirmed" reservations whose date has already passed and
// were never started become "no_show" the next time the calendar is loaded.
export async function autoFlagNoShows(reservationsInView) {
  const today = dateKey();
  const stale = reservationsInView.filter((r) => r.status === "confirmed" && r.date < today);
  await Promise.all(
    stale.map((r) =>
      updateDoc(reservationRef(r.id), {
        status: "no_show", noShowAt: serverTimestamp(), expireAt: expireAtFromNow(),
      }).catch((err) => {
        console.error(`[reservations] Flag no_show fallito per ${r.id}:`, err);
      })
    )
  );
  return stale.map((r) => r.id);
}

// Deletion after 30 days of reservations in a terminal state, same
// lazy/localStorage mechanism as runDailyExpiredOrdersCleanup in orders.js.
const CLEANUP_STORAGE_KEY = "mdp-reservations-last-cleanup";

export async function runDailyExpiredReservationsCleanup() {
  try {
    if (localStorage.getItem(CLEANUP_STORAGE_KEY) === dateKey()) return;
  } catch {
    // localStorage unavailable (e.g. private browsing): proceed anyway, the
    // check will simply be repeated on the next open.
  }
  try {
    const q = query(reservationsRef(), where("expireAt", "<=", Timestamp.now()));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch((err) => {
      console.error(`[reservations] Cancellazione scaduta fallita per ${d.id}:`, err);
    })));
    try { localStorage.setItem(CLEANUP_STORAGE_KEY, dateKey()); } catch { /* ignore */ }
  } catch (err) {
    console.error("[reservations] Pulizia prenotazioni scadute fallita:", err);
  }
}
