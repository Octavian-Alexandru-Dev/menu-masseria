import { test, expect } from "@playwright/test";
import { TEST_ADMIN } from "./test-env";
import { staffLogin } from "./helpers/staffLogin";
import { PHONE, navTo, sheet } from "./helpers/phone";
import { getOwnerUid, removeOwnerBypassingRules, restoreOwnerBypassingRules } from "./helpers/staffRoles";
import { findStaffByEmail } from "./helpers/menuDoc";

// Un progetto senza proprietario (com'era quello in produzione prima del
// ruolo): il primo amministratore lo prende in carico da Personale, una volta
// sola; poi può passarlo a un altro amministratore. Fase Playwright propria,
// in fondo (tests/stages.js): cambia l'unico proprietario, nessun altro test
// deve vedere il progetto così.
test.use(PHONE);
test.describe.configure({ mode: "serial" });

async function openPersonale(page) {
  await page.goto("/?area=staff");
  await staffLogin(page, TEST_ADMIN);
  await navTo(page, "Menù");
  await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
  await sheet(page, "Impostazioni del menù").getByRole("button", { name: /^Personale/ }).click();
  return sheet(page, "Personale");
}

test("senza proprietario un amministratore lo diventa (dopo conferma), poi passa la proprietà a un altro amministratore", async ({ page }) => {
  test.setTimeout(45_000);
  try {
    await removeOwnerBypassingRules();
    const panel = await openPersonale(page);
    const owner = panel.getByRole("region", { name: "Proprietario" });
    await expect(owner).toContainText("Nessun proprietario", { timeout: 10_000 });
    // Finché non c'è, l'amministratore aggiunge solo camerieri.
    await expect(panel.getByRole("group", { name: "Ruolo" })).toHaveCount(0);

    const claim = owner.getByRole("button", { name: "Diventa proprietario" });
    expect((await claim.boundingBox()).height).toBeGreaterThanOrEqual(48);
    await claim.click();
    const confirm = page.getByRole("alertdialog", { name: "Diventare il proprietario?" });
    await confirm.getByRole("button", { name: "Annulla" }).click();
    expect(await getOwnerUid()).toBeNull();

    await claim.click();
    await confirm.getByRole("button", { name: "Diventa proprietario" }).click();
    await expect(owner).toContainText("Admin di test (tu)", { timeout: 10_000 });
    const admin = await findStaffByEmail(TEST_ADMIN.email);
    await expect.poll(getOwnerUid).toBe(admin.uid);
    await expect.poll(async () => (await findStaffByEmail(TEST_ADMIN.email)).role).toBe("owner");
    // Ora sceglie anche il ruolo di amministratore.
    await expect(panel.getByRole("group", { name: "Ruolo" }).getByRole("button", { name: "Amministratore" })).toBeVisible();

    // Passaggio di proprietà all'altro amministratore (il proprietario del seed, ora admin).
    await owner.getByRole("button", { name: "Passa la proprietà…" }).click();
    await owner.getByRole("group", { name: "Nuovo proprietario" }).getByRole("button", { name: "Proprietario di test" }).click();
    await page.getByRole("alertdialog", { name: "Passare la proprietà a Proprietario di test?" }).getByRole("button", { name: "Passa la proprietà" }).click();
    await expect(owner).toContainText("Proprietario di test", { timeout: 10_000 });
    await expect(owner).not.toContainText("(tu)");
    await expect(owner.getByRole("button")).toHaveCount(0);
    await expect.poll(async () => (await findStaffByEmail(TEST_ADMIN.email)).role).toBe("admin");
    await expect(panel.getByRole("group", { name: "Ruolo" })).toHaveCount(0);
  } finally {
    await restoreOwnerBypassingRules({ [TEST_ADMIN.email]: "admin" });
  }
});
