import { test, expect } from "@playwright/test";
import { TEST_ADMIN } from "./test-env";

// Dati di test seedati da scripts/seed-emulator.js (seedTestOrders): date
// relative ad "adesso" al momento del seed, non fisse. Le asserzioni su
// importi esatti usano il preset "Ieri", immune a comande create da altri
// spec in esecuzione in parallelo (che aprono/chiudono tavoli con closedAt
// "adesso" — finiscono sempre in "Oggi", mai in "Ieri").
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /area riservata|staff area/i }).click();
  await page.locator('input[type="email"]').fill(TEST_ADMIN.email);
  await page.locator('input[type="password"]').fill(TEST_ADMIN.password);
  await page.getByRole("button", { name: /accedi|login|sign in/i }).click();
  await page.getByRole("button", { name: "Statistiche" }).click();
});

test.describe("Dashboard statistiche", () => {
  test("mostra i KPI e le sezioni principali per il preset 'Oggi'", async ({ page }) => {
    await expect(page.getByText("Incasso totale")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Piatti più venduti")).toBeVisible();
    await expect(page.getByText("Incasso per categoria")).toBeVisible();
    await expect(page.getByText("Per cameriere")).toBeVisible();
  });

  test("il preset 'Ieri' mostra gli importi esatti dei dati seed", async ({ page }) => {
    await page.getByRole("button", { name: "Ieri", exact: true }).click();
    await expect(page.getByTestId("kpi-value-revenue")).toHaveText("€ 51,00", { timeout: 10_000 });
    await expect(page.getByTestId("kpi-value-covers")).toHaveText("5");
    await expect(page.getByTestId("kpi-value-orders")).toHaveText("2");
    await expect(page.getByText("Orecchiette")).toBeVisible();
    await expect(page.getByText("Primi")).toBeVisible();
    await expect(page.getByText("Cameriere di test")).toBeVisible();
  });

  test("il toggle comande auto-chiuse ricalcola l'incasso senza ricaricare la pagina", async ({ page }) => {
    await expect(page.getByTestId("kpi-value-revenue")).toBeVisible({ timeout: 10_000 });
    const before = await page.getByTestId("kpi-value-revenue").innerText();
    const beforeCents = Math.round(parseFloat(before.replace("€", "").trim().replace(",", ".")) * 100);

    // "comanda chiusa" (singolare) o "comande chiuse" (plurale) a seconda del
    // conteggio nei dati seed — vedi AutoClosedToggle in Stats.jsx.
    await page.getByLabel(/comand[ae] chius[ae] automaticamente/i).uncheck();
    await expect(page.getByTestId("kpi-value-revenue")).not.toHaveText(before);
    const after = await page.getByTestId("kpi-value-revenue").innerText();
    const afterCents = Math.round(parseFloat(after.replace("€", "").trim().replace(",", ".")) * 100);

    // stats-today-2 (auto_closed nei dati seed) vale esattamente 14,00 — la
    // differenza deve essere quella, qualunque sia il totale di partenza
    // (anche con altre comande "Oggi" create da spec in esecuzione parallela).
    expect(beforeCents - afterCents).toBe(1400);
  });

  test("un range personalizzato senza comande mostra lo stato vuoto", async ({ page }) => {
    await page.getByRole("button", { name: "Personalizzato" }).click();
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 5);
    const value = [
      farFuture.getFullYear(),
      String(farFuture.getMonth() + 1).padStart(2, "0"),
      String(farFuture.getDate()).padStart(2, "0"),
    ].join("-");
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.first().fill(value);
    await dateInputs.last().fill(value);
    await expect(page.getByText(/nessuna comanda chiusa in questo periodo/i)).toBeVisible({ timeout: 10_000 });
  });

  test("il preset 'Ieri' mostra il margine escludendo le righe senza costo noto", async ({ page }) => {
    await page.getByRole("button", { name: "Ieri", exact: true }).click();
    // stats-yesterday-1: Orecchiette (10,00-3,00)x3=21,00 + Tiramisù (5,00-1,50)x1=3,50 = 24,50.
    // stats-midnight-late (Caprese) non ha un costo seedato: escluso dal margine
    // (35,00 di incasso piatti con costo noto su 42,00 totali -> 83%).
    await expect(page.getByTestId("kpi-value-margin")).toHaveText("€ 24,50", { timeout: 10_000 });
    await expect(page.getByText(/su 83% dell'incasso piatti/i)).toBeVisible();

    await page.getByRole("button", { name: "Per margine" }).click();
    await expect(page.getByText("Orecchiette")).toBeVisible();
    await expect(page.getByText("Caprese")).not.toBeVisible();
  });

  test("gli assi dei grafici di incasso mostrano euro formattati, non i centesimi grezzi", async ({ page }) => {
    // Bug corretto in questa modifica: XAxis/YAxis non avevano tickFormatter,
    // quindi mostravano revenueCents grezzo (es. "5100" invece di "€ 51").
    // formatCentsCompact (shared.jsx) è ora passato come tickFormatter ai
    // grafici di incasso — qui si verifica sia la presenza di etichette in
    // euro sia l'assenza dei valori grezzi noti dei dati seed di "Ieri".
    await page.getByRole("button", { name: "Ieri", exact: true }).click();
    await expect(page.getByTestId("kpi-value-revenue")).toHaveText("€ 51,00", { timeout: 10_000 });

    const axisTicks = page.locator(".recharts-cartesian-axis-tick-value");
    await expect(axisTicks.filter({ hasText: "€" }).first()).toBeVisible({ timeout: 10_000 });
    // revenueCents grezzo del preset "Ieri" (51,00€) e del margine (24,50€)
    // seedati: se il tickFormatter mancasse, questi comparirebbero come tick.
    await expect(axisTicks.getByText("5100", { exact: true })).toHaveCount(0);
    await expect(axisTicks.getByText("2450", { exact: true })).toHaveCount(0);
  });

  test("il confronto tra periodi segnala un incasso nuovo rispetto a un Periodo A vuoto", async ({ page }) => {
    await page.getByRole("button", { name: "Ieri", exact: true }).click();
    await expect(page.getByTestId("kpi-value-revenue")).toHaveText("€ 51,00", { timeout: 10_000 });
    await page.getByLabel(/confronta con un altro periodo/i).check();
    // Periodo A di default = il giorno prima di "Ieri", senza dati seed:
    // deltaPct è Infinity in quel caso (statsData.js), mostrato come "nuovo"
    // su ogni KPI (tutti partono da zero) — .first() basta per verificare
    // che il meccanismo di confronto scatti.
    await expect(page.getByText("nuovo").first()).toBeVisible({ timeout: 10_000 });
  });
});
