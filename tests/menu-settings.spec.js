import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { TEST_ADMIN, TEST_OWNER } from "./test-env";
import { staffLogin } from "./helpers/staffLogin";
import { PHONE, navTo, sheet } from "./helpers/phone";
import { getTillLock, pinMatchesRemotely, resetTillLockRemotely } from "./helpers/staffRoles";
import { getMenu, setTranslationRemotely, removeTranslationRemotely, setMenuFieldsRemotely, removeStaffRemotely, findStaffByEmail, removeStaffByEmailRemotely, usernameEmail } from "./helpers/menuDoc";

// Impostazioni del menù (MenuSettings.jsx) dal telefono: Menù → Impostazioni,
// ogni voce una pagina intera con "Salva" in fondo. Sostituiscono l'editor
// classico (ex Admin.jsx, "Gestione completa"). Le scritture vanno sul menù
// condiviso dell'emulatore: ogni test ripristina ciò che cambia.
test.use(PHONE);

async function openSettings(page, item, account = TEST_ADMIN) {
  await page.goto("/?area=staff");
  await staffLogin(page, account);
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
    await expect.poll(async () => (await getMenu()).translations.fr.restaurantName).toBe("La Masseria");

    await panel.getByRole("button", { name: "Elimina traduzione FR" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Eliminare la traduzione FR?" });
    await confirm.getByRole("button", { name: "Annulla" }).click();
    expect((await getMenu()).translations.fr).toBeTruthy();
    await panel.getByRole("button", { name: "Elimina traduzione FR" }).click();
    await confirm.getByRole("button", { name: "Elimina traduzione" }).click();
    await expect(panel.getByText("Nessuna traduzione FR")).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await getMenu()).translations?.fr).toBeUndefined();
  } finally {
    await removeTranslationRemotely("fr");
  }
});

