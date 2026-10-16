import { test, expect } from "@playwright/test";
import { TEST_WAITER, TEST_ADMIN } from "./test-env";
import { deleteTestOrderByTableNumber, deleteTestReservationByName } from "./firestore-cleanup";
import { installDesktopBridgeMock, printedTexts } from "./helpers/desktopBridge";
import { deletePrintJobsByTableLabel } from "./helpers/printJobs";
import { swipeLeft } from "./helpers/swipe";
import { setTillLockRemotely, resetTillLockRemotely } from "./helpers/staffRoles";
import { findReservationByName } from "./helpers/reservations";
import { getMenu, findMenuItemByName, addMenuItemRemotely, updateMenuItemRemotely, removeMenuItemsByNamePrefix, addMenuCategoriesRemotely, removeMenuCategoriesByNamePrefix, findStaffByEmail, removeStaffByEmailRemotely, usernameEmail } from "./helpers/menuDoc";

// Sala della cassa (TillSala.jsx): l'interfaccia a tutto schermo in stile
// cassa POS mostrata solo dentro il client Windows (window.mdpDesktop,
// simulato). Stessi dati e regole della Sala da telefono (sala-shared.jsx),
// quindi qui si verifica il layout e il flusso completo dalla cassa:
// tavoli a griglia, apertura con tastierino, comanda a schermo diviso,
// modifica delle righe nella barra laterale (quantità, offerto, sconti,
// prezzo libero), invio con la comanda stampata per la cucina, preconto
// stampato direttamente, chiusura, Storico e Prenotazioni in versione cassa e,
// per l'admin, Menù e Statistiche.
//
// Progetto Playwright "till-sala" (playwright.config.js), in sequenza: ogni
// pagina è una cassa con la stazione di stampa attiva, e alcuni test stampano
// — un'altra "cassa" in parallelo si prenderebbe le loro stampe.
test.describe.configure({ mode: "serial" });

const usedTables = [];
const usedReservations = [];
// Prefisso delle voci di menù create dai test di questo file (ripulite anche
// se un test si interrompe a metà).
const TEST_DISH_PREFIX = "Prova cassa ";
const TEST_CATEGORY_PREFIX = "Prova cassa categoria ";
test.afterEach(async () => {
  await removeMenuCategoriesByNamePrefix(TEST_CATEGORY_PREFIX);
  await removeMenuItemsByNamePrefix(TEST_DISH_PREFIX);
  for (const n of usedTables.splice(0)) {
    await deleteTestOrderByTableNumber(n);
    await deletePrintJobsByTableLabel(`Tavolo ${n}`);
  }
  for (const name of usedReservations.splice(0)) await deleteTestReservationByName(name);
});

function freshTableNumber() {
  // 4 cifre: il tastierino della cassa accetta al massimo 4 cifre.
  return 7000 + Math.floor(Math.random() * 900);
}

async function openTill(page, bridgeOptions = {}) {
  await installDesktopBridgeMock(page, { savedLogin: TEST_WAITER, ...bridgeOptions });
  await page.goto("/cameriere");
  await expect(page.getByRole("button", { name: "Nuovo tavolo" })).toBeVisible({ timeout: 10_000 });
}

async function openTableWithKeypad(page, { adults = 2 } = {}) {
  const tableNumber = freshTableNumber();
  usedTables.push(tableNumber);
  await page.getByRole("button", { name: "Nuovo tavolo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuovo tavolo" });
  for (const digit of String(tableNumber)) await dialog.getByRole("button", { name: `Cifra ${digit}` }).click();
  await expect(dialog.getByRole("textbox", { name: "Numero tavolo" })).toHaveText(String(tableNumber));
  for (let i = 0; i < adults; i++) await dialog.getByRole("button", { name: "Aumenta adulti" }).click();
  await dialog.getByRole("button", { name: `Apri tavolo ${tableNumber}` }).click();
  await expect(page.getByRole("region", { name: "Comanda del tavolo" })).toBeVisible({ timeout: 10_000 });
  return tableNumber;
}

test("i tavoli riempiono lo schermo in una griglia e le sezioni sono a portata di tocco", async ({ page }) => {
  await openTill(page);
  const grid = page.getByTestId("till-floor-grid");
  const viewport = page.viewportSize();
  const box = await grid.boundingBox();
  // Non più una colonna stretta al centro: la griglia occupa quasi tutta la larghezza.
  expect(box.width).toBeGreaterThan(viewport.width * 0.8);
  for (const name of [/^tavoli/i, /^prenotazioni$/i, /^storico$/i]) {
    const tab = page.getByRole("navigation", { name: "Sezioni della sala" }).getByRole("button", { name });
    expect((await tab.boundingBox()).height).toBeGreaterThanOrEqual(48);
  }
  const newTable = await page.getByRole("button", { name: "Nuovo tavolo" }).boundingBox();
  expect(newTable.height).toBeGreaterThanOrEqual(48);
  // Menù e Statistiche sono solo per gli account admin.
  const nav = page.getByRole("navigation", { name: "Sezioni della sala" });
  await expect(nav.getByRole("button", { name: /^menù$/i })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: /^statistiche$/i })).toHaveCount(0);
});

test("dalla cassa si apre un tavolo con il tastierino, si prende la comanda e si invia", async ({ page }) => {
  await openTill(page);
  const tableNumber = await openTableWithKeypad(page);
  const ticket = page.getByRole("region", { name: "Comanda del tavolo" });
  await expect(ticket).toContainText(`Comanda — Tavolo ${tableNumber}`);
  await expect(page.getByRole("button", { name: "Invia comanda (0)" })).toBeDisabled();

  // Menù a riquadri per categoria, con il conteggio sul riquadro.
  await page.getByRole("tab", { name: "Antipasti" }).click();
  await page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).click();
  await page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).click();
  await page.getByRole("tab", { name: "Bevande" }).click();
  await page.getByRole("button", { name: /^Aggiungi Acqua naturale/ }).click();

  const draft = ticket.getByRole("group", { name: "Da inviare" });
  await expect(draft.getByRole("button", { name: /^Modifica Bruschetta: 2 ×/ })).toBeVisible();
  await expect(draft.getByRole("button", { name: /^Modifica Acqua naturale: 1 ×/ })).toBeVisible();

  // Nota per la cucina dall'editor della riga, nella barra laterale.
  await draft.getByRole("button", { name: /^Modifica Bruschetta/ }).click();
  const editor = page.getByRole("region", { name: "Modifica riga" });
  await editor.getByRole("textbox", { name: "Nota di Bruschetta" }).fill("senza aglio");
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(draft).toContainText("senza aglio");

  await page.getByRole("button", { name: "Invia comanda (3)" }).click();
  await expect(draft).toHaveCount(0, { timeout: 15_000 });
  const sent = ticket.getByRole("group", { name: "Già inviato" });
  await expect(sent).toContainText("senza aglio");
  await expect(sent).toContainText(/inviato \d{2}:\d{2}/);
  // Nessuno stato "uscita" della cucina: non c'è un tablet in cucina.
  await expect(ticket).not.toContainText(/uscit/i);

  // Di nuovo ai tavoli: il riquadro mostra stato (scritto) e totale.
  await page.getByRole("button", { name: "Tavoli", exact: true }).click();
  const tile = page.getByRole("button", { name: new RegExp(`^Tavolo ${tableNumber} — Comanda inviata — totale €`) });
  await expect(tile).toBeVisible({ timeout: 10_000 });
});

