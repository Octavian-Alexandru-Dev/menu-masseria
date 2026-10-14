// The till's PIN lock (config/tillLock, see docs/data-model.md): after some
// minutes without touches, at startup or on "Blocca", the till shows a lock
// screen (TillLock.jsx) that only the PIN opens. Set by an admin or the owner
// from Menù › Impostazioni › Blocco cassa (MenuSettings.jsx), from the till or
// a phone — so a forgotten PIN is changed from a phone.
//
// The PIN is never stored: only a salted SHA-256 hash. It keeps the PIN off
// the screen and out of casual reach, not a secret against the staff (a
// short numeric PIN can be guessed from its hash): the lock is meant to keep
// customers and passers-by off the till, the account behind it stays the same.
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase-db";

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 12;

// Minutes without touches before the till locks; 0 = never by itself (only
// at startup, if chosen, and with "Blocca").
export const LOCK_TIMEOUTS = [
  { value: 1, label: "1 min" },
  { value: 2, label: "2 min" },
  { value: 5, label: "5 min" },
  { value: 10, label: "10 min" },
  { value: 30, label: "30 min" },
  { value: 0, label: "Mai" },
];

export const TILL_LOCK_DEFAULTS = { enabled: false, pinHash: "", pinSalt: "", timeoutMinutes: 5, lockOnStart: true };

const lockRef = () => doc(db, "config", "tillLock");

export function subscribeTillLock(onChange, onError) {
  return onSnapshot(lockRef(), (snap) => onChange({ ...TILL_LOCK_DEFAULTS, ...(snap.exists() ? snap.data() : null) }), onError);
}

export function isValidPin(pin) {
  return new RegExp(`^[0-9]{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

// Whether the lock can actually lock (on, with a PIN to open it).
export function lockActive(config) {
  return Boolean(config?.enabled && config.pinHash && config.pinSalt);
}

async function sha256Hex(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function newSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function pinMatches(pin, config) {
  if (!isValidPin(pin) || !config?.pinHash || !config?.pinSalt) return false;
  return (await sha256Hex(`${config.pinSalt}:${pin}`)) === config.pinHash;
}

// settings: { enabled, timeoutMinutes, lockOnStart } and, to change it, pin.
export async function saveTillLock({ enabled, timeoutMinutes, lockOnStart, pin }) {
  const data = { enabled, timeoutMinutes, lockOnStart };
  if (pin) {
    if (!isValidPin(pin)) throw new Error(`Il PIN deve avere da ${PIN_MIN_LENGTH} a ${PIN_MAX_LENGTH} cifre.`);
    data.pinSalt = newSalt();
    data.pinHash = await sha256Hex(`${data.pinSalt}:${pin}`);
  }
  return setDoc(lockRef(), data, { merge: true });
}

// The till stays locked across a reload or a restart of the client: the
// state is kept on the device.
const LOCKED_KEY = "mdp.tillLocked";
export function rememberLocked(locked) {
  try {
    if (locked) localStorage.setItem(LOCKED_KEY, "1");
    else localStorage.removeItem(LOCKED_KEY);
  } catch {
    // Storage unavailable: the lock still works until the next reload.
  }
}
export function wasLocked() {
  try {
    return localStorage.getItem(LOCKED_KEY) === "1";
  } catch {
    return false;
  }
}
