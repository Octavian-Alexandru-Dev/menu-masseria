// Firebase Authentication — usato SOLO dal pannello di gestione menù.
// È in un file a parte apposta: firebase/auth è un modulo pesante e non ha
// senso farlo scaricare a un cliente che sta solo guardando il menù.
// Questo file viene incluso nel sito solo quando si clicca "Gestione menù".
import { app } from "./firebase-db";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

export const auth = getAuth(app);
export { signInWithEmailAndPassword, signOut, onAuthStateChanged };
