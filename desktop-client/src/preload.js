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
  onUpdateAvailable: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("bridge:update-available", listener);
    return () => ipcRenderer.removeListener("bridge:update-available", listener);
  },
});
