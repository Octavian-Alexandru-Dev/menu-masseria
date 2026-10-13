// Print queue for receipts ("preconto") and kitchen tickets ("comanda" for
// the kitchen board) — see docs/stampa-scontrini.md.
//
// A phone's browser can't open a raw TCP connection to the thermal printer,
// so whoever presses "Stampa" (a waiter's phone, the till itself, ...) only
// writes a job to printJobs/{id}; the Windows client at the till
// (desktop-client/, running the print station in printStation.js) listens
// for pending jobs, claims them in a transaction (so two stations never print
// the same job twice) and sends them to the printer. Status updates flow
// back in realtime to the device that asked for the print.
//
// Staff-only module (imports firebase-auth): loaded by the staff screens
// (receipt, kitchen ticket) and the print station, never by the public menu.
import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, query, where,
  runTransaction, serverTimestamp, Timestamp, writeBatch, arrayUnion,
} from "firebase/firestore";
import { db } from "./firebase-db";
import { auth } from "./firebase-auth";
import { parsePriceToCents, tableIdentity } from "./shared";
import { itemsTotalCents, copertoTotalCents, orderRef } from "./orders";
import { buildKitchenTicketPayload } from "./kitchenTicket";

export const PRINT_JOBS_COLLECTION = "printJobs";

// A job still pending after this long is not printed any more but marked
// "expired": when the till was off, a receipt asked for an hour ago coming
// out of the printer at power-on would only confuse whoever is at the till.
export const PRINT_JOB_MAX_AGE_MS = 10 * 60 * 1000;

// Finished jobs are only useful for a short while (status feedback, a
// retry): the print station deletes older ones lazily at startup, same
// "no scheduled job" approach as autoCloseStaleOrders in orders.js.
export const PRINT_JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function printJobsRef() {
  return collection(db, PRINT_JOBS_COLLECTION);
}

function printJobRef(jobId) {
  return doc(db, PRINT_JOBS_COLLECTION, jobId);
}

function coversLabel(adults, children) {
  if (!children) return `Coperto x${adults}`;
  if (!adults) return `Coperto x${children} bamb.`;
  return `Coperto ${adults} ad. + ${children} bamb.`;
}

// Snapshot of what the receipt shows at the moment "Stampa" is pressed,
// stored on the job: the station prints exactly this, even if the order is
// edited in the meantime.
export function buildReceiptPayload(order, menu, now = new Date()) {
  const identity = tableIdentity(order);
  const adults = order.covers?.adults || 0;
  const children = order.covers?.children || 0;
  const copertoCents = copertoTotalCents(order);
  return {
    restaurantName: menu?.restaurantName || "",
    tableLabel: identity.secondary ? `${identity.primary} (${identity.secondary})` : identity.primary,
    dateLabel: `${now.toLocaleDateString("it-IT")}  ${now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`,
    lines: (order.items || []).map((l) => ({
      quantity: l.quantity,
      // "Offerto" / "Sconto 20%" set at the till, visible to the customer.
      name: l.priceNote ? `${l.name} (${l.priceNote.toLowerCase()})` : l.name,
      notes: l.notes || "",
      totalCents: parsePriceToCents(l.price) * l.quantity,
    })),
    coperto: copertoCents > 0 ? { label: coversLabel(adults, children), totalCents: copertoCents } : null,
    totalCents: itemsTotalCents(order) + copertoCents,
  };
}

export async function enqueueReceiptPrint(order, menu) {
  const user = auth.currentUser;
  const ref = await addDoc(printJobsRef(), {
    type: "receipt",
    orderId: order.id,
    payload: buildReceiptPayload(order, menu),
    status: "pending",
    createdAt: serverTimestamp(),
    requestedBy: { uid: user?.uid || null, email: user?.email || null },
    claimedBy: null,
    claimedAt: null,
    finishedAt: null,
    error: null,
  });
  return ref.id;
}

// "Invia comanda": the lines are added to the order and their kitchen ticket
// (see kitchenTicket.js — only dishes flagged "In comanda") is queued in ONE
// batch, so they can't come apart: with the persistent offline cache a send
// still unconfirmed when the page reloads is replayed whole, ticket included.
// `order` is the order before these lines. Resolves once the server has
// confirmed, to the ticket's job id or null when nothing in the batch goes to
// the kitchen; onJobId gets the same value right away, before the server
// answers. The ticket's status is then read per order
// (subscribeOrderKitchenJobs), not kept by the screen that sent it.
export async function sendOrderLinesWithKitchenTicket(order, lines, menu, senderName, onJobId) {
  const batch = writeBatch(db);
  batch.update(orderRef(order.id), { items: arrayUnion(...lines) });
  const payload = buildKitchenTicketPayload(order, lines, menu, { senderName });
  let jobId = null;
  if (payload) {
    const user = auth.currentUser;
    const ref = doc(printJobsRef());
    jobId = ref.id;
    batch.set(ref, {
      type: "kitchen",
      orderId: order.id,
      payload,
      status: "pending",
      createdAt: serverTimestamp(),
      requestedBy: { uid: user?.uid || null, email: user?.email || null },
      claimedBy: null,
      claimedAt: null,
      finishedAt: null,
      error: null,
    });
  }
  onJobId?.(jobId);
  await batch.commit();
  return jobId;
}

