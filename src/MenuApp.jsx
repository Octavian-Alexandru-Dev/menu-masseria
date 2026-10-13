// Main app shell.
//
// Designed to be light on the customer's phone, on a connection that's
// often weak (we're at a countryside farmhouse restaurant):
//  - the staff area (StaffHome.jsx and everything behind it, Firebase
//    Authentication included) is NOT downloaded until someone opens it;
//  - the menu is read with onSnapshot + a persistent local cache (see
//    firebase-db.js): once seen, it stays saved on the phone and reappears
//    instantly even offline, while updating in the background;
//  - if the very first load is slow (poor connection) or the document
//    doesn't exist yet on Firestore, there's no longer a sample menu to
//    show in its place (removed on purpose): a spinner is shown and the
//    connection is retried up to MAX_LOAD_ATTEMPTS times (each attempt has
//    its own timeout); only after the last failed attempt do we settle on
//    an explicit message with a reload button.
import React, { useState, useEffect, useCallback, Suspense, lazy } from "react";
import { doc, onSnapshot, runTransaction } from "firebase/firestore";
import { db } from "./firebase-db";
import { MENU_DOC_PATH, FALLBACK_STYLE, useUrlState } from "./shared";
import ClientView from "./ClientView";
import { getDesktopBridge } from "./desktop";
import { MenuEditError } from "./menuEdit";

const StaffHome = lazy(() => import("./StaffHome"));
const PrintMenu = lazy(() => import("./PrintMenu"));
const PrintStation = lazy(() => import("./PrintStation"));

const LOAD_ATTEMPT_TIMEOUT_MS = 5000; // timeout for each attempt
const MAX_LOAD_ATTEMPTS = 3; // number of automatic retries before the final message
const SAVE_TIMEOUT_MS = 8000;
const MAX_MENU_BYTES = 900_000; // Firestore's document limit is 1 MiB

// Inside the Windows till client (desktop-client/) the print station runs
// alongside whatever screen is shown, so receipts sent from any device are
// printed even while the till is on the waiter area, the dashboard or the
// public menu. Never rendered in a normal browser.
function withPrintStation(content) {
  if (!getDesktopBridge()) return content;
  return (
    <>
      {content}
      <Suspense fallback={null}>
        <PrintStation />
      </Suspense>
    </>
  );
}

