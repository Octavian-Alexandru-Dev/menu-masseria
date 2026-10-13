import { test, expect } from "@playwright/test";
import { TEST_WAITER } from "./test-env";
import { deleteTestReservationByName, deleteTestOrderByTableNumber } from "./firestore-cleanup";
import { PHONE, navTo, sheet } from "./helpers/phone";

// Prenotazioni dal telefono (TillReservations.jsx, la stessa schermata della
// cassa in una colonna): calendario del mese con prenotazioni e coperti per
// giorno, prenotazioni del giorno, scheda e modulo a pagina intera. La
// versione cassa è provata in till-sala.spec.js.
test.use(PHONE);

// Nomi "sentinella" randomizzati (i test girano in parallelo sulla stessa giornata).
const randomName = () => "TestRes " + Math.floor(Math.random() * 1_000_000);
const CELL_DATE_LABEL = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" });
const MONTH_LABEL = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });

async function login(page) {
  await page.locator('input[type="email"]').fill(TEST_WAITER.email);
  await page.locator('input[type="password"]').fill(TEST_WAITER.password);
  await page.getByRole("button", { name: /^accedi$/i }).click();
  await expect(page.getByRole("region", { name: "Calendario" })).toBeVisible({ timeout: 10_000 });
}

// Nuova prenotazione per oggi (o `nextDay`), lasciata da confermare o confermata.
async function createReservation(page, name, { time = "20:30", confirm = false, nextDay = false } = {}) {
  await page.getByRole("button", { name: "Nuova prenotazione" }).click();
  const form = sheet(page, "Nuova prenotazione");
  if (nextDay) await form.getByRole("button", { name: "Giorno successivo" }).click();
  await form.getByRole("button", { name: time, exact: true }).click();
  await form.getByRole("textbox", { name: "Nome *" }).fill(name);
  await form.getByRole("button", { name: confirm ? "Salva e conferma" : "Salva da confermare" }).click();
  const detail = sheet(page, "Dettaglio prenotazione");
  await expect(detail).toContainText(name, { timeout: 10_000 });
  return detail;
}

