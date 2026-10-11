import { test, expect } from "@playwright/test";
import { TEST_WAITER, TEST_ADMIN } from "./test-env";
import { staffLogin } from "./helpers/staffLogin";
import { deleteTestOrderByTableNumber } from "./firestore-cleanup";
import { installDesktopBridgeMock, printedTexts } from "./helpers/desktopBridge";
import { seedPrintJob, getPrintJob, deletePrintJobsByTableLabel, describePrintJobsByTableLabel } from "./helpers/printJobs";

// Stampa dei preconti sulla stampante termica della cassa (docs/stampa-scontrini.md):
// "Stampa" nel preconto accoda una richiesta in printJobs da qualunque
// dispositivo; la stazione di stampa (PrintStation.jsx), attiva solo dentro il
// client Windows (window.mdpDesktop, qui simulato), la prende in carico e la
// manda alla stampante. Il "telefono" e la "cassa" sono due contesti browser
// separati, con login separati, come nella realtà.
//
// Seriale: ogni cassa simulata stampa TUTTE le richieste in coda (come quella
// vera), quindi due test di questo file in parallelo si ruberebbero le
// stampe a vicenda. Nessun altro file di test preme "Stampa" nel preconto.
test.describe.configure({ mode: "serial" });

const SENT_LINE = "Bruschetta";

function freshTableNumber() {
  return 11000 + Math.floor(Math.random() * 500);
}

const usedTables = [];
test.afterEach(async () => {
  for (const n of usedTables.splice(0)) {
    await deleteTestOrderByTableNumber(n);
    await deletePrintJobsByTableLabel(`Tavolo ${n}`);
  }
});

// Telefono del cameriere: apre un tavolo, invia un piatto, apre il preconto.
async function openReceiptOnPhone(page) {
  const tableNumber = freshTableNumber();
  usedTables.push(tableNumber);
  await page.goto("/cameriere");
  await staffLogin(page, TEST_WAITER);
  await page.getByRole("button", { name: /nuovo tavolo/i }).click();
  await page.locator('input[type="number"]').first().fill(String(tableNumber));
  await page.getByRole("button", { name: /apri tavolo/i }).click();
  await expect(page.getByText(`Tavolo ${tableNumber}`, { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: new RegExp(SENT_LINE, "i") }).click();
  await page.getByRole("button", { name: /invia comanda/i }).click();
  await expect(page.getByText(/sincronizzata/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /preconto/i }).click();
  await expect(page.getByText("Documento non fiscale")).toBeVisible();
  return tableNumber;
}

async function openTill(browser, options) {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Errori della stazione di stampa nel report del test (console della cassa).
  page.on("console", (msg) => { if (msg.type() === "error") console.log(`[cassa] ${msg.text()}`); });
  await installDesktopBridgeMock(page, options);
  await page.goto("/cameriere");
  await staffLogin(page, TEST_ADMIN);
  await expect(page.getByRole("button", { name: /stampante: pronta/i })).toBeVisible({ timeout: 10_000 });
  return { context, page };
}

test("dal telefono 'Stampa' accoda il preconto, la cassa lo stampa e lo stato torna al telefono", async ({ page, browser }) => {
  const tableNumber = await openReceiptOnPhone(page);
  // Nel browser normale non c'è la stazione di stampa, ma resta la stampa
  // dal browser come alternativa.
  await expect(page.getByRole("button", { name: /impostazioni stampante/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^stampa dal browser$/i })).toBeVisible();

  // Cassa ancora spenta: la richiesta resta in coda.
  await page.getByRole("button", { name: /^stampa$/i }).click();
  const status = page.getByRole("status", { name: "Stato stampa" });
  await expect(status).toHaveText(/inviato alla cassa, in attesa/i, { timeout: 10_000 });

  // Si accende la cassa: prende la richiesta rimasta in coda e la stampa.
  const till = await openTill(browser);
  try {
    try {
      await expect(status).toHaveText(/stampato alla cassa/i, { timeout: 15_000 });
    } catch (err) {
      // Diagnostica: stato delle richieste del tavolo sul server e console della cassa.
      await test.info().attach("printJobs", { body: JSON.stringify(await describePrintJobsByTableLabel(`Tavolo ${tableNumber}`), null, 2), contentType: "application/json" });
      throw err;
    }
    const texts = await printedTexts(till.page);
    const receipt = texts.find((t) => t.includes(`Tavolo ${tableNumber}`));
    expect(receipt, "scontrino del tavolo stampato").toBeTruthy();
    expect(receipt).toContain(SENT_LINE);
    expect(receipt).toContain("TOTALE");
    expect(receipt).toContain("Qualcosa non torna?");
    expect(receipt).toContain("DOCUMENTO NON FISCALE");
    // Logo raster (GS v 0) in testa e taglio carta (GS V) in fondo.
    expect(receipt).toContain("\x1dv0");
    expect(receipt.endsWith("\x1dVB\x00")).toBe(true);
  } finally {
    await till.context.close();
  }
});

test("se la stampa fallisce il telefono vede l'errore e può riprovare", async ({ page, browser }) => {
  const till = await openTill(browser, { failWith: "Carta esaurita: sostituisci il rotolo e riprova." });
  try {
    const tableNumber = await openReceiptOnPhone(page);
    await page.getByRole("button", { name: /^stampa$/i }).click();
    const status = page.getByRole("status", { name: "Stato stampa" });
    await expect(status).toHaveText(/stampa non riuscita: carta esaurita/i, { timeout: 15_000 });
    // La cassa segnala l'errore sul suo pulsante stampante.
    await expect(till.page.getByRole("button", { name: /stampante: errore — carta esaurita/i })).toBeVisible();
    // Il motivo è visibile anche senza mouse (schermo touch), non solo nel tooltip.
    await expect(till.page.getByRole("button", { name: /^carta esaurita/i })).toBeVisible();

    // Rotolo sostituito: "Riprova stampa" rimette in coda la stessa richiesta.
    await till.page.evaluate(() => { globalThis.__printFail = null; });
    await page.getByRole("button", { name: /^riprova stampa$/i }).click();
    await expect(status).toHaveText(/stampato alla cassa/i, { timeout: 15_000 });
    const texts = await printedTexts(till.page);
    expect(texts.some((t) => t.includes(`Tavolo ${tableNumber}`))).toBe(true);
    await expect(till.page.getByRole("button", { name: /stampante: pronta/i })).toBeVisible();
  } finally {
    await till.context.close();
  }
});

test("una richiesta rimasta in coda troppo a lungo scade invece di essere stampata", async ({ browser }) => {
  const tableNumber = freshTableNumber();
  usedTables.push(tableNumber);
  const jobId = `expired-test-${tableNumber}`;
  await seedPrintJob(jobId, { tableLabel: `Tavolo ${tableNumber}`, createdAtMs: Date.now() - 60 * 60 * 1000 });

  const till = await openTill(browser);
  try {
    await expect.poll(async () => (await getPrintJob(jobId))?.status, { timeout: 15_000 }).toBe("expired");
    const texts = await printedTexts(till.page);
    expect(texts.some((t) => t.includes(`Tavolo ${tableNumber}`))).toBe(false);
  } finally {
    await till.context.close();
  }
});

// Menu Cassa (tastiera, schermo intero, impostazioni, chiusura), banner di
// aggiornamento, login automatico e conferma di uscita: tests/till-client.spec.js.
