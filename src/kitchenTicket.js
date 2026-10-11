// Kitchen ticket ("comanda" printed for the kitchen) — what goes on it.
//
// When someone presses "Invia comanda" (a waiter's phone or the till), the
// lines just sent are printed at the till's thermal printer, to be hung on
// the kitchen board. Only dishes flagged "In comanda" in Gestione menù are
// printed: drinks, for instance, are served by the dining room and would only
// waste paper.
//
// Pure functions (no Firestore, no DOM), testable from Node; the ESC/POS
// layout is in escpos.js > buildKitchenTicket, the queue in printJobs.js.

// Menu item flag `kitchenTicket`: missing = true. Every dish already in the
// menu keeps being printed until someone turns it off — better a drink
// printed by mistake than a dish the kitchen never hears about.
export function itemGoesToKitchen(item) {
  return item?.kitchenTicket !== false;
}

// Default for a new dish: like the rest of its category (a new drink in
// "Bevande", where nothing is printed, starts off too).
export function defaultKitchenTicketForCategory(category) {
  const items = category?.items || [];
  if (items.length === 0) return true;
  return items.some(itemGoesToKitchen);
}

function menuItemIndex(menu) {
  const byId = new Map();
  const categoryOrder = new Map();
  (menu?.categories || []).forEach((c, i) => {
    categoryOrder.set(c.id, i);
    c.items.forEach((it) => byId.set(it.id, it));
  });
  return { byId, categoryOrder };
}

// A sent line goes to the kitchen when its menu item is flagged; a line whose
// dish no longer exists in the menu is printed (same "better too much" rule).
export function lineGoesToKitchen(line, menu, index = menuItemIndex(menu)) {
  const item = line.menuItemId ? index.byId.get(line.menuItemId) : null;
  return item ? itemGoesToKitchen(item) : true;
}

function coversText(order) {
  const adults = order.covers?.adults || 0;
  const children = order.covers?.children || 0;
  const total = adults + children;
  if (!total) return "";
  if (!children) return `${total} ${total === 1 ? "coperto" : "coperti"}`;
  return `${total} coperti (${children} bamb.)`;
}

// Snapshot printed by the station. `order` is the order as it was BEFORE
// these lines were sent: if it already had kitchen lines, this ticket is an
// addition ("AGGIUNTA") to one already on the board.
// senderName: who pressed "Invia comanda" (may not be who opened the table).
// Returns null when none of the lines goes to the kitchen (nothing to print).
export function buildKitchenTicketPayload(order, lines, menu, { now = new Date(), senderName = "" } = {}) {
  const index = menuItemIndex(menu);
  const kitchenLines = (lines || []).filter((l) => lineGoesToKitchen(l, menu, index));
  if (kitchenLines.length === 0) return null;

  const groups = [];
  const sorted = [...kitchenLines].sort((a, b) => {
    const ia = index.categoryOrder.get(a.categoryId) ?? Number.MAX_SAFE_INTEGER;
    const ib = index.categoryOrder.get(b.categoryId) ?? Number.MAX_SAFE_INTEGER;
    return ia - ib;
  });
  for (const l of sorted) {
    const last = groups[groups.length - 1];
    const entry = { quantity: l.quantity, name: l.name, notes: l.notes || "" };
    if (last && last.categoryId === (l.categoryId || null)) last.lines.push(entry);
    else groups.push({ categoryId: l.categoryId || null, categoryName: l.categoryName || "", lines: [entry] });
  }

  const addition = (order.items || []).some((l) => lineGoesToKitchen(l, menu, index));
  return {
    // Same field as the receipt's, so tools that look up a table's print
    // jobs (and the tests' cleanup) treat both kinds alike.
    tableLabel: order.tableName ? `${order.tableName} (Tavolo ${order.tableNumber})` : `Tavolo ${order.tableNumber}`,
    tableNumber: order.tableNumber ?? null,
    tableName: order.tableName || "",
    covers: coversText(order),
    timeLabel: now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
    waiterName: senderName || order.waiterName || "",
    tableNotes: order.notes || "",
    addition,
    groups: groups.map(({ categoryName, lines: ls }) => ({ categoryName, lines: ls })),
  };
}
