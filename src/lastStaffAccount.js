// The last staff account that signed in successfully on this device/browser,
// so the login screen can offer "Rientra come …" after a logout (wanted or
// not): one tap signs straight back in. At the till, the client's saved
// account (getSavedLogin, desktop.js) keeps its own "Accedi come …" button.
//
// Email and display name live in localStorage (read synchronously to draw
// the button). The password is kept encrypted (AES-GCM) in IndexedDB, with a
// key generated on this device as non-extractable: the key itself can't be
// read or exported, so a copy of the browser's storage (a backup, a synced
// profile) doesn't reveal the password — it can only be decrypted by this
// page on this device. That is about the same exposure as Firebase Auth's
// own persisted session, which already keeps a signed-in device signed in.
// "Non sei tu?" (forgetLastStaffAccount) deletes both. Where Web Crypto or
// IndexedDB are unavailable nothing is stored and the button just fills in
// the email.
const KEY = "mdp.lastStaffAccount";
const DB_NAME = "mdp-login";
const STORE = "credentials";
const RECORD = "last";

export function getLastStaffAccount() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    return value && typeof value.email === "string" && value.email ? value : null;
  } catch {
    return null;
  }
}

// name is optional: without it (right after the sign-in, before staff/{uid}
// is read; Gestione menù's own login) the name saved earlier for the same
// email is kept.
export function rememberStaffAccount(email, name) {
  if (!email) return;
  const previous = getLastStaffAccount();
  const keptName = name || (previous?.email === email ? previous.name : "") || "";
  if (previous?.email === email && previous.name === keptName) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ email, name: keptName }));
  } catch { /* storage unavailable: just no suggestion next time */ }
}

export function forgetLastStaffAccount() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return forgetStaffPassword();
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// Called after a successful sign-in with a typed (or remembered) password.
export async function rememberStaffPassword(email, password) {
  if (!email || !password) return;
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(password));
    await withStore("readwrite", (store) => store.put({ email, key, iv, data }, RECORD));
  } catch (err) {
    console.warn("[login] Password non ricordata su questo dispositivo:", err?.message || err);
  }
}

// The remembered password for this email, or null (none, another account,
// or it can't be read here).
export async function loadStaffPassword(email) {
  try {
    const record = await withStore("readonly", (store) => store.get(RECORD));
    if (!record || record.email !== email) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv }, record.key, record.data);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function forgetStaffPassword() {
  try {
    await withStore("readwrite", (store) => store.delete(RECORD));
  } catch { /* nothing stored */ }
}