test("dalla barra laterale si modificano quantità e prezzo di una riga: offerto, sconto, prezzo libero", async ({ page }) => {
  await openTill(page);
  const tableNumber = await openTableWithKeypad(page, { adults: 0 });
  const ticket = page.getByRole("region", { name: "Comanda del tavolo" });
  const total = page.getByTestId("till-order-total");
  await page.getByRole("tab", { name: "Primi" }).click();
  await page.getByRole("button", { name: /^Aggiungi Orecchiette/ }).click(); // 10,00
  await page.getByRole("tab", { name: "Antipasti" }).click();
  await page.getByRole("button", { name: /^Aggiungi Caprese/ }).click(); // 7,00
  await expect(total).toHaveText("€ 17,00");

  // Riga da inviare: quantità 3 e sconto 20% → 3 × 8,00.
  await ticket.getByRole("button", { name: /^Modifica Orecchiette/ }).click();
  let editor = page.getByRole("region", { name: "Modifica riga" });
  await editor.getByRole("button", { name: "Aumenta quantità" }).click();
  await editor.getByRole("button", { name: "Aumenta quantità" }).click();
  await editor.getByRole("button", { name: "Sconto 20%" }).click();
  await expect(page.getByTestId("till-line-total")).toHaveText("€ 24,00");
  // Niente cambia finché non si salva: "Comanda" torna indietro senza modifiche.
  await editor.getByRole("button", { name: "Comanda", exact: true }).click();
  await expect(total).toHaveText("€ 17,00");
  await ticket.getByRole("button", { name: /^Modifica Orecchiette/ }).click();
  editor = page.getByRole("region", { name: "Modifica riga" });
  await editor.getByRole("button", { name: "Aumenta quantità" }).click();
  await editor.getByRole("button", { name: "Aumenta quantità" }).click();
  await editor.getByRole("button", { name: "Sconto 20%" }).click();
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(ticket.getByRole("button", { name: "Modifica Orecchiette: 3 × € 8,00, Sconto 20%" })).toBeVisible();
  await expect(total).toHaveText("€ 31,00");

  await page.getByRole("button", { name: "Invia comanda (4)" }).click();
  const sent = ticket.getByRole("group", { name: "Già inviato" });
  await expect(sent).toBeVisible({ timeout: 15_000 });

  // Riga già inviata: la Caprese diventa offerta (salvata sulla comanda).
  await sent.getByRole("button", { name: /^Modifica Caprese/ }).click();
  editor = page.getByRole("region", { name: "Modifica riga" });
  await editor.getByRole("button", { name: "Offerto" }).click();
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(sent.getByRole("button", { name: "Modifica Caprese: 1 × € 0,00, Offerto" })).toBeVisible({ timeout: 10_000 });
  await expect(total).toHaveText("€ 24,00");

  // Prezzo libero dal tastierino (in centesimi, come le casse): 6,50.
  await sent.getByRole("button", { name: /^Modifica Caprese/ }).click();
  editor = page.getByRole("region", { name: "Modifica riga" });
  await editor.getByRole("button", { name: "Altro" }).click();
  for (const k of ["6", "5", "0"]) await editor.getByRole("button", { name: `Cifra ${k}` }).click();
  await expect(editor.getByRole("textbox", { name: "Nuovo prezzo" })).toHaveText("€ 6,50");
  await editor.getByRole("button", { name: "Usa € 6,50" }).click();
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(sent.getByRole("button", { name: "Modifica Caprese: 1 × € 6,50, Prezzo modificato" })).toBeVisible({ timeout: 10_000 });
  await expect(total).toHaveText("€ 30,50");

  // Il preconto stampato riporta lo sconto.
  await page.getByRole("button", { name: "Stampa preconto" }).click();
  await expect(page.getByRole("status", { name: "Stato stampa" })).toHaveText(/stampato alla cassa/i, { timeout: 15_000 });
  const receipt = (await printedTexts(page)).find((txt) => txt.includes(`Tavolo ${tableNumber}`));
  expect(receipt).toContain("Orecchiette (sconto 20%)");
  expect(receipt).toContain("Caprese (prezzo modificato)");
  expect(receipt).toContain("30,50");
});

