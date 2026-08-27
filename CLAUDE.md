# Testing

This project uses Playwright for end-to-end tests against the real app (Vite dev server + the real Firebase project configured in `.env`). Tests live in `tests/*.spec.js`.

After implementing or changing a UI feature (`ClientView.jsx`, `Admin.jsx`, `shared.jsx`, `MenuApp.jsx`), verify it yourself before considering the task done:

```
npm run test:e2e       # headless run
npm run test:e2e:ui    # interactive UI mode, useful while iterating
```

`playwright.config.js` auto-starts `npm run dev` if it isn't already running, so no manual setup is needed.

Notes:
- `tests/client-view.spec.js` covers the public menu (header, category nav, language switch, link to admin login). Assertions are structural (e.g. "nav has buttons", not hardcoded menu item text), since production Firestore content can change independently of the code.
- `tests/admin-login.spec.js` covers the login screen and the invalid-credentials error path. There's no test account configured, so authenticated admin flows (editing/saving the menu) aren't covered by automated tests — verify those manually, or add a test admin user and extend the suite if that becomes worth it.
- When adding a new UI feature, add or extend a spec in `tests/` alongside it.

# Working directory

This repo is sometimes open in more than one Claude Code session at once. Before deleting or reverting files that look like unfamiliar scaffolding (especially untracked ones), check `git log`/recent activity or ask — a sibling session may be mid-task. If you find conflicting concurrent edits, use `ListAgents`/`SendMessage` to coordinate before cleaning anything up.
