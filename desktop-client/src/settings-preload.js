// API for the local settings window (settings.html) only.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cassa", {
  get: () => ipcRenderer.invoke("settings:get"),
  save: (s) => ipcRenderer.invoke("settings:save", s),
  status: (target) => ipcRenderer.invoke("settings:status", target),
  testPrint: (target) => ipcRenderer.invoke("settings:test-print", target),
  discover: () => ipcRenderer.invoke("settings:discover"),
  onDiscoverProgress: (cb) => ipcRenderer.on("settings:discover-progress", (_e, done, total) => cb(done, total)),
  action: (name) => ipcRenderer.send("settings:action", name),
});
