import { test, expect } from "@playwright/test";
import { TEST_WAITER } from "./test-env";
import { deleteTestOrderByTableNumber, deleteTestReservationByName } from "./firestore-cleanup";
import { installDesktopBridgeMock, printedTexts } from "./helpers/desktopBridge";
import { deletePrintJobsByTableLabel } from "./helpers/printJobs";

// Sala della cassa (TillSala.jsx): l'interfaccia a tutto schermo in stile
// cassa POS mostrata solo dentro il client Windows (window.mdpDesktop,
// simulato). Stessi dati e regole della Sala da telefono (sala-shared.jsx),
// quindi qui si verifica il layout e il flusso completo dalla cassa:
// tavoli a griglia, apertura con tastierino, comanda a schermo diviso,
// modifica delle righe nella barra laterale (quantità, offerto, sconti,
// prezzo libero), invio, preconto stampato direttamente, chiusura, Storico e
// Prenotazioni in versione cassa.
//
// Progetto Playwright "till-sala" (playwright.config.js), in sequenza: ogni
// pagina è una cassa con la stazione di stampa attiva, e alcuni test stampano
// — un'altra "cassa" in parallelo si prenderebbe le loro stampe.
test.describe.configure({ mode: "serial" });

const usedTables = [];
const usedReservations = [];
test.afterEach(async () => {
  for (const n of usedTables.splice(0)) {
    await deleteTestOrderByTableNumber(n);
    await deletePrintJobsByTableLabel(`Tavolo ${n}`);
  }
  for (const name of usedReservations.splice(0)) await deleteTestReservationByName(name);
});

function freshTableNumber() {
  // 4 cifre: il tastierino della cassa accetta al massimo 4 cifre.
  return 7000 + Math.floor(Math.random() * 900);
}

async function openTill(page) {
  await installDesktopBridgeMock(page, { savedLogin: TEST_WAITER });
  await page.goto("/cameriere");
  await expect(page.getByRole("button", { name: "Nuovo tavolo" })).toBeVisible({ timeout: 10_000 });
}

async function openTableWithKeypad(page, { adults = 2 } = {}) {
  const tableNumber = freshTableNumber();
  usedTables.push(tableNumber);
  await page.getByRole("button", { name: "Nuovo tavolo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuovo tavolo" });
  for (const digit of String(tableNumber)) await dialog.getByRole("button", { name: `Cifra ${digit}` }).click();
  await expect(dialog.getByRole("textbox", { name: "Numero tavolo" })).toHaveText(String(tableNumber));
  for (let i = 0; i < adults; i++) await dialog.getByRole("button", { name: "Aumenta adulti" }).click();
  await dialog.getByRole("button", { name: `Apri tavolo ${tableNumber}` }).click();
  await expect(page.getByRole("region", { name: "Comanda del tavolo" })).toBeVisible({ timeout: 10_000 });
  return tableNumber;
}

test("i tavoli riempiono lo schermo in una griglia e le sezioni sono a portata di tocco", async ({ page }) => {
  await openTill(page);
  const grid = page.getByTestId("till-floor-grid");
  const viewport = page.viewportSize();
  const box = await grid.boundingBox();
  // Non più una colonna stretta al centro: la griglia occupa quasi tutta la larghezza.
  expect(box.width).toBeGreaterThan(viewport.width * 0.8);
  for (const name of [/^tavoli/i, /^prenotazioni$/i, /^storico$/i]) {
    const tab = page.getByRole("navigation", { name: "Sezioni della sala" }).getByRole("button", { name });
    expect((await tab.boundingBox()).height).toBeGreaterThanOrEqual(48);
  }
  const newTable = await page.getByRole("button", { name: "Nuovo tavolo" }).boundingBox();
  expect(newTable.height).toBeGreaterThanOrEqual(48);
});

