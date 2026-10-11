import { test, expect } from "@playwright/test";
import { TEST_ADMIN, TEST_WAITER, TEST_KITCHEN, TEST_NO_ROLE, TEST_INVALID_ROLE } from "./test-env";
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

  test("un account con il vecchio ruolo cucina vede perché non ha più un'area", async ({ page }) => {
    await staffLogin(page, TEST_KITCHEN);
    await expect(page.getByText("L'area Cucina non c'è più")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^esci$/i })).toBeVisible();
  });

  test("un account con una sola area (cameriere) salta la Dashboard e apre direttamente Sala", async ({ page }) => {
    await staffLogin(page, TEST_WAITER);
    await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
    // Niente Dashboard (saluto "Ciao,") né barra "Cambia area": un account
    // solo-cameriere non le vede mai (StaffHome.jsx).
    await expect(page.getByText(/^ciao,/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /cambia area/i })).toHaveCount(0);
  });

  test("dopo l'uscita il login propone 'Rientra come …' con l'ultimo account (senza password salvata)", async ({ page }) => {
    // Primo accesso: nessun suggerimento.
    await expect(page.getByRole("button", { name: /rientra come/i })).toHaveCount(0);
    await staffLogin(page, TEST_WAITER);
    await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });

    // Uscita (anche per sbaglio): sopra i campi c'è l'account appena usato.
    await page.getByRole("button", { name: /^esci$/i }).click();
    const again = page.getByRole("button", { name: `Rientra come Cameriere di test (${TEST_WAITER.email})` });
    await expect(again).toBeVisible({ timeout: 10_000 });
    const email = page.locator('input[type="email"]');
    const password = page.locator('input[type="password"]');
    await expect(email).toHaveValue("");
    // La password non viene mai conservata.
    expect(await page.evaluate(() => localStorage.getItem("mdp.lastStaffAccount"))).not.toContain(TEST_WAITER.password);

    // Un tocco: email compilata, si passa alla password.
    await again.click();
    await expect(email).toHaveValue(TEST_WAITER.email);
    await expect(password).toBeFocused();
    await password.fill(TEST_WAITER.password);
    await page.getByRole("button", { name: /^accedi$/i }).click();
    await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });

    // "Non sei tu?" toglie il suggerimento, anche dopo un ricaricamento.
    await page.getByRole("button", { name: /^esci$/i }).click();
    await expect(again).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Non sei tu?" }).click();
    await expect(again).toHaveCount(0);
    await page.reload();
    await expect(email).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /rientra come/i })).toHaveCount(0);
  });

  test("un account admin vede la Dashboard con tutte le aree e naviga con il pulsante Indietro del browser", async ({ page }) => {
    await staffLogin(page, TEST_ADMIN);
    await expect(page.getByText(/^ciao,/i)).toBeVisible({ timeout: 10_000 });
    // Le Dashboard cards includono un contatore live nel nome accessibile
    // (es. "Sala0 tavoli aperti"), quindi si verifica un prefisso, non il
    // nome esatto (StaffHome.jsx, Dashboard: opt.label + count).
    await expect(page.getByRole("button", { name: /^gestione menù/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^sala/i })).toBeVisible();
    // Niente più area Cucina: la cucina lavora con le comande stampate.
    await expect(page.getByRole("button", { name: /^cucina/i })).toHaveCount(0);
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
