import { test, expect } from "@playwright/test";
import { TEST_WAITER } from "./test-env";
import { deleteTestOrderByTableNumber } from "./firestore-cleanup";

// Numero di tavolo "sentinella" molto alto e randomizzato ad ogni run, per
// non essere mai confuso con un tavolo reale e per non collidere con un
// eventuale residuo lasciato da un run precedente interrotto a metà.
const TABLE_NUMBER = 9000 + Math.floor(Math.random() * 500);

test.describe("Area cameriere", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/cameriere");
  });

  // Una comanda di test, anche chiusa correttamente dal flusso UI, resta
  // visibile per sempre nello Storico comande finché non scadono i 30 giorni
  // di retention — quindi non basta chiuderla, va eliminata del tutto.
  test.afterEach(async () => {
    await deleteTestOrderByTableNumber(TABLE_NUMBER);
  });

  test("mostra il login per l'area cameriere", async ({ page }) => {
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /accedi/i })).toBeVisible();
  });

  test("rifiuta credenziali non valide", async ({ page }) => {
    await page.locator('input[type="email"]').fill("nonexistent-user@example.com");
    await page.locator('input[type="password"]').fill("wrong-password");
    await page.getByRole("button", { name: /accedi/i }).click();
    await expect(page.getByText(/non corrett|non riuscito/i)).toBeVisible({ timeout: 10_000 });
  });

  test("apre un tavolo, invia un piatto e mostra l'indicatore di sincronizzazione", async ({ page }) => {
    await page.locator('input[type="email"]').fill(TEST_WAITER.email);
    await page.locator('input[type="password"]').fill(TEST_WAITER.password);
    await page.getByRole("button", { name: /accedi/i }).click();

    await page.getByRole("button", { name: /nuovo tavolo/i }).click();
    await page.locator('input[type="number"]').first().fill(String(TABLE_NUMBER));
    await page.getByRole("button", { name: /apri tavolo/i }).click();

    await expect(page.getByText(`Tavolo ${TABLE_NUMBER}`, { exact: true })).toBeVisible({ timeout: 10_000 });

    // Aggiunge la prima voce di menù disponibile (struttura, non testo
    // hardcoded: il menù reale cambia indipendentemente da questo test).
    const firstDish = page.locator("button", { hasText: "€" }).first();
    await expect(firstDish).toBeVisible({ timeout: 10_000 });
    await firstDish.click();

    const sendButton = page.getByRole("button", { name: /invia comanda/i });
    await expect(sendButton).toBeVisible();
    await sendButton.click();

    // Indicatore di stato di sincronizzazione (§7 del documento): compare
    // subito, poi si conferma.
    await expect(page.getByText(/sincronizzata|invio in corso/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/sincronizzata/i)).toBeVisible({ timeout: 15_000 });

    // La riga inviata compare nella comanda con lo stato "Inviata".
    await expect(page.getByText(/inviata/i).first()).toBeVisible();

    // Chiude il tavolo: torna all'elenco (non più aperto)...
    await page.getByRole("button", { name: /chiudi tavolo/i }).click();
    await page.getByRole("button", { name: /conferma chiusura/i }).click();
    await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });

    // ...ma resta visibile nella sezione "Chiusi nel turno" (non sparisce
    // del tutto dalla schermata per tutto il servizio in corso).
    await expect(page.getByText(/chiusi nel turno/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`Tavolo ${TABLE_NUMBER}`, { exact: true })).toBeVisible();
  });
});
