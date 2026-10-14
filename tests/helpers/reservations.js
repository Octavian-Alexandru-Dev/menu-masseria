// Prenotazioni scritte e lette direttamente su Firestore (emulatore), senza
// passare dall'interfaccia. La pulizia è deleteTestReservationByName
// (tests/firestore-cleanup.js).
import { collection, addDoc, getDocs, query, where, serverTimestamp } from "firebase/firestore";
import { waiterDb } from "./emulatorApp.js";

// Data locale "YYYY-MM-DD" di oggi, come dateKey() in src/reservationsData.js.
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Una prenotazione di oggi. `status: "pending"` ("da confermare") è come
// quelle salvate prima che le prenotazioni nascessero già confermate:
// l'interfaccia non può più crearle, ma nel progetto reale ne restano, e
// devono comparire come tutte le altre.
export async function seedReservation(name, { time = "21:00", adults = 2, status = "confirmed", tableNumber = null } = {}) {
  const db = await waiterDb();
  await addDoc(collection(db, "reservations"), {
    date: todayKey(), time, name, phone: "", notes: "", tableNumber,
    covers: { adults, children: 0 },
    status,
    createdBy: { uid: "test", name: "Prova" }, createdAt: serverTimestamp(),
    confirmedBy: null, confirmedAt: null, rejectedBy: null, rejectedAt: null,
    cancelledBy: null, cancelledAt: null, noShowAt: null,
    orderId: null, startedAt: null, expireAt: null,
  });
}

export function seedLegacyPendingReservation(name, options = {}) {
  return seedReservation(name, { ...options, status: "pending" });
}

// La prenotazione con quel nome sul server ({ id, ...dati }), o null.
export async function findReservationByName(name) {
  const db = await waiterDb();
  const snap = await getDocs(query(collection(db, "reservations"), where("name", "==", name)));
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}
