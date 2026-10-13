// Le fasi della suite E2E, in ordine. Le spec con una stazione di stampa
// attiva (una "cassa", simulata o il vero client Electron) stampano TUTTE le
// richieste in coda, come la cassa vera: se girassero in parallelo con altre,
// una si prenderebbe le stampe dell'altra. Per questo ognuna sta in una fase
// propria, dopo le spec "telefono/browser" (chromium), che girano in
// parallelo tra loro.
//
// Usato da playwright.config.js (un progetto per fase, ciascuno dipendente
// dal precedente) e da scripts/test-e2e-changed.js (che esegue solo le spec
// scelte, fase per fase nello stesso ordine).
export const STAGES = [
  { name: "chromium", spec: null }, // tutte le spec non elencate sotto
  { name: "print-queue", spec: /receipt-printing\.spec\.js$/ },
  { name: "till-client", spec: /till-client\.spec\.js$/ },
  // Prints from the till: after the other "till" specs, so no other till
  // page (print station) can claim its print jobs.
  { name: "till-sala", spec: /till-sala\.spec\.js$/ },
  { name: "desktop-client", spec: /desktop-client\.spec\.js$/ },
];

// La fase di una spec ("tests/till-sala.spec.js" → "till-sala").
export function stageOf(specPath) {
  return (STAGES.find((s) => s.spec?.test(specPath)) || STAGES[0]).name;
}
