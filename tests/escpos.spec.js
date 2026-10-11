import { test, expect } from "@playwright/test";
import {
  encodeText, wrapText, labelAmountLines, buildReceipt, buildKitchenTicket, grayToMonoBitmap, RECEIPT_COLUMNS,
} from "../src/escpos.js";
import { buildKitchenTicketPayload, defaultKitchenTicketForCategory } from "../src/kitchenTicket.js";

// Generatore ESC/POS dello scontrino (src/escpos.js), funzioni pure senza
// browser. I valori attesi sono quelli verificati sulla stampante vera
// (docs/stampa-scontrini.md): 42 colonne in Font A, code page CP858.

test("codifica accenti italiani ed euro in CP858", () => {
  expect(encodeText("àèéìòù€")).toEqual([0x85, 0x8a, 0x82, 0x8d, 0x95, 0x97, 0xd5]);
  // Caratteri tipografici senza posto in CP858: sostituiti, non "?".
  expect(String.fromCharCode(...encodeText("l’uovo – “ok”…"))).toBe("l'uovo - \"ok\"...");
  // Lettere accentate senza posto in CP858: lettera base.
  expect(String.fromCharCode(...encodeText("ő"))).toBe("o");
});

test("le emoji nelle note diventano '?' invece di caratteri a caso, e l'andare a capo conta ciò che si stampa", () => {
  // Prima un'emoji finiva come "<", "=" o ">" (byte alto della coppia surrogata).
  expect(String.fromCharCode(...encodeText("no 🥜 per favore 🌶️"))).toBe("no ? per favore ?");
  for (const l of wrapText("senza cipolla… né aglio… grazie mille…", 21)) {
    expect(encodeText(l).length).toBeLessThanOrEqual(21);
  }
});

test("nessuna riga supera la larghezza della carta", () => {
  for (const l of wrapText("Controlla il tuo conto e se trovi un errore, dillo a uno di noi.", RECEIPT_COLUMNS)) {
    expect(l.length).toBeLessThanOrEqual(RECEIPT_COLUMNS);
  }
  const lines = labelAmountLines("2x Tagliere di salumi e formaggi della casa con miele di castagno", "124,00 €");
  for (const l of lines) expect(l.length).toBeLessThanOrEqual(RECEIPT_COLUMNS);
  // L'importo resta sulla prima riga, allineato a destra.
  expect(lines[0].endsWith("124,00 €")).toBe(true);
  expect(lines.length).toBeGreaterThan(1);
});

test("lo scontrino contiene righe, totale, messaggio al cliente e taglio", () => {
  const bytes = buildReceipt({
    tableLabel: "Tavolo 7",
    dateLabel: "10/10/2026  21:34",
    lines: [{ quantity: 2, name: "Orecchiette", notes: "senza aglio", totalCents: 2400 }],
    coperto: { label: "Coperto x2", totalCents: 500 },
    totalCents: 2900,
  });
  const text = String.fromCharCode(...bytes);
  expect(text.startsWith("\x1b@\x1bt\x13")).toBe(true); // init + CP858
  expect(text).toContain("Preconto - Tavolo 7");
  expect(text).toContain("2x Orecchiette");
  expect(text).toContain("(senza aglio)");
  expect(text).toContain("Coperto x2");
  expect(text).toContain("TOTALE");
  expect(text).toContain("29,00 \xd5");
  expect(text).toContain("Qualcosa non torna?");
  expect(text).toContain("DOCUMENTO NON FISCALE");
  expect(text.endsWith("\x1dVB\x00")).toBe(true);
  // Senza logo: nome del locale in testo al suo posto.
  expect(text).toContain("Fattoria della Piana");
});

test("il logo diventa un raster ESC/POS largo quanto la carta", () => {
  const w = 16, h = 3;
  const gray = new Uint8Array(w * h).fill(255);
  gray.fill(0, 0, 8); // prima metà della prima riga nera
  const logo = grayToMonoBitmap(gray, w, h);
  expect(logo.bits[0]).toBe(0xff);
  expect(logo.bits[1]).toBe(0x00);
  const text = String.fromCharCode(...buildReceipt({ tableLabel: "T", lines: [], totalCents: 0 }, { logo }));
  // GS v 0, 64 byte per riga (512 punti), 3 righe.
  expect(text).toContain("\x1dv0\x00\x40\x00\x03\x00");
  expect(text).not.toContain("Fattoria della Piana");
});

/* ---------------------- comanda per la cucina (kitchenTicket.js) ---------------------- */

const KITCHEN_MENU = {
  categories: [
    { id: "cat-antipasti", name: "Antipasti", items: [{ id: "bru", name: "Bruschetta" }] },
    { id: "cat-primi", name: "Primi", items: [{ id: "ore", name: "Orecchiette alle cime di rapa con mollica", kitchenTicket: true }] },
    { id: "cat-bevande", name: "Bevande", items: [{ id: "acq", name: "Acqua", kitchenTicket: false }, { id: "vin", name: "Vino", kitchenTicket: false }] },
  ],
};
const line = (menuItemId, name, categoryId, categoryName, quantity = 1, notes = "") => ({ menuItemId, name, categoryId, categoryName, quantity, notes });

