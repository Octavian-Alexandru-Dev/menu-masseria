# GIF dimostrative del README

Le GIF in `docs/demo/` sono registrate in automatico, non a mano: ogni
scena è uno script Playwright che usa l'app come farebbe una persona,
contro l'emulatore locale con i dati demo.

```bash
npm run demo:gifs                          # tutte le scene
npm run demo:gifs -- --project=cassa       # solo la cassa (o --project=telefono)
npm run demo:gifs -- -g "prenotazioni"     # solo le scene con quel titolo
```

Servono Docker (come per `npm run test:e2e`) e `ffmpeg` (`brew install ffmpeg`).

- `playwright.demo.config.js`: stessa infrastruttura dei test E2E (emulatore,
  seed, server Vite), con il video attivo. Progetto `telefono` (390×844) e
  `cassa` (1280×800, il client Windows simulato con
  `installDesktopBridgeMock`).
- `telefono.demo.js`, `cassa.demo.js`: le scene. `scene(testInfo, nome)`
  dà il nome alla GIF, `s.start()` segna da dove tagliarla (login e
  caricamento restano fuori).
- `demo-data.js`: tavoli aperti e prenotazioni di oggi, così la sala non è
  vuota.
- `scripts/make-demo-gifs.js`: lancia la registrazione e converte i video
  (in `demo/.recordings/`, ignorata da git) in GIF.

Non sono test: non fanno parte di `npm run test:e2e` e non controllano il
comportamento (per quello ci sono i test in `tests/`). Se l'interfaccia
cambia e una scena non trova più un pulsante, va aggiornato lo script della
scena e vanno rigenerate le GIF. Lo stesso vale quando cambia l'aspetto di
una schermata mostrata nelle GIF.
