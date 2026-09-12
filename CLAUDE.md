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

# Deploy — firestore.rules

`.github/workflows/firebase-hosting-merge.yml` deploys to the real Firebase project on every push to `main`. It builds and deploys **hosting** (`FirebaseExtended/action-hosting-deploy`), and then a separate step deploys **Firestore rules** (`npx firebase-tools deploy --only firestore:rules`, authenticated via the same `FIREBASE_SERVICE_ACCOUNT_MENU_MASSERIA_DELLA_PIAN` secret written to a temp file and passed as `GOOGLE_APPLICATION_CREDENTIALS`). Both steps run automatically — you don't need to deploy manually after a merge to `main`.

Whenever a change touches `firestore.rules` (a new collection, a widened/narrowed rule, a new `match` block), **call this out explicitly** in your summary to the user: say what changed in the rules and confirm it will go out with the next merge to `main` via that workflow. If you need it live *before* a merge (e.g. testing against the real project, or an out-of-band hotfix), it must be deployed by hand with `firebase deploy --only firestore:rules` (Firebase CLI, authenticated) — flag that explicitly too, since Claude Code cannot run this itself (no local Firebase CLI login).

Why this matters: rules changes are easy to miss because they cause no build error and no local-emulator symptom — `npm run test:e2e` runs entirely against the emulator, which loads `firestore.rules` fresh from the repo on every run, so a rule that was never actually deployed to production still looks "tested and green" locally. The failure mode is a silent `permission-denied` on the real project only, often surfacing much later as a UI element that inexplicably stays disabled/empty (e.g. `menuCosts/data` was added to `firestore.rules` in commit `5283d94` but the deploy workflow at the time only published hosting, not rules — the "Costo interno" field in Admin.jsx stayed disabled in production because `subscribeMenuCosts` kept getting denied and `menuCosts` never left its initial `null`, with nothing surfaced beyond a `console.error`).

# Working directory

This repo is sometimes open in more than one Claude Code session at once. Before deleting or reverting files that look like unfamiliar scaffolding (especially untracked ones), check `git log`/recent activity or ask — a sibling session may be mid-task. If you find conflicting concurrent edits, use `ListAgents`/`SendMessage` to coordinate before cleaning anything up.

# Bot Telegram (bot/)

`bot/` is a separate Cloudflare Worker subproject (its own `package.json`, no shared dependencies with the root app) implementing the staff Telegram chatbot — see `docs/telegram-bot.md` for the full design and account setup. It has no React UI, so it's outside the Playwright rule above; it has its own Vitest suite instead:

```
cd bot && npm test
```

After changing anything under `bot/src/`, run that suite before considering the change done, same spirit as the Playwright rule for the main app: a new tool or behavior gets a test, a failing test is either an intentional contract change (update the test, say why) or a regression (stop and ask, don't rewrite the test to pass).
