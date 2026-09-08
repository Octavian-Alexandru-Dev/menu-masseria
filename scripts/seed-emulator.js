// Popola gli emulatori Firebase locali (Auth + Firestore, vedi
// docker-compose.emulator.yml) con un menù demo e tre account di test
// (admin/cameriere/cucina), così l'app e la suite Playwright funzionano da
// subito senza un vero progetto Firebase. Idempotente: rieseguibile senza
// duplicare nulla (stesse email fisse, stesso path del documento menù).
//
// Uso: npm run seed:emulator (richiede gli emulatori già avviati, vedi
// npm run emulators:up).
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, setDoc } from "firebase/firestore";

const app = initializeApp({ apiKey: "demo-key", projectId: "demo-masseria-test" });
const auth = getAuth(app);
const db = getFirestore(app);
connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
connectFirestoreEmulator(db, "localhost", 8080);

export const SEED_ACCOUNTS = {
  admin: { email: "admin@test.local", password: "Test1234!", name: "Admin di test", role: "admin" },
  waiter: { email: "waiter@test.local", password: "Test1234!", name: "Cameriere di test", role: "waiter" },
  kitchen: { email: "kitchen@test.local", password: "Test1234!", name: "Cucina di test", role: "kitchen" },
  // Nessun documento staff/{uid} creato per questo account (vedi main()): usato
  // per testare lo stato "no-role" di useStaffSession (staff-shared.jsx).
  noRole: { email: "norole@test.local", password: "Test1234!" },
  // role volutamente non tra quelli assegnabili dall'interfaccia Admin
  // (waiter/kitchen/admin): usato per testare lo stato "Accesso non
  // consentito" di StaffHome.jsx (staffDoc.role verità ma nessuna delle tre
  // aree core lo riconosce).
  invalidRole: { email: "invalidrole@test.local", password: "Test1234!", name: "Ruolo non valido", role: "legacy-role" },
};

// Il container passa da "healthy" (healthcheck su Firestore+Auth) a
// effettivamente pronto a rispondere con un margine di qualche istante:
// qualche tentativo con backoff evita un fallimento raro per timing invece
// di un vero problema di connessione.
async function withRetry(fn, attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function ensureUser({ email, password }) {
  return withRetry(async () => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      return cred.user.uid;
    } catch (err) {
      if (err.code === "auth/email-already-in-use") {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        return cred.user.uid;
      }
      throw err;
    }
  });
}

const DEMO_MENU = {
  theme: "rustica",
  name: "Masseria Demo",
  location: "Località Demo",
  tagline: "Menù di prova — dati seed dell'emulatore",
  footerNote: "Ambiente locale, nessun dato reale",
  searchEnabled: true,
  coperto: { adults: "2,00", children: "1,00" },
  categories: [
    {
      id: "cat-antipasti",
      name: "Antipasti",
      subtitle: "",
      visible: true,
      items: [
        { id: "item-bruschetta", name: "Bruschetta", price: "6,00", tag: "", description: "Pomodoro e basilico", visible: true, staffOnly: false },
        { id: "item-caprese", name: "Caprese", price: "7,00", tag: "", description: "Mozzarella e pomodoro", visible: true, staffOnly: false },
      ],
    },
    {
      id: "cat-primi",
      name: "Primi",
      subtitle: "",
      visible: true,
      items: [
        { id: "item-orecchiette", name: "Orecchiette", price: "10,00", tag: "", description: "Cime di rapa", visible: true, staffOnly: false },
      ],
    },
    {
      id: "cat-dolci",
      name: "Dolci",
      subtitle: "",
      visible: true,
      items: [
        {
          id: "item-tiramisu", name: "Tiramisù", price: "5,00", tag: "", description: "Ricetta della casa",
          visible: true, staffOnly: false,
          // Unica voce con immagine nel menù seed: usata per testare la modale
          // di zoom in ClientView.jsx (si apre solo per le voci con item.image).
          image: "https://placehold.co/400x300.png",
        },
      ],
    },
  ],
};

async function main() {
  const uids = {};
  for (const [key, account] of Object.entries(SEED_ACCOUNTS)) {
    const uid = await ensureUser(account);
    uids[key] = uid;
    if (account.role) {
      await withRetry(() => setDoc(doc(db, "staff", uid), { name: account.name, role: account.role }));
    }
  }

  await withRetry(() => setDoc(doc(db, "menu", "data"), DEMO_MENU));

  console.log("[seed-emulator] Fatto:", uids);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-emulator] Fallito:", err);
  process.exit(1);
});
