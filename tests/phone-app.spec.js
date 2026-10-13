import { test, expect } from "@playwright/test";
import { TEST_ADMIN, TEST_WAITER } from "./test-env";
import { staffLogin } from "./helpers/staffLogin";
import { deleteTestOrderByTableNumber } from "./firestore-cleanup";
import { removeMenuItemsByNamePrefix } from "./helpers/menuDoc";
import { PHONE } from "./helpers/phone";

// L'area staff su uno smartphone da 6" (Pixel 5: 393×851 CSS px, 6,0"):
// l'app del telefono (PhoneApp.jsx) con le sezioni nella barra in basso, la
// comanda (Waiter.jsx) e la gestione rapida del menù (TillMenu.jsx in
// versione compatta), tutte costruite con i pezzi della cassa (TillUi.jsx,
// OrderUi.jsx). Copertura: docs/stampa-scontrini.md §7.
test.use(PHONE);

const MENU_PREFIX = "Telefono test";
const tableNumber = () => 11000 + Math.floor(Math.random() * 500);
const opened = [];

test.afterEach(async () => {
  await Promise.all(opened.splice(0).map((n) => deleteTestOrderByTableNumber(n)));
});
test.afterAll(async () => {
  await removeMenuItemsByNamePrefix(MENU_PREFIX);
});

async function openTable(page) {
  const n = tableNumber();
  opened.push(n);
  await page.getByRole("button", { name: /nuovo tavolo/i }).click();
  await page.getByRole("textbox", { name: "Numero tavolo" }).or(page.getByRole("spinbutton", { name: "Numero tavolo" })).fill(String(n));
  await page.getByRole("button", { name: `Apri tavolo ${n}` }).click();
  await expect(page.getByText(`Tavolo ${n}`, { exact: true })).toBeVisible({ timeout: 10_000 });
  return n;
}

async function expectNoSideScroll(page, where) {
  const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth);
  expect(overflow, `scorrimento laterale in ${where}`).toBeLessThanOrEqual(0);
}

test("su uno smartphone da 6\" nessuna schermata scorre di lato e la barra in basso resta in fondo", async ({ page }) => {
  await page.goto("/?area=staff");
  await staffLogin(page, TEST_ADMIN);
  await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });

  const nav = page.getByRole("navigation", { name: "Sezioni" });
  const navBox = await nav.boundingBox();
  expect(navBox.y + navBox.height).toBeCloseTo(851, 0);
  for (const name of ["Tavoli", "Prenotazioni", "Storico", "Menù", "Statistiche"]) {
    const button = nav.getByRole("button", { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name })).toBeVisible();
    // L'etichetta si legge per intero (niente "Prenotazi…").
    expect(await button.evaluate((b) => [...b.querySelectorAll("span")].every((s) => s.scrollWidth <= s.clientWidth))).toBe(true);
    await page.waitForTimeout(800); // contenuto della sezione caricato (Firestore non va mai "idle")
    await expectNoSideScroll(page, name);
  }

  await nav.getByRole("button", { name: "Tavoli", exact: true }).click();
  await openTable(page);
  // Nella comanda la barra delle sezioni lascia il posto a quella del tavolo.
  await expect(nav).toHaveCount(0);
  await expectNoSideScroll(page, "comanda");
  await page.getByRole("button", { name: /caprese/i }).click();
  await page.getByRole("button", { name: "Apri la comanda del tavolo" }).click();
  await expectNoSideScroll(page, "comanda del tavolo");
  await page.getByRole("button", { name: "Modifica Caprese" }).click();
  await expectNoSideScroll(page, "modifica riga");
});

