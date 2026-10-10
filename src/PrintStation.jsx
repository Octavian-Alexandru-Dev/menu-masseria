// Print station — mounted by MenuApp.jsx only inside the Windows till client
// (desktop-client/, detected via window.mdpDesktop): listens for pending
// receipt print jobs (printJobs.js) from any device and sends them to the
// thermal printer through the client's native bridge. Also shows the
// floating "Cassa" button (a gear with the printer status dot; tap → menu
// with virtual keyboard, fullscreen, printer settings, close the program)
// and the update banners (UpdateBanner.jsx).
//
// The menu only offers what the installed client supports: a till still on
// an older client version (bridge without toggleKeyboard/setFullscreen/
// quitApp) gets just "Impostazioni stampante".
//
// Lazy-loaded: never part of the public menu bundle, and never loaded at all
// in a normal browser.
import React, { useEffect, useRef, useState } from "react";
import { Keyboard, Maximize, Minimize, Settings, Power } from "lucide-react";
import { confirmAction } from "./confirmDialog";
import UpdateBanner from "./UpdateBanner";
import { useStaffSession } from "./staff-shared";
import { getDesktopBridge } from "./desktop";
import { buildReceipt, grayToMonoBitmap, LOGO_WIDTH_DOTS } from "./escpos";
import {
  subscribePendingPrintJobs, claimPrintJob, finishPrintJob, expirePrintJob,
  isPrintJobExpired, purgeOldPrintJobs,
} from "./printJobs";

let logoPromise = null;

// The same logo used by the web app, converted once per session to the
// printer's 1-bit format. Any failure falls back to a text header
// (buildReceipt with logo: null) rather than blocking the print.
export function loadReceiptLogo() {
  if (!logoPromise) {
    logoPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const width = LOGO_WIDTH_DOTS;
          const height = Math.round((img.naturalHeight * width) / img.naturalWidth);
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, width, height);
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, width, height);
          const rgba = ctx.getImageData(0, 0, width, height).data;
          const gray = new Uint8Array(width * height);
          for (let i = 0; i < gray.length; i++) {
            gray[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
          }
          resolve(grayToMonoBitmap(gray, width, height));
        } catch (err) {
          console.error("[print] Conversione logo fallita:", err);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = "/logo.jpg";
    });
  }
  return logoPromise;
}

function usePrintStation(bridge, active) {
  const [state, setState] = useState({ phase: "idle", lastError: null, printedCount: 0 });
  const inFlight = useRef(new Set());
  const queue = useRef(Promise.resolve());

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let stationName = "Cassa";
    bridge.getConfig().then((cfg) => { if (cfg?.stationName) stationName = cfg.stationName; }).catch(() => {});
    purgeOldPrintJobs().catch((err) => console.error("[print] Pulizia vecchie stampe fallita:", err));

    const processJob = async (job) => {
      if (cancelled) return;
      if (isPrintJobExpired(job)) {
        await expirePrintJob(job.id).catch(() => {});
        return;
      }
      const won = await claimPrintJob(job.id, stationName).catch((err) => {
        console.error("[print] Presa in carico fallita:", err);
        return false;
      });
      if (!won) return;
      setState((s) => ({ ...s, phase: "printing" }));
      try {
        const bytes = buildReceipt(job.payload, { logo: await loadReceiptLogo() });
        await bridge.printRaw(bytes);
        await finishPrintJob(job.id, null);
        setState((s) => ({ phase: "idle", lastError: null, printedCount: s.printedCount + 1 }));
      } catch (err) {
        const message = (err && err.message) || String(err) || "Errore sconosciuto";
        console.error("[print] Stampa fallita:", err);
        await finishPrintJob(job.id, message).catch(() => {});
        setState((s) => ({ ...s, phase: "error", lastError: message }));
      }
    };

    // One job at a time, in arrival order: the printer is a single device.
    const unsubscribe = subscribePendingPrintJobs((jobs) => {
      for (const job of jobs) {
        if (inFlight.current.has(job.id)) continue;
        inFlight.current.add(job.id);
        queue.current = queue.current
          .then(() => processJob(job))
          .finally(() => inFlight.current.delete(job.id));
      }
    }, (err) => {
      console.error("[print] Ascolto coda di stampa fallito:", err);
      setState((s) => ({ ...s, phase: "error", lastError: "Impossibile leggere la coda di stampa." }));
    });

    return () => { cancelled = true; unsubscribe(); };
  }, [bridge, active]);

  return state;
}

