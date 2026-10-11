import { test, expect } from "@playwright/test";
import { TEST_WAITER, TEST_ADMIN, TEST_KITCHEN } from "./test-env";
import { staffLogin } from "./helpers/staffLogin";
import { installDesktopBridgeMock } from "./helpers/desktopBridge";

// Comodità della cassa nel client Windows (docs/stampa-scontrini.md): menu
// "Cassa" (rotella delle impostazioni con lo stato della stampante: tastiera
// virtuale, schermo intero, impostazioni, chiusura con conferma), banner di
// aggiornamento dell'interfaccia e del programma, accesso
// automatico con l'account della cassa salvato nel client, conferma su
// "Esci". Il client è simulato con window.mdpDesktop (helpers/desktopBridge.js).
//
// Progetto Playwright dedicato (playwright.config.js): ogni pagina qui è una
// "cassa" con la stazione di stampa attiva, quindi non deve girare in
// parallelo con tests/receipt-printing.spec.js.

async function expectSignedInAsWaiter(page) {
  await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
}

test("il menu Cassa apre tastiera, schermo intero, impostazioni e chiude il programma solo dopo conferma", async ({ page }) => {
  await installDesktopBridgeMock(page);
  await page.goto("/cameriere");
  // Prima del login la stazione è inattiva (nessun accesso a Firestore).
  await expect(page.getByRole("button", { name: /stampante non attiva: serve il login/i })).toBeVisible({ timeout: 10_000 });
  await staffLogin(page, TEST_ADMIN);
  const cassa = page.getByRole("button", { name: /stampante: pronta.*apri menu cassa/i });
  await expect(cassa).toBeVisible({ timeout: 10_000 });
  const menu = page.getByRole("menu", { name: "Menu cassa" });

  await cassa.click();
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Tastiera" }).click();
  expect(await page.evaluate(() => globalThis.__keyboardToggles)).toBe(1);
  await expect(menu).toHaveCount(0); // si chiude per lasciare spazio alla tastiera

  await cassa.click();
  await menu.getByRole("menuitem", { name: "Esci da schermo intero" }).click();
  expect(await page.evaluate(() => globalThis.__fullscreen)).toBe(false);
  await expect(menu.getByRole("menuitem", { name: "Schermo intero" })).toBeVisible();

  await menu.getByRole("menuitem", { name: "Impostazioni stampante" }).click();
  expect(await page.evaluate(() => globalThis.__settingsOpened)).toBe(1);

  // Chiusura: un tocco sbagliato non chiude nulla.
  await cassa.click();
  await menu.getByRole("menuitem", { name: "Chiudi programma" }).click();
  const dialog = page.getByRole("alertdialog", { name: /chiudere il programma della cassa/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Annulla" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.__quit)).toBe(false);

  await cassa.click();
  await menu.getByRole("menuitem", { name: "Chiudi programma" }).click();
  await dialog.getByRole("button", { name: "Chiudi programma" }).click();
  expect(await page.evaluate(() => globalThis.__quit)).toBe(true);
});

test("con un client vecchio (1.0.0) il menu offre solo le impostazioni stampante", async ({ page }) => {
  await installDesktopBridgeMock(page, { legacy: true });
  await page.goto("/cameriere");
  await staffLogin(page, TEST_ADMIN);
  await page.getByRole("button", { name: /apri menu cassa/i }).click();
  const menu = page.getByRole("menu", { name: "Menu cassa" });
  await expect(menu.getByRole("menuitem", { name: "Impostazioni stampante" })).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
});

test("il pulsante del menu Cassa è una rotella delle impostazioni con il pallino di stato della stampante", async ({ page }) => {
  await installDesktopBridgeMock(page);
  await page.goto("/cameriere");
  await staffLogin(page, TEST_ADMIN);
  const cassa = page.getByRole("button", { name: /stampante: pronta.*apri menu cassa/i });
  await expect(cassa).toBeVisible({ timeout: 10_000 });
  await expect(cassa.locator("svg.lucide-settings")).toHaveCount(1);
  await expect(cassa.locator("svg.lucide-printer")).toHaveCount(0);
});

test("nuova versione dell'interfaccia: banner, 'Aggiorna ora' ricarica e dopo il ricaricamento conferma l'aggiornamento", async ({ page }) => {
  await installDesktopBridgeMock(page);
  await page.goto("/cameriere");
  await staffLogin(page, TEST_ADMIN);
  await expect(page.getByRole("button", { name: /apri menu cassa/i })).toBeVisible({ timeout: 10_000 });
  const banner = page.getByRole("status", { name: "Aggiornamenti" });
  await expect(banner).toHaveCount(0);

  // Nuovo deploy rilevato: banner, non un ricaricamento forzato in mezzo al lavoro.
  await page.evaluate(() => globalThis.__fireUpdateAvailable());
  await expect(banner).toContainText("nuova versione dell'interfaccia");
  await banner.getByRole("button", { name: /aggiorna ora/i }).click();
  await expect(banner).toContainText("Aggiornamento dell'interfaccia in corso");
  expect(await page.evaluate(() => globalThis.__reloaded)).toBe(true);

  // Il client vero ricarica la pagina: al rientro il banner lo conferma.
  await page.reload();
  await expect(banner).toContainText("Interfaccia aggiornata all'ultima versione.", { timeout: 10_000 });
  await banner.getByRole("button", { name: "Chiudi avviso" }).click();
  await expect(banner).toHaveCount(0);
});

test("aggiornamento del programma: banner di download con avanzamento, pronto, installazione", async ({ page }) => {
  await installDesktopBridgeMock(page);
  await page.goto("/cameriere");
  await staffLogin(page, TEST_ADMIN);
  await expect(page.getByRole("button", { name: /apri menu cassa/i })).toBeVisible({ timeout: 10_000 });
  const banner = page.getByRole("status", { name: "Aggiornamenti" });

  await page.evaluate(() => globalThis.__fireClientUpdate({ status: "checking" }));
  await expect(banner).toHaveCount(0); // il semplice controllo non disturba
  await page.evaluate(() => globalThis.__fireClientUpdate({ status: "downloading", version: "1.3.0", progress: 42 }));
  await expect(banner).toContainText("Download dell'aggiornamento del programma (versione 1.3.0) in corso — 42%");
  await expect(banner.getByRole("button", { name: /aggiorna ora/i })).toHaveCount(0);

  // Il client segnala il download anche come "nuova versione": il testo resta quello del programma.
  await page.evaluate(() => {
    globalThis.__fireClientUpdate({ status: "downloaded", version: "1.3.0" });
    globalThis.__fireUpdateAvailable();
  });
  await expect(banner).toContainText("Aggiornamento del programma pronto (versione 1.3.0)");
  await banner.getByRole("button", { name: /aggiorna ora/i }).click();
  // Prima di chiudere il programma: avviso con conto alla rovescia, così
  // nessuno lo riapre a mano mentre l'installer silenzioso lavora.
  await expect(banner).toContainText(/Installazione della versione 1\.3\.0: tra \d secondi il programma si chiude e si riapre da solo/);
  await expect(banner).toContainText("Non riaprirlo nel frattempo");
  expect(await page.evaluate(() => globalThis.__reloaded)).toBe(false);
  await expect.poll(() => page.evaluate(() => globalThis.__reloaded), { timeout: 10_000 }).toBe(true);
});

test("errore di aggiornamento del programma: avviso chiudibile, riprova da solo", async ({ page }) => {
  await installDesktopBridgeMock(page);
  await page.goto("/cameriere");
  await staffLogin(page, TEST_ADMIN);
  await expect(page.getByRole("button", { name: /apri menu cassa/i })).toBeVisible({ timeout: 10_000 });
  const banner = page.getByRole("status", { name: "Aggiornamenti" });
  await page.evaluate(() => globalThis.__fireClientUpdate({ status: "error", error: "net::ERR_INTERNET_DISCONNECTED" }));
  await expect(banner).toContainText("non riuscito: riproverà da solo più tardi");
  await expect(banner).toContainText("ERR_INTERNET_DISCONNECTED");
  await banner.getByRole("button", { name: "Chiudi avviso" }).click();
  await expect(banner).toHaveCount(0);
});

test("dopo il riavvio con una nuova versione del programma il banner conferma l'aggiornamento", async ({ page }) => {
  await page.addInitScript(() => {
    if (!globalThis.sessionStorage.getItem("seeded")) {
      globalThis.localStorage.setItem("mdp.clientVersion", "1.1.0");
      globalThis.sessionStorage.setItem("seeded", "1");
    }
  });
  await installDesktopBridgeMock(page, { version: "1.2.0" });
  await page.goto("/cameriere");
  const banner = page.getByRole("status", { name: "Aggiornamenti" });
  await expect(banner).toContainText("Programma aggiornato alla versione 1.2.0.", { timeout: 10_000 });
  // Solo la prima volta: ricaricando non si ripete.
  await page.reload();
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10_000 });
  await expect(banner).toHaveCount(0);
});

