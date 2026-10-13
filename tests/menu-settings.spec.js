import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { TEST_ADMIN } from "./test-env";
import { staffLogin } from "./helpers/staffLogin";
import { PHONE, navTo, sheet } from "./helpers/phone";
import { getMenu, setTranslationRemotely, removeTranslationRemotely, setMenuFieldsRemotely, removeStaffRemotely, findStaffByEmail, removeStaffByEmailRemotely } from "./helpers/menuDoc";

// Impostazioni del menù (MenuSettings.jsx) dal telefono: Menù → Impostazioni,
// ogni voce una pagina intera con "Salva" in fondo. Sostituiscono l'editor
// classico (ex Admin.jsx, "Gestione completa"). Le scritture vanno sul menù
// condiviso dell'emulatore: ogni test ripristina ciò che cambia.
test.use(PHONE);

async function openSettings(page, item) {
  await page.goto("/?area=staff");
  await staffLogin(page, TEST_ADMIN);
  await navTo(page, "Menù");
  await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
  const hub = sheet(page, "Impostazioni del menù");
  await expect(hub).toBeVisible();
  if (!item) return hub;
  await hub.getByRole("button", { name: new RegExp(`^${item}`) }).click();
  return sheet(page, item);
}

test("l'elenco delle impostazioni porta a ogni pagina e si torna indietro", async ({ page }) => {
  const hub = await openSettings(page);
  for (const item of ["Locale e grafica", "Coperto e ricerca", "Link e social", "Traduzioni", "Personale", "Stampa del menù", "Backup"]) {
    await hub.getByRole("button", { name: new RegExp(`^${item}`) }).click();
    const panel = sheet(page, item);
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Impostazioni", exact: true }).click();
    await expect(hub).toBeVisible();
  }
  await hub.getByRole("button", { name: "Piatti", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Locale e link: si salva solo ciò che cambia e il menù dei clienti lo mostra", async ({ page }) => {
  const original = await getMenu();
  try {
    let panel = await openSettings(page, "Locale e grafica");
    await panel.getByRole("textbox", { name: "Nota a piè di pagina" }).fill("Nota dal test del telefono");
    await panel.getByRole("button", { name: "Salva" }).click();
    await expect(panel.getByText("Salvato.")).toBeVisible({ timeout: 10_000 });
    expect((await getMenu()).footerNote).toBe("Nota dal test del telefono");
    expect((await getMenu()).restaurantName).toBe(original.restaurantName);

    await panel.getByRole("button", { name: "Impostazioni", exact: true }).click();
    await sheet(page, "Impostazioni del menù").getByRole("button", { name: /^Link e social/ }).click();
    panel = sheet(page, "Link e social");
    await panel.getByRole("textbox", { name: "Link Recensione Google" }).fill("https://g.page/r/test-review");
    await panel.getByRole("switch", { name: "Mostra Recensione Google" }).click();
    await panel.getByRole("button", { name: "Salva" }).click();
    await expect(panel.getByText("Salvato.")).toBeVisible({ timeout: 10_000 });

    const client = await page.context().newPage();
    await client.goto("/");
    await expect(client.getByText("Nota dal test del telefono")).toBeVisible({ timeout: 10_000 });
    await expect(client.getByRole("link", { name: /lascia una recensione su google/i })).toBeVisible();
    await client.close();
  } finally {
    await setMenuFieldsRemotely({ footerNote: original.footerNote || "", reviewLinks: original.reviewLinks || {} });
  }
});

test("Grafica: il tema scelto è evidenziato (senza salvare non cambia nulla)", async ({ page }) => {
  const panel = await openSettings(page, "Locale e grafica");
  const themes = panel.getByRole("group", { name: "Grafica del menù" });
  const uliveto = themes.getByRole("button", { name: /uliveto/i });
  await uliveto.click();
  await expect(uliveto).toHaveAttribute("aria-pressed", "true");
  await expect(themes.getByRole("button", { pressed: true })).toHaveCount(1);
});

test("Coperto: il prezzo si cambia dal tastierino e vale solo dopo «Usa»", async ({ page }) => {
  const panel = await openSettings(page, "Coperto e ricerca");
  await panel.getByRole("button", { name: "Cambia coperto adulti" }).click();
  for (const d of ["3", "5", "0"]) await panel.getByRole("button", { name: `Cifra ${d}` }).click();
  await panel.getByRole("button", { name: "Usa € 3,50" }).click();
  await expect(panel).toContainText("€ 3,50");
  // Non si salva: altri test in parallelo aprono tavoli con il coperto demo.
  await panel.getByRole("button", { name: "Impostazioni", exact: true }).click();
  expect((await getMenu()).coperto.adults).toBe("2,00");
});

test("Traduzioni: un testo si corregge a mano e la lingua si elimina dopo conferma", async ({ page }) => {
  await setTranslationRemotely("fr", { restaurantName: "Masseria (FR)", tagline: "", footerNote: "", categories: {} });
  try {
    const panel = await openSettings(page, "Traduzioni");
    await panel.getByRole("button", { name: /^FR/ }).click();
    const name = panel.getByRole("textbox", { name: "Nome del ristorante (FR)" });
    await expect(name).toHaveValue("Masseria (FR)");
    await name.fill("La Masseria");
    await panel.getByRole("button", { name: "Salva 1 testo" }).click();
    await expect(panel.getByText("Traduzioni salvate.")).toBeVisible({ timeout: 10_000 });
    expect((await getMenu()).translations.fr.restaurantName).toBe("La Masseria");

    await panel.getByRole("button", { name: "Elimina traduzione FR" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Eliminare la traduzione FR?" });
    await confirm.getByRole("button", { name: "Annulla" }).click();
    expect((await getMenu()).translations.fr).toBeTruthy();
    await panel.getByRole("button", { name: "Elimina traduzione FR" }).click();
    await confirm.getByRole("button", { name: "Elimina traduzione" }).click();
    await expect(panel.getByText("Nessuna traduzione FR")).toBeVisible({ timeout: 10_000 });
    expect((await getMenu()).translations?.fr).toBeUndefined();
  } finally {
    await removeTranslationRemotely("fr");
  }
});

test("Personale: a un account esistente si dà un ruolo dal suo UID e si toglie dopo conferma", async ({ page }) => {
  const uid = `test-uid-${Date.now()}`;
  try {
    const panel = await openSettings(page, "Personale");
    await panel.getByRole("group", { name: "Tipo di account" }).getByRole("button", { name: "Account esistente" }).click();
    await panel.getByRole("textbox", { name: "UID" }).fill(uid);
    await panel.getByRole("textbox", { name: "Nome della persona" }).fill("Persona di prova");
    await panel.getByRole("group", { name: "Ruolo" }).getByRole("button", { name: "Amministratore" }).click();
    await panel.getByRole("button", { name: "Aggiungi persona" }).click();
    const list = panel.getByRole("list", { name: "Persone con accesso" });
    await expect(list).toContainText("Persona di prova · Amministratore", { timeout: 10_000 });

    await panel.getByRole("button", { name: "Togli accesso a Persona di prova" }).click();
    await page.getByRole("alertdialog", { name: "Togliere l'accesso a Persona di prova?" }).getByRole("button", { name: "Togli accesso" }).click();
    await expect(list).not.toContainText("Persona di prova", { timeout: 10_000 });
  } finally {
    await removeStaffRemotely(uid);
  }
});

test("Personale: si crea un account nuovo con email e password, l'admin resta dentro e la persona entra subito", async ({ page, browser }) => {
  test.setTimeout(45_000); // due accessi (admin + persona nuova) e un ricaricamento
  const email = `nuovo-${Date.now()}@test.local`;
  const password = "Prova123!";
  try {
    const panel = await openSettings(page, "Personale");
    // "Nuovo account" è la scelta di partenza: niente più UID da Firebase Console.
    await expect(panel.getByRole("group", { name: "Tipo di account" }).getByRole("button", { name: "Nuovo account" })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("textbox", { name: "UID" })).toHaveCount(0);
    const create = panel.getByRole("button", { name: "Crea account" });
    await expect(create).toBeDisabled();

    await panel.getByRole("textbox", { name: "Nome della persona" }).fill("Cameriere nuovo");
    await panel.getByRole("textbox", { name: "Email della persona" }).fill(email);
    const pwd = panel.getByLabel("Password della persona");
    await pwd.fill("12345"); // sotto il minimo di Firebase (6)
    await expect(create).toBeDisabled();
    await pwd.fill(password);
    await expect(pwd).toHaveAttribute("type", "password");
    await panel.getByRole("button", { name: "Mostra" }).click();
    await expect(pwd).toHaveAttribute("type", "text"); // l'admin la legge per comunicarla
    await create.click();

    await expect(panel.getByRole("status")).toContainText(`entra con ${email}`, { timeout: 10_000 });
    const list = panel.getByRole("list", { name: "Persone con accesso" });
    await expect(list.getByRole("listitem").filter({ hasText: "Cameriere nuovo · Cameriere" })).toContainText(email);
    expect(await findStaffByEmail(email)).toMatchObject({ name: "Cameriere nuovo", role: "waiter", email });
    // Il form si svuota per la persona successiva.
    await expect(panel.getByRole("textbox", { name: "Email della persona" })).toHaveValue("");
    // Creare l'account non fa uscire l'admin (istanza Firebase secondaria).
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Sezioni" }).getByRole("button", { name: "Menù", exact: true })).toBeVisible({ timeout: 10_000 });

    // La persona entra con le credenziali appena create, su un altro telefono.
    const other = await browser.newContext(PHONE);
    try {
      const phone = await other.newPage();
      await phone.goto("/?area=staff");
      await staffLogin(phone, { email, password });
      const nav = phone.getByRole("navigation", { name: "Sezioni" });
      await expect(nav.getByRole("button", { name: "Tavoli", exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(nav.getByRole("button", { name: "Menù", exact: true })).toHaveCount(0); // cameriere, non admin
      // Il ruolo appena assegnato apre i dati (firestore.rules): i tavoli si caricano.
      await expect(phone.getByText("Caricamento tavoli…")).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await other.close();
    }
  } finally {
    await removeStaffByEmailRemotely(email);
  }
});

test("Personale: un'email già usata dà errore e non aggiunge nessuno; il proprio accesso non si può togliere", async ({ page }) => {
  const panel = await openSettings(page, "Personale");
  const list = panel.getByRole("list", { name: "Persone con accesso" });
  await expect(list).toContainText("Admin di test", { timeout: 10_000 });

  await panel.getByRole("textbox", { name: "Nome della persona" }).fill("Doppione");
  await panel.getByRole("textbox", { name: "Email della persona" }).fill(TEST_ADMIN.email);
  await panel.getByLabel("Password della persona").fill("Prova123!");
  await panel.getByRole("button", { name: "Crea account" }).click();
  await expect(panel.getByRole("alert")).toContainText("Esiste già un account con questa email", { timeout: 10_000 });
  // (Niente conteggio delle righe: altri test in parallelo aggiungono/tolgono persone.)
  await expect(list).not.toContainText("Doppione");
  // I dati restano nel form, per correggere l'email.
  await expect(panel.getByRole("textbox", { name: "Nome della persona" })).toHaveValue("Doppione");

  // Riga dell'admin collegato: "Tu" invece di "Togli" (non ci si chiude fuori da soli).
  const me = list.getByRole("listitem").filter({ hasText: "Admin di test" });
  await expect(me).toContainText("Tu");
  await expect(me.getByRole("button", { name: /Togli accesso/ })).toHaveCount(0);
  await expect(list.getByRole("button", { name: "Togli accesso a Cameriere di test" })).toBeVisible();
});

test("Personale sul telefono: nessuno scorrimento laterale, 'Crea account' in basso e grande", async ({ page }) => {
  const panel = await openSettings(page, "Personale");
  await expect(panel.getByRole("list", { name: "Persone con accesso" })).toContainText("Admin di test", { timeout: 10_000 });
  const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const create = panel.getByRole("button", { name: "Crea account" });
  const box = await create.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(48);
  expect(box.y + box.height).toBeGreaterThan(851 - 120); // nella barra in fondo alla pagina
  for (const name of ["Mostra", "Nuovo account", "Account esistente", "Cameriere", "Amministratore"]) {
    expect((await panel.getByRole("button", { name, exact: true }).boundingBox()).height).toBeGreaterThanOrEqual(48);
  }
});

test("Stampa del menù: errore senza categorie, poi l'anteprima si apre in una nuova scheda", async ({ page }) => {
  const panel = await openSettings(page, "Stampa del menù");
  const cats = panel.getByRole("group", { name: "Categorie da stampare" }).getByRole("button");
  const count = await cats.count();
  for (let i = 0; i < count; i++) await cats.nth(i).click();
  await panel.getByRole("button", { name: "Apri anteprima di stampa" }).click();
  await expect(panel.getByText(/nessun piatto da stampare/i)).toBeVisible();

  await cats.first().click();
  const [preview] = await Promise.all([
    page.context().waitForEvent("page"),
    panel.getByRole("button", { name: "Apri anteprima di stampa" }).click(),
  ]);
  await expect(preview).toHaveURL(/\?print=1/);
  await expect(preview.getByText("Bruschetta")).toBeVisible({ timeout: 10_000 });
});

test("Backup: si scarica il menù; un file non valido dà errore; un backup valido chiede conferma", async ({ page }) => {
  const panel = await openSettings(page, "Backup");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("button", { name: "Scarica backup (JSON)" }).click(),
  ]);
  const backup = JSON.parse(await readFile(await download.path(), "utf-8"));
  expect(Array.isArray(backup.categories)).toBe(true);

  const fileInput = panel.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "rotto.json", mimeType: "application/json", buffer: Buffer.from("{ non è json") });
  await expect(panel.getByText("Il file non è un JSON valido.")).toBeVisible();

  await fileInput.setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  const confirm = page.getByRole("alertdialog", { name: "Sostituire tutto il menù con il backup?" });
  await expect(confirm).toBeVisible();
  // Non si ripristina davvero: altri test in parallelo modificano il menù.
  await confirm.getByRole("button", { name: "Annulla" }).click();
  await expect(panel.getByText("Menù ripristinato dal backup.")).toHaveCount(0);
});

test("'Vedi il menù dei clienti' apre il menù pubblico", async ({ page }) => {
  const hub = await openSettings(page);
  await hub.getByRole("button", { name: /^Vedi il menù dei clienti/ }).click();
  await expect(page.getByRole("button", { name: /area riservata/i })).toBeVisible({ timeout: 10_000 });
  await expect(page).not.toHaveURL(/area=staff/);
});
