// Print station — mounted by MenuApp.jsx only inside the Windows till client
// (desktop-client/, detected via window.mdpDesktop): listens for pending
// receipt print jobs (printJobs.js) from any device and sends them to the
// thermal printer through the client's native bridge. Also shows a small
// floating printer button (status at a glance, tap → native printer
// settings) and the "new version available" banner.
//
// Lazy-loaded: never part of the public menu bundle, and never loaded at all
// in a normal browser.
import React, { useEffect, useRef, useState } from "react";
import { Printer, RefreshCw } from "lucide-react";
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
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => bridge.onUpdateAvailable(() => setUpdateReady(true)), [bridge]);

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
        onClick={() => bridge.openSettings()}
        aria-label={`${label}. Apri impostazioni stampante`}
        title={label}
        data-print-station-phase={active ? station.phase : "inactive"}
        style={{
          position: "fixed", left: 14, bottom: 14, zIndex: 150, width: 52, height: 52, borderRadius: 26,
          border: "1px solid rgba(0,0,0,0.12)", background: "#fff", boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0,
        }}
      >
        <Printer size={22} color="#333" />
        <span style={{ position: "absolute", top: 8, right: 8, width: 12, height: 12, borderRadius: 6, background: dot, border: "2px solid #fff" }} />
      </button>
      {active && station.phase === "error" && (
        <button type="button" onClick={() => bridge.openSettings()} style={{
          position: "fixed", left: 76, bottom: 18, zIndex: 150, maxWidth: "min(420px, calc(100vw - 100px))",
          padding: "8px 12px", borderRadius: 10, border: "none", background: "#c0392b", color: "#fff",
          fontFamily: "'Work Sans', sans-serif", fontSize: 14, lineHeight: 1.35, textAlign: "left", cursor: "pointer",
          boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
        }}>
          {station.lastError}
        </button>
      )}
      {updateReady && (
        <div role="status" style={{
          position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 14, zIndex: 150,
          display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 10px 18px", borderRadius: 12,
          background: "#2b2b2b", color: "#fff", fontFamily: "'Work Sans', sans-serif", fontSize: 15,
          boxShadow: "0 6px 20px rgba(0,0,0,0.25)", maxWidth: "calc(100vw - 100px)",
        }}>
          <span>È disponibile una nuova versione dell'app.</span>
          <button type="button" onClick={() => bridge.reloadApp()} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 8, border: "none",
            background: "#fff", color: "#2b2b2b", fontSize: 15, fontWeight: 600, cursor: "pointer",
          }}>
            <RefreshCw size={16} /> Aggiorna ora
          </button>
        </div>
      )}
    </>
  );
}
