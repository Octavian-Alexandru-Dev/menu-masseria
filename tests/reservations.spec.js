import { test, expect } from "@playwright/test";
import { TEST_WAITER, TEST_ADMIN } from "./test-env";
import { deleteTestReservationByName, deleteTestOrderByTableNumber } from "./firestore-cleanup";
import { PHONE, navTo, sheet } from "./helpers/phone";
import { seedLegacyPendingReservation, seedReservation, findReservationByName } from "./helpers/reservations";
import { swipeLeft } from "./helpers/swipe";

// Prenotazioni dal telefono (TillReservations.jsx, la stessa schermata della
// cassa in una colonna): calendario del mese con prenotazioni e coperti per
// giorno, prenotazioni del giorno, scheda e modulo a pagina intera. La
// versione cassa è provata in till-sala.spec.js.
test.use(PHONE);

// Nomi "sentinella" randomizzati (i test girano in parallelo sulla stessa giornata).
const randomName = () => "TestRes " + Math.floor(Math.random() * 1_000_000);
const CELL_DATE_LABEL = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" });
const MONTH_LABEL = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });

async function login(page, account = TEST_WAITER) {
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: /^accedi$/i }).click();
  await expect(page.getByRole("region", { name: "Calendario" })).toBeVisible({ timeout: 10_000 });
}

