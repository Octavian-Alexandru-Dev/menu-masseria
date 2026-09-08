// Data layer for the statistics Dashboard (src/Stats.jsx): reads closed
// orders from Firestore + all the aggregation (pure, no I/O). Same
// data/UI separation as orders.js and reservationsData.js.
import { query, where, orderBy, limit, startAfter, getDocs, Timestamp } from "firebase/firestore";
import { ordersRef, orderTotalCents } from "./orders";
import { parsePriceToCents } from "./shared";

/* ============================ TIME RANGES ============================ */

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

// Boundaries always in local time (never UTC — same principle as dateKey()
// in reservationsData.js): an evening shift crossing UTC midnight but not
// local midnight must not end up in the wrong day.
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

// The immediately preceding range, same duration (in days) as the given
// range — default for "Periodo A" when period comparison is enabled.
export function previousEquivalentRange(start, end) {
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { start: startOfDay(prevStart), end: endOfDay(prevEnd) };
}

/* ============================== DATA READS ============================== */

// Orders closed or auto-closed with closedAt in [start, end] (inclusive). An
// "open" order has closedAt: null, which Firestore never matches against a
// >=/<= filter on a Timestamp, so no explicit status filter is needed.
// closedAt >= / closedAt <= / orderBy(closedAt) all stay on the SAME field →
// no composite index needed (same principle as
// subscribeShiftClosedOrders/loadClosedOrdersPage in orders.js).
// Internal safety pagination for very wide ranges: unnecessary at current
// volume (a few dozen orders/day) but avoids having to rewrite the function
// if volume grows a lot.
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

/* ============================== AGGREGATION ============================== */

const TOP_N = 10;
const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

// Dish grouping key: prefers menuItemId (stable even if the dish is
// renamed), otherwise the name as a snapshot — never queries the current
// menu, consistent with the snapshot already saved on each line.
function dishKey(line) {
  return line.menuItemId ? `id:${line.menuItemId}` : `name:${line.name}`;
}

function emptyDishStat(line) {
  return { key: dishKey(line), name: line.name, categoryName: line.categoryName || "Altro", qty: 0, revenueCents: 0, marginCents: 0, qtyWithKnownCost: 0 };
}

function weekdayIndexMonFirst(date) {
  return (date.getDay() + 6) % 7; // getDay(): 0=Sunday → 0=Monday
}

// orders: raw array from fetchClosedOrdersInRange. includeAutoClosed=false
// excludes "auto_closed" statuses — pure recomputation, no new query.
export function aggregateOrders(orders, { includeAutoClosed = true } = {}) {
  const autoClosedCount = orders.filter((o) => o.status === "auto_closed").length;
  const included = includeAutoClosed ? orders : orders.filter((o) => o.status !== "auto_closed");

  let revenueCents = 0;
  let coversCount = 0;
  let dishesCount = 0;
  // Margin: only on lines with a snapshotted cost (line.cost, see
  // buildOrderLine in orders.js) — never on the cover charge, which has no
  // notion of dish cost. itemsRevenueCents (all lines) vs
  // marginRevenueCents (only those with a known cost) give the coverage %:
  // if a dish has no cost set in Gestione menù, or the order predates this
  // field, that line is excluded from the margin instead of being treated
  // as zero margin.
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
      // Name/category updated to the most recent occurrence seen (most
      // recent line, consistent with the snapshot at order time if the
      // dish was renamed during the range).
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
  // Excludes dishes with no known cost at all: showing them at zero margin
  // would be misleading (they'd look like the least profitable dishes, when
  // really the data is just missing in Gestione menù).
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
    // Share of dish/drink revenue covered by a known cost (0..1, null if
    // there are no dishes in the period) — used in the UI to flag when the
    // margin is only computed on part of the revenue.
    marginCoverage: itemsRevenueCents > 0 ? marginRevenueCents / itemsRevenueCents : null,
  };
}

function delta(a, b) {
  const d = b - a;
  // a===0: a finite percentage doesn't make sense ("growth from zero") — use
  // Infinity so the UI can tell it apart from an actual 0% (no change).
  const deltaPct = a > 0 ? d / a : b > 0 ? Infinity : 0;
  return { a, b, delta: d, deltaPct };
}

// The single comparison mechanism: used both for a free comparison between
// two user-chosen periods, and to find declining dishes (in that case aggA
// defaults to previousEquivalentRange(...) of period B).
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