test("con le credenziali della cassa salvate l'accesso è automatico", async ({ page }) => {
  await installDesktopBridgeMock(page, { savedLogin: TEST_WAITER });
  await page.goto("/cameriere");
  await expectSignedInAsWaiter(page);
});

test("con un client 1.1–1.3 'Esci' resta (non c'è il logout nelle impostazioni), chiede conferma e si rientra con un tocco", async ({ page }) => {
  await installDesktopBridgeMock(page, { savedLogin: TEST_WAITER, noSettingsLogout: true });
  await page.goto("/cameriere");
  await expectSignedInAsWaiter(page);

  // Tocco per sbaglio: "Annulla" lascia tutto com'era.
  await page.getByRole("button", { name: /^esci$/i }).click();
  const dialog = page.getByRole("alertdialog", { name: /uscire dall'account/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Annulla" }).click();
  await expect(dialog).toHaveCount(0);
  await expectSignedInAsWaiter(page);

  // Uscita voluta: niente rientro automatico (si può usare un altro
  // account), ma basta un tocco per tornare sull'account della cassa.
  await page.getByRole("button", { name: /^esci$/i }).click();
  await dialog.getByRole("button", { name: "Esci" }).click();
  const oneTap = page.getByRole("button", { name: `Accedi come ${TEST_WAITER.email}` });
  await expect(oneTap).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toHaveCount(0);
  await oneTap.click();
  await expectSignedInAsWaiter(page);
});

test("con il client 1.4 non c'è nessun 'Esci' nell'interfaccia: il logout si fa dalle impostazioni del programma", async ({ page }) => {
  await installDesktopBridgeMock(page, { savedLogin: TEST_ADMIN });
  await page.goto("/?area=staff");
  // Alla cassa l'admin entra direttamente nella Sala (niente Dashboard da
  // telefono): nessun "Esci" in nessuna sezione.
  const nav = page.getByRole("navigation", { name: "Sezioni della sala" });
  await expect(nav).toBeVisible({ timeout: 10_000 });
  for (const section of [/^tavoli/i, /^prenotazioni$/i, /^storico$/i, /^menù$/i, /^statistiche$/i]) {
    await nav.getByRole("button", { name: section }).click();
    await expect(page.getByRole("button", { name: /^esci$/i })).toHaveCount(0);
  }
  // Nemmeno nella gestione completa del menù.
  await nav.getByRole("button", { name: /^menù$/i }).click();
  await page.getByRole("button", { name: "Gestione completa" }).click();
  await expect(page.getByText("Identità del locale", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /^esci$/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Menù della cassa" }).click();
  await expect(page.getByRole("region", { name: "Piatti del menù" })).toBeVisible();

  // "Esci dall'account" confermato nelle impostazioni del programma.
  await page.evaluate(() => globalThis.__fireLogoutRequest());
  const oneTap = page.getByRole("button", { name: `Accedi come ${TEST_ADMIN.email}` });
  await expect(oneTap).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1000);
  await expect(nav).toHaveCount(0); // nessun rientro automatico
  await oneTap.click();
  await expect(nav).toBeVisible({ timeout: 10_000 });
});

test("alla cassa senza account salvato, dopo l'uscita il login propone 'Rientra come …' con l'ultimo account", async ({ page }) => {
  await installDesktopBridgeMock(page);
  await page.goto("/?area=staff");
  await staffLogin(page, TEST_WAITER);
  const nav = page.getByRole("navigation", { name: "Sezioni della sala" });
  await expect(nav).toBeVisible({ timeout: 10_000 });

  // "Esci dall'account" dalle impostazioni del programma.
  await page.evaluate(() => globalThis.__fireLogoutRequest());
  const again = page.getByRole("button", { name: `Rientra come Cameriere di test (${TEST_WAITER.email})` });
  await expect(again).toBeVisible({ timeout: 10_000 });
  await expect(again).toHaveCSS("min-height", "56px");
  await again.click();
  await expect(page.locator('input[type="email"]')).toHaveValue(TEST_WAITER.email);
  const password = page.locator('input[type="password"]');
  await expect(password).toBeFocused();
  await password.fill(TEST_WAITER.password);
  await page.getByRole("button", { name: /^accedi$/i }).click();
  await expect(nav).toBeVisible({ timeout: 10_000 });
});

test("alla cassa con l'account salvato non compare un secondo suggerimento per lo stesso account", async ({ page }) => {
  await installDesktopBridgeMock(page, { savedLogin: TEST_ADMIN });
  await page.goto("/?area=staff");
  const nav = page.getByRole("navigation", { name: "Sezioni della sala" });
  await expect(nav).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => globalThis.__fireLogoutRequest());
  await expect(page.getByRole("button", { name: `Accedi come ${TEST_ADMIN.email}` })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /rientra come/i })).toHaveCount(0);
});

test("un account con il vecchio ruolo cucina non ha più un'area: un messaggio spiega perché, senza 'Esci' alla cassa", async ({ page }) => {
  await installDesktopBridgeMock(page, { savedLogin: TEST_KITCHEN });
  await page.goto("/?area=staff");
  await expect(page.getByText("L'area Cucina non c'è più")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/comande stampate dalla cassa/i)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sezioni della sala" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^esci$/i })).toHaveCount(0);
});

test("credenziali della cassa sbagliate mostrano un errore comprensibile", async ({ page }) => {
  await installDesktopBridgeMock(page, { savedLogin: { email: TEST_WAITER.email, password: "sbagliata" } });
  await page.goto("/cameriere");
  await expect(page.getByText(/accesso automatico non riuscito.*email o password non corretti/i)).toBeVisible({ timeout: 10_000 });
});

test("nel browser normale 'Esci' esce subito, senza conferma", async ({ page }) => {
  await page.goto("/cameriere");
  await staffLogin(page, TEST_WAITER);
  await expectSignedInAsWaiter(page);
  await page.getByRole("button", { name: /^esci$/i }).click();
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});