test("presa della comanda: un tocco = un piatto in più col conteggio sul riquadro, invio dalla barra in basso, riga inviata offerta dall'editor", async ({ page }) => {
  await page.goto("/cameriere");
  await staffLogin(page, TEST_WAITER);
  await openTable(page);

  const caprese = page.getByRole("button", { name: /^aggiungi caprese/i });
  await caprese.click();
  await caprese.click();
  await expect(caprese).toContainText("2");
  const ticketButton = page.getByRole("button", { name: "Apri la comanda del tavolo" });
  await expect(ticketButton).toContainText("2 da inviare");

  // La barra con "Invia comanda" sta in fondo allo schermo, nella zona del pollice.
  const send = page.getByRole("button", { name: /invia comanda \(2\)/i });
  const sendBox = await send.boundingBox();
  expect(sendBox.y).toBeGreaterThan(851 * 0.75);
  expect(sendBox.height).toBeGreaterThanOrEqual(56);
  await send.click();
  await expect(page.getByText(/sincronizzata/i)).toBeVisible({ timeout: 15_000 });
  await expect(caprese).not.toContainText("2");

  // Riga già inviata: si tocca nella comanda, "Offerto", "Salva".
  await ticketButton.click();
  await page.getByRole("button", { name: /^modifica caprese: 2 ×/i }).click();
  await expect(page.getByRole("dialog", { name: "Modifica riga" })).toBeVisible();
  await page.getByRole("button", { name: "Offerto" }).click();
  await expect(page.getByTestId("till-line-total")).toHaveText("€ 0,00");
  await page.getByRole("button", { name: /^salva$/i }).click();
  await expect(page.getByRole("group", { name: "Già inviato" })).toContainText("Offerto", { timeout: 10_000 });
  await expect(page.getByTestId("phone-order-total")).toHaveText("€ 0,00");
});

// Una foto da 1×1 px al posto di quelle vere (placehold.co nel seed): i test
// non dipendono dalla rete.
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
async function stubPhotos(page) {
  await page.route(/placehold\.co/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG_1PX }));
}

test("tutte le categorie si vedono subito in una griglia, senza scorrere di lato, e portano alla loro sezione", async ({ page }) => {
  await page.goto("/cameriere");
  await staffLogin(page, TEST_WAITER);
  await openTable(page);

  const grid = page.getByRole("tablist", { name: "Categorie del menù" });
  await expect(grid).toBeInViewport();
  // Ogni categoria è visibile per intero, con quanti piatti ha (scritto, non solo a colori).
  for (const name of ["Antipasti", "Primi", "Dolci", "Bevande"]) {
    const tab = grid.getByRole("tab", { name: new RegExp(`^${name}`) });
    await expect(tab).toBeInViewport({ ratio: 1 });
    await expect(tab).toContainText(/\d+ piatt[oi]/);
    expect((await tab.boundingBox()).height).toBeGreaterThanOrEqual(48);
  }
  await expectNoSideScroll(page, "griglia delle categorie");
  // All'inizio la griglia si vede già tutta: nessun pulsante da toccare prima.
  await expect(page.getByRole("button", { name: /^Categorie:/ })).toHaveCount(0);

  // Un piatto scelto si vede anche sulla sua categoria.
  await page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).click();
  await expect(grid.getByRole("tab", { name: /^Antipasti/ })).toContainText("1 da inviare");

  await grid.getByRole("tab", { name: /^Bevande/ }).click();
  await expect(page.getByRole("region", { name: "Bevande" })).toBeInViewport();
  await expect(page.getByRole("button", { name: /acqua naturale/i })).toBeInViewport();
  // Passata la griglia, in alto compare "Categorie", con la categoria in vista.
  const picker = page.getByRole("button", { name: /^Categorie:/ });
  await expect(picker).toBeInViewport();
  // L'ultima categoria non può salire fino in cima: resta comunque quella
  // evidenziata (bug corretto: si evidenziava quella prima).
  await page.waitForTimeout(1200);
  await expect(picker).toHaveAccessibleName("Categorie: Bevande");
  await expect(grid.getByRole("tab", { name: /^Bevande/ })).toHaveAttribute("aria-selected", "true");

  // Da qualunque punto, "Categorie" riapre la griglia completa e porta alla sezione.
  await picker.click();
  await expect(picker).toHaveAttribute("aria-expanded", "true");
  const choose = page.getByRole("tablist", { name: "Scegli una categoria" });
  await expect(choose.getByRole("tab")).toHaveCount(await grid.getByRole("tab").count());
  await choose.getByRole("tab", { name: /^Primi/ }).click();
  await expect(choose).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Primi" })).toBeInViewport();
  await expect(picker).toHaveAccessibleName("Categorie: Primi");
  // Esc chiude la griglia senza spostarsi.
  await picker.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tablist", { name: "Scegli una categoria" })).toHaveCount(0);

  // Scorrendo a mano, la categoria evidenziata torna a seguire la sezione in vista.
  await page.mouse.wheel(0, -3000);
  await expect(grid.getByRole("tab", { name: /^Antipasti/ })).toHaveAttribute("aria-selected", "true", { timeout: 5_000 });
  // Tornati in cima, la griglia è di nuovo in vista e il pulsante sparisce.
  await expect(page.getByRole("button", { name: /^Categorie:/ })).toHaveCount(0, { timeout: 5_000 });
});

