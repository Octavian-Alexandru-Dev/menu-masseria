// Livello dati della Dashboard statistiche (src/Stats.jsx): lettura delle
// comande chiuse da Firestore + tutta l'aggregazione (pura, senza I/O).
// Stessa separazione dati/UI di orders.js e reservationsData.js.
import { query, where, orderBy, limit, startAfter, getDocs, Timestamp } from "firebase/firestore";
import { ordersRef, orderTotalCents } from "./orders";
import { parsePriceToCents } from "./shared";

/* ============================ RANGE TEMPORALI ============================ */

export const PRESETS = ["today", "yesterday", "last7days", "lastMonth", "currentMonth", "currentYear", "custom"];

export const PRESET_LABELS = {
  today: "Oggi",
  yesterday: "Ieri",
  last7days: "Ultimi 7 giorni",
  lastMonth: "Ultimi 30 giorni",
  currentMonth: "Mese corrente",
  currentYear: "Anno corrente",
  custom: "Personalizzato",
};

function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d) {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

// Confini sempre in ora locale (mai UTC — stesso principio di dateKey() in
// reservationsData.js): un turno serale che passa la mezzanotte UTC ma non
// quella locale non deve finire nel giorno sbagliato.
export function resolvePresetRange(preset, { customStart, customEnd } = {}) {
  const now = new Date();
  switch (preset) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { start: startOfDay(y), end: endOfDay(y) };
    }
    case "last7days": {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { start: startOfDay(from), end: endOfDay(now) };
    }
    case "lastMonth": {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      return { start: startOfDay(from), end: endOfDay(now) };
    }
    case "currentMonth":
      return { start: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), end: endOfDay(now) };
    case "currentYear":
      return { start: startOfDay(new Date(now.getFullYear(), 0, 1)), end: endOfDay(now) };
    case "custom":
      return {
        start: startOfDay(customStart ? new Date(customStart) : now),
        end: endOfDay(customEnd ? new Date(customEnd) : now),
      };
    default:
      return { start: startOfDay(now), end: endOfDay(now) };
  }
}

// Range immediatamente precedente, stessa durata (in giorni) del range dato
// — default di "Periodo A" quando si attiva il confronto tra periodi.
export function previousEquivalentRange(start, end) {
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { start: startOfDay(prevStart), end: endOfDay(prevEnd) };
}

/* ============================== LETTURA DATI ============================== */

// Comande chiuse o auto-chiuse con closedAt in [start, end] (estremi
// inclusi). Un ordine "open" ha closedAt: null, che Firestore non fa mai
// combaciare con un filtro >=/<= su Timestamp, quindi non serve un filtro
// status esplicito. closedAt >= / closedAt <= / orderBy(closedAt) restano
// sullo STESSO campo → nessun indice composito necessario (stesso principio
// di subscribeShiftClosedOrders/loadClosedOrdersPage in orders.js).
// Paginazione interna di sicurezza per range molto ampi: inutile al volume
// attuale (poche decine di comande/giorno) ma evita di dover riscrivere la
// funzione se il volume crescesse molto.
const RANGE_PAGE_SIZE = 500;

export async function fetchClosedOrdersInRange(start, end) {
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);
  let cursor = null;
  const all = [];
  for (;;) {
    const clauses = [
      where("closedAt", ">=", startTs),
      where("closedAt", "<=", endTs),
      orderBy("closedAt", "asc"),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(RANGE_PAGE_SIZE),
    ];
    const snap = await getDocs(query(ordersRef(), ...clauses));
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    all.push(...docs);
    if (docs.length < RANGE_PAGE_SIZE) break;
    cursor = docs[docs.length - 1].closedAt;
  }
  return all;
}

/* ============================== AGGREGAZIONE ============================== */

const TOP_N = 10;
const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

// Chiave di raggruppamento piatto: preferisce menuItemId (stabile anche se il
// piatto viene rinominato), altrimenti il nome come snapshot — non interroga
// mai il menù corrente, coerente con lo snapshot già salvato su ogni riga.
function dishKey(line) {
  return line.menuItemId ? `id:${line.menuItemId}` : `name:${line.name}`;
}

function emptyDishStat(line) {
  return { key: dishKey(line), name: line.name, categoryName: line.categoryName || "Altro", qty: 0, revenueCents: 0, marginCents: 0, qtyWithKnownCost: 0 };
}

function weekdayIndexMonFirst(date) {
  return (date.getDay() + 6) % 7; // getDay(): 0=domenica → 0=lunedì
}

