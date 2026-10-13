import { test, expect } from "@playwright/test";
import { TEST_WAITER } from "./test-env";
import { deleteTestOrderByTableNumber } from "./firestore-cleanup";
import { staffLogin } from "./helpers/staffLogin";
import { failPrintJobsByTableLabel } from "./helpers/printJobs";

// Numero di tavolo "sentinella" molto alto e randomizzato ad ogni run, per
// non essere mai confuso con un tavolo reale e per non collidere con un
// eventuale residuo lasciato da un run precedente interrotto a metà.
const TABLE_NUMBER = 9000 + Math.floor(Math.random() * 500);

// Range distinto da TABLE_NUMBER sopra e da quelli usati in
// reservations.spec.js, per i test aggiuntivi qui sotto
// che aprono un proprio tavolo indipendente (i test girano in parallelo,
// fullyParallel: true).
function freshTableNumber() {
  return 10000 + Math.floor(Math.random() * 500);
}

// La comanda del tavolo (righe da inviare e inviate, totale, Preconto,
// Chiudi tavolo) si apre a schermo intero dal pulsante "Comanda" della barra
// in basso (Waiter.jsx > OrderDetail).
async function openTicket(page) {
  await page.getByRole("button", { name: "Apri la comanda del tavolo" }).click();
  await expect(page.getByRole("dialog", { name: "Comanda del tavolo" })).toBeVisible();
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

    // La riga inviata compare nella comanda, nel gruppo "Inviata".
    await openTicket(page);
    await expect(page.getByRole("group", { name: "Già inviato" })).toContainText(/inviata/i);
    // La comanda per la cucina va in coda alla stampante della cassa (qui
    // nessuna cassa è accesa: resta in attesa, e il cameriere lo vede).
    await expect(page.getByRole("status", { name: "Stampa comanda cucina" })).toHaveText(/comanda cucina: inviato alla cassa, in attesa/i, { timeout: 10_000 });

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

    test("una comanda cucina non stampata è segnalata sul tavolo e si ristampa anche mentre si aggiungono piatti", async ({ page }) => {
      const tableNumber = await openFreshTable(page);
      openedTableNumbers.push(tableNumber);
      await page.getByRole("button", { name: /orecchiette/i }).click();
      await page.getByRole("button", { name: /invia comanda/i }).click();
      await expect(page.getByRole("status", { name: "Stampa comanda cucina" })).toHaveText(/in attesa/i, { timeout: 10_000 });
      await expect.poll(() => failPrintJobsByTableLabel(`Tavolo ${tableNumber}`, "Carta esaurita"), { timeout: 10_000 }).toBe(1);

      const problems = page.getByRole("group", { name: "Comande cucina non stampate" });
      await expect(problems).toContainText(/carta esaurita/i, { timeout: 10_000 });
      await page.getByRole("button", { name: "Tavoli", exact: true }).click();
      const row = page.getByRole("button", { name: new RegExp(`Tavolo ${tableNumber}\\b`) });
      await expect(row).toContainText("Comanda cucina non stampata", { timeout: 10_000 });

      // Riaperto il tavolo, la segnalazione resta anche con nuovi piatti nella bozza.
      await row.click();
      await page.getByRole("button", { name: /bruschetta/i }).click();
      await expect(page.getByRole("button", { name: /invia comanda \(1\)/i })).toBeVisible();
      await expect(problems).toContainText(/comanda delle \d\d:\d\d \(1 piatto\)/i);
      await problems.getByRole("button", { name: "Ristampa" }).click();
      await expect(problems).toHaveCount(0, { timeout: 10_000 });
      await expect(page.getByRole("button", { name: /invia comanda \(1\)/i })).toBeVisible();
    });

    test("i comandi usati a ogni tavolo sono grandi almeno 44px", async ({ page }) => {
      const tableNumber = await openFreshTable(page);
      openedTableNumbers.push(tableNumber);
      await page.getByRole("button", { name: /bruschetta/i }).click();
      const check = async (targets) => {
        for (const target of targets) {
          const box = await target.boundingBox();
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
      };
      // Schermata dei piatti e barra in basso.
      await check([
        page.getByRole("button", { name: "Aumenta adulti" }),
        page.getByRole("button", { name: "Diminuisci bambini" }),
        page.getByRole("button", { name: /orecchiette/i }),
        page.getByRole("tab", { name: "Primi" }),
        page.getByRole("button", { name: "Apri la comanda del tavolo" }),
        page.getByRole("button", { name: /invia comanda/i }),
      ]);
      // Comanda: − / + sulla riga (con una sola porzione "−" diventa "Rimuovi").
      await openTicket(page);
      await check([
        page.getByRole("button", { name: "Modifica Bruschetta" }),
        page.getByRole("button", { name: "Aumenta quantità di Bruschetta" }),
        page.getByRole("button", { name: "Rimuovi Bruschetta dalla comanda" }),
        page.getByRole("button", { name: /invia comanda/i }),
      ]);
      await page.getByRole("button", { name: "Aumenta quantità di Bruschetta" }).click();
      await check([page.getByRole("button", { name: "Diminuisci quantità di Bruschetta" })]);
      // Modifica della riga.
      await page.getByRole("button", { name: "Modifica Bruschetta" }).click();
      await check([
        page.getByRole("textbox", { name: "Nota di Bruschetta" }),
        page.getByRole("button", { name: "Offerto" }),
        page.getByRole("button", { name: /^salva$/i }),
      ]);
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

      await openTicket(page);
      await page.getByRole("button", { name: "Aumenta quantità di Bruschetta" }).click();
      await expect(page.getByRole("button", { name: /invia comanda \(2\)/i })).toBeVisible();
      await page.getByRole("button", { name: "Diminuisci quantità di Bruschetta" }).click();
      await expect(page.getByRole("button", { name: /invia comanda \(1\)/i })).toBeVisible();

      // Nota: si tocca la riga, si scrive nell'editor e vale solo con "Salva".
      await page.getByRole("button", { name: "Modifica Bruschetta" }).click();
      await page.getByRole("textbox", { name: "Nota di Bruschetta" }).fill("senza aglio");
      await page.getByRole("button", { name: /^salva$/i }).click();
      await expect(page.getByRole("group", { name: "Da inviare" })).toContainText("senza aglio");

      await page.getByRole("button", { name: "Rimuovi Bruschetta dalla comanda" }).click();
      // Comanda vuota: niente "Invia comanda", restano Preconto/Chiudi tavolo.
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

    test("Preconto apre il riepilogo stampabile a pagina intera e si torna ai piatti", async ({ page }) => {
      const tableNumber = await openFreshTable(page);
      openedTableNumbers.push(tableNumber);

      await page.getByRole("button", { name: /^preconto$/i }).click();
      const receipt = page.getByRole("dialog", { name: "Preconto" });
      await expect(receipt).toContainText("Documento non fiscale");
      await expect(receipt).toContainText("Nessun piatto ordinato.");

      await receipt.getByRole("button", { name: "Piatti", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    test("una riga inviata si toglie dalla comanda, poi il preconto si conferma e blocca le righe", async ({ page }) => {
      const tableNumber = await openFreshTable(page);
      openedTableNumbers.push(tableNumber);

      await page.getByRole("button", { name: /bruschetta/i }).click();
      await page.getByRole("button", { name: /caprese/i }).click();
      await page.getByRole("button", { name: /invia comanda/i }).click();
      await expect(page.getByText(/sincronizzata/i)).toBeVisible({ timeout: 15_000 });

      // Riga già inviata: si apre dalla comanda e si rimuove, con conferma.
      await openTicket(page);
      await page.getByRole("button", { name: /^modifica bruschetta: 1 ×/i }).click();
      await page.getByRole("dialog", { name: "Modifica riga" }).getByRole("button", { name: "Rimuovi dalla comanda" }).click();
      await page.getByRole("alertdialog", { name: "Rimuovere Bruschetta?" }).getByRole("button", { name: "Rimuovi" }).click();
      const sent = page.getByRole("group", { name: "Già inviato" });
      await expect(sent).not.toContainText("Bruschetta", { timeout: 10_000 });
      await expect(sent).toContainText("Caprese");

      // Preconto dalla comanda: conferma (con conferma) e il conto si blocca.
      await page.getByRole("dialog", { name: "Comanda del tavolo" }).getByRole("button", { name: /^preconto$/i }).click();
      const receipt = page.getByRole("dialog", { name: "Preconto" });
      await expect(receipt).toContainText("Caprese");
      await expect(receipt).not.toContainText("Bruschetta");
      await receipt.getByRole("button", { name: "Conferma preconto" }).click();
      await page.getByRole("alertdialog", { name: "Confermare il preconto?" }).getByRole("button", { name: "Conferma preconto" }).click();
      await expect(receipt.getByText("Preconto confermato")).toBeVisible({ timeout: 10_000 });
      await expect(receipt.getByRole("button", { name: "Conferma preconto" })).toHaveCount(0);

      await receipt.getByRole("button", { name: "Comanda", exact: true }).click();
      await page.getByRole("button", { name: /^modifica caprese: 1 ×/i }).click();
      const editor = page.getByRole("dialog", { name: "Modifica riga" });
      await expect(editor).toContainText("Preconto confermato: le righe non si possono più modificare.");
      await expect(editor.getByRole("button", { name: "Rimuovi dalla comanda" })).toHaveCount(0);
    });

    test("la barra in basso apre Storico e Prenotazioni e riporta ai Tavoli", async ({ page }) => {
      const nav = page.getByRole("navigation", { name: "Sezioni" });
      // Comandi della barra facili da toccare: etichetta di testo sempre
      // visibile e almeno 48px (Material 48dp / Apple 44pt / WCAG 2.5.5).
      for (const name of ["Tavoli", "Prenotazioni", "Storico"]) {
        expect((await nav.getByRole("button", { name, exact: true }).boundingBox()).height).toBeGreaterThanOrEqual(48);
      }
      await nav.getByRole("button", { name: "Storico", exact: true }).click();
      await expect(page.getByText("Storico comande")).toBeVisible();

      await nav.getByRole("button", { name: "Prenotazioni", exact: true }).click();
      await expect(page.getByRole("region", { name: "Calendario" })).toBeVisible({ timeout: 10_000 });

      await nav.getByRole("button", { name: "Tavoli", exact: true }).click();
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
        await openTicket(otherPage);
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
