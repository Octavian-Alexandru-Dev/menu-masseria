// Guscio principale dell'app.
//
// Pensato per essere leggero sul cellulare dei clienti, con connessione
// spesso debole (siamo in un agriturismo):
//  - il pannello di gestione (Admin.jsx, che include Firebase Authentication)
//    NON viene scaricato finché qualcuno non clicca "Gestione menù";
//  - il menù viene letto con onSnapshot + cache locale persistente
//    (vedi firebase-db.js): una volta visto, resta salvato sul telefono e
//    riappare all'istante anche offline, mentre si aggiorna in sottofondo;
//  - se il primo caricamento in assoluto è lento (rete scarsa) o il
//    documento non esiste ancora su Firestore, non c'è più un menù di
//    esempio da mostrare al suo posto (rimosso volutamente): si resta su un
//    messaggio esplicito finché la connessione non porta i dati veri.
import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase-db";
import { MENU_DOC_PATH } from "./shared";
import ClientView from "./ClientView";

const Admin = lazy(() => import("./Admin"));
const PrintMenu = lazy(() => import("./PrintMenu"));

const LOAD_TIMEOUT_MS = 6000;
const SAVE_TIMEOUT_MS = 8000;
const MAX_UNDO_STEPS = 20;

export default function App() {
  const [menu, setMenuState] = useState(null);
  const [view, setView] = useState("client"); // client | admin
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [loadNotice, setLoadNotice] = useState(null);
  const [undoStack, setUndoStack] = useState([]); // stati precedenti di menu, il più recente in fondo

  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  const menuDocRef = doc(db, ...MENU_DOC_PATH);

  // Scheda aperta apposta dal pannello Admin ("Esporta PDF / Stampa") solo
  // per mostrare l'anteprima di stampa: non deve aprire una propria
  // connessione a Firestore, legge il menù già pronto da sessionStorage
  // (vedi PrintMenu.jsx).
  const isPrintMode = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("print") === "1";

  useEffect(() => {
    if (isPrintMode) return;

    let gotAnyData = false;
    const timeoutId = setTimeout(() => {
      if (!gotAnyData) {
        setLoadNotice("Connessione lenta: il menù non è ancora arrivato. Verifica la connessione e attendi, oppure ricarica la pagina.");
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
          // Il documento non esiste ancora su Firestore (prima configurazione,
          // o database ripristinato): non c'è più un menù di esempio locale
          // da mostrare al suo posto. Va creato dal pannello Admin (login
          // possibile anche senza menù caricato — vedi Admin.jsx), es.
          // importando un backup JSON.
          setLoadNotice("Nessun menù trovato su Firestore. Accedi come amministratore per crearne uno (es. importando un backup JSON).");
        }
      },
      (err) => {
        clearTimeout(timeoutId);
        console.error("[menu] onSnapshot error:", err);
        setLoadNotice("Impossibile contattare il server. Verifica la connessione e riprova.");
      }
    );

    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unico punto in cui lo stato menu cambia: ogni chiamata registra lo stato
  // precedente in uno stack di annullamento (max MAX_UNDO_STEPS passi), così
  // qualsiasi azione dell'Admin (modifica campo, generazione traduzione,
  // importazione JSON, ...) diventa automaticamente annullabile senza dover
  // toccare ogni singolo handler in Admin.jsx.
  const setMenu = useCallback((updater) => {
    setMenuState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (prev !== null && next !== prev) {
        setUndoStack((stack) => [...stack, prev].slice(-MAX_UNDO_STEPS));
      }
      return next;
    });
  }, []);

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setMenuState(previous);
  };

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

  if (isPrintMode) {
    return (
      <Suspense
        fallback={
          <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", color: "#6E2A2A" }}>
            Caricamento anteprima di stampa…
          </div>
        }
      >
        <PrintMenu />
      </Suspense>
    );
  }

  // Il pannello Admin può aprirsi anche senza un menù ancora caricato (vedi
  // sopra): mostra il login comunque, e dopo il login una schermata per
  // importare un backup JSON invece del solito editor.
  if (view === "admin") {
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
          onUndo={handleUndo}
          canUndo={undoStack.length > 0}
        />
      </Suspense>
    );
  }

  if (!menu) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 14, fontFamily: "sans-serif", color: "#6E2A2A", padding: 24, textAlign: "center",
      }}>
        <div>{loadNotice || "Caricamento menù…"}</div>
        {loadNotice && (
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "8px 16px", border: "1px solid #6E2A2A", borderRadius: 6, background: "none", color: "#6E2A2A", cursor: "pointer", fontSize: 13 }}
          >
            Ricarica pagina
          </button>
        )}
      </div>
    );
  }

  return <ClientView menu={menu} onGoAdmin={() => setView("admin")} />;
}