function kitchenJobsFrom(snap) {
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
    .filter((j) => j.type === "kitchen");
}

// Every kitchen ticket of one order, oldest first (the order screen shows the
// last one's status and any that didn't print, with "Ristampa").
export function subscribeOrderKitchenJobs(orderId, onChange, onError) {
  const q = query(printJobsRef(), where("orderId", "==", orderId));
  return onSnapshot(q, (snap) => {
    onChange(kitchenJobsFrom(snap).sort((a, b) => jobCreatedMs(a) - jobCreatedMs(b)));
  }, onError);
}

// Kitchen tickets that may not have reached the kitchen (error, expired, or
// still "printing" — stuck if old, see kitchenJobProblem): the table lists
// flag their tables.
export function subscribeUnfinishedKitchenJobs(onChange, onError) {
  const q = query(printJobsRef(), where("status", "in", ["error", "expired", "printing"]));
  return onSnapshot(q, (snap) => onChange(kitchenJobsFrom(snap)), onError);
}

// "Ignora": the ticket isn't needed any more (e.g. the kitchen was told
// another way) — it stops being flagged.
export async function dismissPrintJob(jobId) {
  return updateDoc(printJobRef(jobId), { status: "dismissed", finishedAt: serverTimestamp() });
}

export function jobCreatedMs(job) {
  return job.createdAt?.toMillis ? job.createdAt.toMillis() : Date.now();
}

// A job "printing" for this long was claimed by a till that then stopped
// (closed or crashed mid-print).
export const PRINTING_STUCK_MS = 30_000;

// Why a kitchen ticket may not have reached the kitchen, or null.
export function kitchenJobProblem(job, nowMs = Date.now()) {
  if (job.status === "error" || job.status === "expired") return job.status;
  if (job.status === "printing" && nowMs - (job.claimedAt?.toMillis ? job.claimedAt.toMillis() : jobCreatedMs(job)) > PRINTING_STUCK_MS) return "stuck";
  return null;
}

export function subscribePrintJob(jobId, onChange, onError) {
  return onSnapshot(printJobRef(jobId), (snap) => {
    onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, onError);
}

// Back in the queue (after a printer error, or once it expired), with a
// fresh createdAt so it isn't immediately treated as expired again.
export async function retryPrintJob(jobId) {
  return updateDoc(printJobRef(jobId), {
    status: "pending",
    createdAt: serverTimestamp(),
    claimedBy: null,
    claimedAt: null,
    finishedAt: null,
    error: null,
  });
}

/* ========================= PRINT STATION SIDE ========================= */

export function subscribePendingPrintJobs(onChange, onError) {
  const q = query(printJobsRef(), where("status", "==", "pending"));
  // includeMetadataChanges: a job written by this same device (e.g. "Stampa"
  // pressed at the till) shows up first as a local, unconfirmed write with a
  // null createdAt; we only take it once the server has confirmed it, and
  // without this flag that confirmation alone wouldn't re-trigger the
  // listener.
  return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    onChange(snap.docs.filter((d) => !d.metadata.hasPendingWrites).map((d) => ({ id: d.id, ...d.data() })));
  }, onError);
}

// Returns true when this station won the job (it was still pending).
export async function claimPrintJob(jobId, stationName) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(printJobRef(jobId));
    if (!snap.exists() || snap.data().status !== "pending") return false;
    tx.update(printJobRef(jobId), { status: "printing", claimedBy: stationName, claimedAt: serverTimestamp() });
    return true;
  });
}

export async function finishPrintJob(jobId, error) {
  return updateDoc(printJobRef(jobId), {
    status: error ? "error" : "printed",
    error: error || null,
    finishedAt: serverTimestamp(),
  });
}

export async function expirePrintJob(jobId) {
  return updateDoc(printJobRef(jobId), { status: "expired", finishedAt: serverTimestamp() });
}

export function isPrintJobExpired(job, nowMs = Date.now()) {
  const createdMs = job.createdAt?.toMillis ? job.createdAt.toMillis() : null;
  return createdMs != null && nowMs - createdMs > PRINT_JOB_MAX_AGE_MS;
}

export async function purgeOldPrintJobs() {
  const cutoff = Timestamp.fromMillis(Date.now() - PRINT_JOB_RETENTION_MS);
  const snap = await getDocs(query(printJobsRef(), where("createdAt", "<", cutoff)));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  return snap.size;
}
