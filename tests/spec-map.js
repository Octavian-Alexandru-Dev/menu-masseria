// Quali spec E2E coprono quale parte del codice, per
// `npm run test:e2e:changed` (scripts/test-e2e-changed.js): durante lo
// sviluppo si eseguono solo i test di ciò che è cambiato; la suite completa
// (`npm run test:e2e`) resta la verifica finale. Vedi docs/testing.md.
//
// Regole, nell'ordine:
//  1. una spec cambiata → se stessa;
//  2. un helper dei test cambiato → le spec che lo importano (calcolato);
//  3. un file in FULL_SUITE → tutta la suite (configurazione, dati di
//     partenza, regole, pezzi usati da ogni schermata);
//  4. un file in SPECS_BY_FILE → quelle spec;
//  5. un file in IGNORED → nessun test (documentazione, asset del sito…);
//  6. qualunque altro file → tutta la suite, con un avviso: meglio un test
//     di troppo che una regressione non vista. Aggiungi qui il file nuovo.
//
// Le chiavi sono percorsi dalla radice del repo; quelle che finiscono con "/"
// valgono per tutta la cartella. I nomi delle spec sono senza ".spec.js".

export const FULL_SUITE = [
  "package.json", "package-lock.json", "playwright.config.js", "vite.config.js", "index.html",
  "firestore.rules", "firebase.json", "docker-compose.emulator.yml", "Dockerfile.emulator", "seed-data/",
  "scripts/seed-emulator.js",
  "tests/stages.js", "tests/spec-map.js", "tests/global-setup.js", "tests/global-teardown.js", "tests/test-env.js",
  "tests/helpers/emulatorApp.js", "tests/helpers/appUrl.js",
  "src/main.jsx", "src/MenuApp.jsx", "src/shared.jsx", "src/TillUi.jsx", "src/confirmDialog.jsx",
  "src/firebase-db.js", "src/firebase-auth.js", "src/staff-shared.jsx", "src/staffUsername.js", "src/StaffHome.jsx",
];

const PHONE_STAFF = ["phone-app", "staff-home", "waiter-order", "reservations", "order-history", "stats-dashboard", "menu-settings", "admin-menu-costs"];
const SALA = ["waiter-order", "phone-app", "reservations", "receipt-printing", "till-sala"];
const MENU_ADMIN = ["menu-edit", "menu-settings", "admin-menu-costs", "phone-app", "till-sala"];
const PRINTING = ["receipt-printing", "escpos", "waiter-order", "till-sala", "desktop-client"];
const TILL = ["till-client", "till-sala", "desktop-client"];

export const SPECS_BY_FILE = {
  "src/ClientView.jsx": ["client-view"],
  "src/menuViews.js": ["client-view", "stats-dashboard"],
  "src/PrintMenu.jsx": ["print-menu", "menu-settings"],
  "src/menuPrint.js": ["print-menu", "menu-settings"],
  "src/PhoneApp.jsx": PHONE_STAFF,
  "src/lastStaffAccount.js": ["staff-home", "admin-login", "till-client", "client-view"],
  "src/Waiter.jsx": SALA,
  "src/TillSala.jsx": TILL,
  "src/OrderUi.jsx": SALA,
  "src/sala-shared.jsx": SALA,
  "src/orders.js": [...SALA, "order-history", "stats-dashboard"],
  "src/TillReservations.jsx": ["reservations", "till-sala"],
  "src/reservationsData.js": ["reservations", "till-sala"],
  "src/TillHistory.jsx": ["order-history", "waiter-order", "till-sala"],
  "src/TillStats.jsx": ["stats-dashboard", "till-sala"],
  "src/statsData.js": ["stats-dashboard", "till-sala"],
  "src/TillMenu.jsx": MENU_ADMIN,
  "src/MenuSettings.jsx": [...MENU_ADMIN, "owner-claim"],
  "src/menuEdit.js": MENU_ADMIN,
  "src/menuBackup.js": ["menu-settings"],
  "src/staffData.js": ["menu-settings", "till-sala", "firestore-rules", "owner-claim", "staff-home", "phone-app", "reservations", "order-history"],
  "src/tillLockData.js": ["menu-settings", "till-sala", "firestore-rules"],
  "src/TillLock.jsx": ["menu-settings", "till-sala"],
  "tests/helpers/staffRoles.js": ["menu-settings", "till-sala", "owner-claim"],
  "src/cloudinary.js": ["menu-settings", "phone-app", "client-view"],
  "src/menuCosts.js": ["admin-menu-costs", "stats-dashboard", "waiter-order"],
  "src/printJobs.js": PRINTING,
  "src/usePrintJob.js": PRINTING,
  "src/PrintStation.jsx": PRINTING,
  "src/escpos.js": PRINTING,
  "src/kitchenTicket.js": PRINTING,
  "src/desktop.js": [...TILL, "receipt-printing"],
  "src/UpdateBanner.jsx": ["till-client", "desktop-client"],
  "desktop-client/": ["desktop-client", "till-client"],
  "public/staff.webmanifest": ["phone-app"],
  "src/displayZoom.js": ["phone-app"],
};

// Più ogni file Markdown (*.md), ovunque.
export const IGNORED = [
  "docs/", ".gitignore", ".github/", ".githooks/", ".vscode/", ".claude/", "landing_page/", "demo/", "menu.json",
  ".env.example", ".bws-token.example", ".ftp-credentials.example", ".firebaserc", "playwright.demo.config.js",
  "scripts/make-demo-gifs.js", "scripts/export-seed-data.sh", "scripts/ftp-deploy-landing.sh", "scripts/bws-env.sh",
  "scripts/test-e2e-changed.js", "public/", "eslint.config.js",
];

// Prima corrispondenza di `file` in una lista o mappa di percorsi ("dir/" = tutta la cartella).
export function matchPath(file, keys) {
  return keys.find((k) => (k.endsWith("/") ? file.startsWith(k) : file === k));
}
