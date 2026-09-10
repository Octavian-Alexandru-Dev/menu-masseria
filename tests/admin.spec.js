import { test, expect } from "@playwright/test";
import { openAdmin, importFixtureMenu } from "./helpers/adminHelpers";
import { makeFixtureMenu } from "./helpers/adminFixtureMenu";
import { locatorByValue } from "./helpers/findByValue";

test.describe("Admin — identità, tema, staff (scrivono su Firestore)", () => {
  // Unico test che tocca davvero il documento menu/data condiviso (identità
  // + link recensioni): esegue le modifiche e le ripristina nello stesso
  // test, in sequenza, per non lasciare residui né correre rischi di
  // sovrascritture concorrenti con altri test Admin (che invece lavorano
  // solo sull'editor in memoria, via importFixtureMenu, senza mai salvare).
  test("salva le modifiche a identità e link recensioni, poi le ripristina", async ({ page }) => {
    await openAdmin(page);

    const nameInput = page.getByLabel("Nome del ristorante");
    const locationInput = page.getByLabel("Località");
    const originalName = await nameInput.inputValue();
    const originalLocation = await locationInput.inputValue();

    await nameInput.fill("Masseria Demo — Modificato dal test");
    await locationInput.fill("Località Modificata dal test");
    const googleToggle = page.getByRole("checkbox", { name: "Visibile ai clienti" }).first();
    await googleToggle.check();
    await page.getByPlaceholder("https://g.page/r/…/review").fill("https://g.page/r/test-review");
    await page.getByRole("button", { name: /^salva modifiche$/i }).click();
    await expect(page.getByText(/^salvato alle/i)).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByText("Identità del locale")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Nome del ristorante")).toHaveValue("Masseria Demo — Modificato dal test");
    await expect(page.getByLabel("Località")).toHaveValue("Località Modificata dal test");

    // Il link recensione ora attivo e compilato compare nel piè di pagina
    // del menù pubblico — verifica il contratto end-to-end tra Admin e
    // ClientView, non solo lo stato locale dell'editor.
    const clientPage = await page.context().newPage();
    await clientPage.goto("/");
    await expect(clientPage.getByRole("link", { name: /lascia una recensione su google/i })).toBeVisible({ timeout: 10_000 });
    await clientPage.close();

    // Ripristino.
    await page.getByLabel("Nome del ristorante").fill(originalName);
    await page.getByLabel("Località").fill(originalLocation);
    await page.getByRole("checkbox", { name: "Visibile ai clienti" }).first().uncheck();
    await page.getByPlaceholder("https://g.page/r/…/review").fill("");
    await page.getByRole("button", { name: /^salva modifiche$/i }).click();
    await expect(page.getByText(/^salvato alle/i)).toBeVisible({ timeout: 10_000 });
  });

  test("il selettore tema evidenzia visivamente il tema scelto", async ({ page }) => {
    await openAdmin(page);
    // "Essenziale" è il tema di default del menù demo (scripts/seed-emulator.js).
    const essenziale = page.getByRole("button", { name: "Essenziale" });
    const ciro = page.getByRole("button", { name: "Notte di Cirò" });
    await expect(essenziale).toHaveCSS("border-width", "2px");
    await ciro.click();
    await expect(ciro).toHaveCSS("border-width", "2px");
    await expect(essenziale).toHaveCSS("border-width", "1px");
    // Non salvato: la selezione resta solo nell'editor di questa pagina.
  });

  test("aggiunge e rimuove un membro dello staff", async ({ page }) => {
    await openAdmin(page);
    const fakeUid = `qa-test-uid-${Date.now()}`;
    await page.getByPlaceholder("es. aBc123…").fill(fakeUid);
    await page.getByPlaceholder("es. Marco").fill("Membro Di Prova");
    await page.getByRole("button", { name: /^aggiungi$/i }).click();
    await expect(page.getByText(fakeUid)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/membro di prova/i)).toBeVisible();

    // Risale dal testo dell'uid (univoco) al div-riga: ancestor::div[1] è il
    // div "info" (nome+uid), ancestor::div[2] è la riga vera e propria (che
    // contiene anche il bottone Rimuovi come fratello del div info).
    const row = page.getByText(fakeUid, { exact: true }).locator("xpath=ancestor::div[2]");
    const removeButton = row.getByRole("button", { name: /^rimuovi$/i });
    await removeButton.click();
    await expect(row.getByRole("button", { name: /^conferma$/i })).toBeVisible();
    await row.getByRole("button", { name: /^conferma$/i }).click();
    await expect(page.getByText(fakeUid)).toHaveCount(0, { timeout: 10_000 });
  });
});

