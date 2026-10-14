import { test, expect } from "@playwright/test";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, increment, Timestamp, writeBatch } from "firebase/firestore";
import { TEST_OWNER, TEST_ADMIN, TEST_WAITER, TEST_KITCHEN, TEST_NO_ROLE } from "./test-env";

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

test("prenotazioni: le elimina per sempre solo un amministratore; quelle scadute anche la pulizia automatica di un cameriere", async () => {
  const waiter = await as(TEST_WAITER);
  const admin = await as(TEST_ADMIN);
  const base = { date: "2026-01-01", name: `Regole ${Date.now()}`, status: "started" };
  const ref = doc(waiter.db, "reservations", `rules-res-${Date.now()}`);
  await setDoc(ref, base);
  await denied(deleteDoc(ref));
  await deleteDoc(doc(admin.db, "reservations", ref.id));
  expect((await getDoc(ref)).exists()).toBe(false);

  // Scaduta (expireAt nel passato): la pulizia giornaliera gira anche sul telefono di un cameriere.
  const expired = doc(waiter.db, "reservations", `rules-res-expired-${Date.now()}`);
  await setDoc(expired, { ...base, status: "cancelled", expireAt: Timestamp.fromMillis(Date.now() - 60_000) });
  await deleteDoc(expired);
  expect((await getDoc(expired)).exists()).toBe(false);
});

test("un amministratore aggiunge e toglie solo camerieri", async () => {
  const { db, uid } = await as(TEST_ADMIN);
  const ref = doc(db, "staff", `rules-admin-${Date.now()}`);
  await setDoc(ref, { name: "Persona di prova", role: "waiter" });
  expect((await getDoc(ref)).data().role).toBe("waiter");
  // Né un amministratore, né un proprietario, né promuovere il cameriere.
  await denied(setDoc(doc(db, "staff", `rules-admin2-${Date.now()}`), { name: "Altro admin", role: "admin" }));
  await denied(setDoc(doc(db, "staff", `rules-owner-${Date.now()}`), { name: "Altro proprietario", role: "owner" }));
  await denied(updateDoc(ref, { role: "admin" }));
  await deleteDoc(ref);
  expect((await getDoc(ref)).exists()).toBe(false);

  // Gli altri amministratori e il proprietario restano fuori portata.
  const { uid: ownerUid } = await as(TEST_OWNER);
  await denied(deleteDoc(doc(db, "staff", ownerUid)));
  await denied(setDoc(doc(db, "staff", ownerUid), { name: "Declassato", role: "waiter" }));
  // Con un proprietario già presente non si prende la proprietà.
  const claim = writeBatch(db);
  claim.update(doc(db, "staff", uid), { role: "owner" });
  claim.set(doc(db, "config", "owner"), { uid });
  await denied(claim.commit());
  await denied(updateDoc(doc(db, "staff", uid), { role: "owner" }));
  expect((await getDoc(doc(db, "config", "owner"))).data().uid).toBe(ownerUid);
});

test("il proprietario aggiunge e toglie amministratori e camerieri, ma non sé stesso né un secondo proprietario", async () => {
  const { db, uid } = await as(TEST_OWNER);
  const admin = doc(db, "staff", `rules-owner-admin-${Date.now()}`);
  await setDoc(admin, { name: "Admin di prova", role: "admin" });
  await updateDoc(admin, { role: "waiter" });
  await updateDoc(admin, { role: "admin" });
  await denied(updateDoc(admin, { role: "owner" })); // senza passare config/owner
  await denied(setDoc(doc(db, "staff", `rules-owner2-${Date.now()}`), { name: "Secondo", role: "owner" }));
  await deleteDoc(admin);
  await denied(deleteDoc(doc(db, "staff", uid)));
  await denied(updateDoc(doc(db, "staff", uid), { role: "admin" })); // declassarsi senza passare la proprietà
  await denied(deleteDoc(doc(db, "config", "owner")));
});

test("un cameriere non toglie nessuno", async () => {
  const { uid: adminUid } = await as(TEST_ADMIN);
  const { db } = await as(TEST_WAITER);
  await denied(deleteDoc(doc(db, "staff", adminUid)));
  expect((await getDoc(doc(db, "config", "owner"))).exists()).toBe(true); // lo legge, per l'elenco del personale
});

test("blocco cassa: lo legge tutto il personale, lo imposta solo un amministratore, solo con i campi previsti", async () => {
  const { db: waiterDb } = await as(TEST_WAITER);
  await getDoc(doc(waiterDb, "config", "tillLock"));
  const valid = { enabled: false, timeoutMinutes: 5, lockOnStart: true, pinHash: "", pinSalt: "" };
  await denied(setDoc(doc(waiterDb, "config", "tillLock"), valid));
  const { db: strangerDb } = await as(TEST_NO_ROLE);
  await denied(getDoc(doc(strangerDb, "config", "tillLock")));
  const { db } = await as(TEST_ADMIN);
  await denied(setDoc(doc(db, "config", "tillLock"), { ...valid, pin: "1234" })); // mai il PIN in chiaro
  await denied(setDoc(doc(db, "config", "tillLock"), { ...valid, timeoutMinutes: "5" }));
  // (La scrittura valida dell'admin la copre tests/menu-settings.spec.js: qui
  // cambierebbe il blocco sotto ai piedi di quel test, che gira in parallelo.)
  // Altri documenti di config/ restano chiusi.
  await denied(setDoc(doc(db, "config", "altro"), { x: 1 }));
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