test("nella comanda i piatti con una foto la mostrano in miniatura (la stessa del menù dei clienti)", async ({ page }) => {
  await stubPhotos(page);
  await page.goto("/cameriere");
  await staffLogin(page, TEST_WAITER);
  await openTable(page);
  const withPhoto = page.getByRole("button", { name: /^Aggiungi Tiramisù/ });
  const thumb = withPhoto.locator("img");
  await expect(thumb).toBeVisible();
  await expect(thumb).toHaveAttribute("src", /placehold\.co/);
  // Senza foto: nessun riquadro vuoto.
  await expect(page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).locator("img")).toHaveCount(0);
  await expectNoSideScroll(page, "piatti con foto");
});

test("gestione menù da telefono: categorie in griglia e piatti con la loro foto", async ({ page }) => {
  await stubPhotos(page);
  await page.goto("/?area=staff");
  await staffLogin(page, TEST_ADMIN);
  await page.getByRole("navigation", { name: "Sezioni" }).getByRole("button", { name: "Menù", exact: true }).click();
  const grid = page.getByRole("tablist", { name: "Categorie del menù" });
  for (const name of ["Antipasti", "Primi", "Dolci", "Bevande"]) {
    await expect(grid.getByRole("tab", { name: new RegExp(`^${name}`) })).toBeInViewport({ ratio: 1 });
  }
  await expectNoSideScroll(page, "categorie del menù");
  await grid.getByRole("tab", { name: /^Dolci/ }).click();
  await expect(grid.getByRole("tab", { name: /^Dolci/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Modifica Tiramisù" }).locator("img")).toBeVisible();
});

test("gestione menù da telefono: piatto nuovo e modifica a schermo intero, con Salva sempre in basso", async ({ page }) => {
  const name = `${MENU_PREFIX} ${Date.now()}`;
  await page.goto("/?area=staff");
  await staffLogin(page, TEST_ADMIN);
  await page.getByRole("navigation", { name: "Sezioni" }).getByRole("button", { name: "Menù", exact: true }).click();

  await page.getByRole("tab", { name: "Dolci" }).click();
  await page.getByRole("button", { name: "Nuovo piatto in Dolci" }).click();
  const editor = page.getByRole("dialog", { name: "Nuovo piatto" });
  await expect(editor).toBeVisible();
  await editor.getByRole("textbox", { name: "Nome del piatto" }).fill(name);
  await editor.getByRole("button", { name: "Cambia prezzo" }).click();
  for (const digit of ["4", "5", "0"]) await editor.getByRole("button", { name: `Cifra ${digit}` }).click();
  await editor.getByRole("button", { name: "Usa € 4,50" }).click();

  const add = editor.getByRole("button", { name: "Aggiungi piatto" });
  const addBox = await add.boundingBox();
  expect(addBox.y + addBox.height).toBeLessThanOrEqual(851);
  expect(addBox.height).toBeGreaterThanOrEqual(56);
  await add.click();
  await expect(page.getByRole("dialog", { name: "Modifica piatto" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Piatti" }).click();

  const tile = page.getByRole("button", { name: `Modifica ${name}` });
  await expect(tile).toContainText("€ 4,50");
  await tile.click();
  await page.getByRole("switch", { name: "Disponibile" }).click();
  await page.getByRole("button", { name: /^salva$/i }).click();
  await expect(page.getByText("Salvato.")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Piatti" }).click();
  await expect(tile).toContainText("Nascosto");
});

test("l'area staff si installa come app (manifest solo lì, non nel menù pubblico)", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);

  await page.goto("/?area=staff");
  await staffLogin(page, TEST_WAITER);
  await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/staff.webmanifest");
  const manifest = await (await request.get("/staff.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/?area=staff");
  expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
});
