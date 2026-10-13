import { test, expect } from "@playwright/test";
import { TEST_WAITER, TEST_ADMIN } from "./test-env";
import { staffLogin } from "./helpers/staffLogin";
import { seedClosedOrders, deleteOrdersByWaiterName } from "./helpers/seedClosedOrders";
import { PHONE, navTo, sheet } from "./helpers/phone";

// Storico comande (TillHistory.jsx, la stessa schermata della cassa) dal
// telefono: elenco per giorno, tocco su una comanda → il suo preconto a
// pagina intera (OrderUi.jsx > ReceiptPanel) con "Ristampa preconto" e, per
// l'admin, l'eliminazione. HISTORY_PAGE_SIZE è 20 (orders.js): per la
// paginazione si seminano comande chiuse direttamente su Firestore.
// Marker univoco per test (i test partono in parallelo): è il nome del
// cameriere delle comande seminate, visibile nella riga.
function uniqueMarker(prefix) {
  return `${prefix}${Date.now()}x${Math.random().toString(36).slice(2, 7)}`;
}

test.use(PHONE);

async function openHistory(page, account) {
  await page.goto("/cameriere");
  await staffLogin(page, account);
  await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
  await navTo(page, "Storico");
  await expect(page.getByText("Storico comande")).toBeVisible();
}

test.describe("Storico comande", () => {
  test("mostra 'Carica altre' quando ci sono più comande di una pagina", async ({ page }) => {
    test.slow(); // 25 comande scritte e poi cancellate, con gli altri file in parallelo
    const marker = uniqueMarker("PagTest");
    await seedClosedOrders(25, marker);
    try {
      await openHistory(page, TEST_WAITER);
      const rows = page.getByRole("region", { name: "Comande chiuse" }).getByRole("button", { name: new RegExp(marker) });
      const loadMore = page.getByRole("button", { name: /carica altre/i });
      await expect(loadMore).toBeVisible({ timeout: 10_000 });
      const before = await rows.count();
      await loadMore.click();
      await expect.poll(() => rows.count(), { timeout: 10_000 }).toBeGreaterThan(before);
    } finally {
      await deleteOrdersByWaiterName(marker);
    }
  });

  test("una comanda si apre come preconto a pagina intera, in sola lettura, con la ristampa", async ({ page }) => {
    const marker = uniqueMarker("ExpTest");
    await seedClosedOrders(1, marker);
    try {
      await openHistory(page, TEST_WAITER);
      await page.getByRole("button", { name: new RegExp(marker) }).click();
      const detail = sheet(page, "Dettaglio comanda");
      await expect(detail).toBeVisible();
      await expect(detail).toContainText("Documento non fiscale");
      await expect(detail).toContainText("Voce di test");
      await expect(detail.getByRole("button", { name: "Ristampa preconto" })).toBeVisible();
      await expect(detail.getByRole("button", { name: "Stampa dal browser" })).toBeVisible();
      // Una comanda chiusa non si modifica più.
      await expect(detail.getByRole("button", { name: /conferma preconto/i })).toHaveCount(0);
      await detail.getByRole("button", { name: "Storico", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    } finally {
      await deleteOrdersByWaiterName(marker);
    }
  });

  test("il cameriere non può eliminare comande né svuotare lo storico", async ({ page }) => {
    const marker = uniqueMarker("NoDelTest");
    await seedClosedOrders(1, marker);
    try {
      await openHistory(page, TEST_WAITER);
      await expect(page.getByRole("button", { name: /svuota storico/i })).toHaveCount(0);
      await page.getByRole("button", { name: new RegExp(marker) }).click();
      await expect(sheet(page, "Dettaglio comanda").getByRole("button", { name: /elimina/i })).toHaveCount(0);
    } finally {
      await deleteOrdersByWaiterName(marker);
    }
  });

  test("l'admin elimina una comanda dallo storico dopo una conferma, e resta eliminata", async ({ page }) => {
    const marker = uniqueMarker("DelTest");
    await seedClosedOrders(1, marker);
    try {
      await openHistory(page, TEST_ADMIN);
      const row = page.getByRole("button", { name: new RegExp(marker) });
      await row.click();
      const detail = sheet(page, "Dettaglio comanda");
      await detail.getByRole("button", { name: "Elimina dallo storico" }).click();
      const confirm = page.getByRole("alertdialog", { name: /eliminare tavolo \d+ dallo storico/i });
      await confirm.getByRole("button", { name: "Annulla" }).click();
      await expect(detail).toBeVisible();

      await detail.getByRole("button", { name: "Elimina dallo storico" }).click();
      await confirm.getByRole("button", { name: "Elimina comanda" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(row).toHaveCount(0);

      // Ricaricando si resta nello Storico (sezione nell'URL) e la comanda non c'è più.
      await page.reload();
      await expect(page.getByText("Storico comande")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: new RegExp(marker) })).toHaveCount(0);
    } finally {
      await deleteOrdersByWaiterName(marker);
    }
  });

  test("'Svuota storico' è solo dell'admin e chiede conferma prima di eliminare tutto", async ({ page }) => {
    const marker = uniqueMarker("ClearTest");
    await seedClosedOrders(1, marker);
    try {
      await openHistory(page, TEST_ADMIN);
      await page.getByRole("button", { name: "Svuota storico" }).click();
      const confirm = page.getByRole("alertdialog", { name: "Svuotare tutto lo storico?" });
      await expect(confirm).toBeVisible();
      // Non si conferma: altri test in parallelo usano lo storico.
      await confirm.getByRole("button", { name: "Annulla" }).click();
      await expect(page.getByRole("button", { name: new RegExp(marker) })).toBeVisible();
    } finally {
      await deleteOrdersByWaiterName(marker);
    }
  });
});
