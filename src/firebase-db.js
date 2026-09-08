// Firebase configuration — Firestore ONLY (the menu database).
// This file does NOT import "firebase/auth": it is included on every visit
// to the public site, so we keep it as light as possible.
// Admin access (firebase/auth, much heavier) lives in firebase-auth.js
// and is only downloaded when someone clicks "Gestione menù".
import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

// Local emulator mode (Docker, see docker-compose.emulator.yml): used by
// `npm run dev:local` and the Playwright suite, so we never touch the real
// Firebase project and can run the app without real credentials (also
// useful for letting others try the project without their own Firebase
// account). The VITE_FIREBASE_* values are ignored by the emulator: any
// placeholder works (see .env.example).
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

// Persistent local cache (IndexedDB): once downloaded, the menu stays saved
// on the customer's phone. On later visits it shows up instantly, even on a
// slow or absent connection, while checking for newer updates in the
// background.
//
// We use persistentMultipleTabManager (not persistentSingleTabManager):
// with the "single tab" version, if the site is open in more than one
// tab/page of the same browser at once (e.g. "Menù" and "Gestione menù"
// open together, or two tabs during a test), the second tab fails to
// acquire the cache and save operations stay pending forever, with no
// visible error. The "multi tab" version correctly coordinates the tabs
// with each other and avoids this deadlock.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (USE_EMULATOR) {
  connectFirestoreEmulator(db, "localhost", 8080);
}
