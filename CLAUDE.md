# Testing

This project uses Playwright for end-to-end contract tests, run against a **local Firebase emulator** (Auth + Firestore, containerized — see `docker-compose.emulator.yml`), never against the real production project. Tests live in `tests/*.spec.js` and are plain JavaScript (the app itself has no TypeScript).

After implementing or changing a UI feature (`ClientView.jsx`, `PrintMenu.jsx`, `PrintStation.jsx`, `StaffHome.jsx`, `PhoneApp.jsx`, `Waiter.jsx`, `OrderUi.jsx`, `MenuSettings.jsx`, `shared.jsx`, `staff-shared.jsx`, `sala-shared.jsx`, `MenuApp.jsx`, the staff screens `Till*.jsx`, or the till client in `desktop-client/`), verify it yourself before considering the task done:

```
npm run test:e2e:changed            # while developing: only the specs covering the files you changed (vs HEAD)
npm run test:e2e:changed -- reservations till-sala   # specific specs, in the right stage order
npm run test:e2e:changed -- --list  # show which specs would run and why, without running
npm run test:e2e                    # the full suite — run it once at the end, to validate the whole job
npm run test:e2e:ui                 # interactive UI mode, useful while investigating
```

Use `test:e2e:changed` while iterating (faster, less output); always finish with the full `npm run test:e2e` before considering the task done, and say in the summary which runs you did. The file → spec map is `tests/spec-map.js`: **when you add a file in `src/` or a new spec, add it there** (an unmapped file makes the runner fall back to the full suite, with a warning). Don't run a single till spec with `npx playwright test tests/till-sala.spec.js`: project dependencies make Playwright run the whole `chromium` stage first — use `test:e2e:changed`. Details, and the rules that keep the tests deterministic (no fixed waits, `expect.poll` for server reads, per-test data and cleanup, never `afterAll` cleanup): `docs/testing.md`. A test that fails once and passes on rerun is a bug in the test to fix, not something to retry.

Requires Docker running (`docker` CLI available). `playwright.config.js`'s `globalSetup`/`globalTeardown` start the emulator container and seed it with demo data (`scripts/seed-emulator.js`); `webServer` builds the app for production with `VITE_USE_FIREBASE_EMULATOR=true` and serves it with `vite preview` on port 4173 (never the dev server, never reused) — no `.env` or real Firebase credentials needed to run the suite.

For manual local development against the same emulator (e.g. to try the app without a real Firebase project — useful for a portfolio demo), use `npm run dev:local` instead of `npm run dev`.

The emulator container starts already populated — `Dockerfile.emulator` bakes in a snapshot (`seed-data/`, imported via `--import` on `firebase emulators:start`) with the demo menu and test accounts, so `docker compose -f docker-compose.emulator.yml up` alone never leaves the local menu empty, even without running `npm run seed:emulator` separately. That script still runs automatically in `test:e2e`/`dev:local` as an idempotent safety net. If you change the demo menu's shape in `scripts/seed-emulator.js`, regenerate the baked-in snapshot with `npm run seed:export` and rebuild the image (see `docs/seed-data.md`) — otherwise the image drifts from the seed script.

Test accounts (`TEST_ADMIN`, `TEST_WAITER`, `TEST_KITCHEN`, see `tests/test-env.js` / `scripts/seed-emulator.js`): fixed, non-secret credentials, meaningless outside the ephemeral local emulator.