test("dalla cassa si apre un tavolo con il tastierino, si prende la comanda e si invia", async ({ page }) => {
  await openTill(page);
  const tableNumber = await openTableWithKeypad(page);
  const ticket = page.getByRole("region", { name: "Comanda del tavolo" });
  await expect(ticket).toContainText(`Comanda — Tavolo ${tableNumber}`);
  await expect(page.getByRole("button", { name: "Invia comanda (0)" })).toBeDisabled();

  // Menù a riquadri per categoria, con il conteggio sul riquadro.
  await page.getByRole("tab", { name: "Antipasti" }).click();
  await page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).click();
  await page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).click();
  await page.getByRole("tab", { name: "Bevande" }).click();
  await page.getByRole("button", { name: /^Aggiungi Acqua naturale/ }).click();

  const draft = ticket.getByRole("group", { name: "Da inviare" });
  await expect(draft.getByRole("button", { name: /^Modifica Bruschetta: 2 ×/ })).toBeVisible();
  await expect(draft.getByRole("button", { name: /^Modifica Acqua naturale: 1 ×/ })).toBeVisible();

  // Nota per la cucina dall'editor della riga, nella barra laterale.
  await draft.getByRole("button", { name: /^Modifica Bruschetta/ }).click();
  const editor = page.getByRole("region", { name: "Modifica riga" });
  await editor.getByRole("textbox", { name: "Nota di Bruschetta" }).fill("senza aglio");
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(draft).toContainText("senza aglio");

  await page.getByRole("button", { name: "Invia comanda (3)" }).click();
  await expect(draft).toHaveCount(0, { timeout: 15_000 });
  const sent = ticket.getByRole("group", { name: "Già inviato" });
  await expect(sent).toContainText("senza aglio");
  await expect(sent).toContainText(/inviato \d{2}:\d{2}/);
  // Nessuno stato "uscita" della cucina: non c'è un tablet in cucina.
  await expect(ticket).not.toContainText(/uscit/i);

  // Di nuovo ai tavoli: il riquadro mostra stato (scritto) e totale.
  await page.getByRole("button", { name: "Tavoli", exact: true }).click();
  const tile = page.getByRole("button", { name: new RegExp(`^Tavolo ${tableNumber} — Comanda inviata — totale €`) });
  await expect(tile).toBeVisible({ timeout: 10_000 });
});

