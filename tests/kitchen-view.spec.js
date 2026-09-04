import { test, expect } from "@playwright/test";
import { TEST_WAITER, TEST_KITCHEN } from "./test-env";
import { deleteTestOrderByTableNumber } from "./firestore-cleanup";

// Range distinto da waiter-order.spec.js per evitare collisioni quando i
// file di test girano in parallelo.
const TABLE_NUMBER = 9500 + Math.floor(Math.random() * 500);

test.describe("Area cucina", () => {
  test("mostra il login per l'area cucina", async ({ page }) => {
    await page.goto("/cucina");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("riceve la comanda del cameriere in tempo reale e marca una portata come uscita", async ({ browser }) => {
    // Due login + più round-trip Firestore in tempo reale tra due contesti
    // browser distinti: il timeout di default (15s, vedi playwright.config.js)
    // non basta.
    test.setTimeout(60_000);

    const waiterContext = await browser.newContext();
    const kitchenContext = await browser.newContext();
    const waiterPage = await waiterContext.newPage();
    const kitchenPage = await kitchenContext.newPage();

    try {
      await waiterPage.goto("/cameriere");
      await waiterPage.locator('input[type="email"]').fill(TEST_WAITER.email);
      await waiterPage.locator('input[type="password"]').fill(TEST_WAITER.password);
      await waiterPage.getByRole("button", { name: /accedi/i }).click();

      await waiterPage.getByRole("button", { name: /nuovo tavolo/i }).click();
      await waiterPage.locator('input[type="number"]').first().fill(String(TABLE_NUMBER));
      await waiterPage.getByRole("button", { name: /apri tavolo/i }).click();
      await expect(waiterPage.getByText(`Tavolo ${TABLE_NUMBER}`, { exact: true })).toBeVisible({ timeout: 10_000 });

      const firstDish = waiterPage.locator("button", { hasText: "€" }).first();
      await expect(firstDish).toBeVisible({ timeout: 10_000 });
      await firstDish.click();
      await waiterPage.getByRole("button", { name: /invia comanda/i }).click();
      await expect(waiterPage.getByText(/sincronizzata/i)).toBeVisible({ timeout: 15_000 });

      await kitchenPage.goto("/cucina");
      await kitchenPage.locator('input[type="email"]').fill(TEST_KITCHEN.email);
      await kitchenPage.locator('input[type="password"]').fill(TEST_KITCHEN.password);
      await kitchenPage.getByRole("button", { name: /accedi/i }).click();

      // Il tavolo appena aperto dal cameriere compare in cucina in tempo reale.
      const kitchenCard = kitchenPage.getByTestId(`table-card-${TABLE_NUMBER}`);
      await expect(kitchenCard).toBeVisible({ timeout: 15_000 });

      // Marca l'unica portata presente come uscita (scoperto entro la card
      // del nostro tavolo, per non toccare comande reali di altri tavoli
      // eventualmente aperti in produzione durante il test).
      await kitchenCard.getByRole("button", { name: /segna uscita/i }).first().click();
      // Nota: usare stringa esatta (non regex con ancore ^$) — Playwright
      // normalizza gli spazi per il confronto tra stringhe ma non prima di
      // applicare una regex, e lo span "Uscita" ha uno spazio iniziale
      // dovuto al testo JSX dopo l'icona ({icon} Uscita).
      await expect(kitchenCard.getByText("Uscita", { exact: true })).toBeVisible({ timeout: 15_000 });

      // Il cameriere vede l'aggiornamento di stato in tempo reale, senza
      // dover tornare in cucina a chiedere (§5 punto 4 del documento).
      await expect(waiterPage.getByText(/uscita/i).first()).toBeVisible({ timeout: 15_000 });

      // Chiude il tavolo di test: torna all'elenco tavoli aperti...
      await waiterPage.getByRole("button", { name: /chiudi tavolo/i }).click();
      await waiterPage.getByRole("button", { name: /conferma chiusura/i }).click();
      await expect(waiterPage.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
    } finally {
      // Una comanda di test, anche chiusa correttamente dal flusso UI, resta
      // visibile per sempre nello Storico comande finché non scadono i 30
      // giorni di retention — quindi non basta chiuderla, va eliminata del
      // tutto (indipendentemente dal fatto che sia rimasta aperta per
      // un'asserzione fallita, o già chiusa con successo).
      await deleteTestOrderByTableNumber(TABLE_NUMBER);
      await waiterContext.close();
      await kitchenContext.close();
    }
  });
});
