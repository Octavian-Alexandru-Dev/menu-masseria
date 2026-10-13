// Accesso Node-side al documento del menù (menu/data) sull'emulatore, per i
// test della gestione menù alla cassa (tests/till-sala.spec.js): simula una
// modifica fatta "da un altro dispositivo" e ripulisce le voci create dai
// test. Le scritture sono transazioni sul documento com'è ora, come fa la
// cassa (MenuApp.jsx > handlePatch), così non si cancellano a vicenda.
import { doc, getDoc, runTransaction, deleteDoc, collection, query, where, getDocs, updateDoc, deleteField } from "firebase/firestore";
import { adminDb } from "./emulatorApp.js";

const menuRef = (db) => doc(db, "menu", "data");

export async function getMenu() {
  const db = await adminDb();
  return (await getDoc(menuRef(db))).data();
}

export async function addMenuItemRemotely(categoryId, item) {
  const db = await adminDb();
  await runTransaction(db, async (tx) => {
    const menu = (await tx.get(menuRef(db))).data();
    menu.categories = menu.categories.map((c) => (c.id === categoryId ? { ...c, items: [...c.items, item] } : c));
    tx.set(menuRef(db), menu);
  });
}

export async function updateMenuItemRemotely(itemId, fields) {
  const db = await adminDb();
  await runTransaction(db, async (tx) => {
    const menu = (await tx.get(menuRef(db))).data();
    menu.categories = menu.categories.map((c) => ({ ...c, items: c.items.map((it) => (it.id === itemId ? { ...it, ...fields } : it)) }));
    tx.set(menuRef(db), menu);
  });
}

export function findMenuItemByName(menu, name) {
  for (const c of menu.categories) {
    const item = c.items.find((it) => it.name === name);
    if (item) return { categoryId: c.id, item };
  }
  return null;
}

// Best-effort, come firestore-cleanup.js: non deve mai far fallire un test.
export async function removeMenuItemsByNamePrefix(prefix) {
  try {
    const db = await adminDb();
    await runTransaction(db, async (tx) => {
      const menu = (await tx.get(menuRef(db))).data();
      menu.categories = menu.categories.map((c) => ({ ...c, items: c.items.filter((it) => !String(it.name || "").startsWith(prefix)) }));
      tx.set(menuRef(db), menu);
    });
  } catch (err) {
    console.error(`[test cleanup] Pulizia voci "${prefix}" dal menù fallita:`, err.message || err);
  }
}

// Una traduzione scritta "da un altro dispositivo" (per provarne la
// correzione a mano) e la sua pulizia.
export async function setTranslationRemotely(lang, translation) {
  const db = await adminDb();
  await runTransaction(db, async (tx) => {
    const menu = (await tx.get(menuRef(db))).data();
    menu.translations = { ...(menu.translations || {}), [lang]: translation };
    tx.set(menuRef(db), menu);
  });
}

export async function removeTranslationRemotely(lang) {
  try {
    const db = await adminDb();
    await runTransaction(db, async (tx) => {
      const menu = (await tx.get(menuRef(db))).data();
      if (!menu.translations?.[lang]) return;
      delete menu.translations[lang];
      tx.set(menuRef(db), menu);
    });
  } catch (err) {
    console.error(`[test cleanup] Pulizia traduzione "${lang}" fallita:`, err.message || err);
  }
}

// Ripristina campi di primo livello del menù (identità, link…) cambiati da un test.
export async function setMenuFieldsRemotely(fields) {
  const db = await adminDb();
  await runTransaction(db, async (tx) => {
    const menu = (await tx.get(menuRef(db))).data();
    tx.set(menuRef(db), { ...menu, ...fields });
  });
}

// Best-effort: una persona aggiunta dal test al personale (staff/{uid}).
// staff/ lo scrive solo un amministratore (firestore.rules): si rientra
// esplicitamente come admin, perché nello stesso processo altri helper
// (firestore-cleanup.js) usano la stessa sessione come cameriere.
export async function removeStaffRemotely(uid) {
  try {
    const db = await adminDb();
    await deleteDoc(doc(db, "staff", uid));
  } catch (err) {
    console.error(`[test cleanup] Pulizia personale "${uid}" fallita:`, err.message || err);
  }
}

// Il documento staff/{uid} di un account creato dall'app (Personale >
// Nuovo account), cercato per email; null se non c'è.
export async function findStaffByEmail(email) {
  const db = await adminDb();
  const snap = await getDocs(query(collection(db, "staff"), where("email", "==", email)));
  return snap.empty ? null : { uid: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function removeStaffByEmailRemotely(email) {
  try {
    const member = await findStaffByEmail(email);
    if (member) await removeStaffRemotely(member.uid);
  } catch (err) {
    console.error(`[test cleanup] Pulizia personale "${email}" fallita:`, err.message || err);
  }
}

// Visite al menù di un giorno (menuViews/{YYYY-MM-DD}, src/menuViews.js); 0 se nessuna.
export async function getMenuViewsCount(day) {
  const db = await adminDb();
  const snap = await getDoc(doc(db, "menuViews", day));
  return snap.exists() ? snap.data().count : 0;
}

// Best-effort: il costo interno di un piatto creato dal test (menuCosts/data,
// src/menuCosts.js).
export async function removeMenuCostRemotely(itemId) {
  try {
    const db = await adminDb();
    await updateDoc(doc(db, "menuCosts", "data"), { [itemId]: deleteField() });
  } catch (err) {
    console.error(`[test cleanup] Pulizia costo "${itemId}" fallita:`, err.message || err);
  }
}
