// Blocco di login ripetuto in ogni spec che passa da StaffLoginScreen
// (staff-shared.jsx): area cameriere/cucina/prenotazioni/StaffHome
// condividono lo stesso form (email/password/"Accedi").
export async function staffLogin(page, { email, password }) {
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /accedi/i }).click();
}
