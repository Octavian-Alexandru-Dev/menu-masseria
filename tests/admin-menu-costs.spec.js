import { test, expect } from "@playwright/test";
import { TEST_ADMIN } from "./test-env";
import { PHONE, navTo, sheet } from "./helpers/phone";

// Costo interno di un piatto (src/menuCosts.js, documento separato da
// menu/data, mai letto dal menù pubblico): si imposta nella scheda del
// piatto della gestione menù (TillMenu.jsx) dal tastierino e si salva con
// "Salva" insieme al resto. Questo spec scrive davvero su menuCosts/data
// nell'emulatore e ripristina il valore seedato.
test.use(PHONE);

async function openDish(page, name) {
  await navTo(page, "Menù");
  await page.getByRole("button", { name: `Modifica ${name}` }).click();
  const editor = sheet(page, "Modifica piatto");
  await expect(editor).toBeVisible();
  return editor;
}

async function setCost(editor, digits) {
  await editor.getByRole("button", { name: "Cambia costo" }).click();
  for (const d of digits) await editor.getByRole("button", { name: `Cifra ${d}` }).click();
  await editor.getByRole("button", { name: /^Usa €/ }).click();
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(editor.getByText("Salvato.")).toBeVisible({ timeout: 10_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /area riservata|staff area/i }).click();
  await page.locator('input[type="email"]').fill(TEST_ADMIN.email);
  await page.locator('input[type="password"]').fill(TEST_ADMIN.password);
  await page.getByRole("button", { name: /^accedi$/i }).click();
});

test.describe("Costo interno dei piatti", () => {
  test("mostra il costo seedato per Bruschetta, anche aprendo il piatto prima che i costi arrivino", async ({ page }) => {
    // Bug corretto: la scheda aperta prima dell'arrivo dei costi restava su
    // "non indicato" (TillMenu.jsx > DishEditor, ora segue il costo che arriva).
    const editor = await openDish(page, "Bruschetta");
    await expect(editor.getByTestId("till-dish-cost")).toHaveText("€ 2,00", { timeout: 10_000 });
    await expect(editor).toContainText("mai mostrato ai clienti");
  });

  test("il costo cambiato dal tastierino resta dopo un ricaricamento", async ({ page }) => {
    let editor = await openDish(page, "Caprese");
    // Seed: 2,50 (scripts/seed-emulator.js, DEMO_COSTS); si aspetta che arrivi.
    await expect(editor.getByTestId("till-dish-cost")).toHaveText(/€/, { timeout: 10_000 });
    const original = (await editor.getByTestId("till-dish-cost").innerText()).replace("€ ", "");
    try {
      await setCost(editor, ["9", "9", "9"]);
      await page.reload();
      editor = await openDish(page, "Caprese");
      await expect(editor.getByTestId("till-dish-cost")).toHaveText("€ 9,99", { timeout: 10_000 });
    } finally {
      // Ripristino del valore seedato (le statistiche di altri test lo usano).
      if (!(await editor.isVisible())) editor = await openDish(page, "Caprese");
      if (original === "non indicato") {
        await editor.getByRole("button", { name: "Nessun costo" }).click();
        await editor.getByRole("button", { name: "Salva" }).click();
      } else {
        await setCost(editor, original.replace(",", "").replace(/^0+/, "").split(""));
      }
    }
  });
});
