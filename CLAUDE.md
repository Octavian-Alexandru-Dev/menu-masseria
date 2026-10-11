# Testing

This project uses Playwright for end-to-end contract tests, run against a **local Firebase emulator** (Auth + Firestore, containerized — see `docker-compose.emulator.yml`), never against the real production project. Tests live in `tests/*.spec.js` and are plain JavaScript (the app itself has no TypeScript).

After implementing or changing a UI feature (`ClientView.jsx`, `Admin.jsx`, `Waiter.jsx`, `Reservations.jsx`, `OrderHistory.jsx`, `Stats.jsx`, `PrintMenu.jsx`, `ReceiptOverlay.jsx`, `PrintStation.jsx`, `StaffHome.jsx`, `shared.jsx`, `staff-shared.jsx`, `sala-shared.jsx`, `MenuApp.jsx`, the till screens `Till*.jsx`, or the till client in `desktop-client/`), verify it yourself before considering the task done:

```
npm run test:e2e       # headless run — self-contained, starts/seeds/tears down the emulator automatically
npm run test:e2e:ui    # interactive UI mode, useful while iterating
```

Requires Docker running (`docker` CLI available). `playwright.config.js`'s `globalSetup`/`globalTeardown` start the emulator container, seed it with demo data (`scripts/seed-emulator.js`), and start `npm run dev` against it (`webServer` with `VITE_USE_FIREBASE_EMULATOR=true`) — no `.env` or real Firebase credentials needed to run the suite.

For manual local development against the same emulator (e.g. to try the app without a real Firebase project — useful for a portfolio demo), use `npm run dev:local` instead of `npm run dev`.

The emulator container starts already populated — `Dockerfile.emulator` bakes in a snapshot (`seed-data/`, imported via `--import` on `firebase emulators:start`) with the demo menu and test accounts, so `docker compose -f docker-compose.emulator.yml up` alone never leaves the local menu empty, even without running `npm run seed:emulator` separately. That script still runs automatically in `test:e2e`/`dev:local` as an idempotent safety net. If you change the demo menu's shape in `scripts/seed-emulator.js`, regenerate the baked-in snapshot with `npm run seed:export` and rebuild the image (see `docs/seed-data.md`) — otherwise the image drifts from the seed script.

Test accounts (`TEST_ADMIN`, `TEST_WAITER`, `TEST_KITCHEN`, see `tests/test-env.js` / `scripts/seed-emulator.js`): fixed, non-secret credentials, meaningless outside the ephemeral local emulator.

Notes:
- `tests/client-view.spec.js` / `tests/admin-login.spec.js` / `tests/staff-home.spec.js` / `tests/waiter-order.spec.js` / `tests/reservations.spec.js` cover the public menu, staff login screens, and full authenticated flows (orders and kitchen ticket, reservations lifecycle). Assertions favor structure/role/text over hardcoded content.
- `tests/receipt-printing.spec.js` / `tests/escpos.spec.js` cover receipt and kitchen-ticket printing (print queue, till print station via a mocked `window.mdpDesktop`, ESC/POS output). `tests/till-sala.spec.js` covers the till interface (Tavoli, comanda, Storico, Prenotazioni, Menù, Statistiche) and `tests/till-client.spec.js` the till's menu/banners/login; they run in their own sequential Playwright projects (every till page is a print station). `tests/desktop-client.spec.js` launches the real Electron till client (`desktop-client/`) against a fake TCP printer; it is skipped unless `cd desktop-client && npm install && npx install-electron` has been run. Coverage checklist: `docs/stampa-scontrini.md`.
- `tests/firestore-cleanup.js` deletes test-created orders/reservations between tests within a run (parallel test isolation); the whole emulator is discarded after the run regardless.
- When adding a new UI feature, add or extend a spec in `tests/` alongside it.

# Telefono e cassa — regola obbligatoria

L'area staff ha **due interfacce** per le stesse funzioni:

- **telefono / browser** (mobile-first): `StaffHome.jsx` (Dashboard), `Waiter.jsx`, `Reservations.jsx`, `OrderHistory.jsx`, `ReceiptOverlay.jsx`, `Admin.jsx`, `Stats.jsx` (non c'è più un'area Cucina: la cucina lavora con le comande stampate);
- **cassa** (client Windows `desktop-client/`, riconosciuta da `getDesktopBridge()` in `src/desktop.js`): `TillSala.jsx` (barra delle sezioni + Tavoli/comanda), `TillReservations.jsx`, `TillHistory.jsx`, `TillMenu.jsx`, `TillStats.jsx`, costruite con i pezzi di `TillUi.jsx`.

| Funzione | Telefono | Cassa | Logica condivisa |
|---|---|---|---|
| Sala, comanda, invio, chiusura | `Waiter.jsx` | `TillSala.jsx` | `sala-shared.jsx`, `orders.js` |
| Preconto e stampa | `ReceiptOverlay.jsx` | `TillSala.jsx`, `TillHistory.jsx` | `printJobs.js`, `usePrintJob.js`, `escpos.js` |
| Comanda per la cucina | `Waiter.jsx` | `TillSala.jsx` | `kitchenTicket.js`, `printJobs.js` |
| Storico | `OrderHistory.jsx` | `TillHistory.jsx` | `orders.js` |
| Prenotazioni | `Reservations.jsx` | `TillReservations.jsx` | `reservationsData.js` |
| Gestione menù | `Admin.jsx` | `TillMenu.jsx` | `menuEdit.js`, `menuCosts.js` |
| Statistiche | `Stats.jsx` | `TillStats.jsx` | `statsData.js` |

