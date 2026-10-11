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
  (`staff/{uid}.role`). It has two presentations — see "Phone and till"
  below.

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

## Phone and till: one staff area, two presentations

The staff area runs on waiters' phones (mobile-first screens:
`Waiter.jsx`, `Reservations.jsx`, `OrderHistory.jsx`, `ReceiptOverlay.jsx`,
`Admin.jsx`, `Stats.jsx`) and on the 12" touch till, inside the Windows
client (`desktop-client/`, detected through `window.mdpDesktop`, see
`src/desktop.js`). At the till `StaffHome.jsx` skips the phone Dashboard and
renders `TillSala.jsx`: one full-screen POS with fixed sections in the top
bar — Tavoli, Prenotazioni, Storico and, for admins, Menù and Statistiche
(`TillReservations.jsx`, `TillHistory.jsx`, `TillMenu.jsx`,
`TillStats.jsx`), all built from `TillUi.jsx`.

Both presentations share every rule and every write: `sala-shared.jsx`
(open tables, draft, send + kitchen ticket, close), `orders.js`,
`reservationsData.js`, `menuEdit.js`, `printJobs.js`/`usePrintJob.js`,
`statsData.js`. Only layout and interaction differ, which is why a new
staff feature has to be added to both (`CLAUDE.md`, "Telefono e cassa").

Printing: browsers can't reach the thermal printer, so every device writes
a job to `printJobs` (receipt on "Stampa", kitchen ticket on "Invia
comanda") and the till's print station (`PrintStation.jsx`, mounted only in
the client) claims it in a transaction, renders it with `escpos.js` and
sends the bytes through the client. See `docs/stampa-scontrini.md`.

## Bundle-size strategy: lazy-loading by area

The public menu is the highest-traffic, most latency-sensitive part of the
app (customers on a restaurant's often-weak wifi), so a lot of the
structure exists purely to keep its bundle small:

- `firebase-db.js` (Firestore only) is imported everywhere; `firebase-auth.js`
  (Firebase Auth, a heavier module) is only imported once a user clicks
  "Gestione menù" or lands on a staff route.
- `StaffHome.jsx`, `Waiter.jsx` and `Reservations.jsx` are
  `React.lazy()`-loaded from `MenuApp.jsx`, and `StaffHome.jsx` in turn
  lazy-loads each area (`Admin.jsx`, `Stats.jsx` with Recharts, the till's
  `TillSala.jsx`…) only when it's opened — a customer who never opens the
  staff area never downloads any of that code, and a waiter or the till
  never download the charts library unless someone opens Statistiche on a
  phone (see the `vite build` chunk list: every area is its own chunk).
- `shared.jsx` (themes, translation utilities, small components — no
  Firebase import) is shared by both halves; `staff-shared.jsx` (login,
  role check — imports `firebase-auth.js`) is only used by the staff areas.

## Routing

There's no router library. `MenuApp.jsx` reads `window.location.pathname`
and `?area=`/`?sezione=` query params directly:

- `/`, or any other path — the public menu, unless `?area=staff` is set.
- `/cameriere` or `/waiter` — `Waiter.jsx` directly (bookmarkable, e.g. for
  a dedicated tablet).
- `/prenotazioni` or `/reservations` — `Reservations.jsx` directly.
- `?area=staff` — `StaffHome.jsx`, which after login shows a dashboard of
  the areas the signed-in account's role grants access to
  (`?sezione=admin|waiter|kitchen|reservations|stats`), or jumps straight
  into the one area a single-role account can reach. At the till (Windows
  client) it goes straight to `TillSala.jsx` instead, with `?sezione`
  only choosing the first section shown.
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
| `menuCosts.js` | `menuCosts/data` | Admin/TillMenu (editing), Sala (snapshotting cost onto order lines), Stats (margin) |
| `printJobs.js` (+ `kitchenTicket.js`, `escpos.js`) | `printJobs/{id}` | ReceiptOverlay, Till screens, Sala send (kitchen ticket), PrintStation |

`menu/data` itself has no dedicated data-layer module — `MenuApp.jsx` reads
and writes it directly (it's the one document the whole app's state
machine is built around: undo stack, save/error state, etc. all live
there). Two ways to write it:

- `handleSave` — the Admin editor's draft, saved as a whole with "Salva
  modifiche" (undo stack, unsaved-changes state);
- `handlePatch` — one edit from `menuEdit.js` (a dish, a category…), used by
  the till's `TillMenu.jsx`: applied in a Firestore transaction to the
  document as it is on the server right now, then to the local copy — the
  till stays open all day and must never write back a stale whole menu.

While there are no unsaved Admin edits, the staff area follows the menu
live (prices and dishes changed from another device show up without a
reload); with unsaved edits it stops following, so they aren't
overwritten.

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