test.describe("Prenotazioni", () => {
  const createdNames = [];
  const tables = [];

  test.beforeEach(async ({ page }) => {
    await page.goto("/prenotazioni");
  });

  test.afterEach(async () => {
    await Promise.all(tables.splice(0).map((n) => deleteTestOrderByTableNumber(n)));
    await Promise.all(createdNames.splice(0).map((n) => deleteTestReservationByName(n)));
  });

  test("mostra il login per l'area prenotazioni", async ({ page }) => {
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /^accedi$/i })).toBeVisible();
  });

  test("si apre sulla sezione Prenotazioni, con calendario e prenotazioni di oggi", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("navigation", { name: "Sezioni" }).getByRole("button", { name: "Prenotazioni", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("region", { name: "Prenotazioni del giorno" })).toContainText(/^Oggi/);
  });

  test("crea una prenotazione da confermare e la conferma: compare 'Avvia'", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    const detail = await createReservation(page, name);
    await expect(detail).toContainText("Da confermare");
    await detail.getByRole("button", { name: "Conferma" }).click();
    await expect(detail).toContainText("Confermata", { timeout: 10_000 });
    await expect(detail.getByRole("button", { name: "Avvia (apri il tavolo)" })).toBeVisible();

    await detail.getByRole("button", { name: "Prenotazioni", exact: true }).click();
    await expect(page.getByRole("region", { name: "Prenotazioni del giorno" }).getByRole("button", { name: new RegExp(`^${name}, ore 20:30, 2 adulti, Confermata`) })).toBeVisible();
  });

  test("rifiuta una prenotazione dopo una conferma", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    const detail = await createReservation(page, name);
    await detail.getByRole("button", { name: "Rifiuta" }).click();
    await page.getByRole("alertdialog", { name: `Rifiutare la prenotazione di ${name}?` }).getByRole("button", { name: "Rifiuta" }).click();
    await expect(detail).toContainText("Rifiutata", { timeout: 10_000 });
  });

  test("il modulo richiede il nome prima di poter salvare", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Nuova prenotazione" }).click();
    const form = sheet(page, "Nuova prenotazione");
    const save = form.getByRole("button", { name: "Salva e conferma" });
    await expect(save).toBeDisabled();
    await form.getByRole("textbox", { name: "Nome *" }).fill("Prova Validazione");
    await expect(save).toBeEnabled();
    // "Salva" resta in fondo allo schermo, nella zona del pollice.
    const box = await save.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(851);
    expect(box.y).toBeGreaterThan(851 * 0.7);
  });

  test("tutti i campi del modulo (anche orario e data liberi) si ritrovano in modifica", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    await page.getByRole("button", { name: "Nuova prenotazione" }).click();
    const form = sheet(page, "Nuova prenotazione");
    await form.getByLabel("Altro orario").fill("19:40");
    await form.getByRole("textbox", { name: "Nome *" }).fill(name);
    await form.getByRole("textbox", { name: "Telefono" }).fill("3331234567");
    await form.getByRole("button", { name: "Aumenta adulti" }).click(); // 3
    await form.getByRole("button", { name: "Aumenta bambini" }).click(); // 1
    for (let i = 0; i < 3; i++) await form.getByRole("button", { name: "Aumenta tavolo" }).click(); // 3
    await form.getByRole("textbox", { name: "Note (allergie, richieste…)" }).fill("Vicino alla finestra");
    await form.getByRole("button", { name: "Salva da confermare" }).click();

    const detail = sheet(page, "Dettaglio prenotazione");
    await expect(detail).toContainText("ore 19:40", { timeout: 10_000 });
    await expect(detail).toContainText("3 adulti, 1 bambino");
    await expect(detail).toContainText("Tavolo 3");
    await expect(detail).toContainText("3331234567");
    await expect(detail).toContainText("Vicino alla finestra");

    await detail.getByRole("button", { name: "Modifica" }).click();
    const edit = sheet(page, "Modifica prenotazione");
    await expect(edit.getByLabel("Altro orario")).toHaveValue("19:40");
    await expect(edit.getByRole("textbox", { name: "Telefono" })).toHaveValue("3331234567");
    await edit.getByRole("textbox", { name: "Telefono" }).fill("3339876543");
    await edit.getByRole("button", { name: "Salva modifiche" }).click();
    await expect(sheet(page, "Dettaglio prenotazione")).toContainText("3339876543", { timeout: 10_000 });
  });

  test("una prenotazione confermata si annulla con conferma e finisce tra le annullate", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    const detail = await createReservation(page, name, { confirm: true });
    await expect(detail).toContainText("Confermata", { timeout: 10_000 });
    await detail.getByRole("button", { name: "Annulla", exact: true }).click();
    await page.getByRole("alertdialog", { name: `Annullare la prenotazione di ${name}?` }).getByRole("button", { name: "Annulla prenotazione" }).click();
    await expect(detail).toContainText("Annullata", { timeout: 10_000 });

    await detail.getByRole("button", { name: "Prenotazioni", exact: true }).click();
    await page.getByRole("button", { name: /mostra rifiutate, annullate e non presentate/i }).click();
    await expect(page.getByRole("button", { name: new RegExp(`^${name},.*Annullata`) })).toBeVisible();
  });

  test("il calendario cambia mese e riassume prenotazioni e coperti di ogni giorno", async ({ page }) => {
    await login(page);
    const calendar = page.getByRole("region", { name: "Calendario" });
    const now = new Date();
    await expect(calendar).toContainText(new RegExp(MONTH_LABEL.format(now), "i"));
    await calendar.getByRole("button", { name: "Mese successivo" }).click();
    await expect(calendar).toContainText(new RegExp(MONTH_LABEL.format(new Date(now.getFullYear(), now.getMonth() + 1, 1)), "i"));
    await calendar.getByRole("button", { name: "Mese precedente" }).click();

    const name = randomName();
    createdNames.push(name);
    const detail = await createReservation(page, name, { nextDay: true, time: "13:00", confirm: true });
    await detail.getByRole("button", { name: "Prenotazioni", exact: true }).click();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await expect(page.getByRole("region", { name: "Calendario" }).getByRole("button", { name: new RegExp(`^${CELL_DATE_LABEL.format(tomorrow)}, \\d+ prenotazioni, \\d+ coperti`) })).toBeVisible({ timeout: 10_000 });
  });

  test("'Avvia' da Prenotazioni porta ai Tavoli e apre la comanda col nome della prenotazione", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    const tableNumber = 9500 + Math.floor(Math.random() * 400);
    tables.push(tableNumber);
    const detail = await createReservation(page, name, { confirm: true });
    await detail.getByRole("button", { name: "Avvia (apri il tavolo)" }).click();

    // Nessun tavolo assegnato: si chiede il numero.
    const start = sheet(page, `Avvia ${name}`);
    await start.getByRole("spinbutton", { name: "Numero tavolo" }).fill(String(tableNumber));
    await start.getByRole("button", { name: "Apri comanda" }).click();
    await expect(page.getByText(`Tavolo ${tableNumber}`).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(name).first()).toBeVisible();
  });

  test("le prenotazioni di oggi confermate si avviano anche dai Tavoli", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    const tableNumber = 9900 + Math.floor(Math.random() * 90);
    tables.push(tableNumber);
    const detail = await createReservation(page, name, { confirm: true });
    await expect(detail).toContainText("Confermata", { timeout: 10_000 });
    await detail.getByRole("button", { name: "Prenotazioni", exact: true }).click();

    await navTo(page, "Tavoli");
    await expect(page.getByRole("region", { name: "Prenotazioni di oggi" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: `Avvia prenotazione di ${name}` }).click();
    await sheet(page, `Avvia ${name}`).getByRole("spinbutton", { name: "Numero tavolo" }).fill(String(tableNumber));
    await sheet(page, `Avvia ${name}`).getByRole("button", { name: "Apri comanda" }).click();
    await expect(page.getByText(`Tavolo ${tableNumber}`).first()).toBeVisible({ timeout: 10_000 });
  });
});
