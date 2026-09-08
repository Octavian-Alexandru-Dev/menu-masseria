import { test, expect } from "@playwright/test";
import { TEST_ADMIN, TEST_WAITER, TEST_NO_ROLE, TEST_INVALID_ROLE } from "./test-env";
import { staffLogin } from "./helpers/staffLogin";

test.describe("Area riservata (StaffHome)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?area=staff");
  });

  test("mostra il login per l'area riservata", async ({ page }) => {
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("account autenticato senza ruolo vede 'Account senza ruolo'", async ({ page }) => {
    await staffLogin(page, TEST_NO_ROLE);
    await expect(page.getByText(/account senza ruolo/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /esci/i })).toBeVisible();
  });

  test("account con ruolo non riconosciuto vede 'Accesso non consentito'", async ({ page }) => {
    await staffLogin(page, TEST_INVALID_ROLE);
    await expect(page.getByText(/accesso non consentito/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /esci/i })).toBeVisible();
  });

  test("un account con una sola area (cameriere) salta la Dashboard e apre direttamente Sala", async ({ page }) => {
    await staffLogin(page, TEST_WAITER);
    await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
    // Niente Dashboard (saluto "Ciao,") né barra "Cambia area": un account
    // solo-cameriere non le vede mai (StaffHome.jsx).
    await expect(page.getByText(/^ciao,/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /cambia area/i })).toHaveCount(0);
  });

  test("un account admin vede la Dashboard con tutte le aree e naviga con il pulsante Indietro del browser", async ({ page }) => {
    await staffLogin(page, TEST_ADMIN);
    await expect(page.getByText(/^ciao,/i)).toBeVisible({ timeout: 10_000 });
    // Le Dashboard cards includono un contatore live nel nome accessibile
    // (es. "Sala0 tavoli aperti"), quindi si verifica un prefisso, non il
    // nome esatto (StaffHome.jsx, Dashboard: opt.label + count).
    await expect(page.getByRole("button", { name: /^gestione menù/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^sala/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^cucina/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^prenotazioni/i })).toBeVisible();

    await page.getByRole("button", { name: /^sala/i }).click();
    await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/sezione=waiter/);
    // Più di un'area core disponibile (admin): la barra "Cambia area" è visibile.
    await expect(page.getByRole("button", { name: /cambia area/i })).toBeVisible();

    await page.goBack();
    await expect(page.getByText(/^ciao,/i)).toBeVisible({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/sezione=/);
  });
});
