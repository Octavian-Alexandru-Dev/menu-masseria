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

  test("il modulo richiede nome e data prima di poter salvare", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: /^nuova$/i }).click();

    const saveAndConfirm = page.getByRole("button", { name: /^salva e conferma$/i });
    const saveOnly = page.getByRole("button", { name: /^salva \(da confermare\)$/i });
    // Data è precompilata con il giorno selezionato nel calendario, Nome no:
    // inizialmente disabilitato solo per il nome mancante.
    await expect(saveAndConfirm).toBeDisabled();
    await expect(saveOnly).toBeDisabled();

    await page.getByPlaceholder("es. Famiglia Rossi").fill("Prova Validazione");
    await expect(saveAndConfirm).toBeEnabled();
    await expect(saveOnly).toBeEnabled();

    await page.locator('input[type="date"]').fill("");
    await expect(saveAndConfirm).toBeDisabled();
    await expect(saveOnly).toBeDisabled();
  });

  test("il modulo nuova prenotazione compila tutti i campi e li mantiene in modifica", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);

    await page.getByRole("button", { name: /^nuova$/i }).click();
    await page.getByPlaceholder("es. Famiglia Rossi").fill(name);
    await page.locator('input[type="time"]').fill("20:30");
    await page.locator('input[type="tel"]').fill("3331234567");
    await page.locator('input[type="number"]').nth(0).fill("4"); // Adulti
    await page.locator('input[type="number"]').nth(1).fill("2"); // Bambini
    await page.locator('input[type="number"]').nth(2).fill("12"); // Numero tavolo
    await page.getByRole("textbox", { name: "Note (allergie, richieste…)" }).fill("Tavolo vicino alla finestra");
    await page.getByRole("button", { name: /^salva \(da confermare\)$/i }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });

    // Riapre la stessa prenotazione (bottone che apre la modifica, primo
    // nella riga — Conferma/Rifiuta sono bottoni successivi con lo stesso
    // nome nell'aria-label, "di <nome>").
    await page.getByRole("button", { name: new RegExp(name) }).first().click();
    await expect(page.getByText("Modifica prenotazione")).toBeVisible();
    await expect(page.locator('input[type="time"]')).toHaveValue("20:30");
    await expect(page.locator('input[type="tel"]')).toHaveValue("3331234567");
    await expect(page.locator('input[type="number"]').nth(0)).toHaveValue("4");
    await expect(page.locator('input[type="number"]').nth(1)).toHaveValue("2");
    await expect(page.locator('input[type="number"]').nth(2)).toHaveValue("12");
    await expect(page.getByRole("textbox", { name: "Note (allergie, richieste…)" })).toHaveValue("Tavolo vicino alla finestra");
  });

  test("modifica una prenotazione esistente e salva le modifiche", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    await createReservation(page, name);

    await page.getByRole("button", { name: new RegExp(name) }).first().click();
    await page.locator('input[type="tel"]').fill("3339876543");
    await page.getByRole("button", { name: /^salva modifiche$/i }).click();
    await expect(page.getByText("Modifica prenotazione")).toHaveCount(0);

    await page.getByRole("button", { name: new RegExp(name) }).first().click();
    await expect(page.locator('input[type="tel"]')).toHaveValue("3339876543");
  });

  test("annulla una prenotazione confermata dal modulo di modifica", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    await createReservation(page, name);
    await page.getByRole("button", { name: new RegExp(`Conferma prenotazione di ${name}`, "i") }).click();
    await expect(page.getByRole("button", { name: new RegExp(`Avvia prenotazione di ${name}`, "i") })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: new RegExp(name) }).first().click();
    await expect(page.getByRole("button", { name: /^annulla prenotazione$/i })).toBeVisible();
    await page.getByRole("button", { name: /^annulla prenotazione$/i }).click();
    await expect(page.getByText("Modifica prenotazione")).toHaveCount(0);

    await expect(page.getByRole("button", { name: new RegExp(`Avvia prenotazione di ${name}`, "i") })).toHaveCount(0);
    await page.getByRole("button", { name: /rifiutate.*annullate.*no-show/i }).click();
    await expect(page.getByText(name).first()).toBeVisible();
    await expect(page.getByText(/annullata/i)).toBeVisible();
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
