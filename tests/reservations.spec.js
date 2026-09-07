import { test, expect } from "@playwright/test";
import { TEST_WAITER } from "./test-env";
import { deleteTestReservationByName, deleteTestOrderByTableNumber } from "./firestore-cleanup";

// Nomi "sentinella" randomizzati ad ogni run, per non essere mai confusi con
// una prenotazione reale e per non collidere con un eventuale residuo
// lasciato da un run precedente interrotto a metà (stesso principio di
// TABLE_NUMBER in waiter-order.spec.js). I test girano con fullyParallel:true
// (playwright.config.js), quindi più prenotazioni di oggi da worker diversi
// possono comparire contemporaneamente nella stessa lista — i pulsanti
// Conferma/Rifiuta/Avvia hanno perciò un aria-label che include il nome
// della prenotazione, cosa che rende ogni pulsante univocamente selezionabile
// anche quando altri test scrivono dati concorrenti sulla stessa giornata.
function randomName() {
  return "TestRes " + Math.floor(Math.random() * 1_000_000);
}
const TABLE_NUMBER = 9500 + Math.floor(Math.random() * 500);

async function login(page) {
  await page.locator('input[type="email"]').fill(TEST_WAITER.email);
  await page.locator('input[type="password"]').fill(TEST_WAITER.password);
  await page.getByRole("button", { name: /accedi/i }).click();
}

async function createReservation(page, name) {
  await page.getByRole("button", { name: /^nuova$/i }).click();
  await page.getByPlaceholder("es. Famiglia Rossi").fill(name);
  await page.getByRole("button", { name: /^salva \(da confermare\)$/i }).click();
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });
}

test.describe("Area prenotazioni", () => {
  const createdNames = [];

  test.beforeEach(async ({ page }) => {
    await page.goto("/prenotazioni");
  });

  test.afterEach(async () => {
    await deleteTestOrderByTableNumber(TABLE_NUMBER);
    await Promise.all(createdNames.splice(0).map((n) => deleteTestReservationByName(n)));
  });

  test("mostra il login per l'area prenotazioni", async ({ page }) => {
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /accedi/i })).toBeVisible();
  });

  test("crea una prenotazione e compare tra quelle da confermare", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    await createReservation(page, name);
    await expect(page.getByRole("button", { name: new RegExp(`Conferma prenotazione di ${name}`, "i") })).toBeVisible();
  });

  test("conferma una prenotazione in attesa e mostra il pulsante Avvia", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    await createReservation(page, name);

    await page.getByRole("button", { name: new RegExp(`Conferma prenotazione di ${name}`, "i") }).click();
    await expect(page.getByRole("button", { name: new RegExp(`Conferma prenotazione di ${name}`, "i") })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: new RegExp(`Avvia prenotazione di ${name}`, "i") })).toBeVisible();
  });

  test("rifiuta una prenotazione in attesa", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    await createReservation(page, name);

    await page.getByRole("button", { name: new RegExp(`Rifiuta prenotazione di ${name}`, "i") }).click();
    await expect(page.getByText(name)).toHaveCount(0, { timeout: 10_000 });

    await page.getByRole("button", { name: /rifiutate.*annullate.*no-show/i }).click();
    await expect(page.getByText(name)).toBeVisible();
  });

  test("naviga tra i mesi del calendario", async ({ page }) => {
    await login(page);
    const monthLabel = page.locator('button[aria-label="Mese precedente"] + div');
    const before = await monthLabel.innerText();
    await page.getByRole("button", { name: "Mese successivo" }).click();
    await expect(monthLabel).not.toHaveText(before);
  });

  test("avvia una prenotazione confermata di oggi dalla Sala e apre la comanda", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    await createReservation(page, name);
    await page.getByRole("button", { name: new RegExp(`Conferma prenotazione di ${name}`, "i") }).click();
    await expect(page.getByRole("button", { name: new RegExp(`Avvia prenotazione di ${name}`, "i") })).toBeVisible({ timeout: 10_000 });

    // Stessa sessione (Firebase Auth persiste nel browser): non serve
    // rifare il login navigando su /cameriere.
    await page.goto("/cameriere");

    await expect(page.getByText(/prenotazioni di oggi/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: new RegExp(`Avvia prenotazione di ${name}`, "i") }).click();

    await page.locator('input[type="number"]').fill(String(TABLE_NUMBER));
    await page.getByRole("button", { name: /apri comanda/i }).click();

    await expect(page.getByText(new RegExp(`Tavolo ${TABLE_NUMBER}`)).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(name).first()).toBeVisible();
  });
});
