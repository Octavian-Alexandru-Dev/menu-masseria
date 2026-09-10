// Main app shell.
//
// Designed to be light on the customer's phone, on a connection that's
// often weak (we're at a countryside farmhouse restaurant):
//  - the management panel (Admin.jsx, which includes Firebase Authentication)
//    is NOT downloaded until someone clicks "Gestione menù";
//  - the menu is read with onSnapshot + a persistent local cache (see
//    firebase-db.js): once seen, it stays saved on the phone and reappears
//    instantly even offline, while updating in the background;
//  - if the very first load is slow (poor connection) or the document
//    doesn't exist yet on Firestore, there's no longer a sample menu to
//    show in its place (removed on purpose): a spinner is shown and the
//    connection is retried up to MAX_LOAD_ATTEMPTS times (each attempt has
//    its own timeout); only after the last failed attempt do we settle on
//    an explicit message with a reload button.
import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase-db";
import { MENU_DOC_PATH, FALLBACK_STYLE, useUrlState } from "./shared";
import ClientView from "./ClientView";

const StaffHome = lazy(() => import("./StaffHome"));
const PrintMenu = lazy(() => import("./PrintMenu"));
const Waiter = lazy(() => import("./Waiter"));
const Kitchen = lazy(() => import("./Kitchen"));
const Reservations = lazy(() => import("./Reservations"));

const LOAD_ATTEMPT_TIMEOUT_MS = 5000; // timeout for each attempt
const MAX_LOAD_ATTEMPTS = 3; // number of automatic retries before the final message
const SAVE_TIMEOUT_MS = 8000;
const MAX_UNDO_STEPS = 20;

