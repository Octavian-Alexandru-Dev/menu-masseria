import { test, expect } from "@playwright/test";
import {
  encodeText, wrapText, labelAmountLines, buildReceipt, grayToMonoBitmap, RECEIPT_COLUMNS,
} from "../src/escpos.js";

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
