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
import { getFirestore, connectFirestoreEmulator, doc, setDoc, Timestamp } from "firebase/firestore";

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
  theme: "minimal",
  restaurantName: "Masseria Demo",
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
    {
      id: "cat-bevande",
      name: "Bevande",
      subtitle: "",
      visible: true,
      items: [
        { id: "item-acqua", name: "Acqua naturale", price: "2,00", tag: "", description: "0,75L", searchTags: "Bibita", visible: true, staffOnly: false },
        { id: "item-vino-casa", name: "Vino della casa", price: "12,00", tag: "", description: "Rosso o bianco, la caraffa", searchTags: "Bibita, Alcolico", visible: true, staffOnly: false },
      ],
    },
  ],
};

// Comande chiuse di test per la Dashboard statistiche (src/Stats.jsx,
// src/statsData.js): date relative a "adesso" al momento del seed (non fisse)
// così i preset "Oggi"/"Ieri"/"Ultimi 7 giorni" le trovano sempre, a
// prescindere da quando gira la suite. ID fissi (idempotente come il resto
// del file). Scritte direttamente via setDoc, non tramite il flusso reale
// openOrder/sendOrderLines/closeOrder — qui serve controllo esatto su
// date/importi, non il percorso applicativo.
function dateAt(daysOffset, hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

// DEMO_COSTS: costi interni dei piatti (src/menuCosts.js), mai esposti al
// menù pubblico — vedi firestore.rules, menuCosts/data. La riga di
// "stats-midnight-late" viene seedata SENZA cost apposta (vedi sotto), per
// testare che un costo mancante escluda quella riga dal margine invece di
// contarla come margine zero.
const DEMO_COSTS = {
  "item-bruschetta": "2,00",
  "item-caprese": "2,50",
  "item-orecchiette": "3,00",
  "item-tiramisu": "1,50",
  "item-acqua": "0,30",
  "item-vino-casa": "4,00",
};

function buildTestOrderLine({ lineId, menuItemId, name, price, quantity, categoryId, categoryName, sentAt, cost = null }) {
  return { lineId, menuItemId, name, price, quantity, categoryId, categoryName, notes: "", cost, status: "sent", sentAt: Timestamp.fromDate(sentAt), outAt: null };
}

function buildTestOrder({ tableNumber, waiterUid, waiterName, adults, children, status, openedAt, closedAt, items }) {
  return {
    tableNumber, tableName: "", covers: { adults, children },
    coperto: { adults: DEMO_MENU.coperto.adults, children: DEMO_MENU.coperto.children },
    notes: "", waiterUid, waiterName, status,
    openedAt: Timestamp.fromDate(openedAt), closedAt: Timestamp.fromDate(closedAt), expireAt: null,
    items,
  };
}

async function seedTestOrders(uids) {
  const waiterUid = uids.waiter;
  const waiterName = SEED_ACCOUNTS.waiter.name;
  const adminUid = uids.admin;
  const adminName = SEED_ACCOUNTS.admin.name;

  const orders = {
    // Oggi, cameriere di test: antipasto + bevanda — copre Antipasti e Bevande,
    // usata anche per il totale del preset "Oggi".
    "stats-today-1": buildTestOrder({
      tableNumber: 501, waiterUid, waiterName, adults: 2, children: 0, status: "closed",
      openedAt: dateAt(0, 12, 30), closedAt: dateAt(0, 13, 30),
      items: [
        buildTestOrderLine({ lineId: "l1", menuItemId: "item-bruschetta", name: "Bruschetta", price: "6,00", quantity: 2, categoryId: "cat-antipasti", categoryName: "Antipasti", sentAt: dateAt(0, 12, 35), cost: DEMO_COSTS["item-bruschetta"] }),
        buildTestOrderLine({ lineId: "l2", menuItemId: "item-acqua", name: "Acqua naturale", price: "2,00", quantity: 2, categoryId: "cat-bevande", categoryName: "Bevande", sentAt: dateAt(0, 12, 36), cost: DEMO_COSTS["item-acqua"] }),
      ],
    }),
    // Oggi, admin, chiusa AUTOMATICAMENTE (tavolo dimenticato): serve a
    // testare l'interruttore "includi comande chiuse automaticamente".
    "stats-today-2": buildTestOrder({
      tableNumber: 502, waiterUid: adminUid, waiterName: adminName, adults: 1, children: 0, status: "auto_closed",
      openedAt: dateAt(0, 10, 0), closedAt: dateAt(0, 14, 0),
      items: [
        buildTestOrderLine({ lineId: "l1", menuItemId: "item-vino-casa", name: "Vino della casa", price: "12,00", quantity: 1, categoryId: "cat-bevande", categoryName: "Bevande", sentAt: dateAt(0, 10, 5), cost: DEMO_COSTS["item-vino-casa"] }),
      ],
    }),
    // Ieri, cameriere di test: primo + dolce — copre Primi e Dolci, e dà un
    // secondo giorno distinto per "Ultimi 7 giorni" vs "Oggi".
    "stats-yesterday-1": buildTestOrder({
      tableNumber: 503, waiterUid, waiterName, adults: 3, children: 1, status: "closed",
      openedAt: dateAt(-1, 20, 0), closedAt: dateAt(-1, 21, 30),
      items: [
        buildTestOrderLine({ lineId: "l1", menuItemId: "item-orecchiette", name: "Orecchiette", price: "10,00", quantity: 3, categoryId: "cat-primi", categoryName: "Primi", sentAt: dateAt(-1, 20, 10), cost: DEMO_COSTS["item-orecchiette"] }),
        buildTestOrderLine({ lineId: "l2", menuItemId: "item-tiramisu", name: "Tiramisù", price: "5,00", quantity: 1, categoryId: "cat-dolci", categoryName: "Dolci", sentAt: dateAt(-1, 21, 0), cost: DEMO_COSTS["item-tiramisu"] }),
      ],
    }),
    // A cavallo della mezzanotte locale: verifica che "Ieri" e "Oggi" separino
    // correttamente i confini di giorno (mai UTC — vedi resolvePresetRange in
    // src/statsData.js). Questa riga NON ha un costo (cost resta null): serve
    // a testare che il margine escluda le righe senza costo noto invece di
    // contarle a margine zero (vedi aggregateOrders in src/statsData.js).
    "stats-midnight-late": buildTestOrder({
      tableNumber: 504, waiterUid, waiterName, adults: 1, children: 0, status: "closed",
      openedAt: dateAt(-1, 23, 30), closedAt: dateAt(-1, 23, 58),
      items: [buildTestOrderLine({ lineId: "l1", menuItemId: "item-caprese", name: "Caprese", price: "7,00", quantity: 1, categoryId: "cat-antipasti", categoryName: "Antipasti", sentAt: dateAt(-1, 23, 35) })],
    }),
    "stats-midnight-early": buildTestOrder({
      tableNumber: 505, waiterUid, waiterName, adults: 1, children: 0, status: "closed",
      openedAt: dateAt(0, 0, 2), closedAt: dateAt(0, 0, 20),
      items: [buildTestOrderLine({ lineId: "l1", menuItemId: "item-caprese", name: "Caprese", price: "7,00", quantity: 1, categoryId: "cat-antipasti", categoryName: "Antipasti", sentAt: dateAt(0, 0, 5), cost: DEMO_COSTS["item-caprese"] })],
    }),
  };

  for (const [id, order] of Object.entries(orders)) {
    await withRetry(() => setDoc(doc(db, "orders", id), order));
  }
}

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
  await withRetry(() => setDoc(doc(db, "menuCosts", "data"), DEMO_COSTS));
  await seedTestOrders(uids);

  console.log("[seed-emulator] Fatto:", uids);
  console.log("");
  console.log("Credenziali di accesso (emulatore locale — vedi npm run dev:local):");
  for (const account of Object.values(SEED_ACCOUNTS)) {
    if (!account.role || account.role === "legacy-role") continue; // account solo per test automatici, non per l'uso interattivo
    console.log(`  ${account.role.padEnd(7)} → ${account.email} / ${account.password}`);
  }
  console.log("");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-emulator] Fallito:", err);
  process.exit(1);
});
