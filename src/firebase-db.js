// Configurazione Firebase — SOLO Firestore (il database del menù).
// Questo file NON importa "firebase/auth": viene incluso in ogni visita
// del sito pubblico, quindi lo teniamo il più leggero possibile.
// L'accesso admin (firebase/auth, molto più pesante) sta in firebase-auth.js
// e viene scaricato solo quando qualcuno clicca "Gestione menù".
import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

// Modalità emulatore locale (Docker, vedi docker-compose.emulator.yml): usata
// da `npm run dev:local` e dalla suite Playwright, per non toccare mai il
// progetto Firebase reale e per poter eseguire l'app senza credenziali vere
// (utile anche per far provare il progetto ad altri senza un proprio account
// Firebase). I valori VITE_FIREBASE_* sono ignorati dall'emulatore: bastano
// placeholder (vedi .env.example).
const USE_EMULATOR = import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

// Cache locale persistente (IndexedDB): il menù, una volta scaricato, resta
// salvato sul telefono del cliente. Alle visite successive si vede subito,
// anche con connessione lenta o assente, mentre in sottofondo si controlla
// se ci sono aggiornamenti più recenti da scaricare.
//
// Usiamo persistentMultipleTabManager (non persistentSingleTabManager): con la
// versione "single tab", se il sito è aperto in più schede/pagine dello
// stesso browser contemporaneamente (es. "Menù" e "Gestione menù" aperte
// insieme, o due schede durante un test), la seconda scheda non riesce ad
// attivare la cache e le operazioni di salvataggio restano bloccate in
// attesa per sempre, senza mostrare alcun errore. La versione "multi tab"
// coordina correttamente le schede tra loro ed evita questo blocco.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (USE_EMULATOR) {
  connectFirestoreEmulator(db, "localhost", 8080);
}
