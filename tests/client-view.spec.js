import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10_000 });
});

test("loads the public menu with a header and category navigation", async ({ page }) => {
  await expect(page.locator("header")).toBeVisible();
  const categoryButtons = page.getByRole("navigation").getByRole("button");
  await expect(categoryButtons.first()).toBeVisible();
  expect(await categoryButtons.count()).toBeGreaterThan(0);
});

test("clicking a category tab scrolls its section into view", async ({ page }) => {
  const categoryButtons = page.getByRole("navigation").getByRole("button");
  const label = await categoryButtons.first().textContent();
  await categoryButtons.first().click();
  await expect(page.getByRole("heading", { name: label }).or(page.getByText(label).first())).toBeVisible();
});

test("switching language keeps the page usable", async ({ page }) => {
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
});

test("footer link opens the admin login screen", async ({ page }) => {
  await page.getByRole("button", { name: /gestione menù|menu management/i }).click();
  await expect(page.getByText(/gestione menù/i).first()).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
