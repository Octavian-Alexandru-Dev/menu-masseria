// Update banners for the Windows till client (rendered by PrintStation.jsx,
// so only inside the client): tells whoever is at the till what's happening
// in the background instead of updating silently —
//   - a new web app version was deployed → "Aggiorna ora" reloads the page;
//   - a new client version is downloading (with progress), is ready
//     ("Aggiorna ora" installs and restarts), is installing, or failed (it
//     retries on its own);
//   - after the restart/reload: "aggiornato alla versione X".
//
// Client state comes from bridge.onClientUpdateState (client ≥ 1.2.0; older
// clients only fire onUpdateAvailable, which is still handled).
import React, { useEffect, useState } from "react";
import { RefreshCw, Download, CheckCircle2, AlertTriangle, X } from "lucide-react";

const CLIENT_VERSION_KEY = "mdp.clientVersion";
const WEB_RELOADED_KEY = "mdp.webUpdateReloaded";
const DONE_BANNER_MS = 8000;
// Installing a client update closes the program and runs a silent installer
// (no window) for up to a minute: before that, give people time to read
// that it will reopen by itself — otherwise they reopen it by hand while the
// installer is still replacing its files.
const INSTALL_NOTICE_S = 5;

function storageGet(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}
function storageSet(storage, key, value) {
  try { storage.setItem(key, value); } catch { /* storage unavailable: no "done" banner */ }
}
function storageRemove(storage, key) {
  try { storage.removeItem(key); } catch { /* ignore */ }
}

// What to say after a restart: the client version changed since the last
// run, or the page was reloaded by "Aggiorna ora" for a web deploy. Reading
// it consumes the signal, so it's computed once per page load (module
// level), not in a state initializer — React StrictMode calls those twice.
let doneMessageOnLoad;
function doneMessageForThisLoad(bridge) {
  if (doneMessageOnLoad === undefined) doneMessageOnLoad = initialDoneMessage(bridge);
  return doneMessageOnLoad;
}

function initialDoneMessage(bridge) {
  const previous = storageGet(localStorage, CLIENT_VERSION_KEY);
  storageSet(localStorage, CLIENT_VERSION_KEY, bridge.version);
  if (previous && previous !== bridge.version) return `Programma aggiornato alla versione ${bridge.version}.`;
  if (storageGet(sessionStorage, WEB_RELOADED_KEY)) {
    storageRemove(sessionStorage, WEB_RELOADED_KEY);
    return "Interfaccia aggiornata all'ultima versione.";
  }
  return null;
}

export default function UpdateBanner({ bridge }) {
  const [webUpdate, setWebUpdate] = useState(false);
  const [client, setClient] = useState({ status: "idle" });
  const [applying, setApplying] = useState(null); // "install" | "reload"
  const [done, setDone] = useState(() => doneMessageForThisLoad(bridge));
  const [dismissedError, setDismissedError] = useState(null);
  const [countdown, setCountdown] = useState(null);

  useEffect(() => bridge.onUpdateAvailable(() => setWebUpdate(true)), [bridge]);
  useEffect(() => {
    if (typeof bridge.onClientUpdateState !== "function") return;
    return bridge.onClientUpdateState((st) => setClient(st || { status: "idle" }));
  }, [bridge]);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(null), DONE_BANNER_MS);
    return () => clearTimeout(id);
  }, [done]);

  const clientReady = client.status === "downloaded";

  useEffect(() => {
    if (countdown == null) return;
    if (countdown <= 0) { bridge.reloadApp(); return; }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown, bridge]);

  const applyNow = () => {
    // reloadApp installs a downloaded client update if there is one,
    // otherwise reloads the page with the new web app.
    if (clientReady) {
      setApplying("install");
      setCountdown(INSTALL_NOTICE_S);
      return;
    }
    setApplying("reload");
    storageSet(sessionStorage, WEB_RELOADED_KEY, "1");
    bridge.reloadApp();
  };

  let banner = null;
  if (applying === "install") {
    banner = {
      tone: "busy", icon: RefreshCw,
      text: countdown > 0
        ? `Installazione della versione ${client.version || ""}: tra ${countdown} secondi il programma si chiude e si riapre da solo (circa un minuto). Non riaprirlo nel frattempo.`
        : "Installazione in corso: il programma si riaprirà da solo. Non riaprirlo nel frattempo.",
    };
  } else if (applying === "reload") {
    banner = { tone: "busy", icon: RefreshCw, text: "Aggiornamento dell'interfaccia in corso…" };
  } else if (clientReady) {
    banner = { tone: "action", icon: Download, text: `Aggiornamento del programma pronto (versione ${client.version}). Si installa da solo alla chiusura, oppure adesso: il programma si riavvia in pochi secondi.` };
  } else if (webUpdate) {
    banner = { tone: "action", icon: RefreshCw, text: "È disponibile una nuova versione dell'interfaccia. Aggiornando, la pagina si ricarica (il lavoro salvato resta)." };
  } else if (client.status === "downloading") {
    const pct = client.progress != null ? ` — ${client.progress}%` : "";
    banner = { tone: "info", icon: Download, text: `Download dell'aggiornamento del programma${client.version ? ` (versione ${client.version})` : ""} in corso${pct}. Puoi continuare a lavorare.` };
  } else if (client.status === "error" && dismissedError !== client.error) {
    banner = { tone: "error", icon: AlertTriangle, text: "Aggiornamento del programma non riuscito: riproverà da solo più tardi.", detail: client.error, dismiss: () => setDismissedError(client.error) };
  } else if (done) {
    banner = { tone: "done", icon: CheckCircle2, text: done, dismiss: () => setDone(null) };
  }
  if (!banner) return null;

  const Icon = banner.icon;
  const background = banner.tone === "error" ? "#8e2a20" : banner.tone === "done" ? "#24603f" : "#2b2b2b";
  return (
    <div role="status" aria-label="Aggiornamenti" data-update-tone={banner.tone} style={{
      position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 14, zIndex: 150,
      display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 10px 16px", borderRadius: 12,
      background, color: "#fff", fontFamily: "'Work Sans', sans-serif", fontSize: 15, lineHeight: 1.35,
      boxShadow: "0 6px 20px rgba(0,0,0,0.25)", width: "max-content", maxWidth: "min(640px, calc(100vw - 100px))",
    }}>
      <Icon size={20} style={{ flex: "none" }} className={banner.tone === "busy" ? "mdp-update-spin" : undefined} />
      <style>{"@keyframes mdpUpdateSpin { to { transform: rotate(360deg); } } .mdp-update-spin { animation: mdpUpdateSpin 1s linear infinite; }"}</style>
      <span>
        {banner.text}
        {banner.detail && <span style={{ display: "block", fontSize: 12, opacity: 0.8, marginTop: 2 }}>{banner.detail}</span>}
      </span>
      {banner.tone === "action" && (
        <button type="button" onClick={applyNow} style={{
          flex: "none", display: "flex", alignItems: "center", gap: 6, minHeight: 44, padding: "0 16px", borderRadius: 8,
          border: "none", background: "#fff", color: "#2b2b2b", fontSize: 15, fontWeight: 600, cursor: "pointer",
        }}>
          <RefreshCw size={16} /> Aggiorna ora
        </button>
      )}
      {banner.dismiss && (
        <button type="button" aria-label="Chiudi avviso" onClick={banner.dismiss} style={{
          flex: "none", width: 44, height: 44, border: "none", background: "none", color: "#fff", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <X size={18} />
        </button>
      )}
    </div>
  );
}
