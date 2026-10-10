// Finto window.mdpDesktop (il bridge che il client Windows della cassa,
// desktop-client/preload.js, espone alla web app — contratto in
// src/desktop.js): trasforma una normale pagina Playwright in una "cassa"
// con la stazione di stampa attiva, senza Electron né stampante vera. I byte
// ESC/POS ricevuti finiscono in window.__printed; window.__printFail = "msg"
// fa fallire le stampe con quel messaggio (es. carta esaurita).
// legacy: true simula un client 1.0.0 già installato (bridge senza
// tastiera/schermo intero/chiusura/credenziali). noSettingsLogout: true
// simula un client 1.1–1.3 (senza "Esci dall'account" nelle impostazioni,
// quindi con il pulsante "Esci" ancora visibile nella web app);
// globalThis.__fireLogoutRequest() simula quel pulsante del client 1.4. savedLogin: credenziali
// della cassa salvate nel client ({ email, password }). version: versione del
// client simulato. globalThis.__fireClientUpdate(stato) simula lo stato
// dell'aggiornamento automatico del client (download, pronto, errore…).
export async function installDesktopBridgeMock(page, { failWith = null, legacy = false, savedLogin = null, version = "test", noSettingsLogout = false } = {}) {
  await page.addInitScript(({ failMessage, legacyApi, login, clientVersion, noLogoutRequest }) => {
    globalThis.__printed = [];
    globalThis.__printFail = failMessage;
    globalThis.__settingsOpened = 0;
    globalThis.__reloaded = false;
    globalThis.__keyboardToggles = 0;
    globalThis.__fullscreen = true;
    globalThis.__quit = false;
    const bridge = {
      version: legacyApi ? "1.0.0" : clientVersion,
      getConfig: async () => ({ stationName: "Cassa di test" }),
      printRaw: async (bytes) => {
        if (globalThis.__printFail) throw new Error(globalThis.__printFail);
        globalThis.__printed.push(Array.from(bytes));
      },
      openSettings: () => { globalThis.__settingsOpened += 1; },
      reloadApp: () => { globalThis.__reloaded = true; },
      onUpdateAvailable: (cb) => { globalThis.__fireUpdateAvailable = cb; return () => {}; },
    };
    if (!legacyApi) {
      Object.assign(bridge, {
        toggleKeyboard: async () => { globalThis.__keyboardToggles += 1; return "touch"; },
        setFullscreen: async (wanted) => {
          if (typeof wanted === "boolean") globalThis.__fullscreen = wanted;
          return globalThis.__fullscreen;
        },
        quitApp: () => { globalThis.__quit = true; },
        getSavedLogin: async () => login,
        onClientUpdateState: (cb) => { globalThis.__fireClientUpdate = cb; cb({ status: "idle" }); return () => {}; },
      });
      if (!noLogoutRequest) {
        bridge.onLogoutRequest = (cb) => { globalThis.__fireLogoutRequest = cb; return () => {}; };
      }
    }
    globalThis.mdpDesktop = bridge;
  }, { failMessage: failWith, legacyApi: legacy, login: savedLogin, clientVersion: version, noLogoutRequest: noSettingsLogout });
}

// Ultimi byte stampati decodificati come latin1 (le lettere accentate CP858
// non coincidono con latin1, ma per controllare testo ASCII basta).
export async function printedTexts(page) {
  const all = await page.evaluate(() => globalThis.__printed);
  return all.map((bytes) => String.fromCharCode(...bytes));
}
