// Firebase Authentication — usato SOLO dal pannello di gestione menù.
// È in un file a parte apposta: firebase/auth è un modulo pesante e non ha
// senso farlo scaricare a un cliente che sta solo guardando il menù.
// Questo file viene incluso nel sito solo quando si clicca "Gestione menù".
import { app } from "./firebase-db";
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

export const auth = getAuth(app);

// Vedi firebase-db.js per il significato di VITE_USE_FIREBASE_EMULATOR.
if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true") {
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
}

export { signInWithEmailAndPassword, signOut, onAuthStateChanged };
