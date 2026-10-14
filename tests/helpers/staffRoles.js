// Ruoli del personale e blocco della cassa scritti "da fuori" (fixture dei
// test). Le regole (firestore.rules) non permettono a nessun account di
// togliere il proprietario né di creare config/owner se c'è già: per
// simulare un progetto senza proprietario (quello in produzione prima del
// ruolo) si scrive con le credenziali "owner" della REST API dell'emulatore,
// che ignorano le regole — come fa scripts/seed-emulator.js.
import { webcrypto } from "node:crypto";
import { doc, getDoc, setDoc, getDocs, collection, query, where } from "firebase/firestore";
import { adminDb } from "./emulatorApp.js";
import { TEST_OWNER } from "../test-env.js";

const BASE = "http://localhost:8080/v1/projects/demo-masseria-test/databases/(default)/documents";
const HEADERS = { Authorization: "Bearer owner", "Content-Type": "application/json" };

async function rest(method, path, fields) {
  const body = fields ? JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: v }])) }) : undefined;
  const mask = fields ? `?${Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join("&")}` : "";
  const res = await fetch(`${BASE}/${path}${mask}`, { method, headers: HEADERS, body });
  if (!res.ok && res.status !== 404) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
}

async function uidByEmail(email) {
  const db = await adminDb();
  const snap = await getDocs(query(collection(db, "staff"), where("email", "==", email)));
  return snap.docs[0]?.id;
}

export async function getOwnerUid() {
  const db = await adminDb();
  const snap = await getDoc(doc(db, "config", "owner"));
  return snap.exists() ? snap.data().uid : null;
}

export async function setRoleBypassingRules(email, role) {
  await rest("PATCH", `staff/${await uidByEmail(email)}`, { role });
}

// Progetto "senza proprietario": il proprietario di test torna amministratore.
export async function removeOwnerBypassingRules() {
  await setRoleBypassingRules(TEST_OWNER.email, "admin");
  await rest("DELETE", "config/owner");
}

// Torna lo stato del seed: TEST_OWNER proprietario, gli altri come indicato.
export async function restoreOwnerBypassingRules(others = {}) {
  for (const [email, role] of Object.entries(others)) await setRoleBypassingRules(email, role);
  await setRoleBypassingRules(TEST_OWNER.email, "owner");
  await rest("PATCH", "config/owner", { uid: await uidByEmail(TEST_OWNER.email) });
}

/* ------------------------------ blocco cassa ------------------------------ */

async function hashPin(pin, salt) {
  const bytes = new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${pin}`)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// config/tillLock come lo salva l'app (src/tillLockData.js), scritto dall'admin.
export async function setTillLockRemotely({ enabled = true, pin = "2468", timeoutMinutes = 0, lockOnStart = false } = {}) {
  const db = await adminDb();
  const pinSalt = "salt-dei-test";
  await setDoc(doc(db, "config", "tillLock"), { enabled, timeoutMinutes, lockOnStart, pinSalt, pinHash: await hashPin(pin, pinSalt) });
}

export async function getTillLock() {
  const db = await adminDb();
  const snap = await getDoc(doc(db, "config", "tillLock"));
  return snap.exists() ? snap.data() : null;
}

export async function pinMatchesRemotely(pin, config) {
  return config?.pinHash === (await hashPin(pin, config.pinSalt));
}

// Blocco spento (stato di partenza): nessuna cassa degli altri test si blocca.
export async function resetTillLockRemotely() {
  try {
    const db = await adminDb();
    await setDoc(doc(db, "config", "tillLock"), { enabled: false, timeoutMinutes: 5, lockOnStart: true, pinHash: "", pinSalt: "" });
  } catch (err) {
    console.error("[test cleanup] Ripristino blocco cassa fallito:", err.message || err);
  }
}
