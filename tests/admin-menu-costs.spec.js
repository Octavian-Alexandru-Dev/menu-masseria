import { test, expect } from "@playwright/test";
import { TEST_ADMIN } from "./test-env";
import { PHONE, navTo, sheet } from "./helpers/phone";
import { addMenuItemRemotely, removeMenuItemsByNamePrefix, removeMenuCostRemotely } from "./helpers/menuDoc";

// Costo interno di un piatto (src/menuCosts.js, documento separato da
// menu/data, mai letto dal menù pubblico): si imposta nella scheda del
// piatto della gestione menù (TillMenu.jsx) dal tastierino e si salva con
// "Salva" insieme al resto. Questo spec scrive davvero su menuCosts/data
// nell'emulatore, ma solo per un piatto nascosto creato apposta: i costi
// seedati (letti dalle statistiche e dagli altri test in parallelo) non si
// toccano mai.
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
  await page.getByRole("textbox", { name: "Nome utente", exact: true }).fill(TEST_ADMIN.email);
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
    const id = `cost-test-${Date.now()}`;
    const name = `Costo test ${Date.now()}`;
    await addMenuItemRemotely("cat-antipasti", { id, name, price: "3,00", visible: false, staffOnly: false, kitchenTicket: true });
    try {
      let editor = await openDish(page, name);
      await expect(editor.getByTestId("till-dish-cost")).toHaveText("non indicato");
      await setCost(editor, ["9", "9", "9"]);
      await page.reload();
      editor = await openDish(page, name);
      await expect(editor.getByTestId("till-dish-cost")).toHaveText("€ 9,99");
    } finally {
      await removeMenuItemsByNamePrefix(name);
      await removeMenuCostRemotely(id);
    }
  });
});
