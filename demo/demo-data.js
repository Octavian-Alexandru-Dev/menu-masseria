// Qualche tavolo aperto e qualche prenotazione per oggi, così le GIF non
// mostrano una sala vuota. Scritti direttamente sull'emulatore (stessa
// forma dei documenti creati dall'app: orders.js, reservationsData.js);
// l'emulatore viene buttato a fine registrazione insieme a questi dati.
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { TEST_WAITER } from "../tests/test-env.js";
import { auth, db } from "../tests/helpers/emulatorApp.js";

const minutesAgo = (m) => Timestamp.fromMillis(Date.now() - m * 60_000);

function line(id, menuItemId, name, price, quantity, categoryId, categoryName, sentMinutesAgo) {
  return { lineId: id, menuItemId, name, price, quantity, categoryId, categoryName, notes: "", cost: null, status: "sent", sentAt: minutesAgo(sentMinutesAgo), outAt: null };
}

function localDateKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TABLES = [
  { id: "demo-t3", tableNumber: 3, adults: 2, openedMinutesAgo: 40, items: [
    line("d1", "item-bruschetta", "Bruschetta", "6,00", 2, "cat-antipasti", "Antipasti", 35),
    line("d2", "item-orecchiette", "Orecchiette", "10,00", 2, "cat-primi", "Primi", 20),
    line("d3", "item-vino-casa", "Vino della casa", "12,00", 1, "cat-bevande", "Bevande", 35),
  ] },
  { id: "demo-t5", tableNumber: 5, adults: 4, openedMinutesAgo: 15, items: [
    line("d1", "item-caprese", "Caprese", "7,00", 4, "cat-antipasti", "Antipasti", 10),
    line("d2", "item-acqua", "Acqua naturale", "2,00", 2, "cat-bevande", "Bevande", 10),
  ] },
  { id: "demo-t8", tableNumber: 8, adults: 2, openedMinutesAgo: 5, items: [] },
];

const RESERVATIONS = [
  { id: "demo-r1", time: "20:00", name: "Famiglia Bianchi", adults: 4, children: 2, status: "confirmed" },
  { id: "demo-r2", time: "20:30", name: "Marco Esposito", adults: 2, children: 0, status: "pending" },
  { id: "demo-r3", time: "21:15", name: "Giulia Romano", adults: 6, children: 0, status: "confirmed" },
];

export async function seedDemoData() {
  const { user } = await signInWithEmailAndPassword(auth, TEST_WAITER.email, TEST_WAITER.password);
  const waiter = { waiterUid: user.uid, waiterName: "Cameriere di test" };
  await Promise.all(TABLES.map((t) => setDoc(doc(db, "orders", t.id), {
    tableNumber: t.tableNumber, tableName: "", covers: { adults: t.adults, children: 0 },
    coperto: { adults: "2,00", children: "1,00" }, notes: "", ...waiter, status: "open",
    openedAt: minutesAgo(t.openedMinutesAgo), closedAt: null, expireAt: null, items: t.items,
  })));
  await Promise.all(RESERVATIONS.map((r) => setDoc(doc(db, "reservations", r.id), {
    date: localDateKey(), time: r.time, name: r.name, phone: "", covers: { adults: r.adults, children: r.children },
    notes: "", tableNumber: null, status: r.status,
    createdBy: { uid: user.uid, name: waiter.waiterName }, createdAt: minutesAgo(120),
    confirmedBy: r.status === "confirmed" ? { uid: user.uid, name: waiter.waiterName } : null,
    confirmedAt: r.status === "confirmed" ? minutesAgo(100) : null,
    rejectedBy: null, rejectedAt: null, cancelledBy: null, cancelledAt: null, noShowAt: null,
    orderId: null, startedAt: null, expireAt: null,
  })));
}