export default function PrintStation() {
  const bridge = getDesktopBridge();
  const session = useStaffSession();
  const active = session.status === "ready";
  const station = usePrintStation(bridge, active);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(null);
  const [actionError, setActionError] = useState(null);

  const canKeyboard = typeof bridge.toggleKeyboard === "function";
  const canFullscreen = typeof bridge.setFullscreen === "function";
  const canQuit = typeof bridge.quitApp === "function";

  const openMenu = () => {
    setActionError(null);
    setMenuOpen((open) => !open);
    if (canFullscreen) bridge.setFullscreen().then(setFullscreen).catch(() => {});
  };

  const run = async (fn) => {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError((err && err.message) || String(err));
    }
  };

  // The keyboard is for the screen underneath: close the menu first.
  const onKeyboard = () => run(async () => { setMenuOpen(false); await bridge.toggleKeyboard(); });
  const onFullscreen = () => run(async () => setFullscreen(await bridge.setFullscreen(!fullscreen)));
  const onSettings = () => { setMenuOpen(false); bridge.openSettings(); };
  const onQuit = async () => {
    setMenuOpen(false);
    const confirmed = await confirmAction({
      title: "Chiudere il programma della cassa?",
      message: "Finché resta chiuso, i preconti inviati dai telefoni non verranno stampati.",
      confirmLabel: "Chiudi programma",
      danger: true,
    });
    if (confirmed) bridge.quitApp();
  };

  const menuItem = {
    display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 54, padding: "0 16px",
    border: "none", borderTop: "1px solid #eee5d4", background: "#fff", color: "#2b2620",
    fontSize: 16, fontFamily: "'Work Sans', system-ui, sans-serif", textAlign: "left", cursor: "pointer",
  };

  const dot = !active ? "#9a9a9a" : station.phase === "error" ? "#c0392b" : station.phase === "printing" ? "#d68910" : "#2e8b57";
  const label = !active
    ? "Stampante non attiva: serve il login"
    : station.phase === "error"
      ? `Stampante: errore — ${station.lastError}`
      : station.phase === "printing"
        ? "Stampante: stampa in corso"
        : "Stampante: pronta";

  return (
    <>
      <button
        type="button"
        onClick={openMenu}
        aria-label={`${label}. Apri menu cassa`}
        aria-expanded={menuOpen}
        title={label}
        data-print-station-phase={active ? station.phase : "inactive"}
        style={{
          position: "fixed", left: 14, bottom: 14, zIndex: 150, width: 52, height: 52, borderRadius: 26,
          border: "1px solid rgba(0,0,0,0.12)", background: "#fff", boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0,
        }}
      >
        {/* A gear rather than a printer: the button opens the whole till
            menu (keyboard, fullscreen, settings, close), not just printing.
            The dot still shows the printer's state. */}
        <Settings size={24} color="#333" />
        <span style={{ position: "absolute", top: 8, right: 8, width: 12, height: 12, borderRadius: 6, background: dot, border: "2px solid #fff" }} />
      </button>
      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 151 }} />
          <div role="menu" aria-label="Menu cassa" style={{
            position: "fixed", left: 14, bottom: 76, zIndex: 152, width: 290, maxWidth: "calc(100vw - 28px)",
            background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,0.22)",
            fontFamily: "'Work Sans', system-ui, sans-serif",
          }}>
            <div style={{ padding: "12px 16px", fontSize: 14, color: station.phase === "error" && active ? "#c0392b" : "#5c554b", lineHeight: 1.4 }}>
              {label}
            </div>
            {canKeyboard && (
              <button type="button" role="menuitem" onClick={onKeyboard} style={menuItem}>
                <Keyboard size={20} /> Tastiera
              </button>
            )}
            {canFullscreen && (
              <button type="button" role="menuitem" onClick={onFullscreen} style={menuItem}>
                {fullscreen ? <><Minimize size={20} /> Esci da schermo intero</> : <><Maximize size={20} /> Schermo intero</>}
              </button>
            )}
            <button type="button" role="menuitem" onClick={onSettings} style={menuItem}>
              <Settings size={20} /> Impostazioni stampante
            </button>
            {canQuit && (
              <button type="button" role="menuitem" onClick={onQuit} style={{ ...menuItem, color: "#b03a2e" }}>
                <Power size={20} /> Chiudi programma
              </button>
            )}
          </div>
        </>
      )}
      {actionError && (
        <div role="alert" style={{
          position: "fixed", left: 76, bottom: 18, zIndex: 150, maxWidth: "min(420px, calc(100vw - 100px))",
          padding: "8px 12px", borderRadius: 10, background: "#c0392b", color: "#fff",
          fontFamily: "'Work Sans', sans-serif", fontSize: 14,
        }}>
          {actionError}
        </div>
      )}
      {active && station.phase === "error" && !actionError && (
        <button type="button" onClick={() => bridge.openSettings()} style={{
          position: "fixed", left: 76, bottom: 18, zIndex: 150, maxWidth: "min(420px, calc(100vw - 100px))",
          padding: "8px 12px", borderRadius: 10, border: "none", background: "#c0392b", color: "#fff",
          fontFamily: "'Work Sans', sans-serif", fontSize: 14, lineHeight: 1.35, textAlign: "left", cursor: "pointer",
          boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
        }}>
          {station.lastError}
        </button>
      )}
      <UpdateBanner bridge={bridge} />
    </>
  );
}