// Nuova prenotazione per oggi (o `nextDay`): nasce già confermata.
async function createReservation(page, name, { time = "20:30", nextDay = false } = {}) {
  await page.getByRole("button", { name: "Nuova prenotazione" }).click();
  const form = sheet(page, "Nuova prenotazione");
  if (nextDay) await form.getByRole("button", { name: "Giorno successivo" }).click();
  await form.getByRole("button", { name: time, exact: true }).click();
  await form.getByRole("textbox", { name: "Nome *" }).fill(name);
  await form.getByRole("button", { name: "Salva prenotazione" }).click();
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

  test("una nuova prenotazione è subito valida: nessun passaggio di conferma, si può avviare", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    const detail = await createReservation(page, name);
    await expect(detail).toContainText("Prenotata");
    await expect(detail).not.toContainText(/confermar/i);
    await expect(detail.getByRole("button", { name: "Conferma" })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "Rifiuta" })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "Avvia (apri il tavolo)" })).toBeVisible();

    await detail.getByRole("button", { name: "Prenotazioni", exact: true }).click();
    const day = page.getByRole("region", { name: "Prenotazioni del giorno" });
    await expect(day.getByRole("button", { name: new RegExp(`^${name}, ore 20:30, 2 adulti, Prenotata`) })).toBeVisible();
    await expect(day).not.toContainText(/da confermare/i);
    await expect(page.getByRole("region", { name: "Calendario" })).not.toContainText(/da confermare/i);
  });

  test("una vecchia prenotazione 'da confermare' compare come le altre (Prenotazioni e Tavoli)", async ({ page }) => {
    const name = randomName();
    createdNames.push(name);
    await seedLegacyPendingReservation(name);
    await login(page);
    const row = page.getByRole("region", { name: "Prenotazioni del giorno" }).getByRole("button", { name: new RegExp(`^${name}, ore 21:00, 2 adulti, Prenotata`) });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await expect(sheet(page, "Dettaglio prenotazione").getByRole("button", { name: "Avvia (apri il tavolo)" })).toBeVisible();
    await sheet(page, "Dettaglio prenotazione").getByRole("button", { name: "Prenotazioni", exact: true }).click();

    await navTo(page, "Tavoli");
    await expect(page.getByRole("button", { name: `Avvia prenotazione di ${name}` })).toBeVisible({ timeout: 10_000 });
  });

  test("il modulo richiede il nome prima di poter salvare", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Nuova prenotazione" }).click();
    const form = sheet(page, "Nuova prenotazione");
    const save = form.getByRole("button", { name: "Salva prenotazione" });
    // Un solo modo di salvare: niente più "da confermare".
    await expect(form.getByRole("button", { name: /^salva/i })).toHaveCount(1);
    await expect(save).toBeDisabled();
    await form.getByRole("textbox", { name: "Nome *" }).fill("Prova Validazione");
    await expect(save).toBeEnabled();
    // "Salva" resta in fondo allo schermo, nella zona del pollice (misurato a pagina ferma).
    await expect(save).toBeInViewport({ ratio: 1 });
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
    await form.getByRole("button", { name: "Salva prenotazione" }).click();

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

  test("una prenotazione si annulla con conferma e finisce tra le annullate", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    const detail = await createReservation(page, name);
    await expect(detail).toContainText("Prenotata", { timeout: 10_000 });
    await detail.getByRole("button", { name: "Annulla", exact: true }).click();
    await page.getByRole("alertdialog", { name: `Annullare la prenotazione di ${name}?` }).getByRole("button", { name: "Annulla prenotazione" }).click();
    await expect(detail).toContainText("Annullata", { timeout: 10_000 });

    await detail.getByRole("button", { name: "Prenotazioni", exact: true }).click();
    await page.getByRole("button", { name: /mostra avviate, annullate e non presentate/i }).click();
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
    const detail = await createReservation(page, name, { nextDay: true, time: "13:00" });
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
    const detail = await createReservation(page, name);
    await detail.getByRole("button", { name: "Avvia (apri il tavolo)" }).click();

    // Nessun tavolo assegnato: si chiede il numero.
    const start = sheet(page, `Avvia ${name}`);
    await start.getByRole("spinbutton", { name: "Numero tavolo" }).fill(String(tableNumber));
    await start.getByRole("button", { name: "Apri comanda" }).click();
    await expect(page.getByText(`Tavolo ${tableNumber}`).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(name).first()).toBeVisible();
  });

  test("le prenotazioni di oggi si avviano anche dai Tavoli, col tasto rapido 'Avvia'", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    const tableNumber = 9900 + Math.floor(Math.random() * 90);
    tables.push(tableNumber);
    const detail = await createReservation(page, name);
    await detail.getByRole("button", { name: "Prenotazioni", exact: true }).click();

    await navTo(page, "Tavoli");
    await expect(page.getByRole("region", { name: "Prenotazioni di oggi" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: `Avvia prenotazione di ${name}` }).click();
    await sheet(page, `Avvia ${name}`).getByRole("spinbutton", { name: "Numero tavolo" }).fill(String(tableNumber));
    await sheet(page, `Avvia ${name}`).getByRole("button", { name: "Apri comanda" }).click();
    await expect(page.getByText(`Tavolo ${tableNumber}`).first()).toBeVisible({ timeout: 10_000 });
  });

  test("toccando una prenotazione di oggi nei Tavoli si apre la sua scheda, da cui si modifica e si avvia", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    const tableNumber = 9990 + Math.floor(Math.random() * 9);
    tables.push(tableNumber);
    const detail = await createReservation(page, name, { time: "21:15" });
    await detail.getByRole("button", { name: "Prenotazioni", exact: true }).click();

    await navTo(page, "Tavoli");
    const card = page.getByRole("region", { name: "Prenotazioni di oggi" }).getByRole("button", { name: new RegExp(`^${name}, ore 21:15, 2 adulti — apri la prenotazione`) });
    await expect(card).toBeVisible({ timeout: 10_000 });
    // Bersaglio touch pieno e nessuno scorrimento laterale a 393px.
    expect((await card.boundingBox()).height).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
    await card.click();

    // Siamo in Prenotazioni, sulla scheda di quella prenotazione.
    await expect(page.getByRole("navigation", { name: "Sezioni" }).getByRole("button", { name: "Prenotazioni", exact: true })).toHaveAttribute("aria-current", "page");
    const opened = sheet(page, "Dettaglio prenotazione");
    await expect(opened).toContainText(name);
    await expect(opened).toContainText("ore 21:15");

    // Da qui si modifica…
    await opened.getByRole("button", { name: "Modifica" }).click();
    const edit = sheet(page, "Modifica prenotazione");
    await edit.getByRole("textbox", { name: "Note (allergie, richieste…)" }).fill("Seggiolone");
    await edit.getByRole("button", { name: "Salva modifiche" }).click();
    await expect(sheet(page, "Dettaglio prenotazione")).toContainText("Seggiolone", { timeout: 10_000 });

    // …e si avvia: si torna ai Tavoli con la comanda aperta.
    await sheet(page, "Dettaglio prenotazione").getByRole("button", { name: "Avvia (apri il tavolo)" }).click();
    const start = sheet(page, `Avvia ${name}`);
    await start.getByRole("spinbutton", { name: "Numero tavolo" }).fill(String(tableNumber));
    await start.getByRole("button", { name: "Apri comanda" }).click();
    await expect(page.getByText(`Tavolo ${tableNumber}`).first()).toBeVisible({ timeout: 10_000 });
  });

  test("uscendo da Prenotazioni e tornandoci si riparte dall'elenco, non dalla prenotazione aperta dai Tavoli", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    const detail = await createReservation(page, name, { time: "22:00" });
    await detail.getByRole("button", { name: "Prenotazioni", exact: true }).click();

    await navTo(page, "Tavoli");
    await page.getByRole("button", { name: new RegExp(`^${name}, ore 22:00.*apri la prenotazione`) }).click();
    await expect(sheet(page, "Dettaglio prenotazione")).toContainText(name);
    await sheet(page, "Dettaglio prenotazione").getByRole("button", { name: "Prenotazioni", exact: true }).click();
    await navTo(page, "Storico");
    await navTo(page, "Prenotazioni");
    await expect(page.getByRole("region", { name: "Prenotazioni del giorno" })).toContainText(name);
    await expect(page.getByRole("dialog", { name: "Dettaglio prenotazione" })).toHaveCount(0);
  });

  // Avvia dalla scheda (aperta) sul tavolo `tableNumber` e torna in Prenotazioni.
  async function startFromDetail(page, name, tableNumber) {
    await sheet(page, "Dettaglio prenotazione").getByRole("button", { name: "Avvia (apri il tavolo)" }).click();
    const start = sheet(page, `Avvia ${name}`);
    await start.getByRole("spinbutton", { name: "Numero tavolo" }).fill(String(tableNumber));
    await start.getByRole("button", { name: "Apri comanda" }).click();
    await expect(page.getByText(`Tavolo ${tableNumber}`).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Tavoli", exact: true }).first().click();
    await navTo(page, "Prenotazioni");
  }

  test("una prenotazione avviata lascia l'elenco del giorno; il cameriere la ritrova tra le avviate ma non la può eliminare", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    const tableNumber = 9600 + Math.floor(Math.random() * 300);
    tables.push(tableNumber);
    await createReservation(page, name, { time: "20:15" });
    await startFromDetail(page, name, tableNumber);

    const day = page.getByRole("region", { name: "Prenotazioni del giorno" });
    const row = day.getByRole("button", { name: new RegExp(`^${name}, ore 20:15`) });
    await expect(row).toHaveCount(0);
    await day.getByRole("button", { name: /mostra avviate, annullate e non presentate/i }).click();
    await expect(row).toContainText("Al tavolo");

    // Niente "Elimina" nella scheda…
    await row.click();
    const detail = sheet(page, "Dettaglio prenotazione");
    await expect(detail.getByRole("button", { name: "Vai al tavolo" })).toBeVisible();
    await expect(detail.getByRole("button", { name: "Elimina prenotazione" })).toHaveCount(0);
    await detail.getByRole("button", { name: "Prenotazioni", exact: true }).click();
    // …né swipe per eliminare (la riga resta un pulsante qualunque: col
    // mouse il trascinamento finisce in un tocco, che apre la scheda).
    await swipeLeft(page, row, 0.9);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Elimina la prenotazione di ${name}` })).toHaveCount(0);
    // Resta traccia di tutto.
    await expect.poll(() => findReservationByName(name)).toMatchObject({ status: "started" });
  });

  test("l'admin elimina una prenotazione annullata dalla scheda: chiede conferma, 'Indietro' la lascia, 'Elimina' la toglie per sempre", async ({ page }) => {
    await login(page, TEST_ADMIN);
    const name = randomName();
    createdNames.push(name);
    const detail = await createReservation(page, name, { time: "13:15" });
    await detail.getByRole("button", { name: "Annulla", exact: true }).click();
    await page.getByRole("alertdialog", { name: `Annullare la prenotazione di ${name}?` }).getByRole("button", { name: "Annulla prenotazione" }).click();
    await expect(detail).toContainText("Annullata", { timeout: 10_000 });

    const remove = detail.getByRole("button", { name: "Elimina prenotazione" });
    expect((await remove.boundingBox()).height).toBeGreaterThanOrEqual(48);
    await remove.click();
    const confirm = page.getByRole("alertdialog", { name: `Eliminare la prenotazione di ${name}?` });
    await confirm.getByRole("button", { name: "Indietro" }).click();
    await expect(detail).toContainText("Annullata");

    await remove.click();
    await confirm.getByRole("button", { name: "Elimina" }).click();
    await expect(page.getByRole("dialog", { name: "Dettaglio prenotazione" })).toHaveCount(0, { timeout: 10_000 });
    await expect.poll(() => findReservationByName(name)).toBeNull();
    // Dopo un ricaricamento non c'è più, nemmeno tra le annullate.
    await page.reload();
    const day = page.getByRole("region", { name: "Prenotazioni del giorno" });
    await expect(day).toBeVisible({ timeout: 10_000 });
    await expect(day).not.toContainText(name);
  });

  test("l'admin elimina con uno swipe: corto scopre 'Elimina' (da toccare), lungo chiede subito conferma", async ({ page }) => {
    await login(page, TEST_ADMIN);
    const short = randomName();
    const long = randomName();
    createdNames.push(short, long);
    await seedReservation(short, { time: "12:30" });
    await seedReservation(long, { time: "12:45" });
    const day = page.getByRole("region", { name: "Prenotazioni del giorno" });
    const shortRow = day.getByRole("button", { name: new RegExp(`^${short}, `) });
    const longRow = day.getByRole("button", { name: new RegExp(`^${long}, `) });
    await expect(shortRow).toBeVisible({ timeout: 10_000 });

    // Corto: l'azione resta scoperta, e lo swipe non apre la scheda.
    await swipeLeft(page, shortRow, 0.3);
    const action = page.getByRole("button", { name: `Elimina la prenotazione di ${short}` });
    await expect(action).toBeVisible();
    expect((await action.boundingBox()).width).toBeGreaterThanOrEqual(48);
    await expect(page.getByRole("dialog", { name: "Dettaglio prenotazione" })).toHaveCount(0);
    await action.click();
    await page.getByRole("alertdialog", { name: `Eliminare la prenotazione di ${short}?` }).getByRole("button", { name: "Elimina" }).click();
    await expect(shortRow).toHaveCount(0, { timeout: 10_000 });
    await expect.poll(() => findReservationByName(short)).toBeNull();

    // Lungo: conferma subito; "Indietro" la lascia dov'era.
    await swipeLeft(page, longRow, 0.9);
    await page.getByRole("alertdialog", { name: `Eliminare la prenotazione di ${long}?` }).getByRole("button", { name: "Indietro" }).click();
    await expect(longRow).toBeVisible();
    await expect.poll(() => findReservationByName(long)).not.toBeNull();
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
  });

  test("nei Tavoli una prenotazione con il tavolo assegnato mostra prima il numero, poi il nome; avviata, il tavolo fa lo stesso", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    const tableNumber = 9450 + Math.floor(Math.random() * 40);
    tables.push(tableNumber);
    await seedReservation(name, { time: "21:30", tableNumber });

    await navTo(page, "Tavoli");
    const card = page.getByRole("region", { name: "Prenotazioni di oggi" }).getByRole("button", { name: new RegExp(`^${name}, ore 21:30.*apri la prenotazione`) });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText(new RegExp(`^Tavolo ${tableNumber} · 21:30${name}`));

    await page.getByRole("button", { name: `Avvia prenotazione di ${name}` }).click();
    await expect(page.getByText(new RegExp(`^Tavolo ${tableNumber} · ${name}$`))).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Tavoli", exact: true }).first().click();
    await expect(page.getByRole("button", { name: new RegExp(`^Tavolo ${tableNumber} \\(${name}\\) — `) })).toBeVisible();
  });
});
