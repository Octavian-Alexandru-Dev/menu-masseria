// Masseria Cassa — Windows client for the till (see docs/stampa-scontrini.md).
//
// A thin shell around the deployed web app: the whole UI is the same staff
// interface used on phones, loaded from Firebase Hosting, so a normal
// deploy updates the till too. What the shell adds is only what a browser
// can't do: talking raw TCP to the thermal printer (printer.js), a
// fullscreen/kiosk window for the 12" touch terminal, and a local settings
// window to fix printer problems on the spot.
const path = require("node:path");
const crypto = require("node:crypto");
const { app, BrowserWindow, ipcMain, shell, session, net, screen } = require("electron");
const store = require("./settings-store");
const printer = require("./printer");

// Lets the Playwright smoke test (tests/desktop-client.spec.js) run the real
// client against a throwaway settings folder.
if (process.env.MDP_USER_DATA_DIR) app.setPath("userData", process.env.MDP_USER_DATA_DIR);

const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const MAX_PRINT_BYTES = 2 * 1024 * 1024;

let settings = store.load();
let mainWindow = null;
let settingsWindow = null;
let loadedHtmlHash = null;
let updateTimer = null;

function appOrigin() {
  try { return new URL(settings.appUrl).origin; } catch { return null; }
}

// Every bridge call must come from the configured web app, not from any
// other page that might end up in the window.
function fromApp(event) {
  try {
    return new URL(event.senderFrame.url).origin === appOrigin();
  } catch {
    return false;
  }
}

async function fetchHtmlHash() {
  try {
    const res = await net.fetch(settings.appUrl, { cache: "no-store" });
    if (!res.ok) return null;
    return crypto.createHash("sha256").update(await res.text()).digest("hex");
  } catch {
    return null;
  }
}

// OTA updates: the web app's index.html references content-hashed bundles,
// so it changes with every deploy. When it differs from the one loaded at
// startup, the page shows a "new version — update now" banner (never a
// forced reload in the middle of someone's work).
function startUpdateChecks() {
  clearInterval(updateTimer);
  fetchHtmlHash().then((h) => { loadedHtmlHash = h; });
  updateTimer = setInterval(async () => {
    const h = await fetchHtmlHash();
    if (h && loadedHtmlHash && h !== loadedHtmlHash && mainWindow) {
      mainWindow.webContents.send("bridge:update-available");
    }
  }, UPDATE_CHECK_INTERVAL_MS);
}

function loadApp() {
  if (!mainWindow) return;
  mainWindow.loadURL(settings.appUrl).catch(() => {});
}

function applyWindowSettings() {
  if (!mainWindow) return;
  mainWindow.setKiosk(Boolean(settings.kiosk));
  if (!settings.kiosk) mainWindow.setFullScreen(Boolean(settings.startFullscreen));
  mainWindow.webContents.setZoomFactor(Number(settings.zoomFactor) || 1);
  app.setLoginItemSettings({ openAtLogin: Boolean(settings.launchAtLogin) });
}

function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1280, width),
    height: Math.min(800, height),
    title: "Masseria Cassa",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    backgroundColor: "#f6f1e7",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.once("ready-to-show", () => {
    applyWindowSettings();
    mainWindow.show();
  });

  const wc = mainWindow.webContents;
  // Touch terminal: no accidental pinch-zoom; scale is the "Zoom" setting.
  wc.setVisualZoomLevelLimits(1, 1);
  wc.on("did-finish-load", () => wc.setZoomFactor(Number(settings.zoomFactor) || 1));

  // Links to other sites (Instagram, maps...) open in the system browser.
  wc.on("will-navigate", (e, url) => {
    if (new URL(url).origin !== appOrigin() && !url.startsWith("file:")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === appOrigin()) {
      // e.g. "Esporta PDF / Stampa" of the menu (PrintMenu.jsx).
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  // No connection at startup: local page with "retry" and "settings".
  wc.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted (e.g. a redirect)
    mainWindow.loadFile(path.join(__dirname, "offline.html"), { query: { error: `${desc} (${code})`, url } });
  });

  // Keyboard shortcuts, for when a keyboard is attached.
  wc.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") { mainWindow.setFullScreen(!mainWindow.isFullScreen()); e.preventDefault(); }
    if (input.key === "F5" || (input.control && input.key.toLowerCase() === "r")) { loadApp(); e.preventDefault(); }
    if (input.control && input.shift && input.key.toLowerCase() === "p") { openSettings(); e.preventDefault(); }
    if (input.control && input.shift && input.key.toLowerCase() === "i") { wc.toggleDevTools(); e.preventDefault(); }
  });

  mainWindow.on("closed", () => { mainWindow = null; });
  loadApp();
  startUpdateChecks();
}

