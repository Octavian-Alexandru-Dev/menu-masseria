// Visits to the public menu, per day (menuViews/{YYYY-MM-DD}: { count }),
// shown in Statistiche (TillStats.jsx). A visit = a phone/browser opening
// the menu on a given day: the same device counts once a day, however many
// times it reloads (a marker in its localStorage). Nothing personal is
// stored — no cookie, no id, no IP: just one number per day.
//
// Not counted: devices used by the staff (a staff account signed in here at
// least once, lastStaffAccount.js), the till client, the printable menu.
//
// firestore.rules: anyone may only add 1 to a day (or start it at 1);
// only staff can read. A determined person could still inflate the number
// one visit at a time — it's an indicator, not an accounting figure.
import { doc, setDoc, increment, query, where, getDocs, collection, documentId } from "firebase/firestore";
import { db } from "./firebase-db";
import { getLastStaffAccount } from "./lastStaffAccount";
import { getDesktopBridge } from "./desktop";

const SEEN_KEY = "mdp.menuViewDay";

// Local calendar day ("YYYY-MM-DD"), never UTC (same as statsData.js).
export function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Called once when the public menu opens. Never throws: counting must never
// get in the way of showing the menu.
export async function recordMenuView(now = new Date()) {
  try {
    if (getDesktopBridge() || getLastStaffAccount()) return;
    const today = dayKey(now);
    if (localStorage.getItem(SEEN_KEY) === today) return;
    localStorage.setItem(SEEN_KEY, today);
    await setDoc(doc(db, "menuViews", today), { count: increment(1) }, { merge: true });
  } catch (err) {
    console.warn("[menu] Visita non registrata:", err?.code || err);
  }
}

// Visits per day between two dates (local days, both included), as
// [{ day: "YYYY-MM-DD", date: Date, count }] for every day — 0 included.
export async function fetchMenuViews(start, end) {
  const from = dayKey(start);
  const to = dayKey(end);
  const snap = await getDocs(query(collection(db, "menuViews"), where(documentId(), ">=", from), where(documentId(), "<=", to)));
  const counts = Object.fromEntries(snap.docs.map((d) => [d.id, d.data().count || 0]));
  const days = [];
  for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); dayKey(d) <= to; d.setDate(d.getDate() + 1)) {
    days.push({ day: dayKey(d), date: new Date(d), count: counts[dayKey(d)] || 0 });
  }
  return days;
}

// The days grouped for the chart: one bar a day up to ~2 months, then one a
// month (a year of days would be 365 unreadable bars on a phone).
export function groupMenuViews(days) {
  const total = days.reduce((s, d) => s + d.count, 0);
  const avgPerDay = days.length ? total / days.length : 0;
  const best = days.reduce((b, d) => (d.count > (b?.count ?? 0) ? d : b), null);
  if (days.length <= 62) return { total, avgPerDay, best, unit: "day", bars: days.map((d) => ({ key: d.day, date: d.date, count: d.count })) };
  const months = new Map();
  for (const d of days) {
    const key = d.day.slice(0, 7);
    if (!months.has(key)) months.set(key, { key, date: new Date(d.date.getFullYear(), d.date.getMonth(), 1), count: 0 });
    months.get(key).count += d.count;
  }
  return { total, avgPerDay, best, unit: "month", bars: [...months.values()] };
}