test("alla cassa tutte le categorie stanno in una griglia sempre visibile, con i piatti e quelli da inviare; i piatti mostrano la foto", async ({ page }) => {
  await page.route(/placehold\.co/, (route) => route.fulfill({ status: 200, contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64") }));
  await openTill(page);
  await openTableWithKeypad(page);
  const grid = page.getByRole("tablist", { name: "Categorie del menù" });
  for (const name of ["Antipasti", "Primi", "Dolci", "Bevande"]) {
    const tab = grid.getByRole("tab", { name: new RegExp(`^${name}`) });
    await expect(tab).toBeInViewport({ ratio: 1 });
    await expect(tab).toContainText(/\d+ piatt[oi]/);
    expect((await tab.boundingBox()).height).toBeGreaterThanOrEqual(48);
  }
  // Nessuna categoria nascosta oltre il bordo: la griglia non scorre di lato.
  expect(await grid.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

  await grid.getByRole("tab", { name: /^Antipasti/ }).click();
  await page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).click();
  await expect(grid.getByRole("tab", { name: /^Antipasti/ })).toContainText("1 da inviare");
  await expect(page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).locator("img")).toHaveCount(0);

  await grid.getByRole("tab", { name: /^Dolci/ }).click();
  await expect(grid.getByRole("tab", { name: /^Dolci/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: /^Aggiungi Tiramisù/ }).locator("img")).toBeVisible();
});

test("una riga già inviata si può rimuovere dall'editor, con conferma", async ({ page }) => {
  await openTill(page);
  await openTableWithKeypad(page, { adults: 0 });
  const ticket = page.getByRole("region", { name: "Comanda del tavolo" });
  await page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).click();
  await page.getByRole("button", { name: "Invia comanda (1)" }).click();
  const sent = ticket.getByRole("group", { name: "Già inviato" });
  await sent.getByRole("button", { name: /^Modifica Bruschetta/ }).click();
  await page.getByRole("region", { name: "Modifica riga" }).getByRole("button", { name: "Rimuovi dalla comanda" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Rimuovere Bruschetta?" });
  await confirm.getByRole("button", { name: "Rimuovi" }).click();
  await expect(sent).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId("till-order-total")).toHaveText("€ 0,00");
});

test("alla cassa non c'è la ricerca dei piatti: si sceglie dalle categorie", async ({ page }) => {
  await openTill(page);
  await openTableWithKeypad(page, { adults: 0 });
  await expect(page.getByRole("tablist", { name: "Categorie del menù" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Cerca un piatto" })).toHaveCount(0);
  // Nemmeno le etichette di ricerca dei piatti (searchTags "Bibita" nel menù demo).
  await expect(page.getByRole("button", { name: "Bibita", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: /^Dolci/ }).click();
  await expect(page.getByRole("button", { name: /^Aggiungi Tiramisù/ })).toBeVisible();
});

// Regressione: con un menù lungo come quello vero (molte categorie, molte
// etichette) su uno schermo da cassa piccolo, la parte fissa sopra i piatti
// riempiva lo schermo e i piatti non si potevano più scorrere né raggiungere.
test("con un menù lungo su uno schermo piccolo i piatti si raggiungono scorrendo", async ({ page }) => {
  const stamp = Date.now();
  const categories = Array.from({ length: 12 }, (_, c) => ({
    id: `prova-cat-${stamp}-${c + 1}`, name: `${TEST_CATEGORY_PREFIX}${c + 1}`, subtitle: "", visible: true,
    items: Array.from({ length: 10 }, (_, i) => ({
      id: `prova-item-${stamp}-${c + 1}-${i + 1}`, name: `${TEST_DISH_PREFIX}${c + 1}.${i + 1}`, price: "5,00", tag: "", description: "",
      searchTags: `Etichetta ${c + 1}, Etichetta ${i + 1}`, visible: true, staffOnly: false,
    })),
  }));
  await addMenuCategoriesRemotely(categories);
  await page.setViewportSize({ width: 1024, height: 738 });
  await openTill(page);
  await openTableWithKeypad(page, { adults: 0 });

  await page.getByRole("tab", { name: new RegExp(`^${TEST_CATEGORY_PREFIX}12`) }).click();
  const lastDish = page.getByRole("button", { name: new RegExp(`^Aggiungi ${TEST_DISH_PREFIX}12\\.10,`) });
  await expect(lastDish).toBeAttached({ timeout: 10_000 });
  // Come farebbe una persona: scorrere con la rotellina sopra il menù, finché
  // l'ultimo piatto è tutto sullo schermo (prima della correzione non si
  // muoveva nulla e restava tagliato fuori).
  const menu = page.getByRole("region", { name: "Menu" });
  const box = await menu.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(async () => {
    await page.mouse.wheel(0, 400);
    await expect(lastDish).toBeInViewport({ ratio: 1, timeout: 500 });
  }).toPass({ timeout: 10_000 });
  // Il menù resta dentro lo schermo: niente tagliato sotto il bordo.
  const menuBox = await menu.boundingBox();
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(738 + 1);

  await lastDish.click();
  const draft = page.getByRole("region", { name: "Comanda del tavolo" }).getByRole("group", { name: "Da inviare" });
  await expect(draft.getByRole("button", { name: new RegExp(`^Modifica ${TEST_DISH_PREFIX}12\\.10`) })).toBeVisible();
});

test("un tavolo già aperto viene segnalato nel tastierino, con il collegamento al tavolo", async ({ page }) => {
  await openTill(page);
  const tableNumber = await openTableWithKeypad(page, { adults: 0 });
  await page.getByRole("button", { name: "Tavoli", exact: true }).click();
  await page.getByRole("button", { name: "Nuovo tavolo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuovo tavolo" });
  for (const digit of String(tableNumber)) await dialog.getByRole("button", { name: `Cifra ${digit}` }).click();
  await expect(dialog.getByRole("alert")).toContainText(`Il tavolo ${tableNumber} è già aperto.`);
  await dialog.getByRole("button", { name: `Vai al tavolo ${tableNumber}` }).click();
  await expect(page.getByRole("region", { name: "Comanda del tavolo" })).toContainText(`Comanda — Tavolo ${tableNumber}`);
});

test("chiudere un tavolo chiede conferma e lo sposta nello Storico, da cui si ristampa il preconto", async ({ page }) => {
  await openTill(page);
  const tableNumber = await openTableWithKeypad(page, { adults: 0 });
  await page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).click();
  await page.getByRole("button", { name: "Invia comanda (1)" }).click();
  await expect(page.getByRole("group", { name: "Già inviato" })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Chiudi tavolo" }).click();
  const confirm = page.getByRole("alertdialog", { name: `Chiudere Tavolo ${tableNumber}?` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Annulla" }).click();
  await expect(page.getByRole("region", { name: "Comanda del tavolo" })).toBeVisible();

  await page.getByRole("button", { name: "Chiudi tavolo" }).click();
  await confirm.getByRole("button", { name: "Chiudi tavolo" }).click();
  await expect(page.getByRole("button", { name: "Nuovo tavolo" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: new RegExp(`^Tavolo ${tableNumber} —`) })).toHaveCount(0);

  // Storico della cassa: elenco a sinistra, dettaglio e ristampa a destra.
  await page.getByRole("navigation", { name: "Sezioni della sala" }).getByRole("button", { name: /^storico$/i }).click();
  const list = page.getByRole("region", { name: "Comande chiuse" });
  await list.getByRole("button", { name: new RegExp(`^Tavolo ${tableNumber}`) }).click();
  const detail = page.getByRole("region", { name: "Dettaglio comanda" });
  await expect(detail).toContainText("Bruschetta");
  await detail.getByRole("button", { name: "Ristampa preconto" }).click();
  await expect(detail.getByRole("status", { name: "Stato stampa" })).toHaveText(/stampato alla cassa/i, { timeout: 15_000 });
});

test("il preconto si stampa direttamente dalla barra laterale e il tavolo lo segnala", async ({ page }) => {
  await openTill(page);
  const tableNumber = await openTableWithKeypad(page, { adults: 0 });
  await page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).click();

  // Piatti non ancora inviati: avviso prima di stampare.
  await page.getByRole("button", { name: "Stampa preconto" }).click();
  const warn = page.getByRole("alertdialog", { name: "Ci sono piatti non inviati" });
  await warn.getByRole("button", { name: "Annulla" }).click();
  await page.getByRole("button", { name: "Invia comanda (1)" }).click();
  // "Da inviare" si svuota alla conferma del server (l'avviso resterebbe giusto fino ad allora).
  await expect(page.getByRole("group", { name: "Da inviare" })).toHaveCount(0, { timeout: 15_000 });

  await page.getByRole("button", { name: "Stampa preconto" }).click();
  await expect(page.getByRole("status", { name: "Stato stampa" })).toHaveText(/stampato alla cassa/i, { timeout: 15_000 });
  await expect(page.getByText("Documento non fiscale")).toHaveCount(0); // niente finestrella da telefono
  await page.getByRole("button", { name: "Tavoli", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^Tavolo ${tableNumber} — Preconto stampato`) })).toBeVisible({ timeout: 10_000 });
});

test("prenotazioni della cassa: si crea con orari a tocco, è subito valida e si avvia aprendo il tavolo", async ({ page }) => {
  await openTill(page);
  const name = `Prova Cassa ${Date.now()}`;
  usedReservations.push(name);
  await page.getByRole("navigation", { name: "Sezioni della sala" }).getByRole("button", { name: /^prenotazioni$/i }).click();
  await expect(page.getByRole("region", { name: "Calendario" })).toBeVisible();

  await page.getByRole("region", { name: "Prenotazioni del giorno" }).getByRole("button", { name: "Nuova" }).click();
  const form = page.getByRole("region", { name: "Nuova prenotazione" });
  await form.getByRole("button", { name: "20:30" }).click();
  await form.getByRole("textbox", { name: "Nome *" }).fill(name);
  await form.getByRole("button", { name: "Aumenta adulti" }).click(); // 3 adulti
  const tableNumber = freshTableNumber();
  usedTables.push(tableNumber);
  // Il tavolo si sceglie poi all'avvio (tastierino): qui resta "da assegnare".
  // Un solo "Salva": la prenotazione nasce già confermata.
  await expect(form.getByRole("button", { name: /^salva/i })).toHaveCount(1);
  await form.getByRole("button", { name: "Salva prenotazione" }).click();

  const day = page.getByRole("region", { name: "Prenotazioni del giorno" });
  await expect(day.getByRole("button", { name: new RegExp(`^${name}, ore 20:30, 3 adulti, Prenotata`) })).toBeVisible({ timeout: 10_000 });
  const detail = page.getByRole("region", { name: "Dettaglio prenotazione" });
  await expect(detail.getByRole("button", { name: "Conferma" })).toHaveCount(0);
  await expect(page.getByText(/da confermare/i)).toHaveCount(0);

  // Avvio: chiede il numero del tavolo con il tastierino e apre la comanda.
  await detail.getByRole("button", { name: "Avvia (apri il tavolo)" }).click();
  const dialog = page.getByRole("dialog", { name: `Avvia ${name}` });
  for (const digit of String(tableNumber)) await dialog.getByRole("button", { name: `Cifra ${digit}` }).click();
  await dialog.getByRole("button", { name: "Apri comanda" }).click();
  // Il tavolo prende il nome della prenotazione, in secondo piano: prima il numero.
  await expect(page.getByRole("region", { name: "Comanda del tavolo" })).toContainText(`Comanda — Tavolo ${tableNumber}`, { timeout: 10_000 });
  await expect(page.getByRole("region", { name: "Menu" })).toContainText(`Tavolo ${tableNumber} · ${name}`);
});

test("Tavoli della cassa: toccando una prenotazione di oggi si apre la sua scheda in Prenotazioni, da cui si avvia; 'Avvia' resta il tasto rapido", async ({ page }) => {
  await openTill(page);
  const name = `Dai Tavoli ${Date.now()}`;
  const quick = `Rapida ${Date.now()}`;
  usedReservations.push(name, quick);
  const sections = page.getByRole("navigation", { name: "Sezioni della sala" });
  await sections.getByRole("button", { name: /^prenotazioni$/i }).click();
  for (const [who, time] of [[name, "21:30"], [quick, "21:45"]]) {
    await page.getByRole("region", { name: "Prenotazioni del giorno" }).getByRole("button", { name: "Nuova" }).click();
    const form = page.getByRole("region", { name: "Nuova prenotazione" });
    await form.getByRole("button", { name: time }).click();
    await form.getByRole("textbox", { name: "Nome *" }).fill(who);
    await form.getByRole("button", { name: "Salva prenotazione" }).click();
    await expect(page.getByRole("region", { name: "Dettaglio prenotazione" })).toContainText(who, { timeout: 10_000 });
  }

  // Dai Tavoli, la scheda della prenotazione apre il dettaglio in Prenotazioni.
  await sections.getByRole("button", { name: /^Tavoli( \d+)?$/ }).click();
  const todays = page.getByRole("complementary", { name: "Prenotazioni di oggi" });
  await todays.getByRole("button", { name: new RegExp(`^${name}, ore 21:30, 2 adulti — apri la prenotazione`) }).click();
  const detail = page.getByRole("region", { name: "Dettaglio prenotazione" });
  await expect(detail).toContainText(name);
  await expect(detail).toContainText("ore 21:30");
  await expect(page.getByRole("region", { name: "Calendario" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Prenotazioni del giorno" }).getByRole("button", { name: new RegExp(`^${name}, `) })).toHaveAttribute("aria-pressed", "true");

  // Avvio dal dettaglio: tastierino e comanda aperta.
  const tableNumber = freshTableNumber();
  usedTables.push(tableNumber);
  await detail.getByRole("button", { name: "Avvia (apri il tavolo)" }).click();
  let dialog = page.getByRole("dialog", { name: `Avvia ${name}` });
  for (const digit of String(tableNumber)) await dialog.getByRole("button", { name: `Cifra ${digit}` }).click();
  await dialog.getByRole("button", { name: "Apri comanda" }).click();
  await expect(page.getByRole("region", { name: "Comanda del tavolo" })).toContainText(`Comanda — Tavolo ${tableNumber}`, { timeout: 10_000 });

  // Il tasto rapido "Avvia" sulla scheda nei Tavoli funziona ancora, senza passare dal dettaglio.
  await sections.getByRole("button", { name: /^Tavoli( \d+)?$/ }).click();
  await expect(todays.getByRole("button", { name: new RegExp(`^${name}, `) })).toHaveCount(0, { timeout: 10_000 });
  const quickTable = freshTableNumber();
  usedTables.push(quickTable);
  await todays.getByRole("button", { name: `Avvia prenotazione di ${quick}` }).click();
  dialog = page.getByRole("dialog", { name: `Avvia ${quick}` });
  for (const digit of String(quickTable)) await dialog.getByRole("button", { name: `Cifra ${digit}` }).click();
  await dialog.getByRole("button", { name: "Apri comanda" }).click();
  await expect(page.getByRole("region", { name: "Comanda del tavolo" })).toContainText(`Comanda — Tavolo ${quickTable}`, { timeout: 10_000 });
});

// Alla cassa, come `account`: crea una prenotazione di oggi e la avvia sul
// tavolo `tableNumber`; ritorna in Prenotazioni.
async function bookAndStartAtTill(page, name, tableNumber) {
  const sections = page.getByRole("navigation", { name: "Sezioni della sala" });
  await sections.getByRole("button", { name: /^prenotazioni$/i }).click();
  await page.getByRole("region", { name: "Prenotazioni del giorno" }).getByRole("button", { name: "Nuova" }).click();
  const form = page.getByRole("region", { name: "Nuova prenotazione" });
  await form.getByRole("button", { name: "20:45" }).click();
  await form.getByRole("textbox", { name: "Nome *" }).fill(name);
  await form.getByRole("button", { name: "Salva prenotazione" }).click();
  const detail = page.getByRole("region", { name: "Dettaglio prenotazione" });
  await expect(detail).toContainText(name, { timeout: 10_000 });
  await detail.getByRole("button", { name: "Avvia (apri il tavolo)" }).click();
  const dialog = page.getByRole("dialog", { name: `Avvia ${name}` });
  for (const digit of String(tableNumber)) await dialog.getByRole("button", { name: `Cifra ${digit}` }).click();
  await dialog.getByRole("button", { name: "Apri comanda" }).click();
  await expect(page.getByRole("region", { name: "Comanda del tavolo" })).toContainText(`Comanda — Tavolo ${tableNumber}`, { timeout: 10_000 });
  await sections.getByRole("button", { name: /^prenotazioni$/i }).click();
}

test("prenotazioni della cassa: un'avviata lascia l'elenco del giorno e il cameriere non la può eliminare", async ({ page }) => {
  await openTill(page);
  const name = `Avviata Cassa ${Date.now()}`;
  usedReservations.push(name);
  const tableNumber = freshTableNumber();
  usedTables.push(tableNumber);
  await bookAndStartAtTill(page, name, tableNumber);

  const day = page.getByRole("region", { name: "Prenotazioni del giorno" });
  const row = day.getByRole("button", { name: new RegExp(`^${name}, .*Al tavolo`) });
  await expect(row).toHaveCount(0);
  await day.getByRole("button", { name: /mostra avviate, annullate e non presentate/i }).click();
  await row.click();
  const detail = page.getByRole("region", { name: "Dettaglio prenotazione" });
  await expect(detail).toContainText("Al tavolo");
  await expect(detail.getByRole("button", { name: "Vai al tavolo" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Elimina prenotazione" })).toHaveCount(0);
  // Nemmeno con lo swipe.
  await swipeLeft(page, row, 0.9);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Elimina la prenotazione di ${name}` })).toHaveCount(0);
  await expect.poll(() => findReservationByName(name)).not.toBeNull();
});

test("prenotazioni della cassa: l'admin elimina un'avviata dalla scheda, con conferma, e il tavolo resta aperto", async ({ page }) => {
  await openTill(page, { savedLogin: TEST_ADMIN });
  const name = `Elimina Cassa ${Date.now()}`;
  usedReservations.push(name);
  const tableNumber = freshTableNumber();
  usedTables.push(tableNumber);
  await bookAndStartAtTill(page, name, tableNumber);

  const day = page.getByRole("region", { name: "Prenotazioni del giorno" });
  await day.getByRole("button", { name: /mostra avviate, annullate e non presentate/i }).click();
  const row = day.getByRole("button", { name: new RegExp(`^${name}, `) });
  await row.click();
  const detail = page.getByRole("region", { name: "Dettaglio prenotazione" });
  await detail.getByRole("button", { name: "Elimina prenotazione" }).click();
  const confirm = page.getByRole("alertdialog", { name: `Eliminare la prenotazione di ${name}?` });
  await expect(confirm).toContainText("Il tavolo già aperto resta");
  await confirm.getByRole("button", { name: "Elimina" }).click();
  await expect(row).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => findReservationByName(name)).toBeNull();

  // Il tavolo resta, col numero in primo piano e il nome in secondo.
  await page.getByRole("navigation", { name: "Sezioni della sala" }).getByRole("button", { name: /^Tavoli( \d+)?$/ }).click();
  await expect(page.getByRole("button", { name: `Tavolo ${tableNumber} (${name})`, exact: false })).toBeVisible();
});

test("prenotazioni della cassa: l'admin elimina con uno swipe verso sinistra (anche col mouse), dopo conferma", async ({ page }) => {
  await openTill(page, { savedLogin: TEST_ADMIN });
  const name = `Swipe Cassa ${Date.now()}`;
  usedReservations.push(name);
  await page.getByRole("navigation", { name: "Sezioni della sala" }).getByRole("button", { name: /^prenotazioni$/i }).click();
  const day = page.getByRole("region", { name: "Prenotazioni del giorno" });
  await day.getByRole("button", { name: "Nuova" }).click();
  const form = page.getByRole("region", { name: "Nuova prenotazione" });
  await form.getByRole("button", { name: "22:00" }).click();
  await form.getByRole("textbox", { name: "Nome *" }).fill(name);
  await form.getByRole("button", { name: "Salva prenotazione" }).click();
  const row = day.getByRole("button", { name: new RegExp(`^${name}, `) });
  await expect(row).toBeVisible({ timeout: 10_000 });

  await swipeLeft(page, row, 0.9);
  await page.getByRole("alertdialog", { name: `Eliminare la prenotazione di ${name}?` }).getByRole("button", { name: "Elimina" }).click();
  await expect(row).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => findReservationByName(name)).toBeNull();
});

test("il calendario della cassa riassume prenotazioni e coperti del giorno", async ({ page }) => {
  await openTill(page);
  const name = `Calendario Cassa ${Date.now()}`;
  usedReservations.push(name);
  await page.getByRole("navigation", { name: "Sezioni della sala" }).getByRole("button", { name: /^prenotazioni$/i }).click();
  await page.getByRole("region", { name: "Prenotazioni del giorno" }).getByRole("button", { name: "Nuova" }).click();
  const form = page.getByRole("region", { name: "Nuova prenotazione" });
  await form.getByRole("button", { name: "Giorno successivo" }).click();
  await form.getByRole("button", { name: "13:00" }).click();
  await form.getByRole("textbox", { name: "Nome *" }).fill(name);
  await form.getByRole("button", { name: "Salva prenotazione" }).click();
  // Si sposta sul giorno della prenotazione.
  await expect(page.getByRole("region", { name: "Prenotazioni del giorno" }).getByRole("button", { name: new RegExp(`^${name}, ore 13:00, 2 adulti, Prenotata`) })).toBeVisible({ timeout: 10_000 });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const cellLabel = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" }).format(tomorrow);
  await expect(page.getByRole("region", { name: "Calendario" }).getByRole("button", { name: new RegExp(`^${cellLabel}, \\d+ prenotazioni, \\d+ coperti`) })).toBeVisible();
});

test("'Invia comanda' stampa per la cucina solo i piatti 'In comanda', in grande e senza prezzi", async ({ page }) => {
  await openTill(page);
  const tableNumber = await openTableWithKeypad(page, { adults: 2 });
  const ticket = page.getByRole("region", { name: "Comanda del tavolo" });
  const kitchenStatus = page.getByRole("status", { name: "Stampa comanda cucina" });
  const kitchenTickets = async () => (await printedTexts(page)).filter((txt) => txt.includes(`TAVOLO ${tableNumber}\n`));

  // Bruschetta (in comanda) + Acqua (bevanda, non in comanda nel menù demo).
  await page.getByRole("tab", { name: "Antipasti" }).click();
  await page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).click();
  await page.getByRole("tab", { name: "Bevande" }).click();
  await page.getByRole("button", { name: /^Aggiungi Acqua naturale/ }).click();
  await page.getByRole("button", { name: "Invia comanda (2)" }).click();
  await expect(kitchenStatus).toHaveText(/comanda cucina: stampato alla cassa/i, { timeout: 15_000 });
  let tickets = await kitchenTickets();
  expect(tickets).toHaveLength(1);
  expect(tickets[0]).toContain("Bruschetta");
  expect(tickets[0]).toContain("2 coperti");
  expect(tickets[0]).not.toContain("Acqua");
  expect(tickets[0]).not.toContain("Preconto");
  expect(tickets[0]).not.toContain("AGGIUNTA");

  // Solo bevande: nessuna comanda stampata (e nessuno stato di stampa).
  await page.getByRole("button", { name: /^Aggiungi Vino della casa/ }).click();
  await page.getByRole("button", { name: "Invia comanda (1)" }).click();
  await expect(ticket.getByRole("group", { name: "Già inviato" })).toContainText("Vino della casa", { timeout: 15_000 });
  await expect(kitchenStatus).toHaveCount(0);

  // Un altro piatto per la cucina: la comanda dice che è un'aggiunta.
  await page.getByRole("tab", { name: "Primi" }).click();
  await page.getByRole("button", { name: /^Aggiungi Orecchiette/ }).click();
  await page.getByRole("button", { name: "Invia comanda (1)" }).click();
  await expect(kitchenStatus).toHaveText(/stampato alla cassa/i, { timeout: 15_000 });
  tickets = await kitchenTickets();
  expect(tickets).toHaveLength(2);
  expect(tickets[1]).toContain("AGGIUNTA");
  expect(tickets[1]).toContain("Orecchiette");
  expect(tickets[1]).not.toContain("Bruschetta");
});

test("una comanda cucina non stampata resta segnalata sul tavolo e si ristampa riaprendolo, anche dopo altri invii", async ({ page }) => {
  // Stampante senza carta: la comanda va in errore.
  await openTill(page, { failWith: "Carta esaurita" });
  const tableNumber = await openTableWithKeypad(page, { adults: 2 });
  await page.getByRole("tab", { name: "Primi" }).click();
  await page.getByRole("button", { name: /^Aggiungi Orecchiette/ }).click();
  await page.getByRole("button", { name: "Invia comanda (1)" }).click();
  const problems = page.getByRole("group", { name: "Comande cucina non stampate" });
  await expect(problems).toContainText(/carta esaurita/i, { timeout: 15_000 });

  // Si torna ai tavoli: il tavolo dice che la comanda non è arrivata in cucina.
  await page.getByRole("button", { name: "Tavoli", exact: true }).click();
  const tile = page.getByRole("button", { name: new RegExp(`Tavolo ${tableNumber}\\b.*Comanda cucina non stampata`) });
  await expect(tile).toBeVisible({ timeout: 10_000 });

  // Riaprendo il tavolo la comanda fallita c'è ancora, anche dopo un nuovo invio.
  await tile.click();
  await expect(problems).toContainText(/1 piatto/);
  await page.getByRole("tab", { name: "Antipasti" }).click();
  await page.getByRole("button", { name: /^Aggiungi Bruschetta/ }).click();
  await page.getByRole("button", { name: "Invia comanda (1)" }).click();
  await expect(problems.getByRole("button", { name: "Ristampa comanda cucina" })).toHaveCount(2, { timeout: 15_000 });

  // Carta rimessa: si ristampano entrambe, in cucina arrivano tutti i piatti.
  await page.evaluate(() => { globalThis.__printFail = null; });
  await problems.getByRole("button", { name: "Ristampa comanda cucina" }).first().click();
  await expect(problems.getByRole("button", { name: "Ristampa comanda cucina" })).toHaveCount(1, { timeout: 15_000 });
  await problems.getByRole("button", { name: "Ristampa comanda cucina" }).click();
  await expect(problems).toHaveCount(0, { timeout: 15_000 });
  // La segnalazione sparisce appena la comanda torna in coda: si aspetta la carta.
  const printedForTable = async () => (await printedTexts(page)).filter((txt) => txt.includes(`TAVOLO ${tableNumber}\n`)).join("\n");
  await expect.poll(printedForTable, { timeout: 15_000 }).toContain("Orecchiette");
  await expect.poll(printedForTable, { timeout: 15_000 }).toContain("Bruschetta");
  await page.getByRole("button", { name: "Tavoli", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(`Tavolo ${tableNumber}\\b.*Comanda inviata`) })).toBeVisible();
});

test("'Ignora' toglie la segnalazione di una comanda cucina non stampata, dopo conferma", async ({ page }) => {
  await openTill(page, { failWith: "Stampante non raggiungibile" });
  await openTableWithKeypad(page, { adults: 1 });
  await page.getByRole("tab", { name: "Primi" }).click();
  await page.getByRole("button", { name: /^Aggiungi Orecchiette/ }).click();
  await page.getByRole("button", { name: "Invia comanda (1)" }).click();
  const problems = page.getByRole("group", { name: "Comande cucina non stampate" });
  await problems.getByRole("button", { name: "Ignora" }).click({ timeout: 15_000 });
  const confirm = page.getByRole("alertdialog", { name: "Ignorare questa comanda?" });
  await confirm.getByRole("button", { name: "Annulla" }).click();
  await expect(problems).toBeVisible();
  await problems.getByRole("button", { name: "Ignora" }).click();
  await confirm.getByRole("button", { name: "Ignora comanda" }).click();
  await expect(problems).toHaveCount(0, { timeout: 10_000 });
});

async function openTillAsAdmin(page) {
  await installDesktopBridgeMock(page, { savedLogin: TEST_ADMIN });
  await page.goto("/?area=staff");
  // Alla cassa niente Dashboard da telefono: si entra subito nella Sala.
  const nav = page.getByRole("navigation", { name: "Sezioni della sala" });
  await expect(nav).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/^Ciao,/)).toHaveCount(0);
  return nav;
}

