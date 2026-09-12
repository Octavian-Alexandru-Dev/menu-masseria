// The actions the chatbot can actually perform, and the guardrails around
// them. Every tool call from the model is re-validated here against the
// real current Firestore state before anything is written — a hallucinated
// itemId/tableNumber is rejected with a message the bot relays back,
// instead of silently writing bad data (see docs/telegram-bot.md
// "Validazione e conferme").
//
// Writes mirror the exact document shapes src/orders.js and MenuApp.jsx
// already produce (see docs/data-model.md), so Waiter/Kitchen/Stats treat a
// bot-created order line or menu edit identically to one made from the UI.
import { getDocument, patchDocument, createDocument, queryEquals } from "./firestoreRest.js";

export class ToolError extends Error {}

const PRICE_RE = /^\d+(,\d{2})?$/;

/* ------------------------------ tool schemas ------------------------------ */
// OpenAI-style function-calling schema, as Groq's chat completions API
// expects it (see groq.js).

const SCHEMAS = {
  hide_menu_item: {
    type: "function",
    function: {
      name: "hide_menu_item",
      description:
        "Nasconde un piatto dal menù pubblico (resta nello storico ordini, si può sempre rimostrare). Usa questo quando ti viene chiesto di togliere, nascondere o rimuovere un piatto dal menù.",
      parameters: {
        type: "object",
        properties: {
          categoryId: { type: "string", description: "id esatto della categoria, dalla lista fornita" },
          itemId: { type: "string", description: "id esatto del piatto, dalla lista fornita" },
        },
        required: ["categoryId", "itemId"],
      },
    },
  },
  show_menu_item: {
    type: "function",
    function: {
      name: "show_menu_item",
      description: "Rende di nuovo visibile sul menù pubblico un piatto precedentemente nascosto.",
      parameters: {
        type: "object",
        properties: {
          categoryId: { type: "string", description: "id esatto della categoria, dalla lista fornita" },
          itemId: { type: "string", description: "id esatto del piatto, dalla lista fornita" },
        },
        required: ["categoryId", "itemId"],
      },
    },
  },
  update_menu_item_price: {
    type: "function",
    function: {
      name: "update_menu_item_price",
      description: "Cambia il prezzo di un piatto del menù.",
      parameters: {
        type: "object",
        properties: {
          categoryId: { type: "string", description: "id esatto della categoria, dalla lista fornita" },
          itemId: { type: "string", description: "id esatto del piatto, dalla lista fornita" },
          newPrice: { type: "string", description: 'nuovo prezzo in formato italiano, es. "12,50"' },
        },
        required: ["categoryId", "itemId", "newPrice"],
      },
    },
  },
  open_table: {
    type: "function",
    function: {
      name: "open_table",
      description:
        "Apre un nuovo tavolo (comanda). Necessario prima di poter aggiungere piatti con add_order_items, se il tavolo non è già aperto.",
      parameters: {
        type: "object",
        properties: {
          tableNumber: { type: "integer" },
          adults: { type: "integer", description: "numero di adulti, per il coperto" },
          children: { type: "integer", description: "numero di bambini, per il coperto (0 se non specificato)" },
        },
        required: ["tableNumber", "adults"],
      },
    },
  },
  add_order_items: {
    type: "function",
    function: {
      name: "add_order_items",
      description:
        "Aggiunge una o più righe alla comanda di un tavolo GIÀ APERTO. Se il tavolo non è aperto, questo strumento fallisce: chiedi prima di aprirlo con open_table.",
      parameters: {
        type: "object",
        properties: {
          tableNumber: { type: "integer" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                categoryId: { type: "string", description: "id esatto della categoria, dalla lista fornita" },
                itemId: { type: "string", description: "id esatto del piatto, dalla lista fornita" },
                quantity: { type: "integer" },
                notes: { type: "string", description: 'es. "senza cipolla" — vuoto se non specificato' },
              },
              required: ["categoryId", "itemId", "quantity"],
            },
          },
        },
        required: ["tableNumber", "items"],
      },
    },
  },
  close_table: {
    type: "function",
    function: {
      name: "close_table",
      description: "Chiude un tavolo già aperto (fine servizio per quel tavolo).",
      parameters: {
        type: "object",
        properties: { tableNumber: { type: "integer" } },
        required: ["tableNumber"],
      },
    },
  },
};

