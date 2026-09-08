# Dati seed dell'emulatore (`seed-data/`)

Snapshot esportato dell'emulatore Firebase (Firestore + Auth): un menù demo
completo e gli account admin/waiter/kitchen di test (vedi
`scripts/seed-emulator.js` per le credenziali fisse — non sono segreti, sono
validi solo dentro l'emulatore locale).

`Dockerfile.emulator` copia `seed-data/` nell'immagine e avvia l'emulatore
con `--import=/app/seed-data`: il container parte già popolato, senza dover
ricordarsi di lanciare `npm run seed:emulator` a parte — così il menù
locale (via `npm run dev:local` o la suite E2E) non è mai vuoto quando si
usa il container senza credenziali reali.

`npm run test:e2e`/`npm run dev:local` chiamano comunque anche
`seed:emulator` come rete di sicurezza idempotente (riscrive gli stessi
dati, non duplica nulla) — utile se questo snapshot finisce disallineato
dallo schema del menù.

## Rigenerare dopo una modifica

Se cambi la forma del menù demo o degli account in
`scripts/seed-emulator.js`, questo snapshot va rigenerato altrimenti resta
vecchio:

```
npm run seed:export
docker compose -f docker-compose.emulator.yml build
```

**Importante**: questo documento vive apposta FUORI dalla cartella
`seed-data/`, non dentro. `firebase emulators:export --force` (usato da
`scripts/export-seed-data.sh`) cancella tutto il contenuto della cartella
di destinazione prima di scriverci il nuovo export — un file messo dentro
`seed-data/` (es. un README) sparirebbe al primo re-export.
