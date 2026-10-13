// Firebase Authentication — used ONLY by the menu management panel.
// Kept in its own file on purpose: firebase/auth is a heavy module with no
// reason to be downloaded by a customer who's just looking at the menu.
// This file is only included in the bundle once someone clicks "Gestione menù".
import { initializeApp, getApps } from "firebase/app";
import { app, firebaseConfig, USE_EMULATOR } from "./firebase-db";
import {
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

export const auth = getAuth(app);

// See firebase-db.js for the meaning of VITE_USE_FIREBASE_EMULATOR.
if (USE_EMULATOR) {
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
}

// A second Firebase app just for creating staff accounts (MenuSettings >
// Personale): createUserWithEmailAndPassword signs the new user in on the
// Auth instance it runs on, so on the main one it would log the admin out.
// In-memory persistence: the new user's session never touches the device.
const CREATOR_APP = "staff-account-creator";
let creatorAuth = null;
function getCreatorAuth() {
  if (!creatorAuth) {
    const creatorApp = getApps().find((a) => a.name === CREATOR_APP) || initializeApp(firebaseConfig, CREATOR_APP);
    creatorAuth = initializeAuth(creatorApp, { persistence: inMemoryPersistence });
    if (USE_EMULATOR) connectAuthEmulator(creatorAuth, "http://localhost:9099", { disableWarnings: true });
  }
  return creatorAuth;
}

// Creates an email/password account, then runs `assignRole(uid)` (with the
// current session, i.e. the admin's). If that fails the new account is
// deleted again, so a retry doesn't hit "email already in use" on an
// account without a role. Errors keep Firebase's `code` (auth/...).
export async function createAuthAccount(email, password, assignRole) {
  const creator = getCreatorAuth();
  const { user } = await createUserWithEmailAndPassword(creator, email.trim(), password);
  try {
    await assignRole(user.uid);
    return user.uid;
  } catch (err) {
    await user.delete().catch((deleteErr) => console.error("[auth] Account senza ruolo non eliminato:", user.uid, deleteErr));
    throw err;
  } finally {
    await signOut(creator).catch(() => {});
  }
}

export { signInWithEmailAndPassword, signOut, onAuthStateChanged };
