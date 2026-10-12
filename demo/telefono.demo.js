// Scene da telefono (390×844) per le GIF del README: menù pubblico e area
// staff (sala, prenotazioni, statistiche). Vedi demo/README.md.
import { test, expect } from "@playwright/test";
import { TEST_ADMIN, TEST_WAITER } from "../tests/test-env.js";
import { staffLogin } from "../tests/helpers/staffLogin.js";
import { seedDemoData } from "./demo-data.js";
import { showTaps, pause, tap, type, scene } from "./helpers.js";

test.beforeAll(seedDemoData);
test.beforeEach(({ page }) => showTaps(page));

const dish = (page, name) => page.locator("button", { hasText: "€" }).filter({ hasText: name }).first();

test("menù pubblico: categorie, foto, lingue e ricerca", async ({ page }, testInfo) => {
  const s = scene(testInfo, "telefono-menu");
  await page.goto("/");
  await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10_000 });
  await pause(page, 800);
  s.start();

  await pause(page, 1000);
  await tap(page.getByRole("navigation").getByRole("button", { name: "Primi" }), 1000);
  await tap(page.getByRole("navigation").getByRole("button", { name: "Dolci" }), 900);
  await tap(page.getByRole("group", { name: "Lingua / Language" }).getByRole("button", { name: "EN", exact: true }), 1500);
  await tap(page.getByRole("group", { name: "Lingua / Language" }).getByRole("button", { name: "IT", exact: true }), 900);
  const search = page.getByRole("textbox", { name: /cerca un piatto|search for a dish/i });
  await type(search, "bibita");
  await pause(page, 1800);
  s.save();
});

test("sala: si apre un tavolo, si prende la comanda e si invia", async ({ page }, testInfo) => {
  const s = scene(testInfo, "telefono-comanda");
  await page.goto("/cameriere");
  await staffLogin(page, TEST_WAITER);
  await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
  await pause(page, 800);
  s.start();

  await pause(page, 1200);
  await tap(page.getByRole("button", { name: /nuovo tavolo/i }));
  await type(page.locator('input[type="number"]').first(), "12");
  await type(page.locator('input[type="number"]').nth(1), "2");
  await pause(page, 500);
  await tap(page.getByRole("button", { name: /apri tavolo/i }), 1000);
  await expect(page.getByText("Tavolo 12", { exact: true })).toBeVisible({ timeout: 10_000 });

  await tap(dish(page, "Bruschetta"), 400);
  await tap(dish(page, "Bruschetta"), 600);
  await tap(dish(page, "Orecchiette"), 600);
  await tap(dish(page, "Vino della casa"), 800);
  await type(page.getByRole("textbox", { name: "Nota per Orecchiette" }), "senza peperoncino");
  await pause(page, 600);
  await tap(page.getByRole("button", { name: /invia comanda/i }), 400);
  await expect(page.getByText(/sincronizzata/i)).toBeVisible({ timeout: 15_000 });
  await pause(page, 1600);
  await tap(page.getByRole("button", { name: "Tavoli", exact: true }), 2000);
  s.save();
});

test("prenotazioni: nuova prenotazione e conferma", async ({ page }, testInfo) => {
  const s = scene(testInfo, "telefono-prenotazioni");
  await page.goto("/prenotazioni");
  await staffLogin(page, TEST_WAITER);
  await expect(page.getByRole("button", { name: /^nuova$/i })).toBeVisible({ timeout: 10_000 });
  await pause(page, 800);
  s.start();

  await pause(page, 1500);
  await tap(page.getByRole("button", { name: /^nuova$/i }));
  await type(page.getByPlaceholder("es. Famiglia Rossi"), "Famiglia Rossi");
  await type(page.locator('input[type="number"]').first(), "3");
  await pause(page, 500);
  await tap(page.getByRole("button", { name: /^salva \(da confermare\)$/i }), 1200);
  await tap(page.getByRole("button", { name: /Conferma prenotazione di Famiglia Rossi/i }), 1500);
  await tap(page.getByRole("button", { name: "Mostra calendario" }), 2200);
  s.save();
});

test("statistiche: incasso, piatti più venduti, periodi", async ({ page }, testInfo) => {
  const s = scene(testInfo, "telefono-statistiche");
  await page.goto("/?area=staff");
  await staffLogin(page, TEST_ADMIN);
  await expect(page.getByRole("button", { name: "Statistiche" })).toBeVisible({ timeout: 10_000 });
  await pause(page, 800);
  s.start();

  await pause(page, 1200);
  await tap(page.getByRole("button", { name: "Statistiche" }));
  await expect(page.getByText("Incasso totale")).toBeVisible({ timeout: 10_000 });
  await pause(page, 1200);
  await tap(page.getByRole("button", { name: "Ieri", exact: true }), 1500);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 250);
    await pause(page, 450);
  }
  await pause(page, 1200);
  s.save();
});
