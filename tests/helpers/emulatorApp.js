// Punto unico di accesso Node-side agli emulatori Firebase, condiviso da
// tutti gli helper di test che leggono/scrivono Firestore fuori dal browser
// (pulizia dati, seed, menù "da un altro dispositivo"…).
//
// Una app Firebase con nome PER ACCOUNT, ognuna con la sua sessione: un
// helper che lavora come cameriere e uno che lavora come amministratore non
// si rubano mai la sessione a vicenda. (Prima c'era una sola app per
// processo: chi accedeva per ultimo decideva l'account di tutti, e una
// pulizia del menù — che può scrivere solo l'amministratore — falliva o no a
// seconda dell'ordine dei test nel worker.)
import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { TEST_ADMIN, TEST_WAITER, TEST_OWNER } from "../test-env.js";

const sessions = new Map(); // email → Promise<Firestore>

// Firestore collegato all'emulatore e autenticato come `account`.
export function dbAs(account) {
  if (!sessions.has(account.email)) {
    const name = `helpers-${account.email}`;
    const app = getApps().find((a) => a.name === name) || initializeApp({ apiKey: "demo-key", projectId: "demo-masseria-test" }, name);
    const auth = getAuth(app);
    const db = getFirestore(app);
    connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "localhost", 8080);
    const ready = signInWithEmailAndPassword(auth, account.email, account.password).then(() => db);
    // Un accesso fallito non resta in memoria: il prossimo helper riprova.
    ready.catch(() => sessions.delete(account.email));
    sessions.set(account.email, ready);
  }
  return sessions.get(account.email);
}

export const waiterDb = () => dbAs(TEST_WAITER);
export const adminDb = () => dbAs(TEST_ADMIN);
export const ownerDb = () => dbAs(TEST_OWNER);