export default function App() {
  const [menu, setMenuState] = useState(null);
  // client | staff — synced with ?area=staff in the URL, so the browser's
  // Back button returns to the public menu instead of doing nothing (see
  // useUrlState in shared.jsx).
  const [view, setView] = useUrlState("area", "client");
  const [loadNotice, setLoadNotice] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(1);
  // The menu document doesn't exist on the server (not just slow to load).
  const [menuMissing, setMenuMissing] = useState(false);

  const menuDocRef = doc(db, ...MENU_DOC_PATH);

  // Tab opened by the menu settings ("Stampa del menù") just to show the
  // print preview: it must not open its own Firestore connection, it reads
  // the menu already prepared in sessionStorage (see PrintMenu.jsx).
  const isPrintMode = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("print") === "1";

  // Dedicated, bookmarkable entries to the staff area (§2 of
  // docs/comande-camerieri.md), e.g. for a device used only for orders or
  // only at the reception: the same app (StaffHome.jsx), opened on that
  // section.
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const isWaiterPath = pathname.startsWith("/cameriere") || pathname.startsWith("/waiter");
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
            // Every device follows the saved menu live: a price or a dish
            // changed from another device shows up without reloading.
            setMenuState(loaded);
            setMenuMissing(false);
            setLoadNotice(null);
          } else if (!snap.metadata.fromCache) {
            // The document doesn't exist yet on Firestore (first-time setup,
            // or a restored database): there's no longer a local sample menu
            // to show in its place. An admin creates it from a JSON backup
            // (staff area → MenuBootstrap in MenuSettings.jsx). No point
            // retrying in this case.
            setMenuMissing(true);
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

  // Leaving the staff area ("Vedi il menù dei clienti" in the menu
  // settings): back to the public menu, also clearing ?sezione (the section
  // of the staff app) with a silent replaceState, so reopening the staff
  // area starts from Tavoli again.
  const handleExitStaff = () => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("sezione");
      window.history.replaceState(null, "", url);
    }
    setView("client");
  };

  // Writes the menu document in a transaction, with a timeout and readable
  // errors. build(current | null) → the new menu (current is null when the
  // document doesn't exist yet).
  const writeMenu = useCallback(async (build) => {
    const { auth } = await import("./firebase-auth");
    if (!auth.currentUser) throw new Error("Sessione scaduta: accedi di nuovo e riprova.");
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Nessuna risposta dal server: la modifica potrebbe essere salvata lo stesso. Controlla la connessione e guarda il menù prima di riprovare.")), SAVE_TIMEOUT_MS);
    });
    try {
      await Promise.race([
        runTransaction(db, async (tx) => {
          const ref = doc(db, ...MENU_DOC_PATH);
          const snap = await tx.get(ref);
          const next = build(snap.exists() ? snap.data() : null);
          if (new Blob([JSON.stringify(next)]).size > MAX_MENU_BYTES) {
            throw new MenuEditError("I dati del menù sono troppo grandi per essere salvati (le foto vanno caricate, non incollate nel testo).");
          }
          tx.set(ref, next);
        }),
        timeout,
      ]);
    } catch (err) {
      console.error("[menu] Salvataggio del menù fallito:", err);
      if (err instanceof MenuEditError) throw err;
      if (err?.code === "permission-denied") throw new Error("Salvataggio non autorizzato: l'account non può modificare il menù.");
      if (err?.message?.startsWith("Nessuna risposta")) throw err;
      // Only a real connection problem is reported as one: anything else
      // (e.g. data Firestore refuses) would send people chasing the wifi.
      if (err?.code === "unavailable" || err?.code === "deadline-exceeded") {
        throw new Error("Salvataggio non riuscito: controlla la connessione e riprova.");
      }
      throw new Error("Salvataggio non riuscito per un errore imprevisto. Riprova; se si ripete, scarica un backup e segnala il problema.");
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  // One edit from the menu editor (TillMenu.jsx / MenuSettings.jsx, edits
  // from menuEdit.js), saved at once: applied to the menu as it is on the
  // server right now — not to this device's copy, which may be hours old —
  // then to the copy on screen. Rejects with a readable message.
  const handlePatch = useCallback(async (edit) => {
    await writeMenu((current) => {
      if (!current) throw new MenuEditError("Il menù non esiste ancora: crealo da un backup.");
      return edit(current);
    });
    setMenuState((prev) => {
      if (!prev) return prev;
      try { return edit(prev); } catch { return prev; } // stale copy: the live update brings the saved one
    });
  }, [writeMenu]);

  // Restoring a JSON backup (menuBackup.js): replaces the whole menu, also
  // creating it when the document doesn't exist yet.
  const handleRestore = useCallback(async (data) => {
    await writeMenu(() => data);
    setMenuState(data);
  }, [writeMenu]);

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

  // The staff area can also open without a menu loaded yet: an admin can
  // create it from a JSON backup there (MenuBootstrap).
  const staffPath = isWaiterPath || isReservationsPath;
  if (staffPath || view === "staff") {
    return withPrintStation(
      <Suspense
        fallback={
          <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", ...FALLBACK_STYLE }}>
            Caricamento…
          </div>
        }
      >
        <StaffHome
          menu={menu}
          menuMissing={menuMissing}
          entrySection={isReservationsPath ? "reservations" : "waiter"}
          onPatch={handlePatch}
          onRestore={handleRestore}
          onExit={staffPath ? () => window.location.assign("/") : handleExitStaff}
        />
      </Suspense>
    );
  }

  if (!menu) {
    return withPrintStation(
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

  return withPrintStation(<ClientView menu={menu} onGoStaff={() => setView("staff")} />);
}
