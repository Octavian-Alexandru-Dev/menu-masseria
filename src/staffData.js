// Staff accounts (staff/{uid}: name + role), see docs/comande-camerieri.md
// §3. Firebase Auth accounts are created by hand in the Firebase console
// (Authentication → Aggiungi utente): here a name and a role are assigned
// to an existing uid. Managed from the menu settings (MenuSettings.jsx).
import { collection, doc, setDoc, deleteDoc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase-db";

export const STAFF_ROLES = [
  { value: "waiter", label: "Cameriere" },
  { value: "admin", label: "Amministratore" },
];

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

export function removeStaffMember(uid) {
  return deleteDoc(doc(db, "staff", uid));
}
