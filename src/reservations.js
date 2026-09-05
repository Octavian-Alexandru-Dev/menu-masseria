// Helper Firestore per le prenotazioni tavoli (area cameriere/amministrazione).
// Vedi docs/prenotazioni.md per il modello dati completo.
//
// File caricato SOLO dalle aree cameriere/prenotazioni (Waiter.jsx/
// Reservations.jsx, entrambe lazy-load), mai dal sito pubblico.
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

// "YYYY-MM-DD" locale (non UTC): il calendario ragiona per giorno, non per
// istante, quindi salviamo la data come stringa invece che come Timestamp —
// evita bug di fuso orario e rende la query per intervallo di giorni una
// semplice where/orderBy sullo stesso campo, senza indice composito (stesso
// trucco già usato per closedAt in orders.js).
export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function expireAtFromNow() {
  return Timestamp.fromMillis(Date.now() + THIRTY_DAYS_MS);
}

// Riepilogo testuale dei coperti di una prenotazione ("3 adulti, 1 bambino"),
// usato sia in Reservations.jsx sia nella sezione "Prenotazioni di oggi" di
// Waiter.jsx.
export function coversLabel(covers) {
  const adults = covers?.adults || 0;
  const children = covers?.children || 0;
  const parts = [];
  if (adults > 0) parts.push(`${adults} ${adults === 1 ? "adulto" : "adulti"}`);
  if (children > 0) parts.push(`${children} ${children === 1 ? "bambino" : "bambini"}`);
  return parts.length > 0 ? parts.join(", ") : "0 coperti";
}

/* ============================== SCRITTURA ============================== */

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

// Modifica i campi di una prenotazione ancora attiva (pending/confirmed):
// stesso form usato per crearla, riutilizzato per l'editing.
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

// "Avvia": riusa openOrder() di orders.js con i dati già presenti sulla
// prenotazione (tavolo/coperti/note), così il cameriere non deve ridigitare
// nulla, poi collega la comanda appena aperta alla prenotazione.
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

/* ============================== LETTURA ============================== */

// Un solo listener per un intervallo di giorni (es. il mese visibile nel
// calendario): filtro e ordinamento sullo stesso campo `date`, quindi
// nessun indice composito necessario.
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

// Caso particolare (un solo giorno) — usato sia da Reservations.jsx sia da
// Waiter.jsx ("prenotazioni di oggi" in Sala).
export function subscribeReservationsForDate(dateStr, onChange, onError) {
  return subscribeReservationsForRange(dateStr, dateStr, onChange, onError);
}

// Conteggio "da confermare", per il badge in Dashboard (StaffHome.jsx).
export function subscribePendingReservations(onChange, onError) {
  const q = query(reservationsRef(), where("status", "==", "pending"));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, onError);
}

/* ======================= PULIZIA AUTOMATICA "PIGRA" ======================= */

// No-show automatico (lazy, stesso pattern di autoCloseStaleOrders in
// orders.js): le prenotazioni "confirmed" con data ormai passata e mai
// avviate diventano "no_show" al successivo caricamento del calendario.
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

// Cancellazione dopo 30 giorni delle prenotazioni in stato terminale, stesso
// meccanismo lazy/localStorage di runDailyExpiredOrdersCleanup in orders.js.
const CLEANUP_STORAGE_KEY = "mdp-reservations-last-cleanup";

export async function runDailyExpiredReservationsCleanup() {
  try {
    if (localStorage.getItem(CLEANUP_STORAGE_KEY) === dateKey()) return;
  } catch {
    // localStorage non disponibile (es. navigazione privata): si procede
    // comunque, il controllo verrà semplicemente ripetuto ad ogni apertura.
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