Notes:
- `tests/client-view.spec.js` / `tests/admin-login.spec.js` / `tests/staff-home.spec.js` / `tests/waiter-order.spec.js` / `tests/reservations.spec.js` / `tests/order-history.spec.js` / `tests/stats-dashboard.spec.js` / `tests/menu-settings.spec.js` / `tests/admin-menu-costs.spec.js` cover the public menu, staff login screens, and full authenticated flows (orders and kitchen ticket, reservations lifecycle, history, statistics, menu settings). The staff-area specs run on a 6" smartphone viewport (`test.use(PHONE)`, `tests/helpers/phone.js`); `tests/phone-app.spec.js` checks the phone app itself (no sideways scrolling, bottom navigation, order taking by taps, full-screen pages). A full-screen page (`SidePanel` `sheet`) makes the app underneath inert, but Playwright still sees it: look for controls inside the open `dialog` (`sheet()` in the helper). Assertions favor structure/role/text over hardcoded content.
- `tests/receipt-printing.spec.js` / `tests/escpos.spec.js` cover receipt and kitchen-ticket printing (print queue, till print station via a mocked `window.mdpDesktop`, ESC/POS output). `tests/till-sala.spec.js` covers the till interface (Tavoli, comanda, Storico, Prenotazioni, Menù, Statistiche) and `tests/till-client.spec.js` the till's menu/banners/login; they run in their own sequential Playwright projects (every till page is a print station). `tests/desktop-client.spec.js` launches the real Electron till client (`desktop-client/`) against a fake TCP printer; it is skipped unless `cd desktop-client && npm install && npx install-electron` has been run. Coverage checklist: `docs/stampa-scontrini.md`.
- `tests/firestore-cleanup.js` deletes test-created orders/reservations between tests within a run (parallel test isolation); the whole emulator is discarded after the run regardless.
- When adding a new UI feature, add or extend a spec in `tests/` alongside it.

# Telefono e cassa — regola obbligatoria

L'area staff si usa da **due tipi di dispositivo**, con **una sola interfaccia per funzione**:

- **telefono / browser**: l'app `PhoneApp.jsx` (barra in alto + barra delle sezioni in basso: Tavoli · Prenotazioni · Storico · Menù · Statistiche, niente Dashboard). `/cameriere` e `/prenotazioni` aprono la stessa app su quella sezione (`StaffHome.jsx`);
- **cassa** (client Windows `desktop-client/`, riconosciuta da `getDesktopBridge()` in `src/desktop.js`): `TillSala.jsx` (barra delle sezioni in alto + Tavoli/comanda).

Prenotazioni, Storico, Menù e Statistiche sono **la stessa schermata** sui due dispositivi (`TillReservations.jsx`, `TillHistory.jsx`, `TillMenu.jsx` + `MenuSettings.jsx`, `TillStats.jsx`): `useCompactLayout()` (`TillUi.jsx`) sceglie la disposizione — alla cassa elenco + barra laterale, sul telefono una colonna con la barra laterale che diventa una pagina intera (`SidePanel` con `sheet`). Solo la **Sala** (tavoli e comanda) ha due presentazioni, perché il gesto è diverso (cassa: schermo diviso con tastierino; telefono: piatti a riquadri e barra in basso): `Waiter.jsx` e `TillSala.jsx`, con i pezzi in comune in `OrderUi.jsx` (modifica riga, coperti, riquadro piatto, riga dello scontrino, preconto) e la logica in `sala-shared.jsx`. Non c'è più un'area Cucina (comande stampate), né l'editor classico del menù (ex `Admin.jsx`), né le vecchie schermate da telefono: non reintrodurre doppioni.

| Funzione | Telefono | Cassa | Logica condivisa |
|---|---|---|---|
| Sala, comanda, invio, chiusura, modifica riga | `Waiter.jsx` | `TillSala.jsx` | `sala-shared.jsx`, `orders.js`, `OrderUi.jsx` |
| Preconto e stampa | `OrderUi.jsx` > `ReceiptPanel` | `TillSala.jsx` (stampa diretta), `ReceiptPanel` nello Storico | `printJobs.js`, `usePrintJob.js`, `escpos.js` |
| Comanda per la cucina | `Waiter.jsx` | `TillSala.jsx` | `kitchenTicket.js`, `printJobs.js` |
| Storico | `TillHistory.jsx` | `TillHistory.jsx` | `orders.js` |
| Prenotazioni | `TillReservations.jsx` | `TillReservations.jsx` | `reservationsData.js` |
| Gestione menù e impostazioni | `TillMenu.jsx`, `MenuSettings.jsx` | `TillMenu.jsx`, `MenuSettings.jsx` | `menuEdit.js`, `menuCosts.js`, `menuBackup.js`, `menuPrint.js`, `staffData.js` |
| Statistiche | `TillStats.jsx` | `TillStats.jsx` | `statsData.js` |
| Zoom dell'interfaccia (solo telefono/tablet, vedi `docs/stampa-scontrini.md` §4.2) | `PhoneApp.jsx` > Zoom | — | `displayZoom.js` |