const ROLE_TOOLS = {
  admin: Object.keys(SCHEMAS),
  waiter: ["open_table", "add_order_items", "close_table"],
  kitchen: [],
};

// Tools whose effect is either customer-facing (menu changes) or hard to
// walk back in the moment (closing a table cuts off further order lines) —
// these ask for an explicit "sì" before executing (see index.js's
// pending-confirmation flow). Adding items / opening a table are left
// frictionless: they're exactly as reversible as a waiter's own taps in the
// existing UI (a line can be removed, a table stays open).
export const DESTRUCTIVE_TOOLS = new Set(["hide_menu_item", "update_menu_item_price", "close_table"]);

export function getToolsForRole(role) {
  return (ROLE_TOOLS[role] || []).map((name) => SCHEMAS[name]);
}

/* ------------------------------ context builders --------------------------- */

export function buildMenuContext(menu) {
  const categories = (menu?.categories || []).map((c) => ({
    categoryId: c.id,
    name: c.name,
    items: (c.items || []).map((i) => ({ itemId: i.id, name: i.name, price: i.price, visible: i.visible !== false })),
  }));
  return JSON.stringify(categories);
}

export function buildOpenOrdersContext(openOrders) {
  const tables = openOrders.map((o) => ({
    tableNumber: o.tableNumber,
    covers: o.covers,
    itemCount: (o.items || []).length,
  }));
  return JSON.stringify(tables);
}

export function buildSystemPrompt({ role, staffName, menuContextJson, openOrdersContextJson }) {
  return [
    `Sei l'assistente di gestione di un ristorante, usato via chat da ${staffName} (ruolo: ${role}).`,
    "Il tuo unico compito è capire il comando e, se possibile, chiamare esattamente UNO degli strumenti disponibili con i parametri corretti.",
    "Usa sempre e solo gli id (categoryId/itemId) presenti nell'elenco qui sotto: non inventare mai un id.",
    "Se il comando è ambiguo (es. più piatti con nomi simili) o manca un'informazione necessaria, NON chiamare nessuno strumento: rispondi con una singola domanda di chiarimento.",
    "Se il comando non corrisponde a nessuna azione disponibile, rispondi spiegando brevemente cosa puoi fare.",
    "Rispondi sempre in italiano, in modo breve e diretto.",
    "",
    `Menù attuale (categoryId, itemId, nome, prezzo, visibile): ${menuContextJson}`,
    `Tavoli aperti ora: ${openOrdersContextJson}`,
  ].join("\n");
}

// Human-readable Italian sentence describing a not-yet-executed tool call,
// used only for the confirmation prompt on DESTRUCTIVE_TOOLS (index.js) —
// looks up real dish names from the already-fetched menu instead of
// surfacing raw ids to the person confirming.
export function describeToolCall(menu, name, args) {
  const itemName = (categoryId, itemId) => {
    const category = (menu?.categories || []).find((c) => c.id === categoryId);
    const item = category?.items?.find((i) => i.id === itemId);
    return item ? item.name : itemId;
  };
  switch (name) {
    case "hide_menu_item":
      return `nascondere dal menù "${itemName(args.categoryId, args.itemId)}"`;
    case "show_menu_item":
      return `rendere di nuovo visibile "${itemName(args.categoryId, args.itemId)}"`;
    case "update_menu_item_price":
      return `cambiare il prezzo di "${itemName(args.categoryId, args.itemId)}" a €${args.newPrice}`;
    case "close_table":
      return `chiudere il tavolo ${args.tableNumber}`;
    default:
      return `eseguire ${name}`;
  }
}

/* --------------------------------- execution ------------------------------- */

function findMenuItem(menu, categoryId, itemId) {
  const category = (menu?.categories || []).find((c) => c.id === categoryId);
  if (!category) throw new ToolError(`Non trovo la categoria "${categoryId}" nel menù.`);
  const item = (category.items || []).find((i) => i.id === itemId);
  if (!item) throw new ToolError(`Non trovo il piatto "${itemId}" nella categoria "${category.name}".`);
  return { category, item };
}

async function findOpenOrder(env, tableNumber) {
  const matches = await queryEquals(
    env,
    "orders",
    [
      ["tableNumber", tableNumber],
      ["status", "open"],
    ],
    1
  );
  return matches[0] || null;
}

