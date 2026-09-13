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

test("footer link opens the staff login screen", async ({ page }) => {
  await page.getByRole("button", { name: /area riservata|staff area/i }).click();
  await expect(page.getByText(/area riservata|staff area/i).first()).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test("searching filters items and can be cleared back to the full menu", async ({ page }) => {
  const search = page.getByRole("textbox", { name: /cerca un piatto|search for a dish/i });
  await expect(search).toBeVisible();
  const categoryButtonsBefore = page.getByRole("navigation").getByRole("button");
  const categoryCountBefore = await categoryButtonsBefore.count();

  await search.fill("tiramisù");
  // Category nav is replaced by search results while searching (ClientView.jsx).
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByText("Tiramisù", { exact: true })).toBeVisible();
  await expect(page.getByText("Bruschetta", { exact: true })).toHaveCount(0);

  const clearButton = page.getByRole("button", { name: /chiudi|close/i });
  await clearButton.click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("button")).toHaveCount(categoryCountBefore);
});

test("searching for a dish that doesn't exist shows the empty-results message", async ({ page }) => {
  const search = page.getByRole("textbox", { name: /cerca un piatto|search for a dish/i });
  await search.fill("xyznonexistentdish");
  await expect(page.getByText(/nessun piatto trovato|no dishes found/i)).toBeVisible();
});

test("searching a search-tag surfaces every dish carrying it, across categories", async ({ page }) => {
  // Seed data (scripts/seed-emulator.js): both "Acqua naturale" and "Vino
  // della casa" carry the "Bibita" search-tag, but only the wine also
  // carries "Alcolico" — the tag, not the category, drives the match.
  const search = page.getByRole("textbox", { name: /cerca un piatto|search for a dish/i });
  await search.fill("bibita");
  await expect(page.getByText("Acqua naturale", { exact: true })).toBeVisible();
  await expect(page.getByText("Vino della casa", { exact: true })).toBeVisible();

  await search.fill("alcolico");
  await expect(page.getByText("Vino della casa", { exact: true })).toBeVisible();
  await expect(page.getByText("Acqua naturale", { exact: true })).toHaveCount(0);
});

test("searching a category name surfaces every dish in that category", async ({ page }) => {
  // "Orecchiette" has no tag/description mentioning "primi": only living
  // inside the "Primi" category should surface it for that search.
  const search = page.getByRole("textbox", { name: /cerca un piatto|search for a dish/i });
  await search.fill("primi");
  await expect(page.getByText("Orecchiette", { exact: true })).toBeVisible();
  await expect(page.getByText("Bruschetta", { exact: true })).toHaveCount(0);
});

test("clicking an item with a photo opens a zoom modal, closable via the X button", async ({ page }) => {
  await page.getByText("Tiramisù", { exact: true }).click();
  const modal = page.locator(".mdp-modal-card");
  await expect(modal).toBeVisible();
  await expect(modal.getByText("Ricetta della casa")).toBeVisible();

  await page.getByRole("button", { name: /chiudi|close/i }).click();
  await expect(page.locator(".mdp-modal-card")).toHaveCount(0);
});

test("zoom modal closes on Escape and on backdrop click", async ({ page }) => {
  await page.getByText("Tiramisù", { exact: true }).click();
  await expect(page.locator(".mdp-modal-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".mdp-modal-card")).toHaveCount(0);

  await page.getByText("Tiramisù", { exact: true }).click();
  await expect(page.locator(".mdp-modal-card")).toBeVisible();
  await page.locator(".mdp-modal-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(page.locator(".mdp-modal-card")).toHaveCount(0);
});
