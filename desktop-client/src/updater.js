// Automatic updates of the client itself, from the GitHub Releases published
// by .github/workflows/desktop-client-release.yml (latest.yml + installer).
//
// Downloaded by the app, not by a browser: no Edge/SmartScreen download
// block, no need to reinstall by hand. Only the shell is updated this way —
// the interface keeps coming from the site (web deploys).
const { app } = require("electron");
const { autoUpdater } = require("electron-updater");

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const state = { status: "idle", version: null, error: null };
let onChange = () => {};

function set(patch) {
  Object.assign(state, patch);
  onChange({ ...state });
}

function init(listener) {
  onChange = listener;
  if (!app.isPackaged) {
    set({ status: "dev" });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => set({ status: "checking", error: null }));
  autoUpdater.on("update-available", (info) => set({ status: "downloading", version: info.version }));
  autoUpdater.on("update-not-available", () => set({ status: "up-to-date" }));
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", progress: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => set({ status: "downloaded", version: info.version }));
  autoUpdater.on("error", (err) => set({ status: "error", error: (err && err.message) || String(err) }));
  check();
  setInterval(check, CHECK_INTERVAL_MS);
}

function check() {
  if (!app.isPackaged) return;
  autoUpdater.checkForUpdates().catch(() => {});
}

// Silent install of the downloaded version, then the app restarts by itself.
function installNow() {
  if (state.status !== "downloaded") return false;
  autoUpdater.quitAndInstall(true, true);
  return true;
}

module.exports = { init, check, installNow, state: () => ({ ...state }) };