> 1. Ogni funzione o interazione nuova dell'area staff (un campo nuovo di un piatto, un'azione sulla comanda, un filtro…) va fatta **in entrambe le interfacce** nello stesso intervento. Se una funzione deve esistere solo da una parte (es. il PDF del menù resta in "Gestione completa"), dillo esplicitamente nel riepilogo all'utente e scrivilo in `docs/stampa-scontrini.md` §4.1.
> 2. La logica (dati, regole, calcoli, scritture su Firestore) sta nei moduli condivisi della colonna a destra, mai duplicata nei due componenti: le due interfacce cambiano solo la presentazione. Un campo nuovo del menù passa da `menuEdit.js` ed è modificabile sia in `Admin.jsx` sia in `TillMenu.jsx`; aggiorna anche `scripts/seed-emulator.js` (se serve per i test) e `docs/data-model.md`.
> 3. Alla cassa segui i principi già applicati in `TillUi.jsx` (dettagli in `docs/stampa-scontrini.md` §4.1): bersagli touch ≥ 48px, etichette di testo sempre visibili, stato mai affidato al solo colore (palette fissa `STATUS`), modifica nella barra laterale che si applica solo con "Salva", tastierino a schermo per i numeri, conferma prima delle azioni irreversibili, nessun "Esci". Usa i componenti di `TillUi.jsx` invece di stili nuovi.
> 4. Test: almeno un test E2E per il telefono (progetto `chromium`) e uno per la cassa (`tests/till-sala.spec.js`, con `installDesktopBridgeMock`), più la riga nella matrice di copertura di `docs/stampa-scontrini.md` §7.

# Contract testing E2E — regola obbligatoria

> 1. Prima di considerare completata qualsiasi implementazione che tocchi l'interfaccia utente, esegui l'intera suite di test E2E Playwright — o quantomeno i test relativi alle funzionalità toccate, se la suite è molto ampia e serve un'esecuzione mirata per motivi di tempo. In tal caso specifica quali test sono stati eseguiti e perché non l'intera suite.
> 2. Se un test fallisce dopo una modifica:
>    - **(a)** Analizza se il fallimento è dovuto a un cambiamento intenzionale dell'interfaccia/comportamento (la modifica richiesta ha legittimamente cambiato il contratto). In questo caso aggiorna il test, spiegando esplicitamente cosa è cambiato e perché, mostrando il diff minimo necessario.
>    - **(b)** Se invece il fallimento rivela una regressione o un bug introdotto dall'implementazione appena fatta, **non modificare il test per farlo passare**. Segnala il problema, fermati e chiedi conferma su come procedere prima di continuare.
>    - **(c)** In caso di dubbio tra (a) e (b), tratta il fallimento come potenziale bug (opzione b) finché non c'è conferma esplicita che si tratti di un cambiamento intenzionale.
> 3. Ogni nuova funzionalità o interazione UI aggiunta deve essere accompagnata da almeno un test E2E corrispondente prima di considerare la feature completa. Nessuna funzionalità va considerata "fatta" senza il relativo contract test.
> 4. Non eliminare o disabilitare test esistenti senza segnalarlo esplicitamente e motivarlo (es. funzionalità rimossa — non "test che dava fastidio").
> 5. Mantieni la matrice di copertura aggiornata: se una modifica introduce nuovi stati o interazioni, aggiorna la checklist di copertura, non solo il codice dei test.

# Deploy — firestore.rules

`.github/workflows/firebase-hosting-merge.yml` deploys to the real Firebase project on every push to `main`. It builds and deploys **hosting** (`FirebaseExtended/action-hosting-deploy`), and then a separate step deploys **Firestore rules** (`npx firebase-tools deploy --only firestore:rules`, authenticated via the same `FIREBASE_SERVICE_ACCOUNT_MENU_MASSERIA_DELLA_PIAN` secret written to a temp file and passed as `GOOGLE_APPLICATION_CREDENTIALS`). Both steps run automatically — you don't need to deploy manually after a merge to `main`.

Whenever a change touches `firestore.rules` (a new collection, a widened/narrowed rule, a new `match` block), **call this out explicitly** in your summary to the user: say what changed in the rules and confirm it will go out with the next merge to `main` via that workflow. If you need it live *before* a merge (e.g. testing against the real project, or an out-of-band hotfix), it must be deployed by hand with `firebase deploy --only firestore:rules` (Firebase CLI, authenticated) — flag that explicitly too, since Claude Code cannot run this itself (no local Firebase CLI login).

Why this matters: rules changes are easy to miss because they cause no build error and no local-emulator symptom — `npm run test:e2e` runs entirely against the emulator, which loads `firestore.rules` fresh from the repo on every run, so a rule that was never actually deployed to production still looks "tested and green" locally. The failure mode is a silent `permission-denied` on the real project only, often surfacing much later as a UI element that inexplicably stays disabled/empty (e.g. `menuCosts/data` was added to `firestore.rules` in commit `5283d94` but the deploy workflow at the time only published hosting, not rules — the "Costo interno" field in Admin.jsx stayed disabled in production because `subscribeMenuCosts` kept getting denied and `menuCosts` never left its initial `null`, with nothing surfaced beyond a `console.error`).

# Working directory

This repo is sometimes open in more than one Claude Code session at once. Before deleting or reverting files that look like unfamiliar scaffolding (especially untracked ones), check `git log`/recent activity or ask — a sibling session may be mid-task. If you find conflicting concurrent edits, use `ListAgents`/`SendMessage` to coordinate before cleaning anything up.
