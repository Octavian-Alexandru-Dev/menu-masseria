# Architecture

## Overview

This is a single-page React app talking directly to Firestore/Firebase
Auth — no backend server of its own. It has two halves that are kept
deliberately separate for bundle-size reasons (see below):

- **Public menu** (`ClientView.jsx`): what customers see. No login, no
  Firebase Authentication import, multi-language (pre-generated
  translations, no runtime API calls — see "Translations" below).
- **Staff area** (`StaffHome.jsx` and everything under it): order taking,
  reservations, history, menu management, sales stats. Gated behind
  Firebase Auth + a role stored in Firestore (`staff/{uid}.role`). One
  interface per function, laid out for the phone or for the till — see
  "Phone and till" below.

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

## Phone and till: one staff area, one interface per function

The staff area runs on waiters' phones and on the 12" touch till, inside
the Windows client (`desktop-client/`, detected through `window.mdpDesktop`,
see `src/desktop.js`). `StaffHome.jsx` signs in and checks the role, then:

- on a phone (or any other browser) renders `PhoneApp.jsx`: one app with a
  bottom navigation bar (Tavoli, Prenotazioni, Storico and, for admins,
  Menù and Statistiche);
- at the till renders `TillSala.jsx`: a full-screen POS with the same
  sections in its top bar.

Prenotazioni, Storico, Menù (+ its settings) and Statistiche are the very
same components on both (`TillReservations.jsx`, `TillHistory.jsx`,
`TillMenu.jsx` + `MenuSettings.jsx`, `TillStats.jsx`): `useCompactLayout()`
(`TillUi.jsx`) picks the layout — list + side panel at the till, one
column on a phone with the side panel opening as a full-screen page
(`SidePanel` with `sheet`, which also makes the app underneath inert).
Only Tavoli and the order screen have two presentations, because the
gesture differs (`Waiter.jsx` on phones, `TillSala.jsx` at the till),
built from the same pieces (`OrderUi.jsx`: line editor, covers, dish tile,
ticket line, receipt page).

Every rule and every write is shared: `sala-shared.jsx` (open tables,
draft, send + kitchen ticket, line edits, close), `orders.js`,
`reservationsData.js`, `menuEdit.js`, `menuBackup.js`, `menuPrint.js`,
`staffData.js`, `printJobs.js`/`usePrintJob.js`, `statsData.js` (see
`CLAUDE.md`, "Telefono e cassa").

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
- `StaffHome.jsx` is `React.lazy()`-loaded from `MenuApp.jsx`, and in
  turn lazy-loads `PhoneApp.jsx` or `TillSala.jsx`, which lazy-load each
  section only when it's opened — a customer who never opens the staff
  area never downloads any of that code (see the `vite build` chunk list:
  every section is its own chunk). There's no charts library: statistics
  are plain lists with bars.
- `shared.jsx` (themes, translation utilities, small components — no
  Firebase import) is shared by both halves; `staff-shared.jsx` (login,
  role check — imports `firebase-auth.js`) is only used by the staff areas.

## Routing

There's no router library. `MenuApp.jsx` reads `window.location.pathname`
and `?area=`/`?sezione=` query params directly:

- `/`, or any other path — the public menu, unless `?area=staff` is set.
- `?area=staff` — `StaffHome.jsx`: after login the staff app opens on
  Tavoli; the section is kept in `?sezione=waiter|reservations|history|admin|stats`
  (Back button and reload stay on it). At the till (Windows client) the
  same, inside `TillSala.jsx`.
- `/cameriere` or `/waiter`, `/prenotazioni` or `/reservations` — the same
  staff area, opened on Tavoli / Prenotazioni (bookmarkable, e.g. for a
  dedicated tablet).
- `?print=1` — `PrintMenu.jsx`, opened in a new tab by the menu settings
  ("Stampa del menù", `menuPrint.js`); it reads the menu prepared in
  `sessionStorage` rather than opening its own Firestore connection.

`useUrlState` (`src/shared.jsx`) is the one piece of routing infrastructure
that exists: it syncs a single piece of state with one query-string
parameter and the browser's history (so Back/Forward work), used for both
`?area=` and `?sezione=`.

## Data layer

One module per Firestore domain, each exporting subscribe/read/write
functions and no UI:

| Module | Collection(s) | Consumed by |
|---|---|---|
| `orders.js` | `orders/{orderId}` | Sala (Waiter/TillSala), TillHistory, statistics (via `statsData.js`) |
| `reservationsData.js` | `reservations/{id}` | TillReservations, Sala (today's reservations) |
| `statsData.js` | reads `orders` via `orders.js`, no writes | TillStats |
| `menuCosts.js` | `menuCosts/data` | TillMenu (editing), Sala (snapshotting cost onto order lines), statistics (margin) |
| `staffData.js` | `staff/{uid}` (+ creates the Auth account, `firebase-auth.js`) | MenuSettings (Personale) |
| `menuViews.js` | `menuViews/{day}` (public +1 on open; reads for stats) | ClientView (records), TillStats (reads) |
| `printJobs.js` (+ `kitchenTicket.js`, `escpos.js`) | `printJobs/{id}` | receipt page (`OrderUi.jsx`), TillSala, Sala send (kitchen ticket), PrintStation |

`menu/data` itself is read by `MenuApp.jsx` (live, `onSnapshot`) and
written in two ways, both transactions with a timeout and readable errors:

- `handlePatch` — one edit from `menuEdit.js` (a dish, a category, a
  setting…), applied to the document as it is on the server right now,
  then to the local copy: a device stays open all day and must never write
  back a stale whole menu;
- `handleRestore` — a whole JSON backup (`menuBackup.js`), also used to
  create the menu on a new database.

There are no unsaved edits anywhere: every "Salva" writes at once, so every
device follows the menu live.

See [`docs/data-model.md`](data-model.md) for the full schema.

## Translations

Customer-facing multi-language support (`src/shared.jsx`:
`generateMissingTranslations`, `applyTranslation`) is pre-generated, not
live-translated: the admin triggers translation generation (via the free
MyMemory API) from the menu settings (Traduzioni), corrects any text by hand there, and it's saved into
`menu.translations[lang]`. The public menu never calls a translation API —
it just picks which pre-translated text to render from data it already
downloaded, so switching language is instant and works offline.

## Testing

End-to-end only (Playwright), against a local Firestore/Auth emulator that
`playwright.config.js`'s `globalSetup` starts, seeds, and tears down
automatically — never against the real Firebase project. See
[`CLAUDE.md`](../CLAUDE.md) for the full workflow and when to run it.
