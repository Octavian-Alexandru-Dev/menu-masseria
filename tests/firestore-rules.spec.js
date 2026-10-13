import { test, expect } from "@playwright/test";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, deleteDoc, collection, getDocs, increment } from "firebase/firestore";
import { TEST_ADMIN, TEST_WAITER, TEST_KITCHEN, TEST_NO_ROLE } from "./test-env";

// Regole di firestore.rules sull'emulatore, senza browser. Da quando gli
// account si creano dall'app (Impostazioni > Personale), essere autenticati
// non basta più: chiunque conosca la chiave web può crearsi un account, quindi
// i dati dello staff si aprono solo a chi ha un ruolo in staff/{uid}, e solo
// un amministratore assegna ruoli. Ogni account usa una sua app Firebase
// (nome = email), così le sessioni non si sovrascrivono a vicenda.
const apps = new Map();
async function as(account) {
  if (!apps.has(account.email)) {
    const app = initializeApp({ apiKey: "demo-key", projectId: "demo-masseria-test" }, `rules-${account.email}`);
    const auth = getAuth(app);
    const db = getFirestore(app);
    connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "localhost", 8080);
    apps.set(account.email, { auth, db });
  }
  const { auth, db } = apps.get(account.email);
  if (auth.currentUser?.email !== account.email) {
    if (account.create) await createUserWithEmailAndPassword(auth, account.email, account.password);
    else await signInWithEmailAndPassword(auth, account.email, account.password);
  }
  return { db, uid: auth.currentUser.uid };
}

// Un visitatore del menù pubblico: nessun account.
function anonymousDb() {
  const app = initializeApp({ apiKey: "demo-key", projectId: "demo-masseria-test" }, `rules-anon-${Date.now()}-${Math.random()}`);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "localhost", 8080);
  return db;
}

async function denied(promise) {
  await expect(promise).rejects.toMatchObject({ code: "permission-denied" });
}

test("un account appena registrato da fuori (senza ruolo) non legge né scrive i dati dello staff, né si dà un ruolo", async () => {
  const stranger = { email: `estraneo-${Date.now()}@test.local`, password: "Prova123!", create: true };
  const { db, uid } = await as(stranger);
  // Il proprio documento si legge (anche se non esiste): è così che l'app mostra "nessun ruolo".
  expect((await getDoc(doc(db, "staff", uid))).exists()).toBe(false);
  await denied(setDoc(doc(db, "staff", uid), { name: "Io", role: "admin" }));
  await denied(getDocs(collection(db, "staff")));
  await denied(getDocs(collection(db, "orders")));
  await denied(getDocs(collection(db, "reservations")));
  await denied(getDocs(collection(db, "printJobs")));
  await denied(getDoc(doc(db, "menuCosts", "data")));
  await denied(setDoc(doc(db, "menu", "data"), { categories: [] }));
  // Il menù resta pubblico in lettura.
  expect((await getDoc(doc(db, "menu", "data"))).exists()).toBe(true);
});

test("gli account senza un ruolo in uso (nessuno, o il vecchio 'kitchen') restano fuori dai dati", async () => {
  for (const account of [TEST_NO_ROLE, TEST_KITCHEN]) {
    const { db } = await as(account);
    await denied(getDocs(collection(db, "orders")));
    await denied(getDocs(collection(db, "reservations")));
  }
});

test("un cameriere lavora su comande e prenotazioni e vede il personale, ma non assegna ruoli", async () => {
  const { db, uid } = await as(TEST_WAITER);
  await getDocs(collection(db, "orders"));
  await getDocs(collection(db, "reservations"));
  await getDoc(doc(db, "menuCosts", "data"));
  expect((await getDocs(collection(db, "staff"))).size).toBeGreaterThan(0);
  await denied(setDoc(doc(db, "staff", uid), { name: "Cameriere di test", role: "admin" }));
  await denied(setDoc(doc(db, "staff", `rules-waiter-${Date.now()}`), { name: "Amico", role: "waiter" }));
});

test("un amministratore assegna e toglie ruoli", async () => {
  const { db } = await as(TEST_ADMIN);
  const ref = doc(db, "staff", `rules-admin-${Date.now()}`);
  await setDoc(ref, { name: "Persona di prova", role: "waiter" });
  expect((await getDoc(ref)).data().role).toBe("waiter");
  await deleteDoc(ref);
  expect((await getDoc(ref)).exists()).toBe(false);
});

test("visite al menù: chiunque può solo aggiungere 1 al giorno, e solo il personale le legge", async () => {
  const db = anonymousDb();
  // Un giorno tutto per questo test (anno passato a caso), lontano da quelli dell'app.
  const day = `19${String(10 + Math.floor(Math.random() * 89))}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;
  const ref = doc(db, "menuViews", day);
  await denied(setDoc(ref, { count: 50 }));
  await denied(setDoc(ref, { count: 1, chi: "io" }));
  await denied(setDoc(doc(db, "menuViews", "non-una-data"), { count: 1 }));
  await setDoc(ref, { count: increment(1) }, { merge: true }); // primo del giorno: 1
  await setDoc(ref, { count: increment(1) }, { merge: true }); // poi +1
  await denied(setDoc(ref, { count: increment(5) }, { merge: true }));
  await denied(setDoc(ref, { count: 0 }));
  await denied(deleteDoc(ref));
  await denied(getDoc(ref));

  const { db: staffDb } = await as(TEST_WAITER);
  expect((await getDoc(doc(staffDb, "menuViews", day))).data().count).toBe(2);
  const { db: strangerDb } = await as(TEST_NO_ROLE);
  await denied(getDoc(doc(strangerDb, "menuViews", day)));
});