// orders: array grezzo da fetchClosedOrdersInRange. includeAutoClosed=false
// esclude gli status "auto_closed" — ricalcolo puro, nessuna nuova query.
export function aggregateOrders(orders, { includeAutoClosed = true } = {}) {
  const autoClosedCount = orders.filter((o) => o.status === "auto_closed").length;
  const included = includeAutoClosed ? orders : orders.filter((o) => o.status !== "auto_closed");

  let revenueCents = 0;
  let coversCount = 0;
  let dishesCount = 0;
  // Margine: solo sulle righe con un costo fotografato (line.cost, vedi
  // buildOrderLine in orders.js) — mai sul coperto, che non ha un concetto
  // di costo del piatto. itemsRevenueCents (tutte le righe) vs
  // marginRevenueCents (solo quelle con costo noto) danno la % di copertura:
  // se un piatto non ha un costo impostato in Gestione menù, o la comanda è
  // precedente all'introduzione di questo campo, quella riga viene esclusa
  // dal margine invece di essere trattata come margine zero.
  let itemsRevenueCents = 0;
  let marginCents = 0;
  let marginRevenueCents = 0;
  const dishByKey = new Map();
  const categoryByName = new Map();
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, ordersCount: 0, revenueCents: 0 }));
  const weekday = WEEKDAY_LABELS.map((label, idx) => ({ weekday: idx, label, ordersCount: 0, revenueCents: 0 }));
  const waiterByName = new Map();

  for (const order of included) {
    const orderRevenue = orderTotalCents(order);
    revenueCents += orderRevenue;
    coversCount += (order.covers?.adults || 0) + (order.covers?.children || 0);

    const waiterName = order.waiterName || "—";
    if (!waiterByName.has(waiterName)) waiterByName.set(waiterName, { waiterName, ordersCount: 0, coversCount: 0, revenueCents: 0 });
    const waiterEntry = waiterByName.get(waiterName);
    waiterEntry.ordersCount += 1;
    waiterEntry.coversCount += (order.covers?.adults || 0) + (order.covers?.children || 0);
    waiterEntry.revenueCents += orderRevenue;

    const openedAtDate = order.openedAt?.toDate ? order.openedAt.toDate() : null;
    if (openedAtDate) {
      hourly[openedAtDate.getHours()].ordersCount += 1;
      hourly[openedAtDate.getHours()].revenueCents += orderRevenue;
      const wIdx = weekdayIndexMonFirst(openedAtDate);
      weekday[wIdx].ordersCount += 1;
      weekday[wIdx].revenueCents += orderRevenue;
    }

    for (const line of order.items || []) {
      const lineRevenue = parsePriceToCents(line.price) * line.quantity;
      dishesCount += line.quantity;
      itemsRevenueCents += lineRevenue;

      const key = dishKey(line);
      if (!dishByKey.has(key)) dishByKey.set(key, emptyDishStat(line));
      const dishEntry = dishByKey.get(key);
      dishEntry.qty += line.quantity;
      dishEntry.revenueCents += lineRevenue;
      // Nome/categoria aggiornati all'occorrenza più recente vista (per riga
      // più recente, coerente con lo snapshot al momento dell'ordine se il
      // piatto è stato rinominato durante il range).
      dishEntry.name = line.name;
      dishEntry.categoryName = line.categoryName || "Altro";

      const catName = line.categoryName || "Altro";
      if (!categoryByName.has(catName)) categoryByName.set(catName, { categoryName: catName, qty: 0, revenueCents: 0, marginCents: 0 });
      const catEntry = categoryByName.get(catName);
      catEntry.qty += line.quantity;
      catEntry.revenueCents += lineRevenue;

      if (line.cost != null) {
        const lineMargin = lineRevenue - parsePriceToCents(line.cost) * line.quantity;
        dishEntry.marginCents += lineMargin;
        dishEntry.qtyWithKnownCost += line.quantity;
        catEntry.marginCents += lineMargin;
        marginCents += lineMargin;
        marginRevenueCents += lineRevenue;
      }
    }
  }

  const dishStats = Array.from(dishByKey.values());
  const topDishesByQty = [...dishStats].sort((a, b) => b.qty - a.qty).slice(0, TOP_N);
  const topDishesByRevenue = [...dishStats].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, TOP_N);
  // Esclude i piatti senza alcun costo noto: mostrarli a margine 0 sarebbe
  // fuorviante (sembrerebbero i piatti meno profittevoli, mentre in realtà
  // manca solo il dato in Gestione menù).
  const topDishesByMargin = dishStats.filter((d) => d.qtyWithKnownCost > 0).sort((a, b) => b.marginCents - a.marginCents).slice(0, TOP_N);
  const categoryBreakdown = Array.from(categoryByName.values()).sort((a, b) => b.revenueCents - a.revenueCents);
  const perWaiter = Array.from(waiterByName.values())
    .map((w) => ({ ...w, avgReceiptCents: w.ordersCount > 0 ? Math.round(w.revenueCents / w.ordersCount) : 0 }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  const ordersCount = included.length;
  return {
    ordersCount,
    autoClosedCount,
    revenueCents,
    coversCount,
    avgReceiptCents: ordersCount > 0 ? Math.round(revenueCents / ordersCount) : 0,
    avgPerCoverCents: coversCount > 0 ? Math.round(revenueCents / coversCount) : 0,
    dishesCount,
    dishStats,
    topDishesByQty,
    topDishesByRevenue,
    topDishesByMargin,
    categoryBreakdown,
    hourlyDistribution: hourly,
    weekdayDistribution: weekday,
    perWaiter,
    itemsRevenueCents,
    marginCents,
    marginRevenueCents,
    // Quota di incasso piatti/bevande coperta da un costo noto (0..1, null se
    // non ci sono piatti nel periodo) — usata in UI per segnalare quando il
    // margine è calcolato solo su una parte dell'incasso.
    marginCoverage: itemsRevenueCents > 0 ? marginRevenueCents / itemsRevenueCents : null,
  };
}

function delta(a, b) {
  const d = b - a;
  // a===0: una percentuale finita non ha senso (crescita "da zero") — usare
  // Infinity per farlo distinguere in UI da un vero 0% (nessuna variazione).
  const deltaPct = a > 0 ? d / a : b > 0 ? Infinity : 0;
  return { a, b, delta: d, deltaPct };
}

// Unico meccanismo di confronto: usato sia per il confronto libero tra due
// periodi scelti dall'utente, sia per individuare i piatti in calo (in quel
// caso aggA è di default previousEquivalentRange(...) del periodo B).
export function compareAggregates(aggA, aggB) {
  const kpi = {
    revenueCents: delta(aggA.revenueCents, aggB.revenueCents),
    avgReceiptCents: delta(aggA.avgReceiptCents, aggB.avgReceiptCents),
    coversCount: delta(aggA.coversCount, aggB.coversCount),
    ordersCount: delta(aggA.ordersCount, aggB.ordersCount),
    dishesCount: delta(aggA.dishesCount, aggB.dishesCount),
    marginCents: delta(aggA.marginCents, aggB.marginCents),
  };

  const dishKeys = new Set([...aggA.dishStats.map((d) => d.key), ...aggB.dishStats.map((d) => d.key)]);
  const dishByKeyA = new Map(aggA.dishStats.map((d) => [d.key, d]));
  const dishByKeyB = new Map(aggB.dishStats.map((d) => [d.key, d]));
  const dishDeltas = Array.from(dishKeys, (key) => {
    const a = dishByKeyA.get(key);
    const b = dishByKeyB.get(key);
    const name = (b || a).name;
    const categoryName = (b || a).categoryName;
    return {
      key, name, categoryName,
      qtyA: a?.qty || 0, qtyB: b?.qty || 0, qtyDelta: (b?.qty || 0) - (a?.qty || 0),
      revenueA: a?.revenueCents || 0, revenueB: b?.revenueCents || 0, revenueDelta: (b?.revenueCents || 0) - (a?.revenueCents || 0),
    };
  }).sort((x, y) => x.qtyDelta - y.qtyDelta);

  const catNames = new Set([...aggA.categoryBreakdown.map((c) => c.categoryName), ...aggB.categoryBreakdown.map((c) => c.categoryName)]);
  const catByNameA = new Map(aggA.categoryBreakdown.map((c) => [c.categoryName, c]));
  const catByNameB = new Map(aggB.categoryBreakdown.map((c) => [c.categoryName, c]));
  const categoryDeltas = Array.from(catNames, (categoryName) => ({
    categoryName,
    revenueA: catByNameA.get(categoryName)?.revenueCents || 0,
    revenueB: catByNameB.get(categoryName)?.revenueCents || 0,
    revenueDelta: (catByNameB.get(categoryName)?.revenueCents || 0) - (catByNameA.get(categoryName)?.revenueCents || 0),
  })).sort((x, y) => y.revenueB - x.revenueB);

  const waiterNames = new Set([...aggA.perWaiter.map((w) => w.waiterName), ...aggB.perWaiter.map((w) => w.waiterName)]);
  const waiterByNameA = new Map(aggA.perWaiter.map((w) => [w.waiterName, w]));
  const waiterByNameB = new Map(aggB.perWaiter.map((w) => [w.waiterName, w]));
  const waiterDeltas = Array.from(waiterNames, (waiterName) => ({
    waiterName,
    revenueA: waiterByNameA.get(waiterName)?.revenueCents || 0,
    revenueB: waiterByNameB.get(waiterName)?.revenueCents || 0,
    revenueDelta: (waiterByNameB.get(waiterName)?.revenueCents || 0) - (waiterByNameA.get(waiterName)?.revenueCents || 0),
  })).sort((x, y) => y.revenueB - x.revenueB);

  return { kpi, dishDeltas, categoryDeltas, waiterDeltas };
}
