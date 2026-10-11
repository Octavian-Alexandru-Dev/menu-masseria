// Sending something to the till's printer queue (printJobs.js) and following
// its status in realtime — shared by the phone receipt (ReceiptOverlay.jsx),
// the till (TillSala.jsx, TillHistory.jsx) and the kitchen ticket sent with
// "Invia comanda" (sala-shared.jsx), so all say the same things the same way.
import { useState, useEffect } from "react";
import {
  enqueueReceiptPrint, subscribePrintJob, retryPrintJob, subscribeOrderKitchenJobs, dismissPrintJob,
  kitchenJobProblem, jobCreatedMs, PRINTING_STUCK_MS,
} from "./printJobs";
import { confirmAction } from "./confirmDialog";

// After this long still "pending", nobody has picked the job up: most likely
// the till client is off or not logged in.
const STATION_SLOW_MS = 15_000;
// A job "printing" for PRINTING_STUCK_MS (printJobs.js) was claimed by a
// till that then stopped (closed or crashed mid-print): treat it as failed,
// so it can be retried instead of showing "Stampa in corso…" forever.

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

// enqueue(...args) → Promise<jobId | null> (null = nothing to print).
// print(...args): a new job — or, after an error/expiry/interrupted print,
// a retry of the current one (same button, "Riprova stampa").
// printNew(...args): always a new job (a new "Invia comanda" after a failed
// one must print the new lines, not the old ones again).
// status: { text, tone: info|warn|ok|error } | null.
export function usePrintJob(enqueue = enqueueReceiptPrint) {
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

  const run = async (retry, args) => {
    setSending(true);
    setEnqueueError(null);
    try {
      if (retry) {
        await retryPrintJob(jobId);
      } else {
        setJob(null);
        setJobId(await enqueue(...args));
      }
    } catch (err) {
      console.error("[print] Invio alla cassa fallito:", err);
      setEnqueueError("Invio alla cassa non riuscito. Controlla la connessione e riprova.");
    } finally {
      setSending(false);
    }
  };

  const canRetry = Boolean(jobId) && (jobStatus === "error" || jobStatus === "expired" || stuck);
  const print = (...args) => run(canRetry, args);
  const printNew = (...args) => run(false, args);

  const busy = sending || Boolean(jobId && !enqueueError && !stuck && (!job || jobStatus === "pending" || jobStatus === "printing"));
  const status = jobId || enqueueError ? statusText(job, slow, enqueueError) : null;
  return { print, printNew, busy, failed, status };
}

const TIME_LABEL = (ms) => new Date(ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

// The kitchen tickets of one order (sent with "Invia comanda", see
// sendOrderLinesWithKitchenTicket), read from the print queue — so a ticket
// that didn't print is still there, with "Ristampa", when the table is opened
// again later, from any device.
// status: print status ({ text, tone } | null) of the ticket of the last
// send from this screen (none if that send had nothing for the kitchen) or,
// before any, of a ticket still on its way. track(jobId) is called by the
// send (sala-shared.jsx) with the new ticket's id, or null.
// problems: tickets that may not have reached the kitchen, each with
// retry() (back in the queue) and dismiss() ("Ignora": not needed any more).
export function useOrderKitchenTickets(orderId) {
  const [jobs, setJobs] = useState([]);
  const [trackedId, setTrackedId] = useState(undefined); // undefined = nothing sent from this screen yet
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    if (!orderId) return;
    return subscribeOrderKitchenJobs(orderId, setJobs, (err) => console.error("[print] Comande cucina non disponibili:", err));
  }, [orderId]);

  // Ticking clock only while a ticket is on its way ("slow" / "stuck").
  const inFlight = jobs.some((j) => j.status === "pending" || j.status === "printing");
  useEffect(() => {
    if (!inFlight) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [inFlight]);

  const act = async (fn) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      console.error("[print] Comanda cucina: azione non riuscita:", err);
      setActionError("Invio alla cassa non riuscito. Controlla la connessione e riprova.");
    } finally {
      setBusy(false);
    }
  };

  const describe = (job) => {
    const problem = kitchenJobProblem(job, now);
    const slow = job.status === "pending" && now - jobCreatedMs(job) > STATION_SLOW_MS;
    return { problem, status: statusText(job, slow || problem === "stuck", null) };
  };

  const problems = jobs
    .map((job) => ({ job, ...describe(job) }))
    .filter((j) => j.problem)
    .map(({ job, status }) => {
      const dishes = (job.payload?.groups || []).reduce((n, g) => n + (g.lines || []).reduce((m, l) => m + (l.quantity || 0), 0), 0);
      const title = `Comanda delle ${TIME_LABEL(jobCreatedMs(job))}${dishes ? ` (${dishes} ${dishes === 1 ? "piatto" : "piatti"})` : ""}`;
      return {
        id: job.id,
        title,
        status,
        retry: () => act(() => retryPrintJob(job.id)),
        dismiss: async () => {
          const ok = await confirmAction({
            title: "Ignorare questa comanda?",
            message: `${title}: non verrà più segnalata come non stampata. Fallo solo se la cucina ha già questi piatti.`,
            confirmLabel: "Ignora comanda",
          });
          if (ok) await act(() => dismissPrintJob(job.id));
        },
      };
    });

  let status = null;
  if (actionError) {
    status = { text: actionError, tone: "error" };
  } else if (trackedId !== undefined) {
    const job = trackedId && jobs.find((j) => j.id === trackedId);
    if (trackedId && !job) status = statusText(null, false, null); // "Invio alla cassa…"
    else if (job && !describe(job).problem) status = describe(job).status;
  } else {
    const last = jobs[jobs.length - 1];
    if (last && (last.status === "pending" || last.status === "printing") && !describe(last).problem) status = describe(last).status;
  }
  return { status, problems, busy, track: setTrackedId };
}