> 1. Ogni funzione o interazione nuova dell'area staff (un campo nuovo di un piatto, un'azione sulla comanda, un filtro…) deve funzionare **su entrambi i dispositivi** nello stesso intervento: nelle schermate condivise basta farla una volta (controllando entrambe le disposizioni), nella Sala va fatta in `Waiter.jsx` e in `TillSala.jsx`. Se una funzione deve esistere solo da una parte, dillo esplicitamente nel riepilogo all'utente e scrivilo in `docs/stampa-scontrini.md` §4.1.
> 2. La logica (dati, regole, calcoli, scritture su Firestore) sta nei moduli condivisi della colonna a destra, mai duplicata nei componenti, che cambiano solo la presentazione. Le modifiche al menù si salvano una alla volta con `onPatch` (MenuApp.jsx > `handlePatch`, una transazione sul menù com'è sul server) e scrivono solo i campi cambiati; un campo nuovo del menù passa da `menuEdit.js`; aggiorna anche `scripts/seed-emulator.js` (se serve per i test) e `docs/data-model.md`.
> 3. Stessi principi ovunque, quelli di `TillUi.jsx` (dettagli in `docs/stampa-scontrini.md` §4.1–4.2): bersagli touch ≥ 48px, etichette di testo sempre visibili, stato mai affidato al solo colore (palette fissa `STATUS`), modifiche che si applicano solo con "Salva", conferma (`confirmAction`) prima delle azioni irreversibili, tastierino a schermo per i numeri alla cassa, nessun "Esci" alla cassa. Sul telefono in più: azione principale in basso (barra fissa o "Salva" in fondo alla pagina), sezioni nella barra in basso, pagine intere invece di finestre sovrapposte, nessuno scorrimento laterale a 393px. Usa i componenti di `TillUi.jsx` invece di stili nuovi: nessuna schermata deve avere un aspetto diverso dalle altre.
> 4. Test: almeno un test E2E sul telefono (progetto `chromium`, `test.use(PHONE)`) e uno alla cassa (`tests/till-sala.spec.js`, con `installDesktopBridgeMock`), più la riga nella matrice di copertura di `docs/stampa-scontrini.md` §7.

# Contract testing E2E — regola obbligatoria

> 1. Durante lo sviluppo esegui i test della parte toccata (`npm run test:e2e:changed`); prima di considerare completata qualsiasi implementazione che tocchi l'interfaccia utente, esegui l'intera suite E2E (`npm run test:e2e`). Se per un motivo eccezionale non la esegui, specifica quali test sono stati eseguiti e perché non l'intera suite.
> 2. Se un test fallisce dopo una modifica:
>    - **(a)** Analizza se il fallimento è dovuto a un cambiamento intenzionale dell'interfaccia/comportamento (la modifica richiesta ha legittimamente cambiato il contratto). In questo caso aggiorna il test, spiegando esplicitamente cosa è cambiato e perché, mostrando il diff minimo necessario.
>    - **(b)** Se invece il fallimento rivela una regressione o un bug introdotto dall'implementazione appena fatta, **non modificare il test per farlo passare**. Segnala il problema, fermati e chiedi conferma su come procedere prima di continuare.
>    - **(c)** In caso di dubbio tra (a) e (b), tratta il fallimento come potenziale bug (opzione b) finché non c'è conferma esplicita che si tratti di un cambiamento intenzionale.
> 3. Ogni nuova funzionalità o interazione UI aggiunta deve essere accompagnata da almeno un test E2E corrispondente prima di considerare la feature completa. Nessuna funzionalità va considerata "fatta" senza il relativo contract test.
> 4. Non eliminare o disabilitare test esistenti senza segnalarlo esplicitamente e motivarlo (es. funzionalità rimossa — non "test che dava fastidio").
> 5. Mantieni la matrice di copertura aggiornata: se una modifica introduce nuovi stati o interazioni, aggiorna la checklist di copertura, non solo il codice dei test.

# Test dell'interfaccia per ogni nuova funzionalità — regola obbligatoria

> 1. **Ogni nuova funzionalità** (o modifica di comportamento) dell'interfaccia va consegnata **insieme ai test E2E** Playwright che la validano. Senza test la funzionalità non è finita, e non si fa commit né push.
> 2. I test coprono i **casi principali e significativi dell'interazione**, non solo "la pagina si apre":
>    - il percorso felice completo (es. aggiungere un piatto → inviare → vederlo nella comanda);
>    - le varianti che cambiano il risultato (es. quantità, prezzo offerto/scontato, nota, rimozione);
>    - gli stati vuoti e di errore (nessun risultato, campo obbligatorio mancante, salvataggio fallito, dato cancellato da un altro dispositivo);
>    - le conferme prima delle azioni irreversibili (chiudere un tavolo, eliminare);
>    - la persistenza quando conta (dopo un ricaricamento o visto da un'altra sessione).
> 3. **Telefono:** per le schermate dell'area staff da telefono, almeno un test gira con viewport da smartphone 6" (393×851: `test.use(PHONE)` da `tests/helpers/phone.js`, vedi `tests/phone-app.spec.js`) e verifica che non ci sia scorrimento laterale e che i comandi principali siano ≥ 48px e raggiungibili (barra in basso / "Salva" in fondo). **Cassa:** test in `tests/till-sala.spec.js` con `installDesktopBridgeMock` (vedi la regola "Telefono e cassa").
> 4. Selettori per ruolo/etichetta accessibile e testo visibile (`getByRole`, `getByLabel`), non per classi CSS o struttura del DOM: così i test descrivono l'interazione dell'utente e restano validi se cambia solo lo stile.
> 5. Ogni bug corretto nell'interfaccia riceve un test che lo riproduce (fallisce prima della correzione, passa dopo), per evitare che ritorni.
> 6. Aggiorna la matrice di copertura in `docs/stampa-scontrini.md` §7 con le nuove righe.

# Deploy — firestore.rules

`.github/workflows/firebase-hosting-merge.yml` deploys to the real Firebase project on every push to `main`. It builds and deploys **hosting** (`FirebaseExtended/action-hosting-deploy`), and then a separate step deploys **Firestore rules** (`npx firebase-tools deploy --only firestore:rules`, authenticated via the same `FIREBASE_SERVICE_ACCOUNT_MENU_MASSERIA_DELLA_PIAN` secret written to a temp file and passed as `GOOGLE_APPLICATION_CREDENTIALS`). Both steps run automatically — you don't need to deploy manually after a merge to `main`.

Whenever a change touches `firestore.rules` (a new collection, a widened/narrowed rule, a new `match` block), **call this out explicitly** in your summary to the user: say what changed in the rules and confirm it will go out with the next merge to `main` via that workflow. If you need it live *before* a merge (e.g. testing against the real project, or an out-of-band hotfix), it must be deployed by hand with `firebase deploy --only firestore:rules` (Firebase CLI, authenticated) — flag that explicitly too, since Claude Code cannot run this itself (no local Firebase CLI login).

Why this matters: rules changes are easy to miss because they cause no build error and no local-emulator symptom — `npm run test:e2e` runs entirely against the emulator, which loads `firestore.rules` fresh from the repo on every run, so a rule that was never actually deployed to production still looks "tested and green" locally. The failure mode is a silent `permission-denied` on the real project only, often surfacing much later as a UI element that inexplicably stays disabled/empty (e.g. `menuCosts/data` was added to `firestore.rules` in commit `5283d94` but the deploy workflow at the time only published hosting, not rules — the "Costo interno" field in Admin.jsx stayed disabled in production because `subscribeMenuCosts` kept getting denied and `menuCosts` never left its initial `null`, with nothing surfaced beyond a `console.error`).

# Working directory

This repo is sometimes open in more than one Claude Code session at once. Before deleting or reverting files that look like unfamiliar scaffolding (especially untracked ones), check `git log`/recent activity or ask — a sibling session may be mid-task. If you find conflicting concurrent edits, use `ListAgents`/`SendMessage` to coordinate before cleaning anything up.
