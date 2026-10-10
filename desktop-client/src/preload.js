// Bridge exposed to the web app as window.mdpDesktop (contract documented in
// src/desktop.js of the web app). The main process re-checks the caller's
// origin on every call, so a page from any other site can't use it even if
// it somehow got loaded in this window.
const { contextBridge, ipcRenderer } = require("electron");

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res && res.ok === false) throw new Error(res.error);
  return res ? res.value : undefined;
}

contextBridge.exposeInMainWorld("mdpDesktop", {
  version: ipcRenderer.sendSync("app:version"),
  getConfig: () => call("bridge:config"),
  printRaw: (bytes) => call("bridge:print", bytes),
  openSettings: () => ipcRenderer.send("bridge:open-settings"),
  reloadApp: () => ipcRenderer.send("bridge:reload"),
  toggleKeyboard: () => call("bridge:keyboard"),
  // setFullscreen(true|false) → Promise<boolean>; no argument = read only.
  setFullscreen: (wanted) => call("bridge:fullscreen", wanted),
  quitApp: () => ipcRenderer.send("bridge:quit"),
  getSavedLogin: () => call("bridge:saved-login"),
  // Client self-update state ({ status, version, progress, error }), current
  // value first, then every change. Since client 1.2.0.
  onClientUpdateState: (cb) => {
    const listener = (_e, st) => cb(st);
    ipcRenderer.on("bridge:update-state", listener);
    call("bridge:update-state").then(cb).catch(() => {});
    return () => ipcRenderer.removeListener("bridge:update-state", listener);
  },
  // "Esci dall'account" pressed in the settings window. Since client 1.4.0.
  onLogoutRequest: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("bridge:logout-request", listener);
    return () => ipcRenderer.removeListener("bridge:logout-request", listener);
  },
  onUpdateAvailable: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("bridge:update-available", listener);
    return () => ipcRenderer.removeListener("bridge:update-available", listener);
  },
});
