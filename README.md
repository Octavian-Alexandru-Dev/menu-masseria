# Masseria della Piana — menù digitale e gestione sala

Applicazione web sviluppata come lavoro freelance per **Masseria della
Piana**, ristorante agriturismo a Candidoni (RC): è in produzione, usata
quotidianamente dal ristorante per il menù rivolto ai clienti e per la
gestione interna di ordini e prenotazioni.

Non è solo un menù digitale: copre l'intero ciclo sala-cucina (comande da
tabellet/telefono del cameriere, display cucina in tempo reale), le
prenotazioni dei tavoli e un pannello di amministrazione per gestire menù,
traduzioni, statistiche e backup — pensato per essere usato dal titolare
senza assistenza tecnica.

## Demo live

- **Menù pubblico:** [menu.masseria-della-piana.it](https://menu.masseria-della-piana.it/)
- **Landing page del ristorante:** [masseria-della-piana.it](https://www.masseria-della-piana.it/)

Sono gli ambienti di produzione reali. Le sezioni riservate allo staff
(comande, cucina, prenotazioni, amministrazione) richiedono credenziali del
personale e non sono pubblicamente accessibili — per provarle senza dover
chiedere accesso a un progetto reale, vedi [Provarla in locale](#provarla-in-locale-senza-credenziali-reali) qui sotto.

## Funzionalità principali

- **Menù pubblico multilingua** (IT/EN/ES/DE/FR): traduzioni generate una
  tantum lato admin (revisionabili a mano) e lette dal client senza nessuna
  chiamata di rete al cambio lingua.
- **Comande in tempo reale**: il cameriere invia l'ordine dal proprio
  dispositivo, la cucina lo vede comparire a schermo istantaneamente
  (`Waiter.jsx` ↔ `Kitchen.jsx`, sincronizzati su Firestore).
- **Prenotazioni tavoli** con vista dedicata per lo staff (`Reservations.jsx`).
- **Pannello Admin**: editor del menù con riordino drag & drop delle
  categorie, gestione traduzioni, esportazione PDF stampabile del menù
  (lingua, immagini, colonne e formato pagina configurabili), export/import
  JSON per il backup, undo fino a 20 azioni.
- **Statistiche** di vendita e utilizzo per lo staff (`Stats.jsx`, grafici
  con Recharts).
- **SEO curato**: meta tag, Open Graph/Twitter Card, dato strutturato
  `schema.org/Restaurant`, sitemap — la landing page è indicizzata e pensata
  per essere trovata da chi cerca il ristorante.

## Stack tecnico

| Livello | Scelta |
|---|---|
| Frontend | React 18 + Vite |
| Backend | Firebase (Firestore + Authentication) |
| Immagini | Cloudinary (upload, ottimizzazione formato/peso automatica) |
| Drag & drop | `@dnd-kit` (riordino categorie/piatti nel pannello admin) |
| Statistiche | Recharts |
| Test E2E | Playwright, eseguiti contro un emulatore Firebase containerizzato (Docker) — mai contro il progetto reale |
| Hosting | Firebase Hosting (app) + hosting FTP tradizionale su Tophost (landing page, dominio principale) |

## Provarla in locale (senza credenziali reali)

L'app gira interamente contro un emulatore Firebase containerizzato,
pre-popolato con un menù demo e account di staff di test — non serve un
progetto Firebase reale:

```bash
npm install
docker compose -f docker-compose.emulator.yml up -d --wait   # emulatore Firestore + Auth, già pre-popolato
npm run dev:local
```

Apri l'URL stampato in console. Account di staff disponibili nell'emulatore
(credenziali fisse e non sensibili: valgono solo in locale, sono seminate da
`scripts/seed-emulator.js`):

| Ruolo | Email | Password |
|---|---|---|
| Admin | `admin@test.local` | `Test1234!` |
| Cameriere | `waiter@test.local` | `Test1234!` |
| Cucina | `kitchen@test.local` | `Test1234!` |

## Sviluppo contro il progetto Firebase reale

Per lavorare con `npm run dev` (non l'emulatore) serve un file `.env` con la
configurazione Firebase/Cloudinary — vedi `GUIDA.md` per come recuperare
questi valori dalla console Firebase. Se hai accesso al progetto Bitwarden
Secrets Manager `Menu-masseria` (vedi `.bws-token.example`),
`scripts/bws-env.sh` genera `.env` al posto della copia manuale di
`.env.example`.

## Test automatici

```bash
npm run test:e2e      # headless: avvia/popola/smonta l'emulatore da solo
npm run test:e2e:ui   # modalità interattiva
```

Suite Playwright a contratto (struttura/ruolo/testo, non contenuti
hardcoded) che copre menù pubblico, login staff e i flussi completi
cameriere ↔ cucina e prenotazioni.

## Deploy

Ad ogni push su `main`, GitHub Actions pubblica automaticamente l'app su
Firebase Hosting e aggiorna le regole di sicurezza Firestore
(`.github/workflows/firebase-hosting-merge.yml`). La landing page (statica,
cartella `landing_page/`) è pubblicata separatamente via FTP sull'hosting
Tophost del dominio principale.

Documentazione operativa completa, scritta per il titolare del ristorante
(nessun prerequisito tecnico): [`GUIDA.md`](GUIDA.md).
