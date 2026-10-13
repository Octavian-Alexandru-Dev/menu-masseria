// Crea direttamente su Firestore (emulatore) una prenotazione "da confermare"
// (status "pending"), come quelle salvate prima che le prenotazioni nascessero
// già confermate: l'interfaccia non può più crearle, ma nel progetto reale ne
// restano, e devono comparire come tutte le altre. La pulizia è
// deleteTestReservationByName (tests/firestore-cleanup.js).
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { waiterDb } from "./emulatorApp.js";

// Data locale "YYYY-MM-DD" di oggi, come dateKey() in src/reservationsData.js.
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function seedLegacyPendingReservation(name, { time = "21:00", adults = 2 } = {}) {
  const db = await waiterDb();
  await addDoc(collection(db, "reservations"), {
    date: todayKey(), time, name, phone: "", notes: "", tableNumber: null,
    covers: { adults, children: 0 },
    status: "pending",
    createdBy: { uid: "legacy", name: "Prova" }, createdAt: serverTimestamp(),
    confirmedBy: null, confirmedAt: null, rejectedBy: null, rejectedAt: null,
    cancelledBy: null, cancelledAt: null, noShowAt: null,
    orderId: null, startedAt: null, expireAt: null,
  });
}
