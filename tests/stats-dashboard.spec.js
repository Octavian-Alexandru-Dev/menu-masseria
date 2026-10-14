import { test, expect } from "@playwright/test";
import { TEST_ADMIN } from "./test-env";
import { PHONE, navTo } from "./helpers/phone";

// Statistiche (TillStats.jsx, la stessa schermata della cassa) dal telefono.
// Dati di test seedati da scripts/seed-emulator.js (seedTestOrders): date
// relative ad "adesso" al momento del seed. Le asserzioni su importi esatti
// usano il preset "Ieri", immune a comande create da altri spec in parallelo
// (che chiudono tavoli "adesso" — finiscono sempre in "Oggi", mai in "Ieri").
test.use(PHONE);

const cents = (text) => Math.round(parseFloat(text.replace("€", "").trim().replace(",", ".")) * 100);
const dateValue = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /area riservata|staff area/i }).click();
  await page.getByRole("textbox", { name: "Nome utente", exact: true }).fill(TEST_ADMIN.email);
  await page.locator('input[type="password"]').fill(TEST_ADMIN.password);
  await page.getByRole("button", { name: /^accedi$/i }).click();
  await navTo(page, "Statistiche");
});

test.describe("Statistiche", () => {
  test("mostra numeri e classifiche per il periodo 'Oggi'", async ({ page }) => {
    await expect(page.getByTestId("kpi-revenue")).toBeVisible({ timeout: 10_000 });
    for (const title of ["Piatti più venduti", "Incasso per categoria", "Per cameriere", "Incasso per giorno della settimana"]) {
      await expect(page.getByRole("region", { name: title })).toBeVisible();
    }
  });

  test("il preset 'Ieri' mostra gli importi esatti dei dati seed", async ({ page }) => {
    await page.getByRole("button", { name: "Ieri", exact: true }).click();
    await expect(page.getByTestId("kpi-revenue")).toHaveText("€ 51,00", { timeout: 10_000 });
    await expect(page.getByTestId("kpi-covers")).toHaveText("5");
    await expect(page.getByTestId("kpi-orders")).toHaveText("2");
    await expect(page.getByRole("list", { name: "Classifica dei piatti" })).toContainText("Orecchiette");
    await expect(page.getByRole("region", { name: "Incasso per categoria" })).toContainText("Primi");
    await expect(page.getByRole("region", { name: "Per cameriere" })).toContainText("Cameriere di test");
  });

  test("le comande chiuse in automatico si escludono senza ricaricare la pagina", async ({ page }) => {
    const revenue = page.getByTestId("kpi-revenue");
    await expect(revenue).toBeVisible({ timeout: 10_000 });
    const before = await revenue.innerText();
    await page.getByRole("switch", { name: "Includi chiusure automatiche" }).click();
    await expect(revenue).not.toHaveText(before);
    // stats-today-2 (auto_closed nei dati seed) vale 14,00: la differenza è
    // quella, qualunque sia il totale (altri spec chiudono tavoli "oggi").
    expect(cents(before) - cents(await revenue.innerText())).toBe(1400);
  });

  test("un periodo personalizzato senza comande mostra lo stato vuoto", async ({ page }) => {
    await page.getByRole("button", { name: "Personalizzato" }).click();
    const far = new Date();
    far.setFullYear(far.getFullYear() + 5);
    await page.getByLabel("Periodo: al").fill(dateValue(far));
    await page.getByLabel("Periodo: dal").fill(dateValue(far));
    await expect(page.getByText(/nessuna comanda chiusa in questo periodo/i)).toBeVisible({ timeout: 10_000 });
  });

  test("il margine di 'Ieri' esclude le righe senza costo noto", async ({ page }) => {
    await page.getByRole("button", { name: "Ieri", exact: true }).click();
    // stats-yesterday-1: Orecchiette (10,00-3,00)x3=21,00 + Tiramisù (5,00-1,50)x1=3,50 = 24,50.
    // stats-midnight-late (Caprese) non ha un costo: escluso dal margine
    // (35,00 di incasso piatti con costo noto su 42,00 -> 83%).
    await expect(page.getByTestId("kpi-margin")).toHaveText("€ 24,50", { timeout: 10_000 });
    await expect(page.getByText(/su 83% dell'incasso piatti/i)).toBeVisible();
    await page.getByRole("button", { name: "Margine", exact: true }).click();
    const ranking = page.getByRole("list", { name: "Classifica dei piatti" });
    await expect(ranking).toContainText("Orecchiette");
    await expect(ranking).not.toContainText("Caprese");
  });

  test("incasso per ora e per giorno della settimana in euro, leggibili senza grafici", async ({ page }) => {
    await page.getByRole("button", { name: "Ieri", exact: true }).click();
    await expect(page.getByTestId("kpi-revenue")).toHaveText("€ 51,00", { timeout: 10_000 });
    const byHour = page.getByRole("region", { name: "Incasso per ora di apertura del tavolo" });
    await expect(byHour).toContainText(/\d\d:00/);
    await expect(byHour).toContainText("€");
    const byWeekday = page.getByRole("region", { name: "Incasso per giorno della settimana" });
    await expect(byWeekday).toContainText("€ 51,00");
    // Mai i centesimi grezzi (il vecchio grafico mostrava "5100").
    await expect(byWeekday).not.toContainText("5100");
  });

  test("il confronto con il periodo precedente segnala un incasso nuovo; si può scegliere un altro periodo", async ({ page }) => {
    await page.getByRole("button", { name: "Ieri", exact: true }).click();
    await expect(page.getByTestId("kpi-revenue")).toHaveText("€ 51,00", { timeout: 10_000 });
    // Il giorno prima di "Ieri" non ha dati seed: ogni numero è "nuovo".
    await page.getByRole("button", { name: "Periodo precedente" }).click();
    await expect(page.getByText("nuovo").first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Altro periodo" }).click();
    const far = new Date();
    far.setFullYear(far.getFullYear() - 5);
    await page.getByLabel("Periodo di confronto: dal").fill(dateValue(far));
    await page.getByLabel("Periodo di confronto: al").fill(dateValue(far));
    await expect(page.getByText(/rispetto a/)).toContainText(String(far.getFullYear()));
    await expect(page.getByText("nuovo").first()).toBeVisible({ timeout: 10_000 });
  });

  // Visite al menù (menuViews, seed: ieri 12, 2 giorni fa 7, 4 giorni fa 20,
  // 5 giorni fa 3, 6 giorni fa 9 — oggi lo incrementano i test del menù pubblico).
  test("'Visite al menù': numero del giorno, confronto, grafico a colonne toccabili ed elenco", async ({ page }) => {
    const views = page.getByRole("region", { name: "Visite al menù" });
    await expect(page.getByRole("region", { name: "Vendite" })).toBeVisible();
    await page.getByRole("button", { name: "Ieri", exact: true }).click();
    await expect(views.getByTestId("kpi-views")).toHaveText("12", { timeout: 10_000 });
    // Un giorno solo: niente media né grafico.
    await expect(views.getByTestId("kpi-views-avg")).toHaveCount(0);
    await page.getByRole("group", { name: "Confronta con" }).getByRole("button", { name: "Periodo precedente" }).click();
    await expect(views).toContainText("+71%", { timeout: 10_000 }); // 12 contro 7, scritto (non solo a colori)

    // Da 6 giorni fa a ieri: solo giorni seedati (oggi cresce con gli altri test).
    await page.getByRole("button", { name: "Personalizzato", exact: true }).click();
    const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
    await page.getByLabel("Periodo: dal").fill(dateValue(daysAgo(6)));
    await page.getByLabel("Periodo: al").fill(dateValue(daysAgo(1)));
    await expect(views.getByTestId("kpi-views")).toHaveText("51", { timeout: 10_000 });
    await expect(views.getByTestId("kpi-views-avg")).toHaveText("8,5");
    await expect(views.getByTestId("kpi-views-best")).toHaveText("20");
    const chart = views.getByRole("group", { name: "Visite al menù nel tempo" });
    await expect(chart.getByRole("button")).toHaveCount(6); // una colonna al giorno, anche quelli a zero
    await chart.getByRole("button", { name: /: 7 visite$/ }).click();
    await expect(views.getByText(/: 7 visite$/).first()).toBeVisible();
    await expect(chart.getByRole("button", { name: /: 7 visite$/ })).toHaveAttribute("aria-pressed", "true");
    // Le colonne restano toccabili sul telefono.
    expect((await chart.getByRole("button").first().boundingBox()).width).toBeGreaterThanOrEqual(40);

    await views.getByRole("group", { name: "Mostra le visite" }).getByRole("button", { name: "Elenco" }).click();
    const list = views.getByRole("list", { name: "Visite al menù per giorno" });
    await expect(list.getByRole("listitem")).toHaveCount(6);
    await expect(list).toContainText("20");
    const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("'Visite al menù' senza visite nel periodo lo dice", async ({ page }) => {
    await page.getByRole("button", { name: "Personalizzato", exact: true }).click();
    const far = new Date(2001, 0, 10);
    await page.getByLabel("Periodo: dal").fill(dateValue(far));
    await page.getByLabel("Periodo: al").fill(dateValue(new Date(2001, 0, 12)));
    const views = page.getByRole("region", { name: "Visite al menù" });
    await expect(views.getByTestId("kpi-views")).toHaveText("0", { timeout: 10_000 });
    await expect(views).toContainText("Nessuna visita al menù in questo periodo.");
  });
});
