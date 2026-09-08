// Helper Firestore per le comande dei tavoli (area cameriere/cucina).
// Vedi docs/comande-camerieri.md per il modello dati completo.
//
// File caricato SOLO dalle aree cameriere/cucina (Waiter.jsx/Kitchen.jsx,
// entrambe lazy-load), mai dal sito pubblico.
import {
  collection, doc, addDoc, updateDoc, getDocs, onSnapshot, query, where,
  orderBy, limit, startAfter,
  arrayUnion, serverTimestamp, Timestamp,
} from "firebase/firestore";
import { db } from "./firebase-db";
import { parsePriceToCents } from "./shared";

export const ORDERS_COLLECTION = "orders";

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

// Comande chiuse (manualmente o automaticamente) durante il turno di
// servizio in corso: a differenza dello Storico, restano visibili in sala
// senza dover cambiare schermata, e in tempo reale — un altro cameriere le
// vede sparire dai tavoli aperti e comparire qui appena chiuse. closedAt >=
// inizio turno + orderBy sullo stesso campo: nessun indice composito
// necessario.
export function subscribeShiftClosedOrders(sinceDate, onChange, onError) {
  const q = query(
    ordersRef(),
    where("closedAt", ">=", Timestamp.fromDate(sinceDate)),
    orderBy("closedAt", "desc")
  );
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, onError);
}

