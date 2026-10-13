// Accesso Node-side alla coda di stampa (printJobs, vedi src/printJobs.js)
// sull'emulatore: semina richieste "vecchie" per il test di scadenza, legge
// lo stato di una richiesta e pulisce quelle create dai test.
import { doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs, deleteDoc, Timestamp } from "firebase/firestore";
import { waiterDb } from "./emulatorApp.js";

export async function seedPrintJob(id, { tableLabel, createdAtMs }) {
  const db = await waiterDb();
  await setDoc(doc(db, "printJobs", id), {
    type: "receipt",
    orderId: null,
    payload: { tableLabel, dateLabel: "", lines: [{ quantity: 1, name: "Voce scaduta", notes: "", totalCents: 100 }], coperto: null, totalCents: 100 },
    status: "pending",
    createdAt: Timestamp.fromMillis(createdAtMs),
    requestedBy: { uid: null, email: null },
    claimedBy: null, claimedAt: null, finishedAt: null, error: null,
  });
}

export async function getPrintJob(id) {
  const db = await waiterDb();
  const snap = await getDoc(doc(db, "printJobs", id));
  return snap.exists() ? snap.data() : null;
}

// Best-effort, come firestore-cleanup.js: non deve mai far fallire un test.
export async function deletePrintJobsByTableLabel(tableLabel) {
  try {
    const db = await waiterDb();
    const snap = await getDocs(query(collection(db, "printJobs"), where("payload.tableLabel", "==", tableLabel)));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch (err) {
    console.error(`[test cleanup] Eliminazione stampe "${tableLabel}" fallita:`, err.message || err);
  }
}

// Diagnostica per i test di stampa: stato delle richieste di un tavolo (chi
// le ha prese, quando, con quale esito), da allegare al report quando un
// test fallisce.
export async function describePrintJobsByTableLabel(tableLabel) {
  const db = await waiterDb();
  const snap = await getDocs(query(collection(db, "printJobs"), where("payload.tableLabel", "==", tableLabel)));
  return snap.docs.map((d) => {
    const j = d.data();
    const ms = (ts) => (ts?.toMillis ? ts.toMillis() : null);
    return { id: d.id, type: j.type, status: j.status, claimedBy: j.claimedBy, error: j.error, createdAt: ms(j.createdAt), claimedAt: ms(j.claimedAt), finishedAt: ms(j.finishedAt) };
  });
}

// Come se la cassa avesse provato a stampare e la stampante avesse dato
// errore (nei test del telefono nessuna cassa è accesa).
export async function failPrintJobsByTableLabel(tableLabel, error) {
  const db = await waiterDb();
  const snap = await getDocs(query(collection(db, "printJobs"), where("payload.tableLabel", "==", tableLabel)));
  await Promise.all(snap.docs.map((d) => updateDoc(d.ref, { status: "error", error, claimedBy: "Cassa di test" })));
  return snap.size;
}