function openSettings() {
  if (settingsWindow) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    width: 760,
    height: 720,
    title: "Impostazioni — Masseria Cassa",
    autoHideMenuBar: true,
    backgroundColor: "#f6f1e7",
    webPreferences: {
      preload: path.join(__dirname, "settings-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWindow.setMenu(null);
  settingsWindow.loadFile(path.join(__dirname, "settings.html"));
  settingsWindow.on("closed", () => { settingsWindow = null; });
}

function isSettingsWindow(event) {
  return settingsWindow && event.sender === settingsWindow.webContents;
}

function isLocalPage(event) {
  return event.senderFrame && event.senderFrame.url.startsWith("file:");
}

/* ------------------------------ bridge (web app) ------------------------------ */

ipcMain.on("app:version", (e) => { e.returnValue = app.getVersion(); });

ipcMain.handle("bridge:config", (e) => {
  if (!fromApp(e)) return { ok: false, error: "Origine non autorizzata." };
  return { ok: true, value: { stationName: settings.stationName } };
});

ipcMain.handle("bridge:print", async (e, bytes) => {
  if (!fromApp(e)) return { ok: false, error: "Origine non autorizzata." };
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_PRINT_BYTES) {
    return { ok: false, error: "Dati di stampa non validi." };
  }
  try {
    await printer.printRaw(settings.printer, bytes);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.on("bridge:open-settings", (e) => { if (fromApp(e) || isLocalPage(e)) openSettings(); });
ipcMain.on("bridge:reload", (e) => {
  if (!fromApp(e) && !isLocalPage(e)) return;
  session.defaultSession.clearCache().finally(() => { loadApp(); startUpdateChecks(); });
});

/* ---------------------------- settings window ---------------------------- */

ipcMain.handle("settings:get", (e) => {
  if (!isSettingsWindow(e)) return null;
  return { settings, file: store.file(), version: app.getVersion(), electron: process.versions.electron, fullscreen: mainWindow ? mainWindow.isFullScreen() : false };
});

ipcMain.handle("settings:save", (e, next) => {
  if (!isSettingsWindow(e)) return { ok: false, errors: ["Non autorizzato."] };
  const previousUrl = settings.appUrl;
  const res = store.save(next);
  if (!res.ok) return res;
  settings = res.settings;
  applyWindowSettings();
  if (settings.appUrl !== previousUrl) { loadApp(); startUpdateChecks(); }
  return { ok: true, settings };
});

ipcMain.handle("settings:status", (e, target) => {
  if (!isSettingsWindow(e)) return null;
  return printer.getStatus(target);
});

ipcMain.handle("settings:test-print", async (e, target) => {
  if (!isSettingsWindow(e)) return { ok: false, error: "Non autorizzato." };
  try {
    await printer.printRaw(target, printer.testPageBytes({ ...target, stationName: settings.stationName }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("settings:discover", async (e) => {
  if (!isSettingsWindow(e)) return [];
  return printer.discover({ onProgress: (done, total) => e.sender.send("settings:discover-progress", done, total) });
});

ipcMain.on("settings:action", (e, action) => {
  if (!isSettingsWindow(e)) return;
  if (action === "reload") session.defaultSession.clearCache().finally(() => { loadApp(); startUpdateChecks(); });
  if (action === "toggle-fullscreen" && mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
  if (action === "devtools" && mainWindow) mainWindow.webContents.openDevTools({ mode: "detach" });
  if (action === "quit") app.quit();
});

/* -------------------------------- lifecycle -------------------------------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(async () => {
    // Always start from the latest deployed web app: only the HTTP cache is
    // cleared — the login session and Firestore's offline cache are kept.
    await session.defaultSession.clearCache();
    createMainWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
