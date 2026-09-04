// Helper Firestore per le comande dei tavoli (area cameriere/cucina).
// Vedi docs/comande-camerieri.md per il modello dati completo.
//
// File caricato SOLO dalle aree cameriere/cucina (Waiter.jsx/Kitchen.jsx,
// entrambe lazy-load), mai dal sito pubblico.
import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, query, where,
  arrayUnion, serverTimestamp, Timestamp,
} from "firebase/firestore";
import { db } from "./firebase-db";
import { parsePriceToCents } from "./shared";

export const ORDERS_COLLECTION = "orders";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function ordersRef() {
  return collection(db, ORDERS_COLLECTION);
}

export function orderRef(orderId) {
  return doc(db, ORDERS_COLLECTION, orderId);
}

// Sottoscrizione realtime a tutte le comande aperte (status "open"), usata
// sia dall'area cameriere sia dall'area cucina. includeMetadataChanges:true
// è necessario perché l'indicatore "invio in corso" (§7 del documento) si
// basa sul metadato hasPendingWrites di ciascun documento, che altrimenti
// non farebbe ripartire il listener quando la scrittura viene confermata.
export function subscribeOpenOrders(onChange, onError) {
  const q = query(ordersRef(), where("status", "==", "open"));
  return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const orders = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      _hasPendingWrites: d.metadata.hasPendingWrites,
    }));
    onChange(orders);
  }, onError);
}

export async function openOrder({ tableNumber, adults, children, notes, waiterUid, waiterName }) {
  return addDoc(ordersRef(), {
    tableNumber,
    covers: { adults: adults || 0, children: children || 0 },
    notes: notes || "",
    waiterUid,
    waiterName,
    status: "open",
    openedAt: serverTimestamp(),
    closedAt: null,
    expireAt: null,
    items: [],
  });
}

// Aggiunge righe a una comanda già aperta. Ogni riga arriva già completa
// (snapshot di nome/prezzo, portata, note, quantità — vedi buildOrderLine).
export async function sendOrderLines(orderId, lines) {
  return updateDoc(orderRef(orderId), { items: arrayUnion(...lines) });
}

export function buildOrderLine({ lineId, menuItemId, name, price, quantity, course, notes }) {
  return {
    lineId,
    menuItemId: menuItemId || null,
    name,
    price,
    quantity,
    course,
    notes: notes || "",
    status: "sent",
    // arrayUnion non accetta serverTimestamp() per i singoli elementi: uso
    // un timestamp client, sufficiente per l'ordine di visualizzazione.
    sentAt: Timestamp.now(),
  };
}

// La cucina marca come "uscita" un'intera portata di un tavolo con un solo
// tocco (§5 punto 3 del documento). Gli array di Firestore non supportano
// l'aggiornamento di un singolo elemento, quindi riscriviamo l'intero
// array `items` con lo stato aggiornato solo sulle righe della portata
// scelta che non sono già uscite.
export async function markCourseOut(orderId, currentItems, course) {
  const updated = currentItems.map((line) =>
    line.course === course && line.status !== "out" ? { ...line, status: "out" } : line
  );
  return updateDoc(orderRef(orderId), { items: updated });
}

function expireAtFromNow() {
  return Timestamp.fromMillis(Date.now() + THIRTY_DAYS_MS);
}

export async function closeOrder(orderId) {
  return updateDoc(orderRef(orderId), {
    status: "closed",
    closedAt: serverTimestamp(),
    expireAt: expireAtFromNow(),
  });
}

// Chiusura automatica "pigra" lato client (§6.2 del documento): ogni volta
// che l'area cameriere o cucina carica l'elenco delle comande aperte,
// chiude quelle rimaste aperte da più di 24 ore. Nessun job schedulato,
// niente piano Blaze — converge al risultato corretto al successivo
// utilizzo dell'app.
export async function autoCloseStaleOrders(openOrders) {
  const now = Date.now();
  const stale = openOrders.filter((o) => {
    const openedAtMs = o.openedAt?.toMillis ? o.openedAt.toMillis() : null;
    return openedAtMs != null && now - openedAtMs > TWENTY_FOUR_HOURS_MS;
  });
  await Promise.all(
    stale.map((o) =>
      updateDoc(orderRef(o.id), {
        status: "auto_closed",
        closedAt: serverTimestamp(),
        expireAt: expireAtFromNow(),
      }).catch((err) => {
        console.error(`[orders] Chiusura automatica fallita per ${o.id}:`, err);
      })
    )
  );
  return stale.map((o) => o.id);
}

export function orderTotalCents(order) {
  return (order.items || []).reduce((sum, line) => sum + parsePriceToCents(line.price) * line.quantity, 0);
}

// Cancellazione dopo 30 giorni (§6.1 del documento) — lato client, come la
// chiusura automatica a 24h: il piano Firebase gratuito (Spark) non permette
// di configurare una policy TTL nativa (richiede il piano Blaze anche solo
// per attivarla, pur restando l'uso effettivo a costo zero), quindi ogni
// volta che l'area cameriere o cucina si apre si controlla se è già stata
// eseguita una pulizia oggi su questo dispositivo (localStorage) e, se no,
// si cancellano le comande chiuse con expireAt nel passato.
const CLEANUP_STORAGE_KEY = "mdp-orders-last-cleanup";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export async function runDailyExpiredOrdersCleanup() {
  try {
    if (localStorage.getItem(CLEANUP_STORAGE_KEY) === todayKey()) return;
  } catch {
    // localStorage non disponibile (es. navigazione privata): si procede
    // comunque, il controllo verrà semplicemente ripetuto ad ogni apertura.
  }
  try {
    const q = query(ordersRef(), where("expireAt", "<=", Timestamp.now()));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch((err) => {
      console.error(`[orders] Cancellazione comanda scaduta fallita per ${d.id}:`, err);
    })));
    try { localStorage.setItem(CLEANUP_STORAGE_KEY, todayKey()); } catch { /* ignore */ }
  } catch (err) {
    console.error("[orders] Pulizia comande scadute fallita:", err);
  }
}
