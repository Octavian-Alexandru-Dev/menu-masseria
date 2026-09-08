// Elimina (non solo chiude) le comande/prenotazioni di test create durante
// i test Playwright, per non lasciare residui tra test che girano in
// parallelo nello stesso run (fullyParallel: true) contro lo stesso
// emulatore. Usa il client SDK di Firebase direttamente in Node, connesso
// all'emulatore locale (mai al progetto reale — vedi tests/global-setup.js).
import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, collection, query, where, getDocs, deleteDoc } from "firebase/firestore";
import { TEST_WAITER } from "./test-env.js";

const app = getApps()[0] || initializeApp({ apiKey: "demo-key", projectId: "demo-masseria-test" });
const auth = getAuth(app);
const db = getFirestore(app);
connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
connectFirestoreEmulator(db, "localhost", 8080);

let signInPromise = null;
function ensureSignedIn() {
  if (!signInPromise) {
    signInPromise = signInWithEmailAndPassword(auth, TEST_WAITER.email, TEST_WAITER.password);
  }
  return signInPromise;
}

// Best-effort: non deve mai far fallire un test per un problema di pulizia.
export async function deleteTestOrderByTableNumber(tableNumber) {
  try {
    await ensureSignedIn();
    const q = query(collection(db, "orders"), where("tableNumber", "==", tableNumber));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch (err) {
    console.error(`[test cleanup] Eliminazione tavolo ${tableNumber} fallita:`, err.message || err);
  }
}

// Stesso pattern di deleteTestOrderByTableNumber, per le prenotazioni create
// durante i test di tests/reservations.spec.js.
export async function deleteTestReservationByName(name) {
  try {
    await ensureSignedIn();
    const q = query(collection(db, "reservations"), where("name", "==", name));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch (err) {
    console.error(`[test cleanup] Eliminazione prenotazione "${name}" fallita:`, err.message || err);
  }
}