test("alla cassa l'admin gestisce il menù: piatto nuovo con prezzo dal tastierino, 'In comanda' ereditato, modifica ed eliminazione", async ({ page }) => {
  const nav = await openTillAsAdmin(page);
  await nav.getByRole("button", { name: /^menù$/i }).click();
  await page.getByRole("tab", { name: "Bevande" }).click();
  await expect(page.getByRole("button", { name: "Modifica Acqua naturale" })).toContainText("Non in comanda");

  const name = `${TEST_DISH_PREFIX}${Date.now()}`;
  await page.getByRole("button", { name: "Nuovo piatto in Bevande" }).click();
  const editor = page.getByRole("region", { name: "Nuovo piatto" });
  await editor.getByRole("textbox", { name: "Nome del piatto" }).fill(name);
  await editor.getByRole("button", { name: "Cambia prezzo" }).click();
  for (const k of ["3", "5", "0"]) await editor.getByRole("button", { name: `Cifra ${k}` }).click();
  await editor.getByRole("button", { name: "Usa € 3,50" }).click();
  await expect(editor.getByTestId("till-dish-price")).toHaveText("€ 3,50");
  // Come le altre bevande: non va in comanda. Il valore segue la categoria
  // scelta nell'editor finché non si tocca l'interruttore.
  const kitchenSwitch = editor.getByRole("switch", { name: "In comanda" });
  await expect(kitchenSwitch).toHaveAttribute("aria-checked", "false");
  const categories = editor.getByRole("group", { name: "Categoria del piatto" });
  await categories.getByRole("button", { name: "Antipasti" }).click();
  await expect(kitchenSwitch).toHaveAttribute("aria-checked", "true");
  await categories.getByRole("button", { name: "Bevande" }).click();
  await expect(kitchenSwitch).toHaveAttribute("aria-checked", "false");
  // Il costo interno si scrive col tastierino; con un tastierino aperto non si salva.
  await editor.getByRole("button", { name: "Cambia costo" }).click();
  await expect(editor.getByRole("button", { name: "Aggiungi piatto" })).toBeDisabled();
  for (const k of ["1", "2", "0"]) await editor.getByRole("button", { name: `Cifra ${k}` }).click();
  await editor.getByRole("button", { name: "Usa € 1,20" }).click();
  await expect(editor.getByTestId("till-dish-cost")).toHaveText("€ 1,20");
  await editor.getByRole("button", { name: "Aggiungi piatto" }).click();

  const tile = page.getByRole("button", { name: `Modifica ${name}` });
  await expect(tile).toContainText("€ 3,50", { timeout: 10_000 });
  await expect(tile).toContainText("Non in comanda");
  await expect.poll(async () => findMenuItemByName(await getMenu(), name)?.item.price, { timeout: 10_000 }).toBe("3,50");

  // Modifica: non disponibile e in comanda, salvato solo con "Salva".
  const edit = page.getByRole("region", { name: "Modifica piatto" });
  await expect(edit.getByTestId("till-dish-cost")).toHaveText("€ 1,20", { timeout: 10_000 });
  // Il tastierino parte dal prezzo attuale, ma la prima cifra ne inizia uno nuovo.
  await edit.getByRole("button", { name: "Cambia prezzo" }).click();
  await expect(edit.getByRole("textbox", { name: "Nuovo prezzo" })).toHaveText("€ 3,50");
  for (const k of ["4", "0", "0"]) await edit.getByRole("button", { name: `Cifra ${k}` }).click();
  await edit.getByRole("button", { name: "Usa € 4,00" }).click();
  await expect(edit.getByTestId("till-dish-price")).toHaveText("€ 4,00");
  await edit.getByRole("switch", { name: "Disponibile" }).click();
  await edit.getByRole("switch", { name: "In comanda" }).click();
  await expect(tile).toContainText("Non in comanda");
  await edit.getByRole("button", { name: "Salva" }).click();
  await expect(edit.getByRole("status")).toHaveText("Salvato.", { timeout: 10_000 });
  await expect(tile).toContainText("Nascosto");
  await expect(tile).not.toContainText("Non in comanda");
  const saved = findMenuItemByName(await getMenu(), name);
  expect(saved.categoryId).toBe("cat-bevande");
  expect(saved.item.visible).toBe(false);
  expect(saved.item.kitchenTicket).toBe(true);
  expect(saved.item.price).toBe("4,00");

  // Eliminazione con conferma.
  await edit.getByRole("button", { name: "Elimina piatto" }).click();
  await page.getByRole("alertdialog", { name: `Eliminare ${name}?` }).getByRole("button", { name: "Elimina piatto" }).click();
  await expect(tile).toHaveCount(0, { timeout: 10_000 });
  expect(findMenuItemByName(await getMenu(), name)).toBeNull();
});

