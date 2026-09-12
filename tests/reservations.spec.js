import { test, expect } from "@playwright/test";
import { TEST_WAITER } from "./test-env";
import { deleteTestReservationByName, deleteTestOrderByTableNumber } from "./firestore-cleanup";

// Stesso formatter usato in Reservations.jsx per l'aria-label delle celle
// del calendario ("15 settembre 2026" [, N prenotazioni, M coperti]).
const CELL_DATE_LABEL = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" });
const DAY_HEADER_LABEL = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

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

  test("il calendario mostra una panoramica di prenotazioni e coperti per il giorno", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);
    await createReservation(page, name); // usa la data selezionata di default: oggi

    const todayCell = page.getByRole("button", { name: CELL_DATE_LABEL.format(new Date()) });
    await expect(todayCell).toBeVisible();
    // L'aria-label include "N prenotazioni, M coperti" solo quando la cella
    // ha almeno una prenotazione attiva — la prenotazione appena creata
    // (pending) lo garantisce, indipendentemente da eventuali altre
    // prenotazioni di oggi create da test paralleli.
    await expect(todayCell).toHaveAccessibleName(/\d+ prenotazioni, \d+ coperti/);
  });

  test("scorrendo la lista oltre le prenotazioni di oggi compaiono quelle del giorno successivo, e il calendario segue", async ({ page }) => {
    await login(page);
    const name = randomName();
    createdNames.push(name);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);

    await page.getByRole("button", { name: /^nuova$/i }).click();
    await page.getByPlaceholder("es. Famiglia Rossi").fill(name);
    await page.locator('input[type="date"]').fill(tomorrowKey);
    await page.getByRole("button", { name: /^salva \(da confermare\)$/i }).click();
    await expect(page.getByText("Nuova prenotazione")).toHaveCount(0, { timeout: 10_000 });

    // La sezione di domani esiste già nel DOM (l'agenda carica una finestra
    // di giorni attorno alla data selezionata, non solo il giorno corrente):
    // basta scorrerci sopra, senza dover ricreare/riaprire la pagina.
    // Allinea esplicitamente l'intestazione del giorno in cima al viewport
    // (block: "start"): scrollIntoViewIfNeeded si limita a scorrere quanto
    // basta per renderla visibile, e potrebbe fermarsi con l'intestazione
    // ancora in fondo allo schermo — sotto la soglia con cui l'agenda decide
    // quale giorno è "in vista" (vedi AGENDA_TOP_MARGIN in Reservations.jsx).
    const tomorrowHeader = page.getByText(DAY_HEADER_LABEL.format(tomorrow), { exact: false });
    await tomorrowHeader.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });

    // Il calendario in alto segue lo scroll: la cella di domani deve
    // risultare selezionata (sfondo pieno, non trasparente) una volta che
    // la sua sezione è entrata in vista.
    const tomorrowCell = page.getByRole("button", { name: new RegExp(CELL_DATE_LABEL.format(tomorrow)) });
    await expect(tomorrowCell).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });

  test("il calendario resta raggiungibile anche dopo aver scorso molto l'agenda avanti e indietro", async ({ page }) => {
    await login(page);

    const monthNav = page.getByRole("button", { name: "Mese successivo" });
    const before = await monthNav.boundingBox();

    // L'agenda (la lista dei giorni) ha un proprio box di scroll indipendente
    // dalla pagina: scorrerla molto in avanti — anche per decine di "pagine"
    // di rotellina, così l'agenda deve estendere più volte la finestra
    // caricata — non deve mai spostare il calendario, che sta fuori da quel
    // box (bug: prima lo scroll era sull'intera pagina, e tornare indietro
    // dopo essere scesi riattivava l'estensione all'indietro invece di far
    // ricomparire il calendario).
    const firstDay = page.locator("[data-day-key]").first();
    const dayBox = await firstDay.boundingBox();
    await page.mouse.move(dayBox.x + dayBox.width / 2, dayBox.y + 10);
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 4000);
    }
    await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBe(0);
    expect((await monthNav.boundingBox()).y).toBeCloseTo(before.y, 0);

    // E scorrendo indietro (anche superando abbondantemente il punto di
    // partenza) il calendario è sempre lì, senza bisogno di alcun pulsante
    // "torna al calendario".
    for (let i = 0; i < 14; i++) {
      await page.mouse.wheel(0, -4000);
    }
    await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBe(0);
    await expect(monthNav).toBeVisible();
    expect((await monthNav.boundingBox()).y).toBeCloseTo(before.y, 0);
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