test("dalla barra laterale si modificano quantità e prezzo di una riga: offerto, sconto, prezzo libero", async ({ page }) => {
  await openTill(page);
  const tableNumber = await openTableWithKeypad(page, { adults: 0 });
  const ticket = page.getByRole("region", { name: "Comanda del tavolo" });
  const total = page.getByTestId("till-order-total");
  await page.getByRole("tab", { name: "Primi" }).click();
  await page.getByRole("button", { name: /^Aggiungi Orecchiette/ }).click(); // 10,00
  await page.getByRole("tab", { name: "Antipasti" }).click();
  await page.getByRole("button", { name: /^Aggiungi Caprese/ }).click(); // 7,00
  await expect(total).toHaveText("€ 17,00");

  // Riga da inviare: quantità 3 e sconto 20% → 3 × 8,00.
  await ticket.getByRole("button", { name: /^Modifica Orecchiette/ }).click();
  let editor = page.getByRole("region", { name: "Modifica riga" });
  await editor.getByRole("button", { name: "Aumenta quantità" }).click();
  await editor.getByRole("button", { name: "Aumenta quantità" }).click();
  await editor.getByRole("button", { name: "Sconto 20%" }).click();
  await expect(page.getByTestId("till-line-total")).toHaveText("€ 24,00");
  // Niente cambia finché non si salva: "Comanda" torna indietro senza modifiche.
  await editor.getByRole("button", { name: "Comanda", exact: true }).click();
  await expect(total).toHaveText("€ 17,00");
  await ticket.getByRole("button", { name: /^Modifica Orecchiette/ }).click();
  editor = page.getByRole("region", { name: "Modifica riga" });
  await editor.getByRole("button", { name: "Aumenta quantità" }).click();
  await editor.getByRole("button", { name: "Aumenta quantità" }).click();
  await editor.getByRole("button", { name: "Sconto 20%" }).click();
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(ticket.getByRole("button", { name: "Modifica Orecchiette: 3 × € 8,00, Sconto 20%" })).toBeVisible();
  await expect(total).toHaveText("€ 31,00");

  await page.getByRole("button", { name: "Invia comanda (4)" }).click();
  const sent = ticket.getByRole("group", { name: "Già inviato" });
  await expect(sent).toBeVisible({ timeout: 15_000 });

  // Riga già inviata: la Caprese diventa offerta (salvata sulla comanda).
  await sent.getByRole("button", { name: /^Modifica Caprese/ }).click();
  editor = page.getByRole("region", { name: "Modifica riga" });
  await editor.getByRole("button", { name: "Offerto" }).click();
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(sent.getByRole("button", { name: "Modifica Caprese: 1 × € 0,00, Offerto" })).toBeVisible({ timeout: 10_000 });
  await expect(total).toHaveText("€ 24,00");

  // Prezzo libero dal tastierino (in centesimi, come le casse): 6,50.
  await sent.getByRole("button", { name: /^Modifica Caprese/ }).click();
  editor = page.getByRole("region", { name: "Modifica riga" });
  await editor.getByRole("button", { name: "Altro" }).click();
  for (const k of ["6", "5", "0"]) await editor.getByRole("button", { name: `Cifra ${k}` }).click();
  await expect(editor.getByRole("textbox", { name: "Nuovo prezzo" })).toHaveText("€ 6,50");
  await editor.getByRole("button", { name: "Usa € 6,50" }).click();
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(sent.getByRole("button", { name: "Modifica Caprese: 1 × € 6,50, Prezzo modificato" })).toBeVisible({ timeout: 10_000 });
  await expect(total).toHaveText("€ 30,50");

  // Il preconto stampato riporta lo sconto.
  await page.getByRole("button", { name: "Stampa preconto" }).click();
  await expect(page.getByRole("status", { name: "Stato stampa" })).toHaveText(/stampato alla cassa/i, { timeout: 15_000 });
  const receipt = (await printedTexts(page)).find((txt) => txt.includes(`Tavolo ${tableNumber}`));
  expect(receipt).toContain("Orecchiette (sconto 20%)");
  expect(receipt).toContain("Caprese (prezzo modificato)");
  expect(receipt).toContain("30,50");
});

test("una riga già inviata si può rimuovere dall'editor, con conferma", async ({ page }) => {
  await openTill(page);
  await openTableWithKeypad(page, { adults: 0 });
  const ticket = page.getByRole("region", { name: "Comanda del tavolo" });
  await page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).click();
  await page.getByRole("button", { name: "Invia comanda (1)" }).click();
  const sent = ticket.getByRole("group", { name: "Già inviato" });
  await sent.getByRole("button", { name: /^Modifica Bruschetta/ }).click();
  await page.getByRole("region", { name: "Modifica riga" }).getByRole("button", { name: "Rimuovi dalla comanda" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Rimuovere Bruschetta?" });
  await confirm.getByRole("button", { name: "Rimuovi" }).click();
  await expect(sent).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId("till-order-total")).toHaveText("€ 0,00");
});

