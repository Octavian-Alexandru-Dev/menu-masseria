// Elimina (non solo chiude) le comande/prenotazioni di test create durante
// i test Playwright, per non lasciare residui tra test che girano in
// parallelo nello stesso run (fullyParallel: true) contro lo stesso
// emulatore. Usa il client SDK di Firebase direttamente in Node, connesso
// all'emulatore locale (mai al progetto reale — vedi tests/global-setup.js).
import { collection, query, where, getDocs, deleteDoc } from "firebase/firestore";
import { waiterDb, adminDb } from "./helpers/emulatorApp.js";

// Best-effort: non deve mai far fallire un test per un problema di pulizia.
export async function deleteTestOrderByTableNumber(tableNumber) {
  try {
    const db = await waiterDb();
    const q = query(collection(db, "orders"), where("tableNumber", "==", tableNumber));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    // Anche le stampe del tavolo (comanda per la cucina accodata da "Invia
    // comanda", preconti): senza una cassa accesa resterebbero in coda e la
    // prima cassa simulata di un altro file le stamperebbe tutte.
    for (const d of snap.docs) {
      const jobs = await getDocs(query(collection(db, "printJobs"), where("orderId", "==", d.id)));
      await Promise.all(jobs.docs.map((j) => deleteDoc(j.ref)));
    }
  } catch (err) {
    console.error(`[test cleanup] Eliminazione tavolo ${tableNumber} fallita:`, err.message || err);
  }
}

// Stesso pattern di deleteTestOrderByTableNumber, per le prenotazioni create
// durante i test di tests/reservations.spec.js.
// Da amministratore: eliminare una prenotazione può solo lui (firestore.rules).
export async function deleteTestReservationByName(name) {
  try {
    const db = await adminDb();
    const q = query(collection(db, "reservations"), where("name", "==", name));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch (err) {
    console.error(`[test cleanup] Eliminazione prenotazione "${name}" fallita:`, err.message || err);
  }
}