test("il menù della cassa segue le modifiche fatte da un altro dispositivo e salvare non le cancella", async ({ page }) => {
  const nav = await openTillAsAdmin(page);
  await nav.getByRole("button", { name: /^menù$/i }).click();
  await page.getByRole("tab", { name: "Antipasti" }).click();

  // Un piatto aggiunto da un altro dispositivo compare da solo, senza ricaricare.
  const remoteName = `${TEST_DISH_PREFIX}remoto ${Date.now()}`;
  await addMenuItemRemotely("cat-antipasti", { id: `remote-${Date.now()}`, name: remoteName, price: "4,00", visible: true, staffOnly: false });
  await expect(page.getByRole("button", { name: `Modifica ${remoteName}` })).toBeVisible({ timeout: 10_000 });

  // Un piatto nuovo dalla cassa: salvato sul menù com'è ora, quello remoto resta.
  const localName = `${TEST_DISH_PREFIX}locale ${Date.now()}`;
  await page.getByRole("button", { name: "Nuovo piatto in Antipasti" }).click();
  const editor = page.getByRole("region", { name: "Nuovo piatto" });
  await expect(editor.getByRole("switch", { name: "In comanda" })).toHaveAttribute("aria-checked", "true");
  await editor.getByRole("textbox", { name: "Nome del piatto" }).fill(localName);
  await editor.getByRole("button", { name: "Aggiungi piatto" }).click();
  await expect(page.getByRole("button", { name: `Modifica ${localName}` })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => Boolean(findMenuItemByName(await getMenu(), localName)), { timeout: 10_000 }).toBe(true);
  expect(findMenuItemByName(await getMenu(), remoteName)).not.toBeNull();

  // Pannello aperto sul piatto remoto; intanto un telefono ne cambia la
  // descrizione e lo nasconde. Salvare il prezzo dalla cassa non le annulla.
  await page.getByRole("button", { name: `Modifica ${remoteName}` }).click();
  const edit = page.getByRole("region", { name: "Modifica piatto" });
  const remoteId = findMenuItemByName(await getMenu(), remoteName).item.id;
  await updateMenuItemRemotely(remoteId, { description: "Cambiata dal telefono", visible: false });
  await expect(page.getByRole("button", { name: `Modifica ${remoteName}` })).toContainText("Nascosto", { timeout: 10_000 });
  await edit.getByRole("button", { name: "Cambia prezzo" }).click();
  for (const k of ["5", "0", "0"]) await edit.getByRole("button", { name: `Cifra ${k}` }).click();
  await edit.getByRole("button", { name: "Usa € 5,00" }).click();
  await edit.getByRole("button", { name: "Salva" }).click();
  await expect(edit.getByRole("status")).toHaveText("Salvato.", { timeout: 10_000 });
  const after = findMenuItemByName(await getMenu(), remoteName).item;
  expect(after.price).toBe("5,00");
  expect(after.description).toBe("Cambiata dal telefono");
  expect(after.visible).toBe(false);
});