async function setItemVisibility(env, { categoryId, itemId }, visible) {
  const menu = await getDocument(env, "menu/data");
  if (!menu) throw new ToolError("Il menù non è stato trovato.");
  const { category, item } = findMenuItem(menu, categoryId, itemId);
  item.visible = visible;
  await patchDocument(env, "menu/data", { categories: menu.categories });
  return `${visible ? "Reso visibile" : "Nascosto"} "${item.name}" (${category.name}).`;
}

async function updateMenuItemPrice(env, { categoryId, itemId, newPrice }) {
  if (!PRICE_RE.test(newPrice)) {
    throw new ToolError(`Prezzo "${newPrice}" non valido: usa il formato italiano, es. "12,50".`);
  }
  const menu = await getDocument(env, "menu/data");
  if (!menu) throw new ToolError("Il menù non è stato trovato.");
  const { category, item } = findMenuItem(menu, categoryId, itemId);
  item.price = newPrice;
  await patchDocument(env, "menu/data", { categories: menu.categories });
  return `Prezzo di "${item.name}" (${category.name}) aggiornato a €${newPrice}.`;
}

async function openTable(env, { tableNumber, adults, children }, ctx) {
  const existing = await findOpenOrder(env, tableNumber);
  if (existing) throw new ToolError(`Il tavolo ${tableNumber} risulta già aperto.`);

  const menu = await getDocument(env, "menu/data");
  const coperto = menu?.coperto || {};

  await createDocument(env, "orders", {
    tableNumber,
    tableName: "",
    covers: { adults: adults || 0, children: children || 0 },
    coperto: { adults: coperto.adults || "0,00", children: coperto.children || "0,00" },
    notes: "",
    waiterUid: ctx.staffUid,
    waiterName: ctx.staffName,
    status: "open",
    openedAt: new Date(),
    closedAt: null,
    expireAt: null,
    items: [],
  });
  const childrenPart = children ? `, ${children} bambini` : "";
  return `Tavolo ${tableNumber} aperto (${adults || 0} adulti${childrenPart}).`;
}

async function addOrderItems(env, { tableNumber, items }) {
  if (!items || items.length === 0) throw new ToolError("Nessun piatto specificato.");

  const order = await findOpenOrder(env, tableNumber);
  if (!order) throw new ToolError(`Il tavolo ${tableNumber} non risulta aperto: aprilo prima con i coperti.`);

  const menu = await getDocument(env, "menu/data");
  if (!menu) throw new ToolError("Il menù non è stato trovato.");
  const menuCosts = (await getDocument(env, "menuCosts/data")) || {};

  const newLines = items.map(({ categoryId, itemId, quantity, notes }) => {
    const { category, item } = findMenuItem(menu, categoryId, itemId);
    return {
      lineId: crypto.randomUUID(),
      menuItemId: item.id,
      name: item.name,
      price: item.price,
      quantity: quantity || 1,
      categoryId: category.id,
      categoryName: category.name,
      notes: notes || "",
      cost: menuCosts[item.id] || null,
      status: "sent",
      sentAt: new Date(),
      outAt: null,
    };
  });

  await patchDocument(env, `orders/${order.id}`, { items: [...(order.items || []), ...newLines] });
  const summary = newLines.map((l) => `${l.quantity}x ${l.name}`).join(", ");
  return `Aggiunto al tavolo ${tableNumber}: ${summary}.`;
}

async function closeTable(env, { tableNumber }) {
  const order = await findOpenOrder(env, tableNumber);
  if (!order) throw new ToolError(`Il tavolo ${tableNumber} non risulta aperto.`);
  await patchDocument(env, `orders/${order.id}`, { status: "closed", closedAt: new Date(), expireAt: null });
  return `Tavolo ${tableNumber} chiuso.`;
}

// ctx: { staffUid, staffName }. Returns a human-readable Italian confirmation
// string on success; throws ToolError (message safe to relay to Telegram) or
// a generic Error (unexpected — the caller logs it and replies generically).
export async function executeTool(env, name, args, ctx) {
  switch (name) {
    case "hide_menu_item":
      return setItemVisibility(env, args, false);
    case "show_menu_item":
      return setItemVisibility(env, args, true);
    case "update_menu_item_price":
      return updateMenuItemPrice(env, args);
    case "open_table":
      return openTable(env, args, ctx);
    case "add_order_items":
      return addOrderItems(env, args);
    case "close_table":
      return closeTable(env, args);
    default:
      throw new ToolError(`Strumento sconosciuto: ${name}`);
  }
}
