// Staff accounts (staff/{uid}: name + role [+ email]), see
// docs/comande-camerieri.md §3. Managed from the menu settings
// (MenuSettings.jsx > Personale): a new person gets their Firebase Auth
// account (email + password) created right there, or a role is assigned to
// an account that already exists (its uid).
//
// Hierarchy: owner (only one, config/owner) > admin > waiter. Owner and
// admin can do the same things in the app; they differ in whom they can add
// or remove: only people of a lower rank than their own (the owner admins
// and waiters, an admin only waiters, a waiter nobody). Enforced by
// firestore.rules; the functions below only shape the UI after it.
import { collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch } from "firebase/firestore";
import { db } from "./firebase-db";
import { createAuthAccount } from "./firebase-auth";

// The roles that can be assigned from Personale ("owner" can't: it is
// claimed once, then handed over — claimOwnership/transferOwnership).
export const STAFF_ROLES = [
  { value: "waiter", label: "Cameriere" },
  { value: "admin", label: "Amministratore" },
];
export const OWNER_ROLE = "owner";

const ROLE_RANK = { owner: 3, admin: 2, waiter: 1 };
// Old or unknown roles rank like a waiter: any admin can remove them.
export function roleRank(role) {
  return ROLE_RANK[role] || 1;
}

// Admin rights in the app (Menù, Statistiche, deleting for good…).
export function isAdminRole(role) {
  return role === "admin" || role === OWNER_ROLE;
}

export function isStaffRole(role) {
  return role in ROLE_RANK;
}

// Roles `myRole` can give to someone.
export function assignableRoles(myRole) {
  if (!isAdminRole(myRole)) return [];
  return STAFF_ROLES.filter((r) => roleRank(r.value) < roleRank(myRole));
}

// Whether `myRole` can change or remove someone holding `targetRole`.
export function canManageStaff(myRole, targetRole) {
  return isAdminRole(myRole) && roleRank(targetRole) < roleRank(myRole);
}

// Firebase Auth's own minimum.
export const MIN_PASSWORD_LENGTH = 6;

// "kitchen": old role, the kitchen area was removed (printed tickets now).
export function staffRoleLabel(role) {
  if (role === OWNER_ROLE) return "Proprietario";
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

// config/owner: { uid } of the owner, null while there is none (a project
// created before the role existed, until an admin claims it).
export function subscribeOwner(onChange, onError) {
  return onSnapshot(doc(db, "config", "owner"), (snap) => onChange(snap.exists() ? snap.data().uid || null : null), onError);
}

// No owner yet: the admin `uid` becomes the owner. Allowed only while
// config/owner doesn't exist, so it works once per project.
export function claimOwnership(uid) {
  const batch = writeBatch(db);
  batch.update(doc(db, "staff", uid), { role: OWNER_ROLE });
  batch.set(doc(db, "config", "owner"), { uid });
  return batch.commit();
}

// The owner hands the role over to an admin and becomes an admin.
export function transferOwnership(myUid, newOwnerUid) {
  const batch = writeBatch(db);
  batch.update(doc(db, "staff", newOwnerUid), { role: OWNER_ROLE });
  batch.update(doc(db, "staff", myUid), { role: "admin" });
  batch.set(doc(db, "config", "owner"), { uid: newOwnerUid });
  return batch.commit();
}

export function staffAccountErrorMessage(err) {
  switch (err?.code) {
    case "auth/email-already-in-use": return "Esiste già un account con questa email. Se è di una persona senza accesso, aggiungila da «Account esistente».";
    case "auth/invalid-email": return "Indirizzo email non valido.";
    case "auth/weak-password": return `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`;
    case "auth/operation-not-allowed":
    case "auth/admin-restricted-operation": return "La creazione di account è disattivata nel progetto Firebase (Authentication → Impostazioni).";
    case "auth/network-request-failed": return "Nessuna connessione. Riprova.";
    case "permission-denied": return "Il tuo ruolo non permette di aggiungere o cambiare questa persona.";
    default: return "Salvataggio non riuscito. Verifica la connessione e riprova.";
  }
}
