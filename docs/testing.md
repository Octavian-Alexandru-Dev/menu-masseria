# Test E2E — come si eseguono e come restano deterministici

La suite Playwright (`tests/*.spec.js`) gira contro gli emulatori Firebase
locali in Docker, mai contro il progetto reale. Qui: quali comandi usare
durante lo sviluppo e quali regole seguire perché un test dia sempre lo
stesso risultato. Copertura funzionale: `docs/stampa-scontrini.md` §7.

## 1. Quali comandi

| Quando | Comando | Cosa fa |
|---|---|---|
| Mentre sviluppi | `npm run test:e2e:changed` | Solo le spec della parte toccata (file cambiati rispetto all'ultimo commit, più quelli nuovi) |
| Su un branch | `npm run test:e2e:changed -- --base main` | Come sopra, rispetto al punto in cui il branch si è staccato da `main` |
| Spec precise | `npm run test:e2e:changed -- reservations till-sala` | Proprio quelle (nome o percorso), nell'ordine giusto |
| Per vedere il piano | `npm run test:e2e:changed -- --list` | Quali file sono cambiati, quali spec ne derivano e perché, senza eseguire nulla |
| Opzioni a Playwright | `npm run test:e2e:changed -- reservations -- --headed -g "Avvia"` | Ciò che segue il secondo `--` va a `playwright test` |
| Prima di consegnare | `npm run test:e2e` | **La suite completa**, la verifica finale di tutto il lavoro |
| Per indagare | `npm run test:e2e:ui` | Modalità interattiva di Playwright |

`test:e2e:changed` (`scripts/test-e2e-changed.js`) avvia l'emulatore una
volta sola, esegue le spec fase per fase e alla fine lo spegne. Se cambia
qualcosa di condiviso da tutto (configurazione, dati di partenza,
`firestore.rules`, `shared.jsx`, `TillUi.jsx`…) o un file che la mappa non
conosce, esegue la suite completa: meglio un test di troppo che una
regressione non vista.

### La mappa file → spec

`tests/spec-map.js` dice quali spec coprono quale file:

- una spec cambiata esegue se stessa;
- un helper dei test esegue le spec che lo importano, anche indirettamente
  (calcolato leggendo gli `import`, nessuna lista da tenere aggiornata);
- `FULL_SUITE` elenca i file che fanno partire tutta la suite;
- `SPECS_BY_FILE` collega ogni modulo di `src/` alle sue spec;
- `IGNORED` (più ogni `*.md`) sono file senza test (documentazione, asset).

**Quando aggiungi un file in `src/` o una spec nuova, aggiorna la mappa.**
Finché non lo fai, il file nuovo fa partire la suite completa, con un
avviso nell'output.

### Le fasi

Le spec con una "cassa" accesa (una stazione di stampa, simulata o il vero
client Electron) stampano tutte le richieste in coda, come la cassa vera.
Per questo `tests/stages.js` le divide in fasi che girano una dopo l'altra:
prima `chromium` (telefono e browser, in parallelo tra loro), poi
`print-queue`, `till-client`, `till-sala`, `desktop-client`.

In `playwright.config.js` ogni fase dipende dalla precedente. Playwright
però esegue **sempre per intero** i progetti da cui ne dipende un altro,
anche se gli passi un solo file: `npx playwright test tests/till-sala.spec.js`
esegue prima tutta la fase `chromium`. Per questo, per lanciare spec
precise, usa `test:e2e:changed`, che passa `--project=<fase> --no-deps`
fase per fase. Per una spec della fase `chromium` va bene anche
`npx playwright test tests/<nome>.spec.js`, che però avvia e spegne
l'emulatore ogni volta.

## 2. Perché i test sono deterministici (e come non rompere la cosa)

Prima di ottobre 2026 ogni run completo falliva su 1–3 test diversi, mai gli
stessi. Le cause e le regole che ne derivano:

1. **L'app gira come in produzione.** I test usano una build
   (`vite build` + `vite preview`, porta 4173, cartella `.e2e-dist`), non il
   server di sviluppo: quello compila ogni modulo al primo accesso, e con 4
   worker insieme login e caricamenti superavano i timeout a caso. La porta
   è dedicata e non si riusa un server già aperto, così i test non finiscono
   mai su un `npm run dev` collegato ad altro (`tests/helpers/appUrl.js`).
2. **Movimento ridotto.** I test girano con `prefers-reduced-motion: reduce`:
   le pagine intere (`SidePanel` sheet) non scivolano e gli scorrimenti
   "smooth" sono immediati (`scrollBehavior()` in `shared.jsx`, che rispetta
   la stessa preferenza del sistema anche per gli utenti). Una posizione
   misurata con `boundingBox()` è quella finale; aspetta comunque che
   l'elemento sia fermo (`toBeInViewport({ ratio: 1 })`) prima di misurarlo.
3. **Mai attese a tempo per aspettare che qualcosa succeda.** Niente
   `waitForTimeout` prima di un'asserzione positiva: usa le asserzioni che
   riprovano da sole (`expect(locator)…`, `expect.poll`) o aspetta un segnale
   preciso (ad esempio che sparisca "Caricamento…"). Un'attesa fissa è
   ammessa solo per verificare che qualcosa **non** succeda (nessun accesso
   automatico, visita non contata), e va commentata.
4. **Leggere dal server dopo un'azione: sempre `expect.poll`.** L'interfaccia
   si aggiorna già con la scrittura locale di Firestore, prima che il server
   la confermi: una lettura fatta una volta sola da Node (`findStaffByEmail`,
   `getMenu`…) può arrivare prima. Scrivi
   `await expect.poll(() => findStaffByEmail(email)).toMatchObject(…)`.
5. **Ogni test lavora sui propri dati e pulisce solo quelli.** I test della
   fase `chromium` girano in parallelo sullo stesso emulatore:
   - crea dati con nomi unici (`Date.now()`, numeri casuali) e cercali per
     nome, mai "il primo" o "quanti sono";
   - non modificare i dati di partenza condivisi (piatti, costi, coperto del
     seed). Se serve un piatto da modificare, crealo (nascosto,
     `visible: false`, così non compare negli altri test) e cancellalo alla
     fine (vedi `tests/admin-menu-costs.spec.js`);
   - pulisci in `afterEach` (o in un `finally`) **solo ciò che il test ha
     creato**. Mai `afterAll` per pulire: con `fullyParallel` gira in ogni
     worker che ha eseguito un test del file, e cancella i dati di un test
     ancora in corso in un altro worker.
6. **Una sessione per account negli helper.** Gli helper lato Node
   (`tests/helpers/*.js`, `tests/firestore-cleanup.js`) prendono Firestore
   da `waiterDb()` / `adminDb()` (`tests/helpers/emulatorApp.js`): un'app
   Firebase per account, così un helper da amministratore e uno da cameriere
   non si rubano la sessione (prima chi accedeva per ultimo decideva per
   tutti, e la pulizia del menù falliva in silenzio a seconda dell'ordine).
7. **Tempi larghi, non stretti.** 30 s per test, 10 s per asserzione. Un
   test che si avvicina a questi limiti è troppo lungo: dividilo.

Ultimo caso non coperto: un run a cavallo della mezzanotte o del cambio di
turno (le prenotazioni "di oggi", "Ieri" nelle Statistiche, i tavoli "chiusi
nel turno") può vedere il giorno cambiare a metà. Se capita, rilancia.

## 3. Se un test fallisce

1. Rilancia solo quella spec: `npm run test:e2e:changed -- <nome>`.
2. Se ripassa, **non** è un problema risolto: è un test non deterministico.
   Cerca la causa tra quelle sopra (screenshot e `error-context.md` sono in
   `test-results/`) e correggila, invece di aggiungere retry o allungare i
   timeout.
3. Se fallisce sempre, è una regressione o un cambiamento di contratto: vedi
   le regole in `CLAUDE.md` ("Contract testing E2E").