test("la ricerca trova i piatti in tutte le categorie", async ({ page }) => {
  await openTill(page);
  await openTableWithKeypad(page, { adults: 0 });
  await page.getByRole("textbox", { name: "Cerca un piatto" }).fill("tiram");
  await expect(page.getByRole("button", { name: /^Aggiungi Tiramisù/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Aggiungi Bruschetta/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancella ricerca" }).click();
  await expect(page.getByRole("button", { name: /^Aggiungi Bruschetta/ })).toBeVisible();
});

test("un tavolo già aperto viene segnalato nel tastierino, con il collegamento al tavolo", async ({ page }) => {
  await openTill(page);
  const tableNumber = await openTableWithKeypad(page, { adults: 0 });
  await page.getByRole("button", { name: "Tavoli", exact: true }).click();
  await page.getByRole("button", { name: "Nuovo tavolo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuovo tavolo" });
  for (const digit of String(tableNumber)) await dialog.getByRole("button", { name: `Cifra ${digit}` }).click();
  await expect(dialog.getByRole("alert")).toContainText(`Il tavolo ${tableNumber} è già aperto.`);
  await dialog.getByRole("button", { name: `Vai al tavolo ${tableNumber}` }).click();
  await expect(page.getByRole("region", { name: "Comanda del tavolo" })).toContainText(`Comanda — Tavolo ${tableNumber}`);
});

test("chiudere un tavolo chiede conferma e lo sposta nello Storico, da cui si ristampa il preconto", async ({ page }) => {
  await openTill(page);
  const tableNumber = await openTableWithKeypad(page, { adults: 0 });
  await page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).click();
  await page.getByRole("button", { name: "Invia comanda (1)" }).click();
  await expect(page.getByRole("group", { name: "Già inviato" })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Chiudi tavolo" }).click();
  const confirm = page.getByRole("alertdialog", { name: `Chiudere Tavolo ${tableNumber}?` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Annulla" }).click();
  await expect(page.getByRole("region", { name: "Comanda del tavolo" })).toBeVisible();

  await page.getByRole("button", { name: "Chiudi tavolo" }).click();
  await confirm.getByRole("button", { name: "Chiudi tavolo" }).click();
  await expect(page.getByRole("button", { name: "Nuovo tavolo" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: new RegExp(`^Tavolo ${tableNumber} —`) })).toHaveCount(0);

  // Storico della cassa: elenco a sinistra, dettaglio e ristampa a destra.
  await page.getByRole("navigation", { name: "Sezioni della sala" }).getByRole("button", { name: /^storico$/i }).click();
  const list = page.getByRole("region", { name: "Comande chiuse" });
  await list.getByRole("button", { name: new RegExp(`^Tavolo ${tableNumber}`) }).click();
  const detail = page.getByRole("region", { name: "Dettaglio comanda" });
  await expect(detail).toContainText("Bruschetta");
  await detail.getByRole("button", { name: "Ristampa preconto" }).click();
  await expect(detail.getByRole("status", { name: "Stato stampa" })).toHaveText(/stampato alla cassa/i, { timeout: 15_000 });
});

test("il preconto si stampa direttamente dalla barra laterale e il tavolo lo segnala", async ({ page }) => {
  await openTill(page);
  const tableNumber = await openTableWithKeypad(page, { adults: 0 });
  await page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).click();

  // Piatti non ancora inviati: avviso prima di stampare.
  await page.getByRole("button", { name: "Stampa preconto" }).click();
  const warn = page.getByRole("alertdialog", { name: "Ci sono piatti non inviati" });
  await warn.getByRole("button", { name: "Annulla" }).click();
  await page.getByRole("button", { name: "Invia comanda (1)" }).click();
  // "Da inviare" si svuota alla conferma del server (l'avviso resterebbe giusto fino ad allora).
  await expect(page.getByRole("group", { name: "Da inviare" })).toHaveCount(0, { timeout: 15_000 });

  await page.getByRole("button", { name: "Stampa preconto" }).click();
  await expect(page.getByRole("status", { name: "Stato stampa" })).toHaveText(/stampato alla cassa/i, { timeout: 15_000 });
  await expect(page.getByText("Documento non fiscale")).toHaveCount(0); // niente finestrella da telefono
  await page.getByRole("button", { name: "Tavoli", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^Tavolo ${tableNumber} — Preconto stampato`) })).toBeVisible({ timeout: 10_000 });
});

test("prenotazioni della cassa: si crea con orari a tocco, si conferma e si avvia aprendo il tavolo", async ({ page }) => {
  await openTill(page);
  const name = `Prova Cassa ${Date.now()}`;
  usedReservations.push(name);
  await page.getByRole("navigation", { name: "Sezioni della sala" }).getByRole("button", { name: /^prenotazioni$/i }).click();
  await expect(page.getByRole("region", { name: "Calendario" })).toBeVisible();

  await page.getByRole("region", { name: "Prenotazioni del giorno" }).getByRole("button", { name: "Nuova" }).click();
  const form = page.getByRole("region", { name: "Nuova prenotazione" });
  await form.getByRole("button", { name: "20:30" }).click();
  await form.getByRole("textbox", { name: "Nome *" }).fill(name);
  await form.getByRole("button", { name: "Aumenta adulti" }).click(); // 3 adulti
  const tableNumber = freshTableNumber();
  usedTables.push(tableNumber);
  // Il tavolo si sceglie poi all'avvio (tastierino): qui resta "da assegnare".
  await form.getByRole("button", { name: "Salva da confermare" }).click();

  const day = page.getByRole("region", { name: "Prenotazioni del giorno" });
  const row = day.getByRole("button", { name: new RegExp(`^${name}, ore 20:30, 3 adulti, Da confermare`) });
  await expect(row).toBeVisible({ timeout: 10_000 });
  const detail = page.getByRole("region", { name: "Dettaglio prenotazione" });
  await detail.getByRole("button", { name: "Conferma" }).click();
  await expect(day.getByRole("button", { name: new RegExp(`^${name}, ore 20:30, 3 adulti, Confermata`) })).toBeVisible({ timeout: 10_000 });

  // Avvio: chiede il numero del tavolo con il tastierino e apre la comanda.
  await detail.getByRole("button", { name: "Avvia (apri il tavolo)" }).click();
  const dialog = page.getByRole("dialog", { name: `Avvia ${name}` });
  for (const digit of String(tableNumber)) await dialog.getByRole("button", { name: `Cifra ${digit}` }).click();
  await dialog.getByRole("button", { name: "Apri comanda" }).click();
  // Il tavolo prende il nome della prenotazione; il numero è nell'intestazione.
  await expect(page.getByRole("region", { name: "Comanda del tavolo" })).toContainText(`Comanda — ${name}`, { timeout: 10_000 });
  await expect(page.getByRole("region", { name: "Menu" })).toContainText(`Tavolo ${tableNumber}`);
});

test("il calendario della cassa riassume prenotazioni e coperti del giorno", async ({ page }) => {
  await openTill(page);
  const name = `Calendario Cassa ${Date.now()}`;
  usedReservations.push(name);
  await page.getByRole("navigation", { name: "Sezioni della sala" }).getByRole("button", { name: /^prenotazioni$/i }).click();
  await page.getByRole("region", { name: "Prenotazioni del giorno" }).getByRole("button", { name: "Nuova" }).click();
  const form = page.getByRole("region", { name: "Nuova prenotazione" });
  await form.getByRole("button", { name: "Giorno successivo" }).click();
  await form.getByRole("button", { name: "13:00" }).click();
  await form.getByRole("textbox", { name: "Nome *" }).fill(name);
  await form.getByRole("button", { name: "Salva e conferma" }).click();
  // Si sposta sul giorno della prenotazione, già confermata.
  await expect(page.getByRole("region", { name: "Prenotazioni del giorno" }).getByRole("button", { name: new RegExp(`^${name}, ore 13:00, 2 adulti, Confermata`) })).toBeVisible({ timeout: 10_000 });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const cellLabel = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" }).format(tomorrow);
  await expect(page.getByRole("region", { name: "Calendario" }).getByRole("button", { name: new RegExp(`^${cellLabel}, \\d+ prenotazioni, \\d+ coperti`) })).toBeVisible();
});
