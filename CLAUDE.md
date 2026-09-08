# Testing

This project uses Playwright for end-to-end contract tests, run against a **local Firebase emulator** (Auth + Firestore, containerized — see `docker-compose.emulator.yml`), never against the real production project. Tests live in `tests/*.spec.js` and are plain JavaScript (the app itself has no TypeScript).

After implementing or changing a UI feature (`ClientView.jsx`, `Admin.jsx`, `Waiter.jsx`, `Kitchen.jsx`, `Reservations.jsx`, `OrderHistory.jsx`, `PrintMenu.jsx`, `ReceiptOverlay.jsx`, `StaffHome.jsx`, `shared.jsx`, `staff-shared.jsx`, `MenuApp.jsx`), verify it yourself before considering the task done:

```
npm run test:e2e       # headless run — self-contained, starts/seeds/tears down the emulator automatically
npm run test:e2e:ui    # interactive UI mode, useful while iterating
```

Requires Docker running (`docker` CLI available). `playwright.config.js`'s `globalSetup`/`globalTeardown` start the emulator container, seed it with demo data (`scripts/seed-emulator.js`), and start `npm run dev` against it (`webServer` with `VITE_USE_FIREBASE_EMULATOR=true`) — no `.env` or real Firebase credentials needed to run the suite.

For manual local development against the same emulator (e.g. to try the app without a real Firebase project — useful for a portfolio demo), use `npm run dev:local` instead of `npm run dev`.

The emulator container starts already populated — `Dockerfile.emulator` bakes in a snapshot (`seed-data/`, imported via `--import` on `firebase emulators:start`) with the demo menu and test accounts, so `docker compose -f docker-compose.emulator.yml up` alone never leaves the local menu empty, even without running `npm run seed:emulator` separately. That script still runs automatically in `test:e2e`/`dev:local` as an idempotent safety net. If you change the demo menu's shape in `scripts/seed-emulator.js`, regenerate the baked-in snapshot with `npm run seed:export` and rebuild the image (see `docs/seed-data.md`) — otherwise the image drifts from the seed script.

Test accounts (`TEST_ADMIN`, `TEST_WAITER`, `TEST_KITCHEN`, see `tests/test-env.js` / `scripts/seed-emulator.js`): fixed, non-secret credentials, meaningless outside the ephemeral local emulator.

Notes:
- `tests/client-view.spec.js` / `tests/admin-login.spec.js` / `tests/kitchen-view.spec.js` / `tests/waiter-order.spec.js` / `tests/reservations.spec.js` cover the public menu, staff login screens, and full authenticated flows (waiter↔kitchen realtime order handling, reservations lifecycle). Assertions favor structure/role/text over hardcoded content.
- `tests/firestore-cleanup.js` deletes test-created orders/reservations between tests within a run (parallel test isolation); the whole emulator is discarded after the run regardless.
- When adding a new UI feature, add or extend a spec in `tests/` alongside it.

# Contract testing E2E — regola obbligatoria

> 1. Prima di considerare completata qualsiasi implementazione che tocchi l'interfaccia utente, esegui l'intera suite di test E2E Playwright — o quantomeno i test relativi alle funzionalità toccate, se la suite è molto ampia e serve un'esecuzione mirata per motivi di tempo. In tal caso specifica quali test sono stati eseguiti e perché non l'intera suite.
> 2. Se un test fallisce dopo una modifica:
>    - **(a)** Analizza se il fallimento è dovuto a un cambiamento intenzionale dell'interfaccia/comportamento (la modifica richiesta ha legittimamente cambiato il contratto). In questo caso aggiorna il test, spiegando esplicitamente cosa è cambiato e perché, mostrando il diff minimo necessario.
>    - **(b)** Se invece il fallimento rivela una regressione o un bug introdotto dall'implementazione appena fatta, **non modificare il test per farlo passare**. Segnala il problema, fermati e chiedi conferma su come procedere prima di continuare.
>    - **(c)** In caso di dubbio tra (a) e (b), tratta il fallimento come potenziale bug (opzione b) finché non c'è conferma esplicita che si tratti di un cambiamento intenzionale.
> 3. Ogni nuova funzionalità o interazione UI aggiunta deve essere accompagnata da almeno un test E2E corrispondente prima di considerare la feature completa. Nessuna funzionalità va considerata "fatta" senza il relativo contract test.
> 4. Non eliminare o disabilitare test esistenti senza segnalarlo esplicitamente e motivarlo (es. funzionalità rimossa — non "test che dava fastidio").
> 5. Mantieni la matrice di copertura aggiornata: se una modifica introduce nuovi stati o interazioni, aggiorna la checklist di copertura, non solo il codice dei test.

# Working directory

This repo is sometimes open in more than one Claude Code session at once. Before deleting or reverting files that look like unfamiliar scaffolding (especially untracked ones), check `git log`/recent activity or ask — a sibling session may be mid-task. If you find conflicting concurrent edits, use `ListAgents`/`SendMessage` to coordinate before cleaning anything up.
