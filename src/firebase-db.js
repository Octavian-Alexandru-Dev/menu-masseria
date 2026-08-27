// Configurazione Firebase — SOLO Firestore (il database del menù).
// Questo file NON importa "firebase/auth": viene incluso in ogni visita
// del sito pubblico, quindi lo teniamo il più leggero possibile.
// L'accesso admin (firebase/auth, molto più pesante) sta in firebase-auth.js
// e viene scaricato solo quando qualcuno clicca "Gestione menù".
import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

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