export default function App() {
  const [menu, setMenuState] = useState(null);
  // client | staff — synced with ?area=staff in the URL, so the browser's
  // Back button returns to the public menu instead of doing nothing (see
  // useUrlState in shared.jsx).
  const [view, setView] = useUrlState("area", "client");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [loadNotice, setLoadNotice] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(1);
  const [undoStack, setUndoStack] = useState([]); // previous states of menu, most recent at the end

  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  const menuDocRef = doc(db, ...MENU_DOC_PATH);

  // Tab opened by the Admin panel ("Esporta PDF / Stampa") just to show the
  // print preview: it must not open its own Firestore connection, it reads
  // the menu already prepared in sessionStorage (see PrintMenu.jsx).
  const isPrintMode = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("print") === "1";

  // Areas restricted to staff (§2 of docs/comande-camerieri.md): dedicated,
  // bookmarkable routes (e.g. for the fixed kitchen screen), not reachable
  // from a button in the public menu. Each handles its own login and role
  // check (see staff-shared.jsx).
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const isWaiterPath = pathname.startsWith("/cameriere") || pathname.startsWith("/waiter");
  const isKitchenPath = pathname.startsWith("/cucina") || pathname.startsWith("/kitchen");
  const isReservationsPath = pathname.startsWith("/prenotazioni") || pathname.startsWith("/reservations");

  useEffect(() => {
    if (isPrintMode) return;

    let cancelled = false;
    let unsubscribe = () => {};
    let timeoutId = null;

    // Each attempt opens its own onSnapshot subscription with a dedicated
    // timeout: if it expires with no data, it closes the subscription and
    // opens a new one (up to MAX_LOAD_ATTEMPTS times). Only after the last
    // failed attempt do we show the explicit message with a manual reload.
    const subscribe = (attempt) => {
      let gotAnyData = false;
      setLoadAttempt(attempt);

      timeoutId = setTimeout(() => {
        if (gotAnyData || cancelled) return;
        unsubscribe();
        if (attempt < MAX_LOAD_ATTEMPTS) {
          subscribe(attempt + 1);
        } else {
          setLoadNotice("Connessione lenta: il menù non è ancora arrivato dopo diversi tentativi. Verifica la connessione, oppure ricarica la pagina.");
        }
      }, LOAD_ATTEMPT_TIMEOUT_MS);

      unsubscribe = onSnapshot(
        menuDocRef,
        (snap) => {
          gotAnyData = true;
          clearTimeout(timeoutId);
          if (snap.exists()) {
            const loaded = snap.data();
            if (loaded && loaded.theme === "cirò") loaded.theme = "ciro";
            // If you're in the restricted area (admin/waiter/kitchen), do NOT
            // overwrite any edits in progress in the editor with an update
            // coming from the server or the cache.
            setMenuState((prev) => {
              if (!prev) return loaded;
              if (viewRef.current === "staff") return prev;
              return loaded;
            });
            setLoadNotice(null);
          } else if (!snap.metadata.fromCache) {
            // The document doesn't exist yet on Firestore (first-time setup,
            // or a restored database): there's no longer a local sample menu
            // to show in its place. It must be created from the Admin panel
            // (login is possible even with no menu loaded — see Admin.jsx),
            // e.g. by importing a JSON backup. No point retrying in this case.
            setLoadNotice("Nessun menù trovato su Firestore. Accedi come amministratore per crearne uno (es. importando un backup JSON).");
          }
        },
        (err) => {
          clearTimeout(timeoutId);
          console.error(`[menu] onSnapshot error (tentativo ${attempt}/${MAX_LOAD_ATTEMPTS}):`, err);
          if (cancelled) return;
          if (attempt < MAX_LOAD_ATTEMPTS) {
            unsubscribe();
            subscribe(attempt + 1);
          } else {
            setLoadNotice("Impossibile contattare il server dopo diversi tentativi. Verifica la connessione e riprova.");
          }
        }
      );
    };

    subscribe(1);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The single place where the menu state changes: every call records the
  // previous state onto an undo stack (max MAX_UNDO_STEPS steps), so any
  // Admin action (field edit, translation generation, JSON import, ...)
  // automatically becomes undoable without having to touch every single
  // handler in Admin.jsx.
  const setMenu = useCallback((updater) => {
    setMenuState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (prev !== null && next !== prev) {
        setUndoStack((stack) => [...stack, prev].slice(-MAX_UNDO_STEPS));
      }
      return next;
    });
  }, []);

  // Exiting the restricted area ("Esci"/"Anteprima" buttons in Admin, or
  // from the waiter/kitchen/reservations login inside StaffHome): besides
  // returning to the public menu, this also clears ?sezione (the sub-area
  // chosen in StaffHome, see StaffHome.jsx) with a silent replaceState — it
  // must not stay in the URL nor generate its own history entry, otherwise
  // reopening "Gestione menù" would jump straight back to the last section
  // instead of showing the Dashboard again.
  const handleExitStaff = () => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("sezione");
      window.history.replaceState(null, "", url);
    }
    setView("client");
  };

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

      // Auth is required before writing: with the persistent cache, setDoc
      // without auth can hang forever.
      const { auth } = await import("./firebase-auth");
      if (!auth.currentUser) {
        throw new Error("Sessione scaduta. Effettua di nuovo l'accesso e riprova.");
      }
      // Force a token refresh to avoid silent rejections.
      try { await auth.currentUser.getIdToken(true); } catch (_) { /* proceed anyway */ }

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
          <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", ...FALLBACK_STYLE }}>
            Caricamento anteprima di stampa…
          </div>
        }
      >
        <PrintMenu />
      </Suspense>
    );
  }

  if (isKitchenPath || isWaiterPath || isReservationsPath) {
    const StaffArea = isKitchenPath ? Kitchen : isReservationsPath ? Reservations : Waiter;
    return (
      <Suspense
        fallback={
          <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", ...FALLBACK_STYLE }}>
            Caricamento…
          </div>
        }
      >
        <StaffArea menu={menu} />
      </Suspense>
    );
  }

  // The restricted area can also open without a menu loaded yet (the Admin
  // panel inside it lets you import a JSON backup if the document doesn't
  // exist yet on Firestore — see Admin.jsx).
  if (view === "staff") {
    return (
      <Suspense
        fallback={
          <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", ...FALLBACK_STYLE }}>
            Caricamento…
          </div>
        }
      >
        <StaffHome
          menu={menu}
          setMenu={setMenu}
          onSave={handleSave}
          saving={saving}
          savedAt={savedAt}
          saveError={saveError || loadNotice}
          onExit={handleExitStaff}
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
        justifyContent: "center", gap: 14, padding: 24, textAlign: "center", ...FALLBACK_STYLE,
      }}>
        {!loadNotice && (
          <>
            <style>{`@keyframes mdpLoadSpin { to { transform: rotate(360deg); } }`}</style>
            <div
              aria-hidden="true"
              style={{
                width: 34, height: 34, borderRadius: "50%",
                border: `3px solid ${FALLBACK_STYLE.color}33`,
                borderTopColor: FALLBACK_STYLE.color,
                animation: "mdpLoadSpin .8s linear infinite",
              }}
            />
          </>
        )}
        <div role="status">
          {loadNotice
            || (loadAttempt > 1 ? `Nuovo tentativo di connessione… (${loadAttempt}/${MAX_LOAD_ATTEMPTS})` : "Caricamento menù…")}
        </div>
        {loadNotice && (
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "8px 16px", border: `1px solid ${FALLBACK_STYLE.color}`, borderRadius: 6, background: "none", color: FALLBACK_STYLE.color, cursor: "pointer", fontSize: 13 }}
          >
            Ricarica pagina
          </button>
        )}
      </div>
    );
  }

  return <ClientView menu={menu} onGoStaff={() => setView("staff")} />;
}
