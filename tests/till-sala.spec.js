import { test, expect } from "@playwright/test";
import { TEST_WAITER } from "./test-env";
import { deleteTestOrderByTableNumber } from "./firestore-cleanup";
import { installDesktopBridgeMock } from "./helpers/desktopBridge";

// Sala della cassa (TillSala.jsx): l'interfaccia a tutto schermo in stile
// cassa POS mostrata solo dentro il client Windows (window.mdpDesktop,
// simulato). Stessi dati e regole della Sala da telefono (sala-shared.jsx),
// quindi qui si verifica il layout e il flusso completo dalla cassa:
// tavoli a griglia, apertura con tastierino, comanda a schermo diviso,
// invio, preconto, chiusura.
//
// Progetto Playwright "till-client" (playwright.config.js): ogni pagina è
// una cassa con la stazione di stampa attiva.

const usedTables = [];
test.afterEach(async () => {
  for (const n of usedTables.splice(0)) await deleteTestOrderByTableNumber(n);
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
  await expect(draft).toContainText("Bruschetta");
  await expect(draft).toContainText("Acqua naturale");
  // Nota per la cucina sulla riga.
  await draft.getByRole("button", { name: "Nota per Bruschetta" }).click();
  await draft.getByRole("textbox", { name: "Nota di Bruschetta" }).fill("senza aglio");
  // 2 × 6,00 + 2,00 + coperto (2 adulti × 2,50 del menù demo, se presente): il totale cresce.
  await expect(page.getByTestId("till-order-total")).toContainText("€");

  await page.getByRole("button", { name: "Invia comanda (3)" }).click();
  await expect(draft).toHaveCount(0, { timeout: 15_000 });
  await expect(ticket).toContainText("Già inviato");
  await expect(ticket).toContainText("(senza aglio)");
  await expect(ticket.getByText(/^Inviata/).first()).toBeVisible();

  // Di nuovo ai tavoli: il riquadro mostra stato (scritto) e totale.
  await page.getByRole("button", { name: "Tavoli", exact: true }).click();
  const tile = page.getByRole("button", { name: new RegExp(`^Tavolo ${tableNumber} — In cucina · 0/2 uscite — totale €`) });
  await expect(tile).toBeVisible({ timeout: 10_000 });
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

test("chiudere un tavolo chiede conferma e lo sposta tra i chiusi nel turno", async ({ page }) => {
  await openTill(page);
  const tableNumber = await openTableWithKeypad(page, { adults: 0 });

  await page.getByRole("button", { name: "Chiudi tavolo" }).click();
  const confirm = page.getByRole("alertdialog", { name: `Chiudere Tavolo ${tableNumber}?` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Annulla" }).click();
  await expect(page.getByRole("region", { name: "Comanda del tavolo" })).toBeVisible();

  await page.getByRole("button", { name: "Chiudi tavolo" }).click();
  await confirm.getByRole("button", { name: "Chiudi tavolo" }).click();
  await expect(page.getByRole("button", { name: "Nuovo tavolo" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: new RegExp(`^Tavolo ${tableNumber} —`) })).toHaveCount(0);
  await page.getByRole("button", { name: /^Chiusi nel turno/ }).click();
  await expect(page.getByRole("button", { name: `Preconto di Tavolo ${tableNumber}` })).toBeVisible({ timeout: 10_000 });
});

test("il preconto si apre dalla comanda della cassa", async ({ page }) => {
  await openTill(page);
  await openTableWithKeypad(page, { adults: 0 });
  await page.getByRole("button", { name: "Preconto" }).click();
  await expect(page.getByText("Documento non fiscale")).toBeVisible();
  await page.getByRole("button", { name: "Chiudi preconto" }).click();
  await expect(page.getByText("Documento non fiscale")).toHaveCount(0);
});

test("Storico e Prenotazioni si aprono dalla barra in alto e si torna ai tavoli", async ({ page }) => {
  await openTill(page);
  await page.getByRole("button", { name: /^storico$/i }).click();
  await expect(page.getByText("Storico comande")).toBeVisible();
  await page.getByRole("button", { name: "Indietro" }).click();
  await expect(page.getByRole("button", { name: "Nuovo tavolo" })).toBeVisible();

  await page.getByRole("button", { name: /^prenotazioni$/i }).click();
  await expect(page.getByText(/^prenotazioni —/i)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Sala", exact: true }).click();
  await expect(page.getByRole("button", { name: "Nuovo tavolo" })).toBeVisible({ timeout: 10_000 });
});
