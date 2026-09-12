# Menu Masseria — bot Telegram

Cloudflare Worker che riceve messaggi Telegram (testo o vocali) dallo staff
e li trasforma in azioni reali sul menù/comande via Firestore REST API.

Per il progetto/design completo, i costi attesi e — soprattutto — la
procedura per configurare gli account esterni necessari (Telegram, Groq,
Cloudflare, service account Google) prima che questo bot funzioni davvero,
vedi **[`../docs/telegram-bot.md`](../docs/telegram-bot.md)**.

## Sviluppo locale

```
npm install
cp .dev.vars.example .dev.vars   # poi compila i valori, vedi docs/telegram-bot.md §7
npm run dev                       # wrangler dev
```

## Test

```
npm test          # una volta
npm run test:watch
```

## Deploy

```
npx wrangler login              # una tantum
npx wrangler secret put <NOME>  # una volta per ciascun secret, vedi docs/telegram-bot.md §7.4
npm run deploy
```

Dopo il primo deploy, collega il webhook Telegram all'URL restituito da
`wrangler deploy` — comando esatto in `docs/telegram-bot.md` §7.5.

## Struttura

| File | Responsabilità |
|---|---|
| `src/index.js` | entry point del Worker: verifica del webhook, orchestrazione del flusso |
| `src/telegram.js` | Bot API di Telegram (invio/ricezione messaggi, download vocali) |
| `src/groq.js` | trascrizione (Whisper) e interpretazione del comando (tool-calling) |
| `src/firestoreRest.js` | client REST minimale per Firestore, autenticato con JWT di service account |
| `src/auth.js` | risoluzione chat Telegram → account staff/ruolo |
| `src/tools.js` | azioni disponibili, loro validazione, e regole di conferma |
