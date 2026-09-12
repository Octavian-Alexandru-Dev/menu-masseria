import { test, expect } from "@playwright/test";
import { TEST_WAITER } from "./test-env";
import { deleteTestOrderByTableNumber } from "./firestore-cleanup";
import { staffLogin } from "./helpers/staffLogin";

// Numero di tavolo "sentinella" molto alto e randomizzato ad ogni run, per
// non essere mai confuso con un tavolo reale e per non collidere con un
// eventuale residuo lasciato da un run precedente interrotto a metà.
const TABLE_NUMBER = 9000 + Math.floor(Math.random() * 500);

// Range distinto da TABLE_NUMBER sopra e da quelli usati in
// kitchen-view.spec.js/reservations.spec.js, per i test aggiuntivi qui sotto
// che aprono un proprio tavolo indipendente (i test girano in parallelo,
// fullyParallel: true).
function freshTableNumber() {
  return 10000 + Math.floor(Math.random() * 500);
}

async function openFreshTable(page) {
  const tableNumber = freshTableNumber();
  await page.getByRole("button", { name: /nuovo tavolo/i }).click();
  await page.locator('input[type="number"]').first().fill(String(tableNumber));
  await page.getByRole("button", { name: /apri tavolo/i }).click();
  await expect(page.getByText(`Tavolo ${tableNumber}`, { exact: true })).toBeVisible({ timeout: 10_000 });
  return tableNumber;
}

