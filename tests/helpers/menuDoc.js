// Accesso Node-side al documento del menù (menu/data) sull'emulatore, per i
// test della gestione menù alla cassa (tests/till-sala.spec.js): simula una
// modifica fatta "da un altro dispositivo" e ripulisce le voci create dai
// test. Le scritture sono transazioni sul documento com'è ora, come fa la
// cassa (MenuApp.jsx > handlePatch), così non si cancellano a vicenda.
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, runTransaction } from "firebase/firestore";
import { TEST_ADMIN } from "../test-env.js";
import { auth, db } from "./emulatorApp.js";

let signInPromise = null;
function ensureSignedIn() {
  if (!signInPromise) signInPromise = signInWithEmailAndPassword(auth, TEST_ADMIN.email, TEST_ADMIN.password);
  return signInPromise;
}

const menuRef = () => doc(db, "menu", "data");

export async function getMenu() {
  await ensureSignedIn();
  return (await getDoc(menuRef())).data();
}

export async function addMenuItemRemotely(categoryId, item) {
  await ensureSignedIn();
  await runTransaction(db, async (tx) => {
    const menu = (await tx.get(menuRef())).data();
    menu.categories = menu.categories.map((c) => (c.id === categoryId ? { ...c, items: [...c.items, item] } : c));
    tx.set(menuRef(), menu);
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
    await ensureSignedIn();
    await runTransaction(db, async (tx) => {
      const menu = (await tx.get(menuRef())).data();
      menu.categories = menu.categories.map((c) => ({ ...c, items: c.items.filter((it) => !String(it.name || "").startsWith(prefix)) }));
      tx.set(menuRef(), menu);
    });
  } catch (err) {
    console.error(`[test cleanup] Pulizia voci "${prefix}" dal menù fallita:`, err.message || err);
  }
}