test("la comanda per la cucina contiene solo i piatti 'In comanda', nell'ordine del menù", () => {
  const order = { id: "o1", tableNumber: 12, tableName: "", covers: { adults: 3, children: 1 }, notes: "", waiterName: "Marco", items: [] };
  const payload = buildKitchenTicketPayload(order, [
    line("acq", "Acqua", "cat-bevande", "Bevande", 2),
    line("ore", "Orecchiette alle cime di rapa con mollica", "cat-primi", "Primi", 2, "senza glutine"),
    line("bru", "Bruschetta", "cat-antipasti", "Antipasti", 1),
    line("gone", "Piatto tolto dal menù", "cat-x", "Altro", 1),
  ], KITCHEN_MENU, { now: new Date(2026, 9, 10, 20, 41), senderName: "Cassa" });
  expect(payload.groups.map((g) => g.categoryName)).toEqual(["Antipasti", "Primi", "Altro"]);
  expect(JSON.stringify(payload)).not.toContain("Acqua");
  expect(payload.addition).toBe(false);
  expect(payload.covers).toBe("4 coperti (1 bamb.)");
  expect(payload.waiterName).toBe("Cassa");
  expect(payload.timeLabel).toBe("20:41");

  // Solo bevande: niente da stampare (nessuna richiesta accodata).
  expect(buildKitchenTicketPayload(order, [line("vin", "Vino", "cat-bevande", "Bevande")], KITCHEN_MENU)).toBeNull();
  // Il tavolo aveva già piatti per la cucina: è un'aggiunta.
  const again = buildKitchenTicketPayload({ ...order, items: [line("bru", "Bruschetta", "cat-antipasti", "Antipasti")] },
    [line("ore", "Orecchiette", "cat-primi", "Primi")], KITCHEN_MENU);
  expect(again.addition).toBe(true);
  // ...ma non se prima c'erano solo bevande.
  const afterDrinks = buildKitchenTicketPayload({ ...order, items: [line("acq", "Acqua", "cat-bevande", "Bevande")] },
    [line("ore", "Orecchiette", "cat-primi", "Primi")], KITCHEN_MENU);
  expect(afterDrinks.addition).toBe(false);
});

test("un piatto nuovo eredita 'In comanda' dalla sua categoria", () => {
  expect(defaultKitchenTicketForCategory(KITCHEN_MENU.categories[2])).toBe(false);
  expect(defaultKitchenTicketForCategory(KITCHEN_MENU.categories[0])).toBe(true);
  expect(defaultKitchenTicketForCategory({ items: [] })).toBe(true);
});

test("la comanda stampata è grande, senza prezzi né logo, e si taglia subito dopo l'ultimo piatto", () => {
  const order = { id: "o1", tableNumber: 12, tableName: "Famiglia Rossi", covers: { adults: 2, children: 0 }, notes: "allergia noci", waiterName: "Marco", items: [line("bru", "Bruschetta", "cat-antipasti", "Antipasti")] };
  const payload = buildKitchenTicketPayload(order, [
    line("ore", "Orecchiette alle cime di rapa con mollica", "cat-primi", "Primi", 2, "senza glutine"),
  ], KITCHEN_MENU, { now: new Date(2026, 9, 10, 20, 41) });
  const bytes = Array.from(buildKitchenTicket(payload));
  const txt = String.fromCharCode(...bytes);

  expect(txt).toContain("\x1dV" + "B\x00");
  expect(txt.endsWith("\n\x1dVB\x00")).toBe(true); // una sola riga di avanzamento prima del taglio
  expect(txt).toContain("\x1b\x45\x01"); // tutto in grassetto
  expect(txt).toContain("\x1d!\x22TAVOLO 12\n"); // numero del tavolo a dimensione tripla
  expect(txt).toContain("Famiglia Rossi");
  expect(txt).toContain("20:41 - 2 coperti - Marco");
  expect(txt).toContain("\x1dB\x01 AGGIUNTA \n\x1dB\x00"); // in negativo
  expect(txt).toContain("\x1dB\x01! allergia noci");
  expect(txt).toContain("PRIMI");
  expect(txt).toContain("\x1d!\x112x Orecchiette alle");
  expect(txt).toContain("\x1dB\x01> senza glutine");
  expect(txt).not.toContain("\xd5"); // nessun simbolo €: niente prezzi
  expect(txt).not.toContain("\x1dv0"); // nessun logo
  expect(txt).not.toContain("Preconto");

  // Ogni riga a doppia larghezza sta nelle 21 colonne.
  const dishSegments = txt.split("\x1d!\x11").slice(1).map((seg) => seg.split("\x1d!")[0]);
  for (const seg of dishSegments) {
    const plain = seg.split("\x1dB\x01").join("").split("\x1dB\x00").join(""); // senza i comandi di stampa in negativo
    for (const l of plain.split("\n")) expect(l.length).toBeLessThanOrEqual(RECEIPT_COLUMNS / 2);
  }
});
