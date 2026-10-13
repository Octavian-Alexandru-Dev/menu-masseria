// Staff accounts (staff/{uid}: name + role [+ email]), see
// docs/comande-camerieri.md §3. Managed from the menu settings
// (MenuSettings.jsx > Personale): a new person gets their Firebase Auth
// account (email + password) created right there, or a role is assigned to
// an account that already exists (its uid). Only an admin can write here
// (firestore.rules).
import { collection, doc, setDoc, deleteDoc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase-db";
import { createAuthAccount } from "./firebase-auth";

export const STAFF_ROLES = [
  { value: "waiter", label: "Cameriere" },
  { value: "admin", label: "Amministratore" },
];

// Firebase Auth's own minimum.
export const MIN_PASSWORD_LENGTH = 6;

// "kitchen": old role, the kitchen area was removed (printed tickets now).
export function staffRoleLabel(role) {
  return STAFF_ROLES.find((r) => r.value === role)?.label || (role === "kitchen" ? "Cucina (ruolo non più usato)" : role || "nessun ruolo");
}

export function subscribeStaff(onChange, onError) {
  return onSnapshot(collection(db, "staff"), (snap) => onChange(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))), onError);
}

export function saveStaffMember(uid, { name, role }) {
  return setDoc(doc(db, "staff", uid.trim()), { name: name.trim(), role });
}

// New account + role in one go; resolves with the new uid.
export function createStaffMember({ email, password, name, role }) {
  return createAuthAccount(email, password, (uid) => setDoc(doc(db, "staff", uid), { name: name.trim(), role, email: email.trim().toLowerCase() }));
}

export function removeStaffMember(uid) {
  return deleteDoc(doc(db, "staff", uid));
}

export function staffAccountErrorMessage(err) {
  switch (err?.code) {
    case "auth/email-already-in-use": return "Esiste già un account con questa email. Se è di una persona senza accesso, aggiungila da «Account esistente».";
    case "auth/invalid-email": return "Indirizzo email non valido.";
    case "auth/weak-password": return `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`;
    case "auth/operation-not-allowed":
    case "auth/admin-restricted-operation": return "La creazione di account è disattivata nel progetto Firebase (Authentication → Impostazioni).";
    case "auth/network-request-failed": return "Nessuna connessione. Riprova.";
    case "permission-denied": return "Solo un amministratore può aggiungere persone.";
    default: return "Salvataggio non riuscito. Verifica la connessione e riprova.";
  }
}
