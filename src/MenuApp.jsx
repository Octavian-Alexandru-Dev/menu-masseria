// Guscio principale dell'app.
//
// Pensato per essere leggero sul cellulare dei clienti, con connessione
// spesso debole (siamo in un agriturismo):
//  - il pannello di gestione (Admin.jsx, che include Firebase Authentication)
//    NON viene scaricato finché qualcuno non clicca "Gestione menù";
//  - il menù viene letto con onSnapshot + cache locale persistente
//    (vedi firebase-db.js): una volta visto, resta salvato sul telefono e
//    riappare all'istante anche offline, mentre si aggiorna in sottofondo;
//  - se il primo caricamento in assoluto è lento (rete scarsa, nessuna
//    cache ancora), dopo pochi secondi si mostra comunque il menù così com'è
//    nell'ultimo dato noto, invece di restare bloccati su "Caricamento…".
import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase-db";
import { DEFAULT_MENU, MENU_DOC_PATH } from "./shared";
import ClientView from "./ClientView";

const Admin = lazy(() => import("./Admin"));

const LOAD_TIMEOUT_MS = 6000;
const SAVE_TIMEOUT_MS = 8000;

export default function App() {
  const [menu, setMenuState] = useState(null);
  const [view, setView] = useState("client"); // client | admin
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [loadNotice, setLoadNotice] = useState(null);

  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  const menuDocRef = doc(db, ...MENU_DOC_PATH);

  useEffect(() => {
    let gotAnyData = false;
    const timeoutId = setTimeout(() => {
      if (!gotAnyData) {
        setMenuState((prev) => prev || DEFAULT_MENU);
        setLoadNotice("Connessione lenta: mostro l'ultimo menù disponibile.");
      }
    }, LOAD_TIMEOUT_MS);

    const unsubscribe = onSnapshot(
      menuDocRef,
      (snap) => {
        gotAnyData = true;
        clearTimeout(timeoutId);
        if (snap.exists()) {
          const loaded = snap.data();
          if (loaded && loaded.theme === "cirò") loaded.theme = "ciro";
          // Se sei in Gestione menù, NON sovrascriviamo le modifiche in corso
          // con un aggiornamento in arrivo dal server o dalla cache.
          setMenuState((prev) => {
            if (!prev) return loaded;
            if (viewRef.current === "admin") return prev;
            return loaded;
          });
          setLoadNotice(null);
        } else if (!snap.metadata.fromCache) {
          // Il documento non esiste ancora su Firestore: mostriamo il menù
          // di default in locale. Il seeding vero avverrà al primo salvataggio
          // dell'admin (che ha i permessi di scrittura).
          setMenuState((prev) => prev || DEFAULT_MENU);
        }
      },
      (err) => {
        clearTimeout(timeoutId);
        console.error("[menu] onSnapshot error:", err);
        setMenuState((prev) => prev || DEFAULT_MENU);
        setLoadNotice("Impossibile contattare il server: mostro l'ultimo menù disponibile.");
      }
    );

    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMenu = useCallback((updater) => {
    setMenuState((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const sizeInBytes = new Blob([JSON.stringify(menu)]).size;
      if (sizeInBytes > 900_000) {
        throw new Error(
          "I dati del menù sono troppo grandi (probabilmente per una o più immagini incollate per intero invece che come link). Usa un URL immagine (es. https://...) invece di incollare la foto direttamente."
        );
      }

      // Auth obbligatoria prima di scrivere: con la cache persistente,
      // setDoc senza auth può restare in attesa per sempre.
      const { auth } = await import("./firebase-auth");
      if (!auth.currentUser) {
 	throw new Error("Sessione scaduta. Effettua di nuovo l'accesso e riprova.");
      }
      // Forza refresh del token per evitare rifiuti silenziosi.
      try { await auth.currentUser.getIdToken(true); } catch (_) { /* proseguiamo */ }

      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Nessuna risposta dal server entro " + (SAVE_TIMEOUT_MS/1000) + " secondi. Verifica di aver pubblicato le regole (firebase deploy --only firestore:rules) e la connessione, poi riprova.")),
          SAVE_TIMEOUT_MS
        );
      });
      try {
        await Promise.race([setDoc(menuDocRef, menu), timeout]);
      } finally {
        clearTimeout(timeoutId);
      }
      setSavedAt(new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      console.error("[menu] Salvataggio fallito:", e);
      const msg = e && e.message ? e.message : "";
      if (e && e.code === "permission-denied") {
        setSaveError("Salvataggio non riuscito: accesso non autorizzato. Verifica di aver pubblicato le regole Firestore (firebase deploy --only firestore:rules) e di aver effettuato l'accesso con un utente valido.");
      } else {
        setSaveError(msg ? `Salvataggio non riuscito: ${msg}` : "Salvataggio non riuscito. Riprova.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => setMenuState(DEFAULT_MENU);

  if (!menu) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", color: "#6E2A2A" }}>
        Caricamento menù…
      </div>
    );
  }

  if (view === "client") {
    return <ClientView menu={menu} onGoAdmin={() => setView("admin")} />;
  }

  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", color: "#6E2A2A" }}>
          Caricamento gestione…
        </div>
      }
    >
      <Admin
        menu={menu}
        setMenu={setMenu}
        onSave={handleSave}
        saving={saving}
        savedAt={savedAt}
        saveError={saveError || loadNotice}
        onExit={() => setView("client")}
        onReset={handleReset}
      />
    </Suspense>
  );
}
