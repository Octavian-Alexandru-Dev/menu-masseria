// Masseria Cassa — Windows client for the till (see docs/stampa-scontrini.md).
//
// A thin shell around the deployed web app: the whole UI is the same staff
// interface used on phones, loaded from Firebase Hosting, so a normal
// deploy updates the till too. What the shell adds is only what a browser
// can't do: talking raw TCP to the thermal printer (printer.js), a
// fullscreen/kiosk window for the 12" touch terminal, and a local settings
// window to fix printer problems on the spot. Plus the till comforts that
// need the OS: on-demand virtual keyboard (keyboard.js), a saved login for
// the till account (credentials.js) and self-updates (updater.js).
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { app, BrowserWindow, ipcMain, shell, session, net, screen, Notification } = require("electron");
const store = require("./settings-store");
const printer = require("./printer");
const keyboard = require("./keyboard");
const credentials = require("./credentials");
const updater = require("./updater");
const { log, dir: logDir } = require("./log");

// Lets the Playwright smoke test (tests/desktop-client.spec.js) run the real
// client against a throwaway settings folder.
if (process.env.MDP_USER_DATA_DIR) app.setPath("userData", process.env.MDP_USER_DATA_DIR);

const APP_ID = "it.masseria-della-piana.cassa"; // = build.appId, needed for Windows notifications
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const CLEAR_CACHE_TIMEOUT_MS = 3000;
// File name of the installer electron-updater runs during a self-update
// (= build.nsis.artifactName).
const INSTALLER_EXE = "Masseria-Cassa-Setup.exe";
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
    if (h && loadedHtmlHash && h !== loadedHtmlHash) notifyUpdateAvailable();
  }, UPDATE_CHECK_INTERVAL_MS);
}

// Same "new version — update now" banner in the page for both a new web
// deploy and a downloaded client update; "Aggiorna ora" (bridge:reload)
// installs the client update if there is one, otherwise reloads the page.
function notifyUpdateAvailable() {
  if (mainWindow) mainWindow.webContents.send("bridge:update-available");
}

function notify(body) {
  try {
    if (Notification.isSupported()) new Notification({ title: "Masseria Cassa", body }).show();
  } catch (err) { log("notifica non mostrata:", err); }
}

// The silent installer runs with no window for up to a minute: a Windows
// notification says so, so nobody reopens the program in the meantime.
function installUpdate() {
  if (updater.state().status !== "downloaded") return false;
  log("installazione aggiornamento", updater.state().version);
  notify("Aggiornamento in corso: il programma si riaprirà da solo tra circa un minuto. Non riaprirlo nel frattempo.");
  setTimeout(() => updater.installNow(), 800);
  return true;
}

function reloadOrInstall() {
  if (installUpdate()) return;
  session.defaultSession.clearCache().finally(() => { loadApp(); startUpdateChecks(); });
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
    // Shown right away (with the background colour) rather than on
    // "ready-to-show": a window waiting for a page that never finishes
    // loading would leave an invisible process that swallows every later
    // launch (single instance), with nothing on screen.
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenu(null);
  applyWindowSettings();

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
  // A crashed or hung page would leave a blank screen: reload it.
  wc.on("render-process-gone", (_e, details) => {
    log("pagina terminata:", details);
    if (details.reason !== "clean-exit") setTimeout(loadApp, 1000);
  });
  mainWindow.on("unresponsive", () => log("finestra non risponde"));

  wc.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted (e.g. a redirect)
    log("caricamento fallito:", code, desc, url);
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
  if (fromApp(e) || isLocalPage(e)) reloadOrInstall();
});

