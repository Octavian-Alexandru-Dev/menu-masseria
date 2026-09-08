import { test, expect } from "@playwright/test";
import { TEST_ADMIN } from "./test-env";

// A differenza di admin.spec.js (editor menù, volutamente mai salvato su
// Firestore — vedi il suo describe), il costo interno di un piatto si salva
// subito ad ogni modifica (updateCost in Admin.jsx, src/menuCosts.js): questo
// spec scrive davvero su menuCosts/data nell'emulatore.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /area riservata|staff area/i }).click();
  await page.locator('input[type="email"]').fill(TEST_ADMIN.email);
  await page.locator('input[type="password"]').fill(TEST_ADMIN.password);
  await page.getByRole("button", { name: /accedi|login|sign in/i }).click();
  await page.getByRole("button", { name: "Gestione menù" }).click();
});

test.describe("Costo interno dei piatti", () => {
  test("mostra il costo seedato per Bruschetta (item-bruschetta)", async ({ page }) => {
    // Le categorie partono chiuse: cliccare il nome espande la categoria e
    // rende visibili le voci al suo interno (stesso pattern di admin.spec.js).
    await page.getByText("Antipasti", { exact: true }).first().click();
    const costInput = page.getByTestId("item-cost-item-bruschetta");
    await expect(costInput).toBeVisible({ timeout: 10_000 });
    await expect(costInput).toHaveValue("2,00");
  });

  test("modifica il costo di un piatto e la modifica sopravvive a un ricaricamento", async ({ page }) => {
    await page.getByText("Antipasti", { exact: true }).first().click();
    const costInput = page.getByTestId("item-cost-item-caprese");
    await expect(costInput).toBeVisible({ timeout: 10_000 });
    await costInput.fill("9,99");
    await costInput.blur();

    // Il ricaricamento resta su Gestione menù (sezione sincronizzata
    // nell'URL, vedi useUrlState in StaffHome.jsx) ma richiude le categorie.
    await page.reload();
    await page.getByText("Antipasti", { exact: true }).first().click();
    await expect(page.getByTestId("item-cost-item-caprese")).toHaveValue("9,99", { timeout: 10_000 });

    // Ripristina il valore seedato per non alterare le asserzioni di
    // stats-dashboard.spec.js che dipendono dal costo di item-caprese.
    await page.getByTestId("item-cost-item-caprese").fill("2,50");
    await page.getByTestId("item-cost-item-caprese").blur();
  });
});