test.describe("Area cameriere", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/cameriere");
  });

  // Una comanda di test, anche chiusa correttamente dal flusso UI, resta
  // visibile per sempre nello Storico comande finché non scadono i 30 giorni
  // di retention — quindi non basta chiuderla, va eliminata del tutto.
  test.afterEach(async () => {
    await deleteTestOrderByTableNumber(TABLE_NUMBER);
  });

  test("mostra il login per l'area cameriere", async ({ page }) => {
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /accedi/i })).toBeVisible();
  });

  test("rifiuta credenziali non valide", async ({ page }) => {
    await page.locator('input[type="email"]').fill("nonexistent-user@example.com");
    await page.locator('input[type="password"]').fill("wrong-password");
    await page.getByRole("button", { name: /accedi/i }).click();
    await expect(page.getByText(/non corrett|non riuscito/i)).toBeVisible({ timeout: 10_000 });
  });

  test("apre un tavolo, invia un piatto e mostra l'indicatore di sincronizzazione", async ({ page }) => {
    await page.locator('input[type="email"]').fill(TEST_WAITER.email);
    await page.locator('input[type="password"]').fill(TEST_WAITER.password);
    await page.getByRole("button", { name: /accedi/i }).click();

    await page.getByRole("button", { name: /nuovo tavolo/i }).click();
    await page.locator('input[type="number"]').first().fill(String(TABLE_NUMBER));
    await page.getByRole("button", { name: /apri tavolo/i }).click();

    await expect(page.getByText(`Tavolo ${TABLE_NUMBER}`, { exact: true })).toBeVisible({ timeout: 10_000 });

    // Aggiunge la prima voce di menù disponibile (struttura, non testo
    // hardcoded: il menù reale cambia indipendentemente da questo test).
    const firstDish = page.locator("button", { hasText: "€" }).first();
    await expect(firstDish).toBeVisible({ timeout: 10_000 });
    await firstDish.click();

    const sendButton = page.getByRole("button", { name: /invia comanda/i });
    await expect(sendButton).toBeVisible();
    await sendButton.click();

    // Indicatore di stato di sincronizzazione (§7 del documento): compare
    // subito, poi si conferma.
    await expect(page.getByText(/sincronizzata|invio in corso/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/sincronizzata/i)).toBeVisible({ timeout: 15_000 });

    // La riga inviata compare nella comanda con lo stato "Inviata".
    await expect(page.getByText(/inviata/i).first()).toBeVisible();

    // Chiude il tavolo: torna all'elenco (non più aperto)...
    await page.getByRole("button", { name: /chiudi tavolo/i }).click();
    await page.getByRole("button", { name: /conferma chiusura/i }).click();
    await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });

    // ...ma resta visibile nella sezione "Chiusi nel turno" (non sparisce
    // del tutto dalla schermata per tutto il servizio in corso).
    await expect(page.getByText(/chiusi nel turno/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`Tavolo ${TABLE_NUMBER}`, { exact: true })).toBeVisible();
  });

  test.describe("Dettaglio tavolo", () => {
    const openedTableNumbers = [];

    test.afterEach(async () => {
      await Promise.all(openedTableNumbers.splice(0).map((n) => deleteTestOrderByTableNumber(n)));
    });

    test.beforeEach(async ({ page }) => {
      await staffLogin(page, TEST_WAITER);
      await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
    });

    test("il modulo nuovo tavolo richiede il numero prima di poter aprire", async ({ page }) => {
      await page.getByRole("button", { name: /nuovo tavolo/i }).click();
      const openButton = page.getByRole("button", { name: /apri tavolo/i });
      await expect(openButton).toBeDisabled();
      await page.locator('input[type="number"]').first().fill(String(freshTableNumber()));
      await expect(openButton).toBeEnabled();
    });

    test("la ricerca piatti filtra 'Aggiungi piatti' e mostra lo stato senza risultati", async ({ page }) => {
      const tableNumber = await openFreshTable(page);
      openedTableNumbers.push(tableNumber);

      const search = page.getByRole("textbox", { name: "Cerca un piatto" });
      await search.fill("orecchiette");
      await expect(page.getByRole("button", { name: /orecchiette/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /bruschetta/i })).toHaveCount(0);

      await search.fill("xyznonexistentdish");
      await expect(page.getByText("Nessun piatto trovato.")).toBeVisible();

      await page.getByRole("button", { name: "Cancella ricerca" }).click();
      await expect(search).toHaveValue("");
      await expect(page.getByRole("button", { name: /bruschetta/i })).toBeVisible();
    });

    test("i tag di ricerca filtrano come la digitazione manuale, sia cliccati che digitati", async ({ page }) => {
      const tableNumber = await openFreshTable(page);
      openedTableNumbers.push(tableNumber);

      const search = page.getByRole("textbox", { name: "Cerca un piatto" });

      // Cliccando il tag "Bibita" (seed: scripts/seed-emulator.js) il campo
      // di ricerca si valorizza da solo e filtra come se il cameriere avesse
      // digitato la stessa parola a mano.
      await page.getByRole("button", { name: "Bibita", exact: true }).click();
      await expect(search).toHaveValue("Bibita");
      await expect(page.getByRole("button", { name: /acqua naturale/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /vino della casa/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /bruschetta/i })).toHaveCount(0);

      // Ricliccando lo stesso tag (già selezionato) lo si deseleziona.
      await page.getByRole("button", { name: "Bibita", exact: true }).click();
      await expect(search).toHaveValue("");

      // Digitando a mano lo stesso identico testo del tag si ottiene lo
      // stesso risultato del click sulla pillola.
      await search.fill("Alcolico");
      await expect(page.getByRole("button", { name: /vino della casa/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /acqua naturale/i })).toHaveCount(0);
      await page.getByRole("button", { name: "Alcolico", exact: true }).click();
      await expect(search).toHaveValue("");
      await expect(page.getByRole("button", { name: /acqua naturale/i })).toBeVisible();
    });

    test("una riga nel carrello si può aumentare, diminuire, annotare e rimuovere prima dell'invio", async ({ page }) => {
      const tableNumber = await openFreshTable(page);
      openedTableNumbers.push(tableNumber);

      await page.getByRole("button", { name: /bruschetta/i }).click();
      await expect(page.getByRole("button", { name: /invia comanda \(1\)/i })).toBeVisible();

      await page.getByRole("button", { name: "Aumenta quantità di Bruschetta" }).click();
      await expect(page.getByRole("button", { name: /invia comanda \(2\)/i })).toBeVisible();
      await page.getByRole("button", { name: "Diminuisci quantità di Bruschetta" }).click();
      await expect(page.getByRole("button", { name: /invia comanda \(1\)/i })).toBeVisible();

      await page.locator('input[placeholder="nota"]').fill("senza aglio");
      await expect(page.locator('input[placeholder="nota"]')).toHaveValue("senza aglio");

      await page.getByRole("button", { name: "Rimuovi Bruschetta dalla comanda" }).click();
      // Carrello vuoto: torna al footer coi totali/Preconto/Chiudi tavolo.
      await expect(page.getByRole("button", { name: /invia comanda/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /preconto/i })).toBeVisible();
    });

    test("i selettori coperti (CoversEditor) aggiornano adulti e bambini", async ({ page }) => {
      const tableNumber = await openFreshTable(page);
      openedTableNumbers.push(tableNumber);

      const adultsGroup = page.locator("span", { hasText: "Adulti" }).first();
      const childrenGroup = page.locator("span", { hasText: "Bambini" }).first();
      await expect(adultsGroup).toContainText("0");
      await page.getByRole("button", { name: "Aumenta adulti" }).click();
      await expect(adultsGroup).toContainText("1");
      await page.getByRole("button", { name: "Diminuisci adulti" }).click();
      await expect(adultsGroup).toContainText("0");

      await expect(childrenGroup).toContainText("0");
      await page.getByRole("button", { name: "Aumenta bambini" }).click();
      await expect(childrenGroup).toContainText("1");
    });

    test("Preconto apre il riepilogo stampabile e si può chiudere", async ({ page }) => {
      const tableNumber = await openFreshTable(page);
      openedTableNumbers.push(tableNumber);

      await page.getByRole("button", { name: /preconto/i }).click();
      await expect(page.getByText("Documento non fiscale")).toBeVisible();
      await expect(page.getByText("Nessun piatto ordinato.")).toBeVisible();

      await page.getByRole("button", { name: "Chiudi preconto" }).click();
      await expect(page.getByText("Documento non fiscale")).toHaveCount(0);
    });

    test("il Preconto si modifica (rimuove una riga) e si conferma, bloccandosi", async ({ page }) => {
      const tableNumber = await openFreshTable(page);
      openedTableNumbers.push(tableNumber);

      await page.getByRole("button", { name: /bruschetta/i }).click();
      await page.getByRole("button", { name: /caprese/i }).click();
      await page.getByRole("button", { name: /invia comanda/i }).click();
      await expect(page.getByText(/sincronizzata/i)).toBeVisible({ timeout: 15_000 });

      await page.getByRole("button", { name: /preconto/i }).click();
      await expect(page.getByText("Documento non fiscale")).toBeVisible();
      // In sola lettura (non ancora in modifica) le righe non hanno un
      // bottone di rimozione.
      await expect(page.getByRole("button", { name: /^rimuovi .* dal preconto$/i })).toHaveCount(0);

      await page.getByRole("button", { name: /^modifica$/i }).click();
      const removeButtons = page.getByRole("button", { name: /^rimuovi .* dal preconto$/i });
      await expect(removeButtons).toHaveCount(2);
      await removeButtons.first().click();
      await expect(removeButtons).toHaveCount(1, { timeout: 10_000 });

      await page.getByRole("button", { name: /^fine modifica$/i }).click();
      await page.getByRole("button", { name: /^conferma preconto$/i }).click();
      await expect(page.getByText(/^preconto confermato$/i)).toBeVisible({ timeout: 10_000 });
      // Bloccato: niente più Modifica/Conferma.
      await expect(page.getByRole("button", { name: /^modifica$/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^conferma preconto$/i })).toHaveCount(0);
    });

    test("i link Storico e Prenotazioni nell'header aprono le rispettive sezioni e si può tornare a Sala", async ({ page }) => {
      await page.getByRole("button", { name: /storico/i }).click();
      await expect(page.getByText("Storico comande")).toBeVisible();
      await page.getByRole("button", { name: /indietro/i }).click();
      await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });

      await page.getByRole("button", { name: /prenotazioni/i }).click();
      await expect(page.getByText(/^prenotazioni —/i)).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: /^sala$/i }).click();
      await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
    });

    test("un tavolo chiuso da un'altra sessione mostra lo stato 'non più aperto'", async ({ page, browser }) => {
      const tableNumber = await openFreshTable(page);
      openedTableNumbers.push(tableNumber);

      const otherContext = await browser.newContext();
      const otherPage = await otherContext.newPage();
      try {
        await otherPage.goto("/cameriere");
        await staffLogin(otherPage, TEST_WAITER);
        await otherPage.getByText(`Tavolo ${tableNumber}`, { exact: true }).click();
        await expect(otherPage.getByRole("button", { name: /chiudi tavolo/i })).toBeVisible({ timeout: 10_000 });
        await otherPage.getByRole("button", { name: /chiudi tavolo/i }).click();
        await otherPage.getByRole("button", { name: /conferma chiusura/i }).click();
        await expect(otherPage.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });

        // La pagina originale è rimasta sul dettaglio dello stesso tavolo:
        // la sottoscrizione realtime lo fa sparire dagli ordini aperti e
        // mostra il fallback, senza bisogno di ricaricare la pagina.
        await expect(page.getByText("Questo tavolo non è più aperto.")).toBeVisible({ timeout: 15_000 });
        await page.getByRole("button", { name: /torna ai tavoli/i }).click();
        await expect(page.getByRole("button", { name: /nuovo tavolo/i })).toBeVisible({ timeout: 10_000 });
      } finally {
        await otherContext.close();
      }
    });
  });
});
