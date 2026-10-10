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
//   reloadApp()          reloads the web app (picks up a new deploy), or
//                        installs a downloaded client update and restarts
//
// Added in client 1.1.0 — check they exist before using them, since a till
// may still run an older client while the web app is already updated:
//   toggleKeyboard()     → Promise; shows/hides the Windows virtual keyboard
//   setFullscreen(bool?) → Promise<boolean>; no argument = current state
//   quitApp()            closes the client
//   getSavedLogin()      → Promise<{ email, password } | null>, the till
//                          account saved in the client's settings
export function getDesktopBridge() {
  return typeof window !== "undefined" && window.mdpDesktop ? window.mdpDesktop : null;
}
