// Firebase Authentication — used ONLY by the menu management panel.
// Kept in its own file on purpose: firebase/auth is a heavy module with no
// reason to be downloaded by a customer who's just looking at the menu.
// This file is only included in the bundle once someone clicks "Gestione menù".
import { app } from "./firebase-db";
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

export const auth = getAuth(app);

// See firebase-db.js for the meaning of VITE_USE_FIREBASE_EMULATOR.
if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true") {
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
}

export { signInWithEmailAndPassword, signOut, onAuthStateChanged };