test("alla cassa le impostazioni del menù stanno nella barra laterale e valgono solo con 'Salva'", async ({ page }) => {
  const nav = await openTillAsAdmin(page);
  await nav.getByRole("button", { name: /^menù$/i }).click();
  // Non c'è più "Gestione completa": tutto è nelle Impostazioni.
  await expect(page.getByRole("button", { name: "Gestione completa" })).toHaveCount(0);
  await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
  const hub = page.getByRole("region", { name: "Impostazioni del menù" });
  await hub.getByRole("button", { name: /^Coperto e ricerca/ }).click();
  const panel = page.getByRole("region", { name: "Coperto e ricerca" });
  const original = (await getMenu()).coperto.children;
  try {
    await panel.getByRole("button", { name: "Cambia coperto bambini" }).click();
    for (const k of ["1", "5", "0"]) await panel.getByRole("button", { name: `Cifra ${k}` }).click();
    await panel.getByRole("button", { name: "Usa € 1,50" }).click();
    expect((await getMenu()).coperto.children).toBe(original); // non ancora salvato
    await panel.getByRole("button", { name: "Salva" }).click();
    await expect(panel.getByRole("status")).toHaveText("Salvato.", { timeout: 10_000 });
    await expect.poll(async () => (await getMenu()).coperto.children).toBe("1,50");
  } finally {
    await panel.getByRole("button", { name: "Cambia coperto bambini" }).click();
    for (const k of original.replace(",", "").replace(/^0+/, "")) await panel.getByRole("button", { name: `Cifra ${k}` }).click();
    await panel.getByRole("button", { name: `Usa € ${original}` }).click();
    await panel.getByRole("button", { name: "Salva" }).click();
    await expect(panel.getByRole("status")).toHaveText("Salvato.", { timeout: 10_000 });
  }
  await panel.getByRole("button", { name: "Impostazioni", exact: true }).click();
  await expect(hub.getByRole("button", { name: /^Personale/ })).toBeVisible();
});