// Il prezzo del coperto (adulti/bambini) viene fissato al momento
// dell'apertura del tavolo, come snapshot dal menù — se in futuro il prezzo
// cambia in Gestione menù, le comande già aperte o nello storico restano
// coerenti con quanto effettivamente applicato quel giorno.
export async function openOrder({ tableNumber, tableName, adults, children, notes, waiterUid, waiterName, coperto }) {
  return addDoc(ordersRef(), {
    tableNumber,
    tableName: tableName || "",
    covers: { adults: adults || 0, children: children || 0 },
    coperto: { adults: coperto?.adults || "0,00", children: coperto?.children || "0,00" },
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
// (snapshot di nome/prezzo/categoria, note, quantità — vedi buildOrderLine).
export async function sendOrderLines(orderId, lines) {
  return updateDoc(orderRef(orderId), { items: arrayUnion(...lines) });
}

// La "portata" di una riga non è più una scelta manuale del cameriere (fonte
// di errori: es. un piatto aggiunto per sbaglio sotto "Bevande"), ma la
// categoria del menù a cui il piatto appartiene davvero — categoryId/Name
// sono uno snapshot al momento dell'invio, coerente con nome/prezzo.
//
// cost: costo interno del piatto (src/menuCosts.js), fotografato qui per lo
// stesso motivo del prezzo — se il costo cambia dopo, il margine storico
// resta corretto. null quando il piatto non ha un costo configurato (o per
// comande inviate prima che questo campo esistesse) — la Dashboard
// statistiche esclude quelle righe dal margine invece di trattarle come
// margine zero, e segnala quanta parte dell'incasso non ha un costo noto.
export function buildOrderLine({ lineId, menuItemId, name, price, quantity, categoryId, categoryName, notes, cost }) {
  return {
    lineId,
    menuItemId: menuItemId || null,
    name,
    price,
    quantity,
    categoryId: categoryId || null,
    categoryName: categoryName || "",
    notes: notes || "",
    cost: cost || null,
    status: "sent",
    // arrayUnion non accetta serverTimestamp() per i singoli elementi: uso
    // un timestamp client, sufficiente per l'ordine di visualizzazione.
    sentAt: Timestamp.now(),
    outAt: null,
  };
}

// La cucina marca come "uscita" un intero gruppo (una categoria del menù,
// es. tutti gli antipasti del tavolo) con un solo tocco (§5 punto 3 del
// documento). Gli array di Firestore non supportano l'aggiornamento di un
// singolo elemento, quindi riscriviamo l'intero array `items` con lo stato
// aggiornato solo sulle righe della categoria scelta che non sono già uscite.
export async function markCategoryOut(orderId, currentItems, categoryId) {
  const outAt = Timestamp.now();
  const updated = currentItems.map((line) =>
    line.categoryId === categoryId && line.status !== "out" ? { ...line, status: "out", outAt } : line
  );
  return updateDoc(orderRef(orderId), { items: updated });
}

// Modifica i coperti di un tavolo già aperto (persone arrivate/andate via
// dopo l'apertura — non solo al momento della creazione).
export async function updateCovers(orderId, { adults, children }) {
  return updateDoc(orderRef(orderId), { covers: { adults: adults || 0, children: children || 0 } });
}

// Le comande chiuse non scadono più: restano lo storico permanente su cui si
// basa la Dashboard statistiche (src/Stats.jsx, src/statsData.js).
export async function closeOrder(orderId) {
  return updateDoc(orderRef(orderId), {
    status: "closed",
    closedAt: serverTimestamp(),
    expireAt: null,
  });
}

// Rimuove una riga già inviata (correzione di un errore di battitura, non
// più recuperabile con lo "storno" — usata dal flusso del preconto).
export async function removeOrderLine(orderId, currentItems, lineId) {
  const updated = currentItems.filter((line) => line.lineId !== lineId);
  return updateDoc(orderRef(orderId), { items: updated });
}

// Preconto (non fiscale — vedi docs, §9): il cameriere genera un riepilogo
// stampabile via browser, può correggere la comanda (righe perse, errori) e
// poi confermare uno stato "finale". Tutto salvato sulla comanda stessa,
// sincronizzato in tempo reale su ogni client.
export async function markReceiptPrinted(orderId) {
  return updateDoc(orderRef(orderId), { "receipt.printedAt": serverTimestamp() });
}

export async function confirmFinalReceipt(orderId, order) {
  return updateDoc(orderRef(orderId), {
    "receipt.confirmedAt": serverTimestamp(),
    "receipt.items": order.items || [],
    "receipt.totalCents": orderTotalCents(order),
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
        expireAt: null,
      }).catch((err) => {
        console.error(`[orders] Chiusura automatica fallita per ${o.id}:`, err);
      })
    )
  );
  return stale.map((o) => o.id);
}

export function itemsTotalCents(order) {
  return (order.items || []).reduce((sum, line) => sum + parsePriceToCents(line.price) * line.quantity, 0);
}

export function copertoTotalCents(order) {
  const adults = order.covers?.adults || 0;
  const children = order.covers?.children || 0;
  return parsePriceToCents(order.coperto?.adults) * adults + parsePriceToCents(order.coperto?.children) * children;
}

export function orderTotalCents(order) {
  return itemsTotalCents(order) + copertoTotalCents(order);
}

/* ============================== STORICO ============================== */
// Le comande chiuse non vengono più cancellate: restano per sempre come
// storico, base dati della Dashboard statistiche. Il campo `expireAt` resta
// nello schema (sempre null per le nuove comande) solo per compatibilità con
// documenti scritti prima di questo cambiamento.
// Comande chiuse (manualmente o automaticamente), più recenti prima. Usa
// closedAt sia per il filtro (!= null → solo le chiuse) sia per l'ordinamento:
// stesso campo su entrambi, quindi Firestore non richiede un indice composito
// dedicato. Caricamento a pagine (non realtime: uno storico non ha bisogno
// di aggiornarsi da solo) con "carica altri" tramite cursore su closedAt.
export const HISTORY_PAGE_SIZE = 20;

export async function loadClosedOrdersPage(afterClosedAt) {
  const clauses = [where("closedAt", "!=", null), orderBy("closedAt", "desc"), limit(HISTORY_PAGE_SIZE)];
  const q = afterClosedAt
    ? query(ordersRef(), where("closedAt", "!=", null), orderBy("closedAt", "desc"), startAfter(afterClosedAt), limit(HISTORY_PAGE_SIZE))
    : query(ordersRef(), ...clauses);
  const snap = await getDocs(q);
  const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const lastClosedAt = orders.length > 0 ? orders[orders.length - 1].closedAt : null;
  return { orders, lastClosedAt, hasMore: orders.length === HISTORY_PAGE_SIZE };
}
