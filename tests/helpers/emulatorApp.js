// Punto unico di inizializzazione della connessione Node-side agli
// emulatori Firebase, condiviso da tutti gli helper di test che devono
// leggere/scrivere Firestore o autenticarsi fuori dal browser (pulizia dati,
// seed di comande chiuse, ecc.). Deve esistere UN SOLO punto che chiama
// connectAuthEmulator/connectFirestoreEmulator: la app Firebase è un
// singleton di processo (getApps()), quindi se due moduli diversi la
// inizializzano ciascuno per conto proprio, il secondo fallisce con
// "auth/emulator-config-failed" (un auth/Firestore già connesso a un
// emulatore non può essere riconfigurato).
import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

const app = getApps()[0] || initializeApp({ apiKey: "demo-key", projectId: "demo-masseria-test" });
export const auth = getAuth(app);
export const db = getFirestore(app);

if (!globalThis.__mdpEmulatorConnected) {
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "localhost", 8080);
  globalThis.__mdpEmulatorConnected = true;
}
