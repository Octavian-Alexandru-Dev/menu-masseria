import { test, expect } from "@playwright/test";
import { TEST_WAITER } from "./test-env";

// Numero di tavolo "sentinella" molto alto e randomizzato ad ogni run, per
// non essere mai confuso con un tavolo reale e per non collidere con un
// eventuale residuo lasciato da un run precedente interrotto a metà.
const TABLE_NUMBER = 9000 + Math.floor(Math.random() * 500);

test.describe("Area cameriere", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/cameriere");
  });

  // Se un test fallisce a metà (es. su un'asserzione dopo l'invio della
  // comanda), il tavolo di test resterebbe aperto nel Firestore reale.
  // Tentativo di pulizia best-effort, silenzioso se non c'è nulla da chiudere.
  test.afterEach(async ({ page }) => {
    try {
      const closeBtn = page.getByRole("button", { name: /chiudi tavolo/i });
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await closeBtn.click();
        await page.getByRole("button", { name: /conferma chiusura/i }).click({ timeout: 3000 });
      }
    } catch {
      // best-effort: non far fallire il test per un problema di pulizia
    }
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

    // Pulizia: chiude il tavolo di test per non lasciare comande aperte.
    await page.getByRole("button", { name: /chiudi tavolo/i }).click();
    await page.getByRole("button", { name: /conferma chiusura/i }).click();
    await expect(page.getByText(`Tavolo ${TABLE_NUMBER}`, { exact: true })).not.toBeVisible({ timeout: 10_000 });
  });
});
