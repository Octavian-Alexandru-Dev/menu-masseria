// ESC/POS receipt builder for the thermal printer at the till (80mm, the
// "Buffetti PRT 105" — a rebadged POSBANK A6E, see docs/stampa-scontrini.md).
//
// Lives in the web app on purpose, not in the Windows client: the desktop
// shell (desktop-client/) only pipes these bytes to the printer over TCP, so
// any change to the receipt layout ships with a normal hosting deploy and
// reaches the till without reinstalling anything.
//
// Pure functions only (no DOM, no Firestore): the logo is passed in already
// converted to grayscale (see printStation.js > loadReceiptLogo), which keeps
// this file testable from Node.

// Measured on the real printer: in Font A a full line is 42 characters (48
// dashes wrapped as 42 + 6), i.e. ~512 printable dots on 80mm paper.
export const RECEIPT_COLUMNS = 42;
export const PAPER_WIDTH_DOTS = 512;
export const LOGO_WIDTH_DOTS = 400;

export const CUSTOMER_CHECK_TITLE = "Qualcosa non torna?";
export const CUSTOMER_CHECK_MESSAGE =
  "Controlla il tuo conto e se trovi un errore, dillo a uno di noi. Lo sistemiamo subito con un sorriso.";

const ESC = 0x1b;
const GS = 0x1d;

// Code page 858 (= CP850 with "€" at 0xD5): the only one of those tested on
// the printer that prints both Italian accented letters and the euro sign.
const CP858_ESC_T = 19;
const CP858_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";
const CP858_MAP = new Map([...CP858_HIGH].map((ch, i) => [ch, 0x80 + i]));

// Typographic characters that commonly end up in dish names/notes (pasted
// from a phone keyboard or a document) and have no CP858 slot.
const REPLACEMENTS = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", "×": "x" };

export function encodeText(str) {
  const out = [];
  for (const raw of String(str ?? "")) {
    const ch = REPLACEMENTS[raw] ?? raw;
    if (ch.length > 1) {
      for (const c of ch) out.push(c.charCodeAt(0));
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code === 0x0a || (code >= 0x20 && code < 0x7f)) {
      out.push(code);
    } else if (CP858_MAP.has(ch)) {
      out.push(CP858_MAP.get(ch));
    } else {
      // Unknown letter with diacritics (e.g. "ł", "ő"): fall back to its base
      // letter rather than a "?" in the middle of a dish name.
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const baseCode = base.charCodeAt(0);
      out.push(base.length === 1 && baseCode >= 0x20 && baseCode < 0x7f ? baseCode : 0x3f);
    }
  }
  return out;
}

// Greedy word wrap; words longer than the width are hard-split.
export function wrapText(text, width) {
  const lines = [];
  let current = "";
  for (let word of String(text ?? "").split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (current) { lines.push(current); current = ""; }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += " " + word;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}

export function formatEuro(cents) {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

// A left label with a right-aligned amount on the same line; when the label
// doesn't fit next to the amount it wraps, and the amount stays on the first
// line (where the eye looks for it).
export function labelAmountLines(label, amount, width = RECEIPT_COLUMNS) {
  const labelWidth = width - amount.length - 1;
  const wrapped = wrapText(label, labelWidth);
  if (wrapped.length === 0) wrapped.push("");
  return wrapped.map((l, i) => (i === 0 ? l + " ".repeat(width - l.length - amount.length) + amount : l));
}

// Grayscale (0-255, one byte per pixel) → 1 bit per pixel, bit set = black
// dot. "Hybrid" conversion chosen after printing tests: dark/golden ink (the
// "Fattoria della Piana" lettering) becomes solid black, very light tones
// become white, and only the light greys in between (the farmhouse walls) are
// Floyd–Steinberg dithered, so they don't disappear entirely.
export function grayToMonoBitmap(gray, width, height, { lo = 165, hi = 245 } = {}) {
  const levels = new Float32Array(width * height);
  for (let i = 0; i < levels.length; i++) {
    const p = gray[i];
    levels[i] = p < lo ? 0 : p > hi ? 255 : ((p - lo) * 255) / (hi - lo);
  }
  const bytesPerRow = Math.ceil(width / 8);
  const bits = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = levels[i];
      const black = old < 128;
      const err = old - (black ? 0 : 255);
      if (black) bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      if (x + 1 < width) levels[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) levels[i + width - 1] += (err * 3) / 16;
        levels[i + width] += (err * 5) / 16;
        if (x + 1 < width) levels[i + width + 1] += err / 16;
      }
    }
  }
  return { bits, bytesPerRow, height };
}

// Logo centred on the full paper width, sent as GS v 0 raster bands of at
// most 64 rows (some printers reject a single very tall raster block).
export function logoRasterCommands(logo) {
  const { bits, bytesPerRow, height } = logo;
  const paperBytes = PAPER_WIDTH_DOTS / 8;
  const offset = Math.max(0, Math.floor((paperBytes - bytesPerRow) / 2));
  const rowBytes = Math.max(paperBytes, bytesPerRow);
  const out = [];
  for (let y = 0; y < height; y += 64) {
    const h = Math.min(64, height - y);
    out.push(GS, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, h & 0xff, h >> 8);
    for (let row = y; row < y + h; row++) {
      const line = new Uint8Array(rowBytes);
      line.set(bits.subarray(row * bytesPerRow, (row + 1) * bytesPerRow), offset);
      out.push(...line);
    }
  }
  return out;
}