test("alla cassa l'admin crea l'account di una persona nuova dal Personale, senza uscire", async ({ page }) => {
  const username = `cassa-${Date.now()}`;
  const email = usernameEmail(username);
  try {
    const nav = await openTillAsAdmin(page);
    await nav.getByRole("button", { name: /^menù$/i }).click();
    await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
    await page.getByRole("region", { name: "Impostazioni del menù" }).getByRole("button", { name: /^Personale/ }).click();
    const panel = page.getByRole("region", { name: "Personale" });
    await panel.getByRole("textbox", { name: "Nome della persona" }).fill("Responsabile di sala");
    await panel.getByRole("textbox", { name: "Nome utente della persona" }).fill(username);
    await panel.getByLabel("Password della persona").fill("Prova123!");
    // Un amministratore aggiunge solo camerieri: nessuna scelta del ruolo.
    await expect(panel.getByRole("group", { name: "Ruolo" })).toHaveCount(0);
    await panel.getByRole("button", { name: "Crea account" }).click();
    await expect(panel.getByRole("list", { name: "Persone con accesso" }).getByRole("listitem").filter({ hasText: "Responsabile di sala · Cameriere" })).toContainText(username, { timeout: 10_000 });
    // L'elenco si aggiorna già con la scrittura locale: sul server si aspetta che arrivi.
    await expect.poll(() => findStaffByEmail(email)).toMatchObject({ role: "waiter", username });
    // La cassa resta collegata come prima.
    await expect(nav).toBeVisible();
  } finally {
    await removeStaffByEmailRemotely(email);
  }
});

