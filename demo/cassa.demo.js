// Scene della cassa (client Windows, 1280×800, simulato con
// installDesktopBridgeMock come in tests/till-sala.spec.js) per le GIF del
// README. Vedi demo/README.md.
import { test, expect } from "@playwright/test";
import { TEST_ADMIN, TEST_WAITER } from "../tests/test-env.js";
import { installDesktopBridgeMock } from "../tests/helpers/desktopBridge.js";
import { seedDemoData } from "./demo-data.js";
import { showTaps, pause, tap, type, scene } from "./helpers.js";

test.beforeAll(seedDemoData);
test.beforeEach(({ page }) => showTaps(page));

async function openTill(page, login = TEST_WAITER) {
  await installDesktopBridgeMock(page, { savedLogin: login });
  await page.goto("/?area=staff");
  await expect(page.getByRole("button", { name: "Nuovo tavolo" })).toBeVisible({ timeout: 10_000 });
  await pause(page, 1000);
}

const sections = (page) => page.getByRole("navigation", { name: "Sezioni della sala" });

async function keypad(dialog, digits) {
  for (const d of digits) await tap(dialog.getByRole("button", { name: `Cifra ${d}` }), 250);
}

test("cassa: tavoli, comanda a riquadri, nota e invio in cucina", async ({ page }, testInfo) => {
  const s = scene(testInfo, "cassa-comanda");
  await openTill(page);
  s.start();

  await pause(page, 1500);
  await tap(page.getByRole("button", { name: "Nuovo tavolo" }));
  const dialog = page.getByRole("dialog", { name: "Nuovo tavolo" });
  await keypad(dialog, "14");
  await tap(dialog.getByRole("button", { name: "Aumenta adulti" }), 300);
  await tap(dialog.getByRole("button", { name: "Aumenta adulti" }), 500);
  await tap(dialog.getByRole("button", { name: "Apri tavolo 14" }), 1000);
  await expect(page.getByRole("region", { name: "Comanda del tavolo" })).toBeVisible({ timeout: 10_000 });

  await tap(page.getByRole("tab", { name: "Antipasti" }));
  await tap(page.getByRole("button", { name: /^Aggiungi Bruschetta/ }), 350);
  await tap(page.getByRole("button", { name: /^Aggiungi Bruschetta/ }), 500);
  await tap(page.getByRole("tab", { name: "Primi" }));
  await tap(page.getByRole("button", { name: /^Aggiungi Orecchiette/ }), 500);
  await tap(page.getByRole("tab", { name: "Bevande" }));
  await tap(page.getByRole("button", { name: /^Aggiungi Vino della casa/ }), 800);

  const ticket = page.getByRole("region", { name: "Comanda del tavolo" });
  await tap(ticket.getByRole("button", { name: /^Modifica Bruschetta/ }), 800);
  const editor = page.getByRole("region", { name: "Modifica riga" });
  await type(editor.getByRole("textbox", { name: "Nota di Bruschetta" }), "senza aglio");
  await pause(page, 500);
  await tap(editor.getByRole("button", { name: "Salva" }), 900);

  await tap(page.getByRole("button", { name: /^Invia comanda \(\d+\)$/ }), 400);
  await expect(ticket.getByRole("group", { name: "Già inviato" })).toBeVisible({ timeout: 15_000 });
  await pause(page, 1800);
  await tap(page.getByRole("button", { name: "Tavoli", exact: true }), 2200);
  s.save();
});

test("cassa: sconto su una riga, preconto stampato, chiusura e storico", async ({ page }, testInfo) => {
  const s = scene(testInfo, "cassa-conto");
  await openTill(page);
  s.start();

  await pause(page, 1000);
  await tap(page.getByRole("button", { name: /^Tavolo 3 —/ }), 1200);
  const ticket = page.getByRole("region", { name: "Comanda del tavolo" });
  await tap(ticket.getByRole("button", { name: /^Modifica Orecchiette/ }), 900);
  const editor = page.getByRole("region", { name: "Modifica riga" });
  await tap(editor.getByRole("button", { name: "Sconto 20%" }), 900);
  await tap(editor.getByRole("button", { name: "Salva" }), 1200);

  await tap(page.getByRole("button", { name: "Stampa preconto" }), 400);
  await expect(page.getByRole("status", { name: "Stato stampa" })).toHaveText(/stampato alla cassa/i, { timeout: 15_000 });
  await pause(page, 1500);

  await tap(page.getByRole("button", { name: "Chiudi tavolo" }), 900);
  await tap(page.getByRole("alertdialog", { name: "Chiudere Tavolo 3?" }).getByRole("button", { name: "Chiudi tavolo" }), 1200);
  await tap(sections(page).getByRole("button", { name: /^storico$/i }), 1000);
  await tap(page.getByRole("region", { name: "Comande chiuse" }).getByRole("button", { name: /^Tavolo 3/ }).first(), 2200);
  s.save();
});

test("cassa: prenotazioni con orari a tocco e avvio del tavolo", async ({ page }, testInfo) => {
  const s = scene(testInfo, "cassa-prenotazioni");
  await openTill(page);
  s.start();

  await pause(page, 800);
  await tap(sections(page).getByRole("button", { name: /^prenotazioni$/i }), 1500);
  await tap(page.getByRole("region", { name: "Prenotazioni del giorno" }).getByRole("button", { name: "Nuova" }));
  const form = page.getByRole("region", { name: "Nuova prenotazione" });
  await tap(form.getByRole("button", { name: "21:00" }), 400);
  await type(form.getByRole("textbox", { name: "Nome *" }), "Lucia Ferraro");
  await tap(form.getByRole("button", { name: "Aumenta adulti" }), 300);
  await tap(form.getByRole("button", { name: "Aumenta adulti" }), 500);
  await tap(form.getByRole("button", { name: "Salva e conferma" }), 1500);

  const day = page.getByRole("region", { name: "Prenotazioni del giorno" });
  await tap(day.getByRole("button", { name: /^Famiglia Bianchi, ore 20:00/ }), 1000);
  const detail = page.getByRole("region", { name: "Dettaglio prenotazione" });
  await tap(detail.getByRole("button", { name: "Avvia (apri il tavolo)" }), 800);
  const dialog = page.getByRole("dialog", { name: "Avvia Famiglia Bianchi" });
  await keypad(dialog, "6");
  await tap(dialog.getByRole("button", { name: "Apri comanda" }), 400);
  await expect(page.getByRole("region", { name: "Comanda del tavolo" })).toContainText("Famiglia Bianchi", { timeout: 10_000 });
  await pause(page, 2000);
  s.save();
});

test("cassa (admin): statistiche e gestione del menù", async ({ page }, testInfo) => {
  const s = scene(testInfo, "cassa-statistiche-menu");
  await openTill(page, TEST_ADMIN);
  s.start();

  await pause(page, 800);
  await tap(sections(page).getByRole("button", { name: /^statistiche$/i }), 1500);
  const periods = page.getByRole("group", { name: "Periodo" });
  await tap(periods.getByRole("button", { name: "Ieri" }), 1200);
  await tap(page.getByRole("switch", { name: "Confronta con il periodo precedente" }), 2000);
  await tap(sections(page).getByRole("button", { name: /^menù$/i }), 1500);
  await tap(page.getByRole("tab", { name: "Primi" }), 800);
  await tap(page.getByRole("button", { name: "Modifica Orecchiette" }), 2500);
  s.save();
});
