# Masseria della Piana — Digital Menu

A React + Firebase digital menu for an Italian countryside restaurant
(agriturismo): a public multi-language menu for customers, plus a
restricted staff area for menu management, digital order taking
(waiter/kitchen), table reservations, and sales statistics.

This README is the technical entry point for developers. For other
audiences:
- [`GUIDA.md`](GUIDA.md) (Italian) — non-technical setup guide for the
  restaurant owner, covering the real Firebase project, Cloudinary, and
  deployment.
- [`CLAUDE.md`](CLAUDE.md) — project conventions for AI coding agents
  (testing, deploy pipeline, concurrent-session etiquette).
- [`ROADMAP.md`](ROADMAP.md) (Italian) — backlog of planned improvements.
- [`docs/architecture.md`](docs/architecture.md) — module map and the
  reasoning behind the current architecture.
- [`docs/data-model.md`](docs/data-model.md) — the Firestore schema.
- [`docs/comande-camerieri.md`](docs/comande-camerieri.md) and
  [`docs/prenotazioni.md`](docs/prenotazioni.md) (Italian) — detailed design
  docs for the order-taking and reservations features.

## Stack

- **React 18** + **Vite** — no framework/router beyond a hand-rolled
  `useUrlState` hook (see `src/shared.jsx`) that syncs a couple of pieces of
  UI state with the URL query string.
- **Firestore** (realtime listeners, persistent local cache) for all data;
  **Firebase Authentication** (email/password) for the staff area.
- **Cloudinary** for dish photo uploads (unsigned, client-side).
- **Playwright** for end-to-end tests, run against a local, containerized
  Firebase emulator — never against the real project.
- Plain JavaScript throughout (no TypeScript), plain inline styles (no CSS
  framework) — see `src/shared.jsx`'s `THEMES`/`TYPE`/`SPACE` tokens for the
  design system.

## Setup

```
npm install
```

To run against a real Firebase project, copy `.env.example` to `.env` and
fill in the Firebase and Cloudinary values (see `GUIDA.md` for how to
obtain them), then:

```
npm run dev
```

To run locally with **no real Firebase project** (a local, containerized
emulator seeded with demo data — useful for trying the app without
credentials, e.g. for a portfolio demo), you need Docker running:

```
npm run dev:local
```

## Common commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server against the Firebase project configured in `.env`. |
| `npm run dev:local` | Start the local Firebase emulator (Docker) + dev server, no `.env` needed. |
| `npm run build` | Production build (`vite build`) into `dist/`. |
| `npm run lint` | ESLint (see `eslint.config.js`). |
| `npm run test:e2e` | Full Playwright suite — self-contained, starts/seeds/tears down the emulator automatically. Requires Docker. |
| `npm run test:e2e:ui` | Playwright in interactive UI mode. |
| `npm run emulators:up` / `emulators:down` | Start/stop the emulator container directly. |
| `npm run seed:emulator` | (Re-)seed the running emulator with demo data — idempotent. |

See [`CLAUDE.md`](CLAUDE.md) for the full testing workflow, including when
to run the suite and how to handle a failing test after a change.

## Project structure

```
src/
  MenuApp.jsx        # app shell: routing (URL path/query), menu loading, save/undo
  ClientView.jsx      # public menu (no Firebase Auth import — kept light)
  Admin.jsx            # menu management panel (lazy-loaded, includes Firebase Auth)
  StaffHome.jsx         # staff landing page / dashboard, role-based area picker
  Waiter.jsx, Kitchen.jsx, Reservations.jsx, Stats.jsx  # staff areas
  OrderHistory.jsx, ReceiptOverlay.jsx, PrintMenu.jsx    # shared staff UI
  shared.jsx, staff-shared.jsx   # cross-cutting UI/data helpers, no Firebase (shared.jsx) vs. auth+role (staff-shared.jsx)
  orders.js, reservationsData.js, statsData.js, menuCosts.js  # Firestore data layer, one module per domain
  firebase-db.js, firebase-auth.js, cloudinary.js  # external service clients
docs/            # design docs and this technical documentation
scripts/         # emulator seeding/export scripts
tests/           # Playwright E2E specs + fixtures
seed-data/       # baked-in emulator snapshot (see docs/seed-data.md)
```

See [`docs/architecture.md`](docs/architecture.md) for how these fit
together and why the app stays a single deployable instead of being split
up.

## Deployment

Hosting and Firestore rules deploy automatically on every push to `main`
via `.github/workflows/firebase-hosting-merge.yml`. See the "Deploy —
firestore.rules" section in [`CLAUDE.md`](CLAUDE.md) for details, including
the one gotcha to know about (a rules change needs that workflow to run at
least once before it's live — nothing local can catch a rule that was
never deployed).
