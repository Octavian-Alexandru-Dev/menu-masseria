// Finto window.mdpDesktop (il bridge che il client Windows della cassa,
// desktop-client/preload.js, espone alla web app — contratto in
// src/desktop.js): trasforma una normale pagina Playwright in una "cassa"
// con la stazione di stampa attiva, senza Electron né stampante vera. I byte
// ESC/POS ricevuti finiscono in window.__printed; window.__printFail = "msg"
// fa fallire le stampe con quel messaggio (es. carta esaurita).
export async function installDesktopBridgeMock(page, { failWith = null } = {}) {
  await page.addInitScript((failMessage) => {
    globalThis.__printed = [];
    globalThis.__printFail = failMessage;
    globalThis.__settingsOpened = 0;
    globalThis.__reloaded = false;
    globalThis.mdpDesktop = {
      version: "test",
      getConfig: async () => ({ stationName: "Cassa di test" }),
      printRaw: async (bytes) => {
        if (globalThis.__printFail) throw new Error(globalThis.__printFail);
        globalThis.__printed.push(Array.from(bytes));
      },
      openSettings: () => { globalThis.__settingsOpened += 1; },
      reloadApp: () => { globalThis.__reloaded = true; },
      onUpdateAvailable: (cb) => { globalThis.__fireUpdateAvailable = cb; return () => {}; },
    };
  }, failWith);
}

// Ultimi byte stampati decodificati come latin1 (le lettere accentate CP858
// non coincidono con latin1, ma per controllare testo ASCII basta).
export async function printedTexts(page) {
  const all = await page.evaluate(() => globalThis.__printed);
  return all.map((bytes) => String.fromCharCode(...bytes));
}
