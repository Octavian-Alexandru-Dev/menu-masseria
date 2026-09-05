// Elimina (non solo chiude) le comande di test create durante i test
// Playwright, per non lasciare residui permanenti nello storico comande
// reale (le comande chiuse restano visibili nello Storico finché non
// scadono i 30 giorni di retention — dati di test non dovrebbero mai
// arrivarci). Usa il client SDK di Firebase direttamente in Node: le
// chiavi VITE_FIREBASE_* sono valori pubblici (già nel bundle client),
// non credenziali segrete.
import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, query, where, getDocs, deleteDoc } from "firebase/firestore";
import { config } from "dotenv";

config();
config({ path: ".env.test" });

const app = getApps()[0] || initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
});
const auth = getAuth(app);
const db = getFirestore(app);

let signInPromise = null;
function ensureSignedIn() {
  if (!signInPromise) {
    signInPromise = signInWithEmailAndPassword(auth, process.env.TEST_WAITER_EMAIL, process.env.TEST_WAITER_PASSWORD);
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