test.describe("Admin — editor menù (solo in memoria, mai salvato su Firestore)", () => {
  test("importa un JSON valido apre l'editor con le categorie importate; un JSON non valido mostra un errore; l'export scarica lo stesso menù", async ({ page }) => {
    await openAdmin(page);
    const fixture = makeFixtureMenu("import" + Date.now());
    await importFixtureMenu(page, fixture);
    // .first(): il nome categoria compare due volte in pagina (intestazione
    // espandibile + pillola nella sezione "Categorie da includere" del PDF
    // più sotto) — qui basta sapere che è presente.
    await expect(page.getByText(fixture.categories[0].name).first()).toBeVisible();
    await expect(page.getByText(fixture.categories[1].name).first()).toBeVisible();

    const invalidBuffer = Buffer.from("{ questo non è json valido", "utf-8");
    await page.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: invalidBuffer });
    await expect(page.getByText(/il file non è un json valido/i)).toBeVisible({ timeout: 10_000 });
    // Il menù nell'editor resta quello importato con successo in precedenza.
    await expect(page.getByText(fixture.categories[0].name).first()).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /^esporta json$/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^menu-\d{4}-\d{2}-\d{2}\.json$/);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const exported = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    expect(exported.restaurantName).toBe(fixture.restaurantName);
    expect(exported.categories).toHaveLength(2);
  });

  test("modifica i campi di una voce esistente", async ({ page }) => {
    await openAdmin(page);
    const fixture = makeFixtureMenu("edititem" + Date.now());
    await importFixtureMenu(page, fixture);
    const catB = fixture.categories[1];
    const itemB1 = catB.items[0];

    await page.getByText(catB.name, { exact: true }).first().click();
    // Il nome della voce esiste SOLO come valore del campo input (a
    // differenza del nome categoria, che compare anche come testo statico
    // nell'intestazione) — niente da cercare con getByText qui.
    const nameField = await locatorByValue(page, "input", itemB1.name);
    await nameField.fill("Voce B1 Modificata");
    const priceField = await locatorByValue(page, "input", itemB1.price);
    await priceField.fill("9,99");
    const descField = await locatorByValue(page, "textarea", itemB1.description);
    await descField.fill("Descrizione modificata dal test");

    await expect(nameField).toHaveValue("Voce B1 Modificata");
    await expect(priceField).toHaveValue("9,99");
    await expect(descField).toHaveValue("Descrizione modificata dal test");
  });

  test("aggiunge una voce (mostra l'avviso di traduzione mancante) e la elimina", async ({ page }) => {
    await openAdmin(page);
    const fixture = makeFixtureMenu("additem" + Date.now());
    await importFixtureMenu(page, fixture);
    const catB = fixture.categories[1];
    const catBNameText = page.getByText(catB.name, { exact: true }).first();
    // Il conteggio "N voci" è un fratello del nome nello stesso contenitore
    // — altre categorie possono avere per coincidenza lo stesso numero di
    // voci, quindi va scoperto scoping su questa categoria, non con un
    // match generico in tutta la pagina.
    const catBCountText = catBNameText.locator("xpath=following-sibling::div[1]");
    await catBNameText.click();
    await expect(catBCountText).toHaveText(`${catB.items.length} voci`);

    await page.getByRole("button", { name: /^aggiungi voce$/i }).click();
    const warning = page.getByText(/questa voce non ha ancora una traduzione/i);
    await expect(warning).toBeVisible({ timeout: 10_000 });
    // Ancora sull'input "Nome piatto" per valore (univoco: "Nuova voce"),
    // non sul riquadro dell'avviso — quel riquadro sparisce dal DOM appena
    // si preme "Chiudi avviso", il che romperebbe qualunque locator
    // costruito a partire da lì per le interazioni successive.
    // ancestor::div[3]: input → wrapper del campo (1) → griglia campi (2) →
    // card della voce (3), che contiene anche il bottone Elimina voce.
    const newItemNameInput = await locatorByValue(page, "input:not([type])", "Nuova voce");
    const newItemCard = newItemNameInput.locator("xpath=ancestor::div[3]");
    await expect(catBCountText).toHaveText(`${catB.items.length + 1} voci`);

    await page.getByRole("button", { name: "Chiudi avviso" }).click();
    await expect(warning).toHaveCount(0);

    await newItemCard.getByRole("button", { name: /^elimina voce$/i }).click();
    await newItemCard.getByRole("button", { name: /^conferma eliminazione$/i }).click();
    await expect(catBCountText).toHaveText(`${catB.items.length} voci`, { timeout: 10_000 });
  });

  test("riordina categorie e voci, sposta una voce in un'altra categoria, elimina una categoria", async ({ page }) => {
    await openAdmin(page);
    const fixture = makeFixtureMenu("reorder" + Date.now());
    await importFixtureMenu(page, fixture);
    const [catA, catB] = fixture.categories;
    const [itemA1, itemA2] = catA.items;

    // I nomi categoria compaiono anche come testo statico nell'intestazione
    // (innerText li vede), ma i nomi voce esistono SOLO come valore del
    // campo input "Nome piatto" — per il loro ordine serve leggere i valori
    // di tutti gli input nell'ordine in cui compaiono nel DOM.
    const catOrder = async () => {
      const text = await page.locator("body").innerText();
      return { a: text.indexOf(catA.name), b: text.indexOf(catB.name) };
    };
    const itemOrder = async () => {
      const values = await page.locator("input").evaluateAll((els) => els.map((el) => el.value));
      return { a1: values.indexOf(itemA1.name), a2: values.indexOf(itemA2.name) };
    };

    let catPos = await catOrder();
    expect(catPos.a).toBeLessThan(catPos.b);

    // A è la prima categoria: il suo pulsante "giù" è il primo abilitato
    // nel DOM (quello di B, ultima categoria, è disabilitato).
    await page.getByRole("button", { name: /^sposta categoria giù$/i }).first().click();
    catPos = await catOrder();
    expect(catPos.b).toBeLessThan(catPos.a); // ordine invertito: B ora prima di A

    // Espande A (ovunque sia ora) per riordinare le sue voci — nessun'altra
    // categoria è espansa, quindi i pulsanti/il menù a tendina delle voci
    // sotto sono per forza quelli di A.
    await page.getByText(catA.name, { exact: true }).first().click();
    let itemPos = await itemOrder();
    expect(itemPos.a1).toBeLessThan(itemPos.a2);
    await page.getByRole("button", { name: /^sposta voce giù$/i }).first().click();
    itemPos = await itemOrder();
    expect(itemPos.a2).toBeLessThan(itemPos.a1); // A2 ora prima di A1

    // Sposta la voce ora-prima di A (A2) in B tramite il menù a tendina.
    await page.getByLabel("Sposta voce in un'altra categoria").first().selectOption({ label: catB.name });
    const valuesAfterMove = await page.locator("input").evaluateAll((els) => els.map((el) => el.value));
    expect(valuesAfterMove).toContain(itemA2.name); // spostata, non persa

    // Elimina una categoria (conferma a doppio click) — sono sempre
    // entrambe presenti nel DOM (solo il contenuto si espande/comprime),
    // quindi il conteggio dei pulsanti "Elimina categoria" è un segnale
    // affidabile indipendentemente da quale delle due sia rimasta B/A.
    const deleteButtons = page.getByRole("button", { name: "Elimina categoria" });
    await expect(deleteButtons).toHaveCount(2);
    await deleteButtons.last().click();
    await page.getByRole("button", { name: "Conferma eliminazione categoria" }).click();
    await expect(deleteButtons).toHaveCount(1, { timeout: 10_000 });
  });

  test("il caricamento immagine fallisce se Cloudinary non è configurato in questo ambiente", async ({ page }) => {
    await openAdmin(page);
    const fixture = makeFixtureMenu("image" + Date.now());
    await importFixtureMenu(page, fixture);
    const catB = fixture.categories[1];
    await page.getByText(catB.name, { exact: true }).first().click();

    const fakeImage = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // header GIF minimo
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "piatto.gif", mimeType: "image/gif", buffer: fakeImage });
    await expect(page.getByText(/upload immagini non configurato/i)).toBeVisible({ timeout: 10_000 });
  });

  test("opzioni PDF: apre l'anteprima di stampa e mostra un errore se nessuna categoria è selezionata", async ({ page }) => {
    await openAdmin(page);
    const fixture = makeFixtureMenu("pdf" + Date.now());
    await importFixtureMenu(page, fixture);

    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: /^esporta pdf \/ stampa$/i }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await expect(popup.getByText(fixture.restaurantName)).toBeVisible({ timeout: 10_000 });
    await popup.close();

    for (const cat of fixture.categories) {
      await page.getByRole("button", { name: cat.name, exact: true }).click();
    }
    await page.getByRole("button", { name: /^esporta pdf \/ stampa$/i }).click();
    await expect(page.getByText(/nessuna voce da stampare/i)).toBeVisible({ timeout: 10_000 });
  });

  test("editor di traduzione: stato vuoto, compilazione campi esistenti, eliminazione con conferma e annullamento su blur", async ({ page }) => {
    await openAdmin(page);
    const fixture = makeFixtureMenu("i18n" + Date.now());
    const [catA] = fixture.categories;
    const [itemA1] = catA.items;
    // Traduzione DE completa per item A1, deliberatamente assente per A2 —
    // così il contatore "voci mancanti" e "Genera traduzione mancante"
    // hanno qualcosa da mostrare.
    fixture.translations = {
      de: {
        restaurantName: "Restaurant Fixture DE",
        tagline: "Fixture Slogan DE",
        footerNote: "Fixture Fußzeile DE",
        categories: {
          [catA.id]: {
            name: "Fixture Kategorie A DE",
            subtitle: "Untertitel A DE",
            items: { [itemA1.id]: { name: "Fixture Gericht A1 DE", description: "Beschreibung A1 DE" } },
          },
        },
      },
    };
    await importFixtureMenu(page, fixture);

    // FR: nessuna traduzione presente ancora — stato vuoto. langLabel in
    // TranslationEditor è la sigla (LANGUAGES in shared.jsx: "IT"/"EN"/...),
    // non il nome della lingua.
    await page.getByRole("button", { name: /^fr$/i }).click();
    await expect(page.getByText(/nessuna traduzione fr presente/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /genera traduzione automatica/i })).toBeVisible();

    // DE: traduzione parziale — campi compilati per quanto già tradotto,
    // badge "voci mancanti" per A2.
    // Il pulsante lingua include il badge del conteggio mancanti nel nome
    // accessibile quando la traduzione esiste già (es. "DE 6") — prefisso,
    // non match esatto.
    await page.getByRole("button", { name: /^de/i }).click();
    // Nota: "Nome del ristorante" (aria-label) è del campo IT nella card
    // identità principale (sempre presente) — il campo di TranslationEditor
    // è un input diverso, senza aria-label proprio, va cercato per valore.
    const nameField = await locatorByValue(page, "input", "Restaurant Fixture DE");
    await expect(nameField).toBeVisible();
    await expect(page.getByText(/voce non ancora tradotta|voci non ancora tradotte/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /genera traduzione mancante/i })).toBeVisible();

    await nameField.fill("Restaurant Fixture DE Modificato");
    await expect(nameField).toHaveValue("Restaurant Fixture DE Modificato");

    // Lo stesso bottone cambia nome accessibile tra i due stati ("Elimina
    // traduzione DE" ↔ "Conferma eliminazione traduzione DE"): il pattern
    // deve matchare entrambi, altrimenti il locator smette di risolvere
    // dopo il primo click che cambia l'etichetta.
    const deleteButton = page.getByRole("button", { name: /^(elimina|conferma eliminazione) traduzione de$/i });
    await deleteButton.click();
    await expect(page.getByRole("button", { name: /^conferma eliminazione traduzione de$/i })).toBeVisible();
    // Il blur (spostare il focus altrove) annulla la richiesta di conferma.
    await page.getByText("Identità del locale — DE").click();
    await expect(page.getByRole("button", { name: /^elimina traduzione de$/i })).toBeVisible();
    await expect(nameField).toHaveValue("Restaurant Fixture DE Modificato");

    await deleteButton.click();
    await deleteButton.click();
    await expect(page.getByText(/nessuna traduzione de presente/i)).toBeVisible({ timeout: 10_000 });
  });
});