test("alla cassa il Menù mostra le categorie in griglia e i piatti con la loro foto", async ({ page }) => {
  await page.route(/placehold\.co/, (route) => route.fulfill({ status: 200, contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64") }));
  const nav = await openTillAsAdmin(page);
  await nav.getByRole("button", { name: /^menù$/i }).click();
  const grid = page.getByRole("tablist", { name: "Categorie del menù" });
  for (const name of ["Antipasti", "Primi", "Dolci", "Bevande"]) {
    await expect(grid.getByRole("tab", { name: new RegExp(`^${name}`) })).toBeInViewport({ ratio: 1 });
  }
  await grid.getByRole("tab", { name: /^Dolci/ }).click();
  await expect(page.getByRole("button", { name: "Modifica Tiramisù" }).locator("img")).toBeVisible();
});

test("alla cassa la categoria manda in comanda tutti i suoi piatti o nessuno, con un tocco", async ({ page }) => {
  const nav = await openTillAsAdmin(page);
  await nav.getByRole("button", { name: /^menù$/i }).click();
  await page.getByRole("tab", { name: "Bevande" }).click();
  const panel = page.getByRole("region", { name: "Categoria" });
  await expect(panel).toContainText("0 in comanda");
  await expect(panel.getByRole("button", { name: "Nessuno in comanda" })).toBeDisabled();
  try {
    await panel.getByRole("button", { name: "Tutti in comanda" }).click();
    await expect(panel).toContainText("2 in comanda", { timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Modifica Acqua naturale" })).not.toContainText("Non in comanda");
  } finally {
    // Il menù demo torna com'era (le bevande non vanno in comanda).
    await panel.getByRole("button", { name: "Nessuno in comanda" }).click();
    await expect(panel).toContainText("0 in comanda", { timeout: 10_000 });
  }
  const menu = await getMenu();
  expect(menu.categories.find((c) => c.id === "cat-bevande").items.every((it) => it.kitchenTicket === false)).toBe(true);
});

test("statistiche della cassa: periodo a tocco, numeri grandi, confronto e classifica dei piatti", async ({ page }) => {
  const nav = await openTillAsAdmin(page);
  await nav.getByRole("button", { name: /^statistiche$/i }).click();
  const periods = page.getByRole("group", { name: "Periodo" });
  await expect(periods.getByRole("button", { name: "Oggi" })).toHaveAttribute("aria-pressed", "true");
  // Il menù demo ha comande chiuse oggi e ieri (scripts/seed-emulator.js).
  await expect(page.getByTestId("kpi-revenue")).toHaveText(/^€ \d+,\d{2}$/, { timeout: 10_000 });
  for (const b of await periods.getByRole("button").all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(48);

  await periods.getByRole("button", { name: "Ieri" }).click();
  await expect(periods.getByRole("button", { name: "Ieri" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("kpi-orders")).toHaveText(/^\d+$/, { timeout: 10_000 });
  await expect(page.getByRole("list", { name: "Classifica dei piatti" }).getByRole("listitem").first()).toBeVisible();

  const compare = page.getByRole("group", { name: "Confronta con" }).getByRole("button", { name: "Periodo precedente" });
  await compare.click();
  await expect(compare).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Dettagli delle statistiche" })).toContainText(/rispetto a/);
  await expect(page.getByRole("region", { name: "Statistiche", exact: true })).toContainText(/%|invariato|nuovo/, { timeout: 10_000 });

  // Visite al menù (seed: ieri 12) nella colonna principale, sotto le vendite.
  const views = page.getByRole("region", { name: "Visite al menù" });
  await expect(views.getByTestId("kpi-views")).toHaveText("12", { timeout: 10_000 });
  await periods.getByRole("button", { name: "Ultimi 7 giorni" }).click();
  await expect(views.getByRole("group", { name: "Visite al menù nel tempo" }).getByRole("button")).toHaveCount(7, { timeout: 10_000 });
});

/* ------------------------------ blocco cassa ------------------------------ */

async function typePin(scope, pin) {
  for (const d of pin) await scope.getByRole("button", { name: `Cifra ${d}` }).click();
}

test("blocco cassa: bloccata all'avvio, PIN errato rifiutato, quello giusto sblocca; «Blocca» e un ricaricamento la richiudono", async ({ page }) => {
  try {
    await setTillLockRemotely({ pin: "2468", lockOnStart: true, timeoutMinutes: 0 });
    await installDesktopBridgeMock(page, { savedLogin: TEST_WAITER });
    await page.goto("/cameriere");
    const lock = page.getByRole("dialog", { name: "Cassa bloccata" });
    await expect(lock).toBeVisible({ timeout: 15_000 });
    // Tasti grandi, PIN mai mostrato in cifre.
    expect((await lock.getByRole("button", { name: "Cifra 5" }).boundingBox()).height).toBeGreaterThanOrEqual(48);
    const unlock = lock.getByRole("button", { name: "Sblocca" });
    await expect(unlock).toBeDisabled(); // meno di 4 cifre

    await typePin(lock, "1111");
    await expect(lock.getByRole("status", { name: "PIN inserito: 4 cifre" })).toBeVisible();
    await unlock.click();
    await expect(lock.getByRole("alert")).toHaveText(/PIN errato/);
    await expect(lock.getByRole("status", { name: "PIN inserito: 0 cifre" })).toBeVisible();
    // "Cancella ultima cifra" corregge senza ricominciare; quello giusto apre da solo.
    await typePin(lock, "246");
    await lock.getByRole("button", { name: "Cancella ultima cifra" }).click();
    await typePin(lock, "68");
    await expect(lock).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Nuovo tavolo" })).toBeVisible();

    // A mano, dalla barra in alto.
    const blocca = page.getByRole("button", { name: "Blocca", exact: true });
    expect((await blocca.boundingBox()).height).toBeGreaterThanOrEqual(48);
    await blocca.click();
    await expect(lock).toBeVisible();
    // Ricaricare non la apre (vale anche col blocco all'avvio spento).
    await setTillLockRemotely({ pin: "2468", lockOnStart: false, timeoutMinutes: 0 });
    await page.reload();
    await expect(lock).toBeVisible({ timeout: 15_000 });
    // Anche dalla tastiera, se la cassa ne ha una.
    await page.keyboard.type("2468");
    await expect(lock).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Nuovo tavolo" })).toBeVisible({ timeout: 15_000 });
    await expect(lock).toHaveCount(0);
  } finally {
    await resetTillLockRemotely();
  }
});

test("blocco cassa: si chiude da sola dopo il tempo scelto senza tocchi (un tocco fa ripartire il conto) e si apre se il blocco viene spento", async ({ page }) => {
  try {
    await setTillLockRemotely({ pin: "13579", lockOnStart: false, timeoutMinutes: 1 });
    await page.clock.install();
    await openTill(page);
    const lock = page.getByRole("dialog", { name: "Cassa bloccata" });
    await expect(page.getByRole("button", { name: "Blocca", exact: true })).toBeVisible();
    await page.clock.fastForward("00:40");
    await expect(lock).toHaveCount(0);
    await page.getByRole("navigation", { name: "Sezioni della sala" }).getByRole("button", { name: /^storico$/i }).click();
    await page.clock.fastForward("00:40"); // 80 s dall'apertura, 40 dall'ultimo tocco
    await expect(lock).toHaveCount(0);
    await page.clock.fastForward("00:25");
    await expect(lock).toBeVisible();

    // Un amministratore spegne il blocco (es. dal telefono): la cassa si riapre.
    await resetTillLockRemotely();
    await expect(lock).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Blocca", exact: true })).toHaveCount(0);
  } finally {
    await resetTillLockRemotely();
  }
});

test("blocco cassa e personale alla cassa: l'admin trova «Blocco cassa» e «Personale» nelle impostazioni del menù", async ({ page }) => {
  await openTill(page, { savedLogin: TEST_ADMIN });
  await page.getByRole("navigation", { name: "Sezioni della sala" }).getByRole("button", { name: /^menù$/i }).click();
  await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
  await page.getByRole("button", { name: /^Blocco cassa/ }).click();
  const panel = page.getByRole("region", { name: "Blocco cassa" });
  await expect(panel.getByRole("switch", { name: "Blocca la cassa con un PIN" })).toBeVisible({ timeout: 10_000 });
  // Tastierino a schermo per il PIN, come per i numeri alla cassa.
  await typePin(panel, "9876");
  await expect(panel.getByRole("status", { name: /PIN: 4 cifre/ })).toBeVisible();
  await panel.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByRole("button", { name: /^Personale/ }).click();
  const staff = page.getByRole("region", { name: "Personale" });
  await expect(staff.getByRole("region", { name: "Proprietario" })).toContainText("Proprietario di test", { timeout: 10_000 });
  await expect(staff.getByRole("button", { name: "Togli accesso a Proprietario di test" })).toHaveCount(0);
});
