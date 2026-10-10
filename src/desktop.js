// Bridge to the Windows till client (desktop-client/, Electron). Its preload
// script exposes window.mdpDesktop to this page; in a normal browser (a
// waiter's phone, a laptop) it's undefined and the web app behaves exactly as
// before. See docs/stampa-scontrini.md for the full API contract.
//
//   version              shell version string
//   getConfig()          → Promise<{ stationName }>
//   printRaw(bytes)      → Promise<void>, rejects with a readable message
//   openSettings()       opens the native printer/app settings window
//   onUpdateAvailable(cb) → unsubscribe; cb fires when a newer web app
//                          version has been deployed
//   reloadApp()          reloads the web app (picks up a new deploy)
export function getDesktopBridge() {
  return typeof window !== "undefined" && window.mdpDesktop ? window.mdpDesktop : null;
}
