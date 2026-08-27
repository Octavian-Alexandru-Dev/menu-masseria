import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /gestione menù|menu management/i }).click();
});

test("shows the login form with email and password fields", async ({ page }) => {
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /accedi|login|sign in/i })).toBeVisible();
});

test("rejects invalid credentials with an error message", async ({ page }) => {
  await page.locator('input[type="email"]').fill("nonexistent-user@example.com");
  await page.locator('input[type="password"]').fill("wrong-password");
  await page.getByRole("button", { name: /accedi|login|sign in/i }).click();
  await expect(page.getByText(/non corrett|non riuscito|invalid|failed/i)).toBeVisible({ timeout: 10_000 });
});