// payload: the snapshot stored on the print job (printJobs.js >
// buildReceiptPayload). logo: output of grayToMonoBitmap, or null to fall
// back to the restaurant name in large text.
export function buildReceipt(payload, { logo = null, columns = RECEIPT_COLUMNS } = {}) {
  const out = [];
  const raw = (...bytes) => out.push(...bytes);
  const text = (s) => out.push(...encodeText(s));
  const line = (s = "") => text(s + "\n");
  const center = (on) => raw(ESC, 0x61, on ? 1 : 0);
  const bold = (on) => raw(ESC, 0x45, on ? 1 : 0);
  const rule = (ch) => line(ch.repeat(columns));

  raw(ESC, 0x40, ESC, 0x74, CP858_ESC_T);

  center(true);
  if (logo) {
    raw(...logoRasterCommands(logo));
    line();
  } else {
    raw(GS, 0x21, 0x11);
    line(payload.restaurantName || "Fattoria della Piana");
    raw(GS, 0x21, 0x00);
  }
  line(`Preconto - ${payload.tableLabel}`);
  if (payload.dateLabel) line(payload.dateLabel);
  center(false);
  rule("-");

  const lines = payload.lines || [];
  if (lines.length === 0) line("Nessun piatto ordinato.");
  for (const l of lines) {
    for (const s of labelAmountLines(`${l.quantity}x ${l.name}`, formatEuro(l.totalCents), columns)) line(s);
    if (l.notes) for (const s of wrapText(`(${l.notes})`, columns - 3)) line(`   ${s}`);
  }
  if (payload.coperto && payload.coperto.totalCents > 0) {
    for (const s of labelAmountLines(payload.coperto.label, formatEuro(payload.coperto.totalCents), columns)) line(s);
  }
  rule("-");

  bold(true);
  raw(GS, 0x21, 0x01);
  for (const s of labelAmountLines("TOTALE", formatEuro(payload.totalCents || 0), columns)) line(s);
  raw(GS, 0x21, 0x00);
  bold(false);
  rule("=");

  center(true);
  bold(true);
  line(CUSTOMER_CHECK_TITLE);
  bold(false);
  for (const s of wrapText(CUSTOMER_CHECK_MESSAGE, columns)) line(s);
  rule("=");
  line();
  line("Grazie e a presto!");
  line();
  raw(ESC, 0x4d, 1);
  line("DOCUMENTO NON FISCALE");
  raw(ESC, 0x4d, 0);
  center(false);

  raw(0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00); // feed + partial cut
  return Uint8Array.from(out);
}

// Kitchen ticket ("comanda" for the kitchen board, see kitchenTicket.js):
// read from a distance by someone with less than perfect eyesight, and
// printed many times a night, so:
//  - everything bold, dishes at double width and height (21 columns), the
//    table number at triple size (14 columns) — the first thing looked for;
//  - notes (allergies, "senza glutine"…) in reverse print, so they can't be
//    missed; "AGGIUNTA" the same way when the table already has a ticket up;
//  - no logo, no prices, no blank lines, no closing text: the paper is cut
//    right after the last dish.
export const KITCHEN_DISH_COLUMNS = RECEIPT_COLUMNS / 2;
export const KITCHEN_TABLE_COLUMNS = Math.floor(RECEIPT_COLUMNS / 3);

export function buildKitchenTicket(payload, { columns = RECEIPT_COLUMNS } = {}) {
  const out = [];
  const raw = (...bytes) => out.push(...bytes);
  const text = (s) => out.push(...encodeText(s));
  const line = (s = "") => text(s + "\n");
  const align = (n) => raw(ESC, 0x61, n);
  const size = (w, h) => raw(GS, 0x21, ((w - 1) << 4) | (h - 1));
  const reverse = (on) => raw(GS, 0x42, on ? 1 : 0);
  const dishColumns = Math.floor(columns / 2);
  const tableColumns = Math.floor(columns / 3);

  raw(ESC, 0x40, ESC, 0x74, CP858_ESC_T);
  raw(ESC, 0x45, 1); // bold for the whole ticket: darker, easier to read

  align(1);
  size(3, 3);
  const tableTitle = payload.tableNumber != null ? `TAVOLO ${payload.tableNumber}` : payload.tableLabel;
  for (const s of wrapText(tableTitle, tableColumns)) line(s);
  if (payload.tableName) {
    size(2, 2);
    for (const s of wrapText(payload.tableName, dishColumns)) line(s);
  }
  size(1, 2);
  const info = [payload.timeLabel, payload.covers, payload.waiterName].filter(Boolean).join(" - ");
  if (info) for (const s of wrapText(info, columns)) line(s);
  if (payload.addition) {
    size(2, 2);
    reverse(true);
    line(" AGGIUNTA ");
    reverse(false);
  }
  align(0);
  if (payload.tableNotes) {
    size(2, 2);
    reverse(true);
    for (const s of wrapText(`! ${payload.tableNotes}`, dishColumns)) line(s);
    reverse(false);
  }

  for (const group of payload.groups || []) {
    size(1, 1);
    line("-".repeat(columns));
    if (group.categoryName) {
      size(1, 2);
      line(group.categoryName.toUpperCase());
    }
    for (const l of group.lines) {
      size(2, 2);
      const prefix = `${l.quantity}x `;
      const wrapped = wrapText(l.name, dishColumns - prefix.length);
      wrapped.forEach((s, i) => line((i === 0 ? prefix : " ".repeat(prefix.length)) + s));
      if (l.notes) {
        // Indent outside the reverse print, so only the note is highlighted.
        for (const s of wrapText(`> ${l.notes}`, dishColumns - prefix.length)) {
          text(" ".repeat(prefix.length));
          reverse(true);
          text(s);
          reverse(false);
          line();
        }
      }
    }
  }

  size(1, 1);
  raw(ESC, 0x45, 0);
  raw(0x0a, GS, 0x56, 0x42, 0x00); // feed to the cutter + partial cut
  return Uint8Array.from(out);
}
