import { test, expect } from "@playwright/test";
import { TEST_WAITER, TEST_ADMIN } from "./test-env";
import { staffLogin } from "./helpers/staffLogin";
import { seedClosedOrders, deleteOrdersByWaiterName } from "./helpers/seedClosedOrders";

// Storico comande (OrderHistory.jsx) — condiviso tra area cameriere e cucina,
// qui raggiunto da /cameriere. HISTORY_PAGE_SIZE è 20 (orders.js): per
// testare la paginazione in modo deterministico si seminano 25 comande
// chiuse direttamente su Firestore invece di aprirle/chiuderle una a una
// dall'interfaccia (troppo lento, e non aggiungerebbe copertura oltre al
// flusso completo già testato in waiter-order.spec.js/kitchen-view.spec.js).
test.describe("Storico comande", () => {
  test("mostra il pulsante 'Carica altre' quando ci sono più di una pagina di risultati", async ({ page }) => {
    const marker = `PagTest${Date.now()}`;
    await seedClosedOrders(25, marker);
    try {
      await page.goto("/cameriere");
      await staffLogin(page, TEST_WAITER);
      await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: /storico/i }).click();
      await expect(page.getByText("Storico comande")).toBeVisible();

      const loadMore = page.getByRole("button", { name: /carica altre/i });
      await expect(loadMore).toBeVisible({ timeout: 10_000 });
      const rowsBefore = await page.locator("text=€").count();
      await loadMore.click();
      await expect(async () => {
        const rowsAfter = await page.locator("text=€").count();
        expect(rowsAfter).toBeGreaterThan(rowsBefore);
      }).toPass({ timeout: 10_000 });
    } finally {
      await deleteOrdersByWaiterName(marker);
    }
  });

  test("una riga si espande mostrando le voci e il pulsante di stampa apre il preconto in sola lettura", async ({ page }) => {
    const marker = `ExpTest${Date.now()}`;
    await seedClosedOrders(1, marker);
    try {
      await page.goto("/cameriere");
      await staffLogin(page, TEST_WAITER);
      await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: /storico/i }).click();

      // La riga mostra sia il nome cameriere (marker, univoco per questo
      // test) sia il totale: usiamo il marker per individuare il bottone
      // giusto tra le eventuali altre comande chiuse nello storico.
      const toggle = page.getByRole("button", { name: new RegExp(marker) });
      await expect(toggle).toBeVisible({ timeout: 10_000 });
      await toggle.click();
      await expect(page.getByText("Voce di test").first()).toBeVisible();

      // Il pulsante di stampa è un fratello del toggle nella stessa riga
      // (OrderHistory.jsx > OrderRow): risalire da lì, invece di prendere
      // il primo pulsante "Stampa preconto" della pagina, evita di colpire
      // la riga sbagliata quando nello storico sono presenti anche comande
      // chiuse da altri test in esecuzione in parallelo.
      await toggle.locator("xpath=following-sibling::button[1]").click();
      await expect(page.getByText("Documento non fiscale")).toBeVisible();
      await expect(page.getByText("Voce di test").last()).toBeVisible();
      // Sola lettura: una comanda già chiusa non si modifica più — niente
      // pulsante Modifica né Conferma preconto.
      await expect(page.getByRole("button", { name: /^modifica$/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^conferma preconto$/i })).toHaveCount(0);
      await page.getByRole("button", { name: "Chiudi preconto" }).click();
      await expect(page.getByText("Documento non fiscale")).toHaveCount(0);
    } finally {
      await deleteOrdersByWaiterName(marker);
    }
  });

  test("il cameriere non vede alcun pulsante per eliminare le comande", async ({ page }) => {
    const marker = `NoDelTest${Date.now()}`;
    await seedClosedOrders(1, marker);
    try {
      await page.goto("/cameriere");
      await staffLogin(page, TEST_WAITER);
      await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: /storico/i }).click();

      const toggle = page.getByRole("button", { name: new RegExp(marker) });
      await expect(toggle).toBeVisible({ timeout: 10_000 });
      // Solo il pulsante di stampa (fratello del toggle) è presente: niente
      // pulsante Elimina per un ruolo diverso da admin (OrderHistory.jsx).
      await expect(toggle.locator("xpath=following-sibling::button")).toHaveCount(1);
      await expect(page.getByRole("button", { name: /svuota storico/i })).toHaveCount(0);
    } finally {
      await deleteOrdersByWaiterName(marker);
    }
  });

  test("l'admin elimina una singola comanda dallo storico con doppia conferma", async ({ page }) => {
    const marker = `DelTest${Date.now()}`;
    await seedClosedOrders(1, marker);
    try {
      await page.goto("/cameriere");
      await staffLogin(page, TEST_ADMIN);
      await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: /storico/i }).click();

      const toggle = page.getByRole("button", { name: new RegExp(marker) });
      await expect(toggle).toBeVisible({ timeout: 10_000 });
      // Elimina comanda è il secondo pulsante fratello del toggle (dopo
      // Stampa preconto, sempre presente — vedi test sopra).
      const deleteBtn = toggle.locator("xpath=following-sibling::button[2]");
      await expect(deleteBtn).toBeVisible();

      // Primo click: arma la conferma, non elimina ancora.
      await deleteBtn.click();
      await expect(toggle).toBeVisible();
      await expect(page.getByRole("button", { name: /conferma eliminazione comanda/i })).toBeVisible();

      // Secondo click: elimina davvero.
      await page.getByRole("button", { name: /conferma eliminazione comanda/i }).click();
      await expect(toggle).toHaveCount(0);

      // Persistita: ricaricando la pagina la comanda resta sparita (non era
      // solo uno stato locale).
      await page.reload();
      await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: /storico/i }).click();
      await expect(page.getByRole("button", { name: new RegExp(marker) })).toHaveCount(0);
    } finally {
      await deleteOrdersByWaiterName(marker);
    }
  });

  test("il pulsante 'Svuota storico' è visibile solo all'admin e richiede una doppia conferma prima di eliminare", async ({ page }) => {
    // Non si esegue mai la seconda conferma in questo test: "Svuota storico"
    // elimina TUTTE le comande chiuse dell'emulatore (non solo quelle con
    // questo marker), quindi eseguirlo davvero comprometterebbe altri test
    // in esecuzione in parallelo (fullyParallel, vedi playwright.config.js)
    // che dipendono su comande chiuse proprie o sui dati seminati di
    // default (es. stats-dashboard.spec.js). Qui si verifica solo che il
    // pulsante sia riservato all'admin e che il primo click armi la
    // conferma senza cancellare nulla.
    const marker = `ClearAllTest${Date.now()}`;
    await seedClosedOrders(1, marker);
    try {
      await page.goto("/cameriere");
      await staffLogin(page, TEST_ADMIN);
      await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: /storico/i }).click();

      const clearAll = page.getByRole("button", { name: /^svuota storico$/i });
      await expect(clearAll).toBeVisible({ timeout: 10_000 });
      await clearAll.click();
      await expect(page.getByRole("button", { name: /confermi\? elimina tutto/i })).toBeVisible();

      // La comanda seminata per questo test è ancora lì: nessuna
      // eliminazione è avvenuta con un solo click.
      await expect(page.getByRole("button", { name: new RegExp(marker) })).toBeVisible();
    } finally {
      await deleteOrdersByWaiterName(marker);
    }
  });

  // Lo stato di errore di OrderHistory (banner "Impossibile caricare lo
  // storico...") esiste nel codice (vedi il catch in OrderHistory.jsx) ma
  // non è stato incluso qui: con la persistentLocalCache configurata in
  // firebase-db.js, il client Firestore instrada anche le letture one-shot
  // (getDocs) sullo stesso canale WebChannel multiplexato e con retry
  // automatico usato dalle sottoscrizioni realtime — non esiste una singola
  // richiesta HTTP isolabile da interrompere per simulare solo il
  // fallimento dello storico. Interromperla a livello di rete (Playwright
  // route.abort) o rompe anche le sottoscrizioni già attive (side effect
  // indesiderato, non rappresentativo di un guasto reale mirato) oppure,
  // per via del retry automatico dell'SDK, non fa mai fallire la promise in
  // un tempo ragionevole. Riprodurlo in modo pulito richiederebbe di
  // mockare l'SDK stesso, il che va contro l'approccio di questa suite
  // (test contro il backend reale/emulato, non contro finti interni).
});
