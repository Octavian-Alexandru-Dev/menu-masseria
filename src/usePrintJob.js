// Sending a receipt to the till's printer queue (printJobs.js) and following
// its status in realtime — shared by the phone receipt (ReceiptOverlay.jsx)
// and the till (TillSala.jsx), so both say the same things the same way.
import { useState, useEffect } from "react";
import { enqueueReceiptPrint, subscribePrintJob, retryPrintJob } from "./printJobs";

// After this long still "pending", nobody has picked the job up: most likely
// the till client is off or not logged in.
const STATION_SLOW_MS = 15_000;
// A job "printing" for this long was claimed by a till that then stopped
// (closed or crashed mid-print): treat it as failed, so it can be retried
// instead of showing "Stampa in corso…" forever.
const PRINTING_STUCK_MS = 30_000;

function statusText(job, slow, enqueueError) {
  if (enqueueError) return { text: enqueueError, tone: "error" };
  if (!job) return { text: "Invio alla cassa…", tone: "info" };
  switch (job.status) {
    case "pending":
      return slow
        ? { text: "La cassa non ha ancora preso la stampa: il programma della cassa è acceso e connesso?", tone: "warn" }
        : { text: "Inviato alla cassa, in attesa…", tone: "info" };
    case "printing":
      return slow
        ? { text: "La stampa si è interrotta (programma della cassa chiuso?). Riprova.", tone: "error" }
        : { text: "Stampa in corso alla cassa…", tone: "info" };
    case "printed": return { text: "Stampato alla cassa", tone: "ok" };
    case "expired": return { text: "Richiesta scaduta: nessuna cassa l'ha stampata.", tone: "error" };
    case "error": return { text: `Stampa non riuscita: ${job.error || "errore sconosciuto"}`, tone: "error" };
    default: return { text: "", tone: "info" };
  }
}

// print(order, menu): new job, or a retry of the current one after an error
// or expiry. status: { text, tone: info|warn|ok|error } | null.
export function usePrintJob() {
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [slow, setSlow] = useState(false);
  const [enqueueError, setEnqueueError] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    return subscribePrintJob(jobId, setJob, (err) => console.error("[print] Stato stampa non disponibile:", err));
  }, [jobId]);

  const jobStatus = job?.status;
  useEffect(() => {
    setSlow(false);
    if (jobStatus !== "pending" && jobStatus !== "printing") return;
    const id = setTimeout(() => setSlow(true), jobStatus === "printing" ? PRINTING_STUCK_MS : STATION_SLOW_MS);
    return () => clearTimeout(id);
  }, [jobStatus, job?.createdAt]);

  const stuck = jobStatus === "printing" && slow;
  const failed = Boolean(enqueueError) || jobStatus === "error" || jobStatus === "expired" || stuck;

  const print = async (order, menu) => {
    setSending(true);
    setEnqueueError(null);
    try {
      if (jobId && (jobStatus === "error" || jobStatus === "expired" || stuck)) {
        await retryPrintJob(jobId);
      } else {
        setJob(null);
        setJobId(await enqueueReceiptPrint(order, menu));
      }
    } catch (err) {
      console.error("[print] Invio alla cassa fallito:", err);
      setEnqueueError("Invio alla cassa non riuscito. Controlla la connessione e riprova.");
    } finally {
      setSending(false);
    }
  };

  const busy = sending || Boolean(jobId && !enqueueError && !stuck && (!job || jobStatus === "pending" || jobStatus === "printing"));
  const status = jobId || enqueueError ? statusText(job, slow, enqueueError) : null;
  return { print, busy, failed, status };
}