test("Personale: il proprietario dà a un account esistente il ruolo di amministratore dal suo UID e lo toglie dopo conferma", async ({ page }) => {
  const uid = `test-uid-${Date.now()}`;
  try {
    const panel = await openSettings(page, "Personale", TEST_OWNER);
    await expect(panel.getByRole("region", { name: "Proprietario" })).toContainText("Proprietario di test (tu)", { timeout: 10_000 });
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

test("Personale: si crea un account nuovo con nome utente e password, l'admin resta dentro e la persona entra con il nome utente", async ({ page, browser }) => {
  test.setTimeout(45_000); // due accessi (admin + persona nuova) e un ricaricamento
  const username = `nuovo-${Date.now()}`;
  const email = usernameEmail(username);
  const password = "Prova123!";
  try {
    const panel = await openSettings(page, "Personale");
    // "Nuovo account" è la scelta di partenza: niente più UID da Firebase Console.
    await expect(panel.getByRole("group", { name: "Tipo di account" }).getByRole("button", { name: "Nuovo account" })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("textbox", { name: "UID" })).toHaveCount(0);
    // Solo un nome utente: nessun campo email.
    await expect(panel.getByRole("textbox", { name: /email/i })).toHaveCount(0);
    const create = panel.getByRole("button", { name: "Crea account" });
    await expect(create).toBeDisabled();

    await panel.getByRole("textbox", { name: "Nome della persona" }).fill("Cameriere nuovo");
    const user = panel.getByRole("textbox", { name: "Nome utente della persona" });
    // Un'email (o spazi, «@») non è un nome utente: errore visibile, niente creazione.
    await user.fill("marco@esempio.it");
    await expect(panel.getByRole("alert")).toContainText("Nome utente non valido");
    await expect(create).toBeDisabled();
    await user.fill(username.toUpperCase()); // le maiuscole diventano minuscole
    await expect(user).toHaveValue(username);
    await expect(panel.getByRole("alert")).toHaveCount(0);
    const pwd = panel.getByLabel("Password della persona");
    await pwd.fill("12345"); // sotto il minimo di Firebase (6)
    await expect(create).toBeDisabled();
    await pwd.fill(password);
    await expect(pwd).toHaveAttribute("type", "password");
    await panel.getByRole("button", { name: "Mostra" }).click();
    await expect(pwd).toHaveAttribute("type", "text"); // l'admin la legge per comunicarla
    await create.click();

    await expect(panel.getByRole("status")).toContainText(`entra con il nome utente ${username}`, { timeout: 10_000 });
    const list = panel.getByRole("list", { name: "Persone con accesso" });
    const row = list.getByRole("listitem").filter({ hasText: "Cameriere nuovo · Cameriere" });
    await expect(row).toContainText(username);
    await expect(row).not.toContainText("@"); // l'indirizzo interno non si vede
    await expect.poll(() => findStaffByEmail(email)).toMatchObject({ name: "Cameriere nuovo", role: "waiter", username });
    // Il form si svuota per la persona successiva.
    await expect(user).toHaveValue("");
    // Creare l'account non fa uscire l'admin (istanza Firebase secondaria).
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Sezioni" }).getByRole("button", { name: "Menù", exact: true })).toBeVisible({ timeout: 10_000 });

    // La persona entra con il nome utente appena creato, su un altro telefono.
    const other = await browser.newContext(PHONE);
    try {
      const phone = await other.newPage();
      await phone.goto("/?area=staff");
      await staffLogin(phone, { email: username, password });
      const nav = phone.getByRole("navigation", { name: "Sezioni" });
      await expect(nav.getByRole("button", { name: "Tavoli", exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(nav.getByRole("button", { name: "Menù", exact: true })).toHaveCount(0); // cameriere, non admin
      // Il ruolo appena assegnato apre i dati (firestore.rules): i tavoli si caricano.
      await expect(phone.getByText("Caricamento tavoli…")).toHaveCount(0, { timeout: 15_000 });
      // Dopo l'uscita "Rientra come …" mostra il nome utente, non l'indirizzo interno.
      await phone.getByRole("button", { name: /^esci$/i }).click();
      await expect(phone.getByRole("button", { name: `Rientra come Cameriere nuovo (${username})` })).toBeVisible({ timeout: 10_000 });
    } finally {
      await other.close();
    }
  } finally {
    await removeStaffByEmailRemotely(email);
  }
});

test("Personale: un nome utente già usato dà errore e non aggiunge nessuno; il proprio accesso non si può togliere", async ({ page }) => {
  const username = `doppio-${Date.now()}`;
  try {
    const panel = await openSettings(page, "Personale");
    const list = panel.getByRole("list", { name: "Persone con accesso" });
    await expect(list).toContainText("Admin di test", { timeout: 10_000 });

    const add = async (name) => {
      await panel.getByRole("textbox", { name: "Nome della persona" }).fill(name);
      await panel.getByRole("textbox", { name: "Nome utente della persona" }).fill(username);
      await panel.getByLabel("Password della persona").fill("Prova123!");
      await panel.getByRole("button", { name: "Crea account" }).click();
    };
    await add("Originale");
    // Il messaggio arriva quando il form si è svuotato (l'elenco si aggiorna
    // prima, con la scrittura locale): solo allora si riempie di nuovo.
    await expect(panel.getByRole("status")).toContainText("Originale aggiunto", { timeout: 10_000 });
    await expect(list).toContainText("Originale · Cameriere");
    await add("Doppione");
    await expect(panel.getByRole("alert")).toContainText("Questo nome utente è già usato", { timeout: 10_000 });
    // (Niente conteggio delle righe: altri test in parallelo aggiungono/tolgono persone.)
    await expect(list).not.toContainText("Doppione");
    // I dati restano nel form, per correggere il nome utente.
    await expect(panel.getByRole("textbox", { name: "Nome della persona" })).toHaveValue("Doppione");
    await expect(panel.getByRole("textbox", { name: "Nome utente della persona" })).toHaveValue(username);

    // Riga dell'admin collegato: "Tu" invece di "Togli" (non ci si chiude fuori da soli).
    const me = list.getByRole("listitem").filter({ hasText: "Admin di test" });
    await expect(me).toContainText("Tu");
    await expect(me.getByRole("button", { name: /Togli accesso/ })).toHaveCount(0);
    await expect(list.getByRole("button", { name: "Togli accesso a Cameriere di test" })).toBeVisible();
  } finally {
    await removeStaffByEmailRemotely(usernameEmail(username));
  }
});

test("Personale: un amministratore aggiunge solo camerieri e non tocca il proprietario né gli altri amministratori", async ({ page }) => {
  const panel = await openSettings(page, "Personale");
  const list = panel.getByRole("list", { name: "Persone con accesso" });
  await expect(list).toContainText("Proprietario di test · Proprietario", { timeout: 10_000 });
  const owner = panel.getByRole("region", { name: "Proprietario" });
  await expect(owner).toContainText("Proprietario di test");
  // C'è già un proprietario: niente presa in carico, niente passaggio.
  await expect(owner.getByRole("button")).toHaveCount(0);
  await expect(list.getByRole("button", { name: "Togli accesso a Proprietario di test" })).toHaveCount(0);
  await expect(list.getByRole("button", { name: "Togli accesso a Cameriere di test" })).toBeVisible();
  // Il ruolo non si sceglie: solo Cameriere.
  await expect(panel.getByRole("group", { name: "Ruolo" })).toHaveCount(0);
  await expect(panel.getByText("solo il proprietario aggiunge amministratori")).toBeVisible();
});

test("Personale: il proprietario sceglie tra Cameriere e Amministratore, toglie gli amministratori e può passare la proprietà (poi annulla)", async ({ page }) => {
  const panel = await openSettings(page, "Personale", TEST_OWNER);
  const list = panel.getByRole("list", { name: "Persone con accesso" });
  await expect(list).toContainText("Admin di test", { timeout: 10_000 });
  await expect(list.getByRole("button", { name: "Togli accesso a Admin di test" })).toBeVisible();
  await expect(list.getByRole("listitem").filter({ hasText: "Proprietario di test" })).toContainText("Tu");
  const roles = panel.getByRole("group", { name: "Ruolo" });
  await expect(roles.getByRole("button", { name: "Cameriere" })).toHaveAttribute("aria-pressed", "true");
  await expect(roles.getByRole("button", { name: "Amministratore" })).toBeVisible();
  await expect(roles.getByRole("button", { name: "Proprietario" })).toHaveCount(0);

  const owner = panel.getByRole("region", { name: "Proprietario" });
  await owner.getByRole("button", { name: "Passa la proprietà…" }).click();
  const choice = owner.getByRole("group", { name: "Nuovo proprietario" });
  await choice.getByRole("button", { name: "Admin di test" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Passare la proprietà a Admin di test?" });
  await confirm.getByRole("button", { name: "Annulla" }).click();
  await choice.getByRole("button", { name: "Annulla" }).click();
  await expect(owner).toContainText("Proprietario di test (tu)");
});

test("Blocco cassa: senza PIN non si attiva; PIN da tastierino (mai in chiaro), tempo e avvio si salvano", async ({ page }) => {
  try {
    await resetTillLockRemotely();
    const panel = await openSettings(page, "Blocco cassa");
    await expect(panel.getByText("Nessun PIN impostato.")).toBeVisible({ timeout: 10_000 });
    const save = panel.getByRole("button", { name: "Salva" });
    await expect(save).toBeDisabled(); // nulla di cambiato
    await panel.getByRole("switch", { name: "Blocca la cassa con un PIN" }).click();
    await save.click();
    await expect(panel.getByRole("alert")).toContainText("Scegli un PIN");

    // Troppo corto.
    for (const d of "123") await panel.getByRole("button", { name: `Cifra ${d}` }).click();
    await expect(panel.getByRole("status", { name: "PIN: 3 cifre" })).toBeVisible();
    await save.click();
    await expect(panel.getByRole("alert").first()).toContainText("4");
    // Lunghezza libera: 6 cifre.
    for (const d of "456") await panel.getByRole("button", { name: `Cifra ${d}` }).click();
    await expect(panel.getByRole("status", { name: "PIN: 6 cifre" })).toBeVisible();
    await expect(panel.getByText("123456", { exact: true })).toHaveCount(0); // solo pallini
    await panel.getByRole("group", { name: "Si blocca dopo" }).getByRole("button", { name: "10 min" }).click();
    await panel.getByRole("switch", { name: "Bloccata all'avvio" }).click();
    await save.click();
    await expect(panel.getByRole("status").filter({ hasText: "Blocco della cassa salvato." })).toBeVisible({ timeout: 10_000 });

    await expect.poll(getTillLock).toMatchObject({ enabled: true, timeoutMinutes: 10, lockOnStart: false });
    const saved = await getTillLock();
    expect(JSON.stringify(saved)).not.toContain("123456");
    expect(await pinMatchesRemotely("123456", saved)).toBe(true);
    // Dopo il salvataggio: PIN già impostato, il campo è vuoto.
    await expect(panel.getByText(/Un PIN è già impostato/)).toBeVisible();
    await expect(panel.getByRole("status", { name: "Nuovo PIN: 0 cifre" })).toBeVisible();

    // Il telefono non si blocca: niente "Blocca" né schermata di blocco.
    await expect(page.getByRole("dialog", { name: "Cassa bloccata" })).toHaveCount(0);

    // Persistenza: riaperta la pagina, le scelte sono quelle salvate.
    await page.reload();
    await navTo(page, "Menù");
    await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
    await sheet(page, "Impostazioni del menù").getByRole("button", { name: /^Blocco cassa/ }).click();
    const again = sheet(page, "Blocco cassa");
    await expect(again.getByRole("switch", { name: "Blocca la cassa con un PIN" })).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });
    await expect(again.getByRole("group", { name: "Si blocca dopo" }).getByRole("button", { name: "10 min" })).toHaveAttribute("aria-pressed", "true");
    const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect((await again.getByRole("button", { name: "Salva" }).boundingBox()).height).toBeGreaterThanOrEqual(48);
  } finally {
    await resetTillLockRemotely();
  }
});

test("Personale sul telefono: nessuno scorrimento laterale, 'Crea account' in basso e grande", async ({ page }) => {
  // Come proprietario: è l'unico con la scelta del ruolo (Cameriere/Amministratore).
  const panel = await openSettings(page, "Personale", TEST_OWNER);
  await expect(panel.getByRole("list", { name: "Persone con accesso" })).toContainText("Admin di test", { timeout: 10_000 });
  const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const create = panel.getByRole("button", { name: "Crea account" });
  const box = await create.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(48);
  expect(box.y + box.height).toBeGreaterThan(851 - 120); // nella barra in fondo alla pagina
  for (const name of ["Mostra", "Nuovo account", "Account esistente", "Cameriere", "Amministratore", "Passa la proprietà…"]) {
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
