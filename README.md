# Masseria della Piana — Digital Menu

A React + Firebase digital menu for a real restaurant (Masseria della Piana,
an agriturismo in Candidoni, RC): a public multi-language menu for
customers, plus a restricted staff area for menu management, digital order
taking (waiter/kitchen), table reservations, and sales statistics.

Built as freelance work and running in production — used daily by the
restaurant for the customer-facing menu and for internal order and
reservation management.

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
- [`docs/telegram-bot.md`](docs/telegram-bot.md) (Italian) — design doc and
  account setup procedure for the Telegram chatbot (`bot/`), a separate
  Cloudflare Worker that lets staff manage the menu/orders via chat.

## Live demo

- **Public menu:** [menu.masseria-della-piana.it](https://menu.masseria-della-piana.it/)
- **Restaurant landing page:** [masseria-della-piana.it](https://www.masseria-della-piana.it/)

These are the real production environments. Staff-only areas (order
taking, kitchen, reservations, admin) require staff credentials and aren't
publicly accessible — to try them without access to the real project, see
[Try it locally](#try-it-locally-no-real-credentials-needed) below.

## Features

- **Multilingual public menu** (IT/EN/ES/DE/FR): translations are generated
  once from the admin panel (editable by hand) and read by the client with
  no network call on language switch.
- **Real-time order flow**: the waiter sends the order from their device,
  the kitchen sees it appear instantly (`Waiter.jsx` ↔ `Kitchen.jsx`,
  synced via Firestore).
- **Table reservations** with a dedicated staff view (`Reservations.jsx`).
- **Admin panel**: menu editor with drag & drop category/dish reordering,
  translation management, a configurable printable PDF export (language,
  images, columns, page size), JSON export/import for backups, and undo for
  up to 20 actions.
- **Sales and usage statistics** for staff (`Stats.jsx`, charts via
  Recharts).
- **SEO**: meta tags, Open Graph/Twitter Card, `schema.org/Restaurant`
  structured data, sitemap.

## Stack

- **React 18** + **Vite** — no framework/router beyond a hand-rolled
  `useUrlState` hook (see `src/shared.jsx`) that syncs a couple of pieces of
  UI state with the URL query string.
- **Firestore** (realtime listeners, persistent local cache) for all data;
  **Firebase Authentication** (email/password) for the staff area.
- **Cloudinary** for dish photo uploads (unsigned, client-side).
- **Recharts** for the staff statistics dashboard.
- **Playwright** for end-to-end tests, run against a local, containerized
  Firebase emulator — never against the real project.
- Plain JavaScript throughout (no TypeScript), plain inline styles (no CSS
  framework) — see `src/shared.jsx`'s `THEMES`/`TYPE`/`SPACE` tokens for the
  design system.

## Try it locally (no real credentials needed)

The app runs entirely against a containerized Firebase emulator,
pre-seeded with a demo menu and test staff accounts — no real Firebase
project required:

```bash
npm install
docker compose -f docker-compose.emulator.yml up -d --wait   # Firestore + Auth emulator, pre-seeded
npm run dev:local
```

Open the URL printed in the console. Staff accounts available in the
emulator (fixed, non-sensitive credentials — valid only locally, seeded by
`scripts/seed-emulator.js`):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@test.local` | `Test1234!` |
| Waiter | `waiter@test.local` | `Test1234!` |
| Kitchen | `kitchen@test.local` | `Test1234!` |

## Developing against the real Firebase project

To run `npm run dev` (not the emulator) you need a `.env` file with the
Firebase and Cloudinary config — see `GUIDA.md` for how to get these
values from the Firebase console. If you have access to the
`Menu-masseria` Bitwarden Secrets Manager project (see
`.bws-token.example`), `scripts/bws-env.sh` generates `.env` for you
instead of copying `.env.example` by hand.

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
scripts/         # emulator seeding/export scripts, Bitwarden env generation
tests/           # Playwright E2E specs + fixtures
seed-data/       # baked-in emulator snapshot (see docs/seed-data.md)
```

See [`docs/architecture.md`](docs/architecture.md) for how these fit
together and why the app stays a single deployable instead of being split
up.

## Deployment

On every push to `main`, GitHub Actions automatically publishes the app to
Firebase Hosting and updates Firestore security rules
(`.github/workflows/firebase-hosting-merge.yml`) — see the "Deploy —
firestore.rules" section in [`CLAUDE.md`](CLAUDE.md) for a gotcha worth
knowing (a rules change needs that workflow to run at least once before
it's live). The landing page (static, `landing_page/` folder) is published
separately via FTP to the Tophost hosting for the main domain, through a
local `pre-push` git hook (`.githooks/pre-push` +
`scripts/ftp-deploy-landing.sh`) — never from CI, since Tophost blocks FTP
from GitHub Actions runner IPs. Like the app's own `.env` (see
[Developing against the real Firebase project](#developing-against-the-real-firebase-project)),
the hook pulls the Tophost FTP credentials from the `Menu-masseria`
Bitwarden Secrets Manager project when `.bws-token` is present, falling
back to a local `.ftp-credentials` file otherwise (format in
`.ftp-credentials.example`).

Full operational documentation, written for the restaurant owner (no
technical prerequisites): [`GUIDA.md`](GUIDA.md).
