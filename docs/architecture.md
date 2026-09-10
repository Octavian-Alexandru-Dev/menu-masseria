# Architecture

## Overview

This is a single-page React app talking directly to Firestore/Firebase
Auth — no backend server of its own. It has two halves that are kept
deliberately separate for bundle-size reasons (see below):

- **Public menu** (`ClientView.jsx`): what customers see. No login, no
  Firebase Authentication import, multi-language (pre-generated
  translations, no runtime API calls — see "Translations" below).
- **Staff area** (`StaffHome.jsx` and everything under it): menu
  management, order taking, kitchen display, reservations, sales stats.
  Gated behind Firebase Auth + a role stored in Firestore
  (`staff/{uid}.role`).

`src/MenuApp.jsx` is the app shell: it decides which of the two (or which
staff sub-area) to render, based on the URL path and query string — see
"Routing" below.

## Why a single app, not several services

`docs/comande-camerieri.md` (§2) and `docs/prenotazioni.md` (§2) both make
this call explicitly when the order-taking and reservations features were
added: every staff area needs to read the menu (`menu/data`) in real time,
and duplicating that data into a separate service would let it drift out
of sync (e.g. a dish marked unavailable in the menu but still orderable
from a stale copy). Keeping one Firebase project and one React app means
every area reads the same source of truth via the same `onSnapshot`
listeners.

The areas are still cleanly separated at the module level (see below), so
splitting later remains possible if a real scaling need ever appears — but
nothing in the current usage pattern (a single restaurant, realtime data
that's all read from the same handful of Firestore collections) asks for
it.

## Bundle-size strategy: lazy-loading by area

The public menu is the highest-traffic, most latency-sensitive part of the
app (customers on a restaurant's often-weak wifi), so a lot of the
structure exists purely to keep its bundle small:

- `firebase-db.js` (Firestore only) is imported everywhere; `firebase-auth.js`
  (Firebase Auth, a heavier module) is only imported once a user clicks
  "Gestione menù" or lands on a staff route.
- `Admin.jsx`, `Waiter.jsx`, `Kitchen.jsx`, `Reservations.jsx`, `Stats.jsx`
  and `StaffHome.jsx` are all `React.lazy()`-loaded from `MenuApp.jsx` — a
  customer who never opens the staff area never downloads any of that code
  (see the `vite build` chunk list: `Kitchen`, `Waiter`, `Reservations`,
  etc. are all separate chunks).
- `shared.jsx` (themes, translation utilities, small components — no
  Firebase import) is shared by both halves; `staff-shared.jsx` (login,
  role check — imports `firebase-auth.js`) is only used by the staff areas.

## Routing

There's no router library. `MenuApp.jsx` reads `window.location.pathname`
and `?area=`/`?sezione=` query params directly:

- `/`, or any other path — the public menu, unless `?area=staff` is set.
- `/cameriere` or `/waiter` — `Waiter.jsx` directly (bookmarkable, e.g. for
  a dedicated tablet).
- `/cucina` or `/kitchen` — `Kitchen.jsx` directly (same reasoning, for a
  fixed kitchen screen).
- `/prenotazioni` or `/reservations` — `Reservations.jsx` directly.
- `?area=staff` — `StaffHome.jsx`, which after login shows a dashboard of
  the areas the signed-in account's role grants access to
  (`?sezione=admin|waiter|kitchen|reservations|stats`), or jumps straight
  into the one area a single-role account can reach.
- `?print=1` — `PrintMenu.jsx`, opened by the Admin panel in a new tab; it
  reads the menu from `sessionStorage` rather than Firestore, so it can
  also preview unsaved edits.

`useUrlState` (`src/shared.jsx`) is the one piece of routing infrastructure
that exists: it syncs a single piece of state with one query-string
parameter and the browser's history (so Back/Forward work), used for both
`?area=` and `?sezione=`.

## Data layer

One module per Firestore domain, each exporting subscribe/read/write
functions and no UI:

| Module | Collection(s) | Consumed by |
|---|---|---|
| `orders.js` | `orders/{orderId}` | Waiter, Kitchen, OrderHistory, Stats (via `statsData.js`) |
| `reservationsData.js` | `reservations/{id}` | Reservations, Waiter (today's reservations), StaffHome (pending count) |
| `statsData.js` | reads `orders` via `orders.js`, no writes | Stats |
| `menuCosts.js` | `menuCosts/data` | Admin (editing), Waiter (snapshotting cost onto order lines), Stats (margin) |

`menu/data` itself has no dedicated data-layer module — `MenuApp.jsx` reads
and writes it directly (it's the one document the whole app's state
machine is built around: undo stack, save/error state, etc. all live
there).

See [`docs/data-model.md`](data-model.md) for the full schema.

## Translations

Customer-facing multi-language support (`src/shared.jsx`:
`generateMissingTranslations`, `applyTranslation`) is pre-generated, not
live-translated: the admin triggers translation generation (via the free
MyMemory API) from the Admin panel, reviews/corrects it, and saves it into
`menu.translations[lang]`. The public menu never calls a translation API —
it just picks which pre-translated text to render from data it already
downloaded, so switching language is instant and works offline.

## Testing

End-to-end only (Playwright), against a local Firestore/Auth emulator that
`playwright.config.js`'s `globalSetup` starts, seeds, and tears down
automatically — never against the real Firebase project. See
[`CLAUDE.md`](../CLAUDE.md) for the full workflow and when to run it.
