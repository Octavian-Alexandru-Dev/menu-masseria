import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { TEST_WAITER, TEST_ADMIN } from "./test-env";
import { staffLogin } from "./helpers/staffLogin";
import { deleteTestOrderByTableNumber } from "./firestore-cleanup";
import { deletePrintJobsByTableLabel } from "./helpers/printJobs";

// Smoke test del vero client Windows della cassa (desktop-client/, Electron):
// lo avvia puntato sul sito locale (emulatore) e su una finta stampante TCP
// in ascolto su 127.0.0.1, e verifica la catena completa fino ai byte che
// arrivano alla "stampante". Gira anche su macOS/Linux: niente di specifico
// di Windows è coinvolto (solo socket TCP e la web app).
//
// Richiede le dipendenze del client: `cd desktop-client && npm install &&
// npx install-electron`. Senza, il test viene saltato (non fallisce).
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLIENT_DIR = path.join(ROOT, "desktop-client");
const electronInstalled = fs.existsSync(path.join(CLIENT_DIR, "node_modules", "electron", "dist"));

test.describe.configure({ mode: "serial" });
test.skip(!electronInstalled, "Client desktop non installato (desktop-client/node_modules).");

function startFakePrinter() {
  const jobs = [];
  const server = net.createServer((socket) => {
    const chunks = [];
    socket.on("data", (d) => chunks.push(d));
    socket.on("close", () => { if (chunks.length) jobs.push(Buffer.concat(chunks)); });
    socket.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, jobs, port: server.address().port })));
}

let printer;
let app;
let userDataDir;
let launchEnv;
let electronPath;
const tableNumber = 12000 + Math.floor(Math.random() * 500);

test.beforeAll(async () => {
  printer = await startFakePrinter();
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "masseria-cassa-test-"));
  fs.writeFileSync(path.join(userDataDir, "settings.json"), JSON.stringify({
    appUrl: "http://localhost:5173/cameriere",
    printer: { host: "127.0.0.1", port: printer.port },
    stationName: "Cassa smoke test",
    startFullscreen: false,
  }));
  const require = createRequire(path.join(CLIENT_DIR, "package.json"));
  // ELECTRON_RUN_AS_NODE (impostata ad es. dai terminali di VS Code, che è
  // esso stesso un'app Electron) farebbe partire il binario come semplice
  // Node invece che come app.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  launchEnv = { ...env, MDP_USER_DATA_DIR: userDataDir };
  electronPath = require("electron");
  app = await electron.launch({ executablePath: electronPath, args: [CLIENT_DIR], env: launchEnv });
});

test.afterAll(async () => {
  await app?.close();
  printer?.server.close();
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  await deleteTestOrderByTableNumber(tableNumber);
  await deletePrintJobsByTableLabel(`Tavolo ${tableNumber}`);
});