ipcMain.handle("bridge:keyboard", async (e) => {
  if (!fromApp(e)) return { ok: false, error: "Origine non autorizzata." };
  try {
    return { ok: true, value: await keyboard.toggleKeyboard(settings.keyboardMode) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("bridge:fullscreen", (e, wanted) => {
  if (!fromApp(e) || !mainWindow) return { ok: false, error: "Origine non autorizzata." };
  if (typeof wanted === "boolean") {
    // Leaving fullscreen must also leave kiosk mode, otherwise it's a no-op.
    if (!wanted && mainWindow.isKiosk()) mainWindow.setKiosk(false);
    mainWindow.setFullScreen(wanted);
  }
  return { ok: true, value: mainWindow.isFullScreen() || mainWindow.isKiosk() };
});

ipcMain.on("bridge:quit", (e) => { if (fromApp(e)) app.quit(); });

// Current client-update state, for a page that (re)loads mid-download.
ipcMain.handle("bridge:update-state", (e) => {
  if (!fromApp(e)) return { ok: false, error: "Origine non autorizzata." };
  return { ok: true, value: updater.state() };
});

// The till account saved in Impostazioni, handed only to the web app's own
// origin, which uses it to sign in without typing (staff-shared.jsx).
ipcMain.handle("bridge:saved-login", (e) => {
  if (!fromApp(e)) return { ok: false, error: "Origine non autorizzata." };
  return { ok: true, value: settings.autoLogin ? credentials.load() : null };
});

/* ---------------------------- settings window ---------------------------- */

ipcMain.handle("settings:get", (e) => {
  if (!isSettingsWindow(e)) return null;
  return {
    settings, file: store.file(), version: app.getVersion(), electron: process.versions.electron,
    fullscreen: mainWindow ? mainWindow.isFullScreen() : false,
    savedEmail: credentials.savedEmail(), update: updater.state(),
  };
});

ipcMain.handle("settings:credentials", (e, action, email, password) => {
  if (!isSettingsWindow(e)) return { ok: false, error: "Non autorizzato." };
  try {
    if (action === "clear") credentials.clear();
    else credentials.save(String(email).trim(), String(password));
    return { ok: true, savedEmail: credentials.savedEmail() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
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
  if (action === "update-check") updater.check();
  if (action === "update-install") installUpdate();
  if (action === "open-logs") shell.openPath(logDir());
  if (action === "toggle-fullscreen" && mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
  if (action === "devtools" && mainWindow) mainWindow.webContents.openDevTools({ mode: "detach" });
  if (action === "quit") app.quit();
});

/* -------------------------------- lifecycle -------------------------------- */

// Is the self-update installer running right now? Launching the program in
// the middle of it would start it from files being replaced.
function installerRunning() {
  if (process.platform !== "win32") return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", `IMAGENAME eq ${INSTALLER_EXE}`, "/NH"], { windowsHide: true, timeout: 4000 },
      (err, stdout) => resolve(!err && stdout.toLowerCase().includes(INSTALLER_EXE.toLowerCase())));
  });
}

function bringToFront() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

async function start() {
  log(`avvio versione ${app.getVersion()}`);
  if (await installerRunning()) {
    log("installer dell'aggiornamento in corso: esco");
    notify("Aggiornamento in corso: il programma si riaprirà da solo appena finito.");
    setTimeout(() => app.exit(0), 1500);
    return;
  }
  // Always start from the latest deployed web app: only the HTTP cache is
  // cleared — the login session and Firestore's offline cache are kept. With
  // a timeout: the window must appear even if clearing gets stuck.
  await Promise.race([
    session.defaultSession.clearCache().catch((err) => log("pulizia cache fallita:", err)),
    new Promise((resolve) => setTimeout(resolve, CLEAR_CACHE_TIMEOUT_MS)),
  ]);
  createMainWindow();
  updater.init((st) => {
    if (st.status !== "downloading") log("aggiornamento:", st);
    if (settingsWindow) settingsWindow.webContents.send("settings:update-state", st);
    // Progress banners in the page (UpdateBanner.jsx in the web app).
    if (mainWindow) mainWindow.webContents.send("bridge:update-state", st);
    if (st.status === "downloaded") notifyUpdateAvailable();
  });
}

app.setAppUserModelId(APP_ID);

// One program, one process tree: a second launch (e.g. tapping the icon
// again because nothing seemed to happen) only brings the existing window
// to the front, then exits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    log("seconda apertura: porto in primo piano la finestra esistente");
    bringToFront();
  });
  app.whenReady().then(start);
  app.on("window-all-closed", () => app.quit());
}