test("il client carica la web app, espone il bridge e stampa un preconto inviato da un telefono", async ({ page }) => {
  const till = await app.firstWindow();
  await expect(till.getByText("Area cameriere")).toBeVisible({ timeout: 20_000 });
  expect(await till.evaluate(() => typeof globalThis.mdpDesktop?.printRaw)).toBe("function");
  // API 1.1.0: stato schermo intero (avviato in finestra, startFullscreen:
  // false) e nessuna credenziale della cassa salvata.
  expect(await till.evaluate(() => globalThis.mdpDesktop.setFullscreen())).toBe(false);
  expect(await till.evaluate(() => globalThis.mdpDesktop.getSavedLogin())).toBeNull();
  // API 1.2.0: stato dell'aggiornamento automatico (client non pacchettizzato
  // → "dev", aggiornamenti disattivati).
  expect(await till.evaluate(() => new Promise((resolve) => globalThis.mdpDesktop.onClientUpdateState((st) => resolve(st.status))))).toBe("dev");
  await staffLogin(till, TEST_ADMIN);
  await expect(till.getByRole("button", { name: /stampante: pronta/i })).toBeVisible({ timeout: 15_000 });

  // Telefono del cameriere (browser normale).
  await page.goto("/cameriere");
  await staffLogin(page, TEST_WAITER);
  await page.getByRole("button", { name: /nuovo tavolo/i }).click();
  await page.locator('input[type="number"]').first().fill(String(tableNumber));
  await page.getByRole("button", { name: /apri tavolo/i }).click();
  await expect(page.getByText(`Tavolo ${tableNumber}`, { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /bruschetta/i }).click();
  await page.getByRole("button", { name: /invia comanda/i }).click();
  await expect(page.getByText(/sincronizzata/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /preconto/i }).click();
  await page.getByRole("button", { name: /^stampa$/i }).click();
  await expect(page.getByRole("status", { name: "Stato stampa" })).toHaveText(/stampato alla cassa/i, { timeout: 20_000 });

  const receipt = printer.jobs.map((b) => b.toString("latin1")).find((t) => t.includes(`Tavolo ${tableNumber}`));
  expect(receipt, "byte arrivati alla stampante").toBeTruthy();
  expect(receipt).toContain("Bruschetta");
  expect(receipt.endsWith("\x1dVB\x00")).toBe(true);
});

test("il menu Cassa apre le impostazioni native, con verifica stato e stampa di prova", async () => {
  const till = await app.firstWindow();
  const settingsPromise = app.waitForEvent("window");
  await till.getByRole("button", { name: /apri menu cassa/i }).click();
  await till.getByRole("menuitem", { name: "Impostazioni stampante" }).click();
  const settings = await settingsPromise;
  await expect(settings.getByRole("heading", { name: "Impostazioni cassa" })).toBeVisible();
  await expect(settings.locator("#host")).toHaveValue("127.0.0.1");

  await settings.getByRole("button", { name: "Verifica stato" }).click();
  await expect(settings.locator("#printer-msg")).toHaveText(/raggiungibile/i, { timeout: 15_000 });

  const before = printer.jobs.length;
  await settings.getByRole("button", { name: "Stampa di prova" }).click();
  await expect(settings.locator("#printer-msg")).toHaveText(/stampa di prova inviata/i, { timeout: 15_000 });
  await expect.poll(() => printer.jobs.slice(before).some((b) => b.toString("latin1").includes("PROVA STAMPA"))).toBe(true);

  // Un indirizzo sbagliato dà un messaggio comprensibile, non un crash.
  await settings.locator("#port").fill("1");
  await settings.getByRole("button", { name: "Verifica stato" }).click();
  await expect(settings.locator("#printer-msg")).toHaveText(/rifiutato la connessione|non risponde/i, { timeout: 15_000 });
  await settings.getByRole("button", { name: "Chiudi", exact: true }).click();

  // Fuori da Windows la tastiera virtuale non esiste: errore leggibile, non un crash.
  if (process.platform !== "win32") {
    await till.getByRole("button", { name: /apri menu cassa/i }).click();
    await till.getByRole("menuitem", { name: "Tastiera" }).click();
    await expect(till.getByRole("alert")).toHaveText(/solo su windows/i);
  }
});

test("una seconda apertura del programma non crea un'altra istanza: esce e porta in primo piano quella aperta", async () => {
  const till = await app.firstWindow();
  const second = spawn(electronPath, [CLIENT_DIR], { env: launchEnv, stdio: "ignore" });
  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => { second.kill(); resolve("ancora in esecuzione dopo 15s"); }, 15_000);
    second.on("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
  expect(exitCode).toBe(0);
  // L'istanza originale è ancora lì, visibile e funzionante.
  await expect(till.getByRole("button", { name: /apri menu cassa/i })).toBeVisible();
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length)).toBeGreaterThanOrEqual(1);
  const logText = fs.readFileSync(path.join(userDataDir, "logs", "main.log"), "utf8");
  expect(logText).toContain("seconda apertura");
});
