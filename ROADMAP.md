# Roadmap & backlog — Masseria della Piana (menù digitale)

Questo documento raccoglie i miglioramenti individuati con un'analisi
critica dell'app e le richieste del proprietario del progetto. È pensato
per essere dato in pasto a una sessione Claude Code **partendo da zero**:
ogni voce aperta è autosufficiente — contiene contesto, file coinvolti,
perché conta — così puoi assegnare "occupati della voce 2" senza dover
rispiegare il resto del progetto.

Prima di iniziare qualsiasi voce: leggi `CLAUDE.md` (convenzioni di test e
nota sulle sessioni concorrenti) e, se tocchi UI, esegui `npm run test:e2e`
dopo le modifiche come richiesto lì.

Stato di ogni voce: 🔲 da fare · 🔎 da analizzare prima di implementare.
Le voci già implementate non restano qui in dettaglio (il codice e la
cronologia git sono la fonte di verità su *come* funzionano) — solo un
riassunto qui sotto, per sapere cosa è già a posto senza doverlo
rileggere per intero.

---

## ✅ Già implementato

- **Traduzioni pre-generate lato Admin.** Selettore lingua IT/EN/ES/DE/FR
  nel pannello di gestione: per ogni lingua non italiana si genera una
  bozza automatica (rivedibile/correggibile a mano, eliminabile in blocco
  per rigenerarla da capo), che poi il cliente legge senza generare
  nessuna chiamata di rete al cambio lingua. `src/shared.jsx`
  (`applyTranslation`, `generateMissingTranslations`), `src/Admin.jsx`
  (`TranslationEditor`), `src/ClientView.jsx`.
- **Annulla ultima modifica** nel pannello Admin (fino a 20 passi
  indietro, funziona per qualunque azione perché centralizzato in un solo
  punto). `src/MenuApp.jsx` (`setMenu`/`undoStack`), `src/Admin.jsx`
  (pulsante "Annulla").
- **Esportazione/importazione del menù in JSON** (backup manuale, validato
  prima di sostituire lo stato dell'editor). `src/Admin.jsx`
  (`parseMenuJsonFile`, card "Esportazione e backup").
- **Rimozione di `DEFAULT_MENU` dal codice sorgente.** Se Firestore non ha
  ancora un documento menù, l'admin può comunque accedere e importare un
  backup JSON per iniziare (`AdminBootstrap` in `src/Admin.jsx`) — non
  esiste più un menù di esempio precaricato lato client.
- **Esportazione PDF stampabile**, con opzioni scelte al momento
  dell'export (non un pulsante unico): lingua, immagini dei piatti,
  prezzi/etichette/sottotitoli on-off, contatti social come testo in
  fondo pagina, se una categoria può continuare su una pagina nuova o
  deve restare intera, colonne (1/2), formato pagina (A4/Letter),
  categorie da includere. Stile allineato al tema del menù digitale
  (colori, font, logo, fregio decorativo). `src/PrintMenu.jsx`,
  `src/Admin.jsx` (card "Esportazione e backup" → "Versione stampabile").
- **SEO e discoverability.** `meta description`, Open Graph e Twitter Card,
  dato strutturato JSON-LD `schema.org/Restaurant` (indirizzo, link social)
  in `index.html`; `robots.txt` e `sitemap.xml` in `public/`. URL di
  produzione, indirizzo e social sono hardcoded (non derivabili dal codice,
  vedi commit) — da tenere aggiornati a mano se cambiano. Se in futuro si
  aggiunge un dominio personalizzato o si cambiano indirizzo/social, va
  aggiornato anche qui.

---

## 1. 🔲 Autosave locale e avviso "modifiche non salvate"

**File coinvolti:** `src/MenuApp.jsx` (`setMenu`, stato `menu` in `App`),
`src/Admin.jsx` (`AdminPanel`).

**Stato attuale:** l'unico modo di non perdere lavoro è premere "Salva
modifiche", che scrive su Firestore. Non c'è alcun salvataggio intermedio
in `localStorage`, né un avviso prima di uscire/chiudere con modifiche non
salvate. L'undo (già implementato, vedi sopra) aiuta a correggere un
errore, ma non protegge da una tab chiusa per sbaglio o dal telefono che
va in standby a metà modifica.

**Perché conta:** chi gestisce il menù lo fa spesso da telefono, tra un
servizio e l'altro, con distrazioni frequenti. Perdere 10 minuti di
modifiche non salvate senza preavviso è il tipo di frustrazione che fa
smettere di fidarsi dello strumento.

**Da fare:**
- **Autosave locale** (bozza, non pubblicazione): salvare periodicamente lo
  stato `menu` corrente in `localStorage` (debounced, es. ogni 2-3s dopo
  l'ultima modifica) — *non* è un `setDoc` su Firestore, è solo protezione
  contro la perdita di lavoro nel browser. Al riavvio dell'Admin, se c'è una
  bozza più recente del documento salvato, proporre "riprendi la bozza non
  salvata?".
- **Avviso "hai modifiche non salvate"** prima di chiudere/uscire
  (`beforeunload`, o intercettare l'uscita dal pannello) — a basso sforzo e
  ad alto valore, va quasi sempre insieme all'autosave locale.

---

## 2. 🔎 Storico versioni del menù (DA ANALIZZARE prima di implementare)

**Obiettivo (richiesto dal proprietario):** poter vedere e ripristinare
versioni precedenti del menù (es. "la versione di ieri", "la versione
dell'altro ieri"), non solo l'ultima salvata.

**Perché è più complesso delle altre voci — punti da chiarire prima di
scrivere codice:**
- **Dove si archivia lo storico.** Opzione più naturale con lo stack
  attuale: una sub-collection Firestore (es. `menu/data/history/{timestamp}`)
  in cui, a ogni salvataggio riuscito in `handleSave` (`src/MenuApp.jsx`), si
  scrive anche una copia del documento precedente prima di sovrascrivere
  quello corrente. Alternativa più robusta ma più complessa: una Cloud
  Function che si attiva su ogni scrittura del documento principale e
  archivia automaticamente (funziona anche se qualcuno scrive da fuori
  l'app, ma richiede Cloud Functions, quindi piano Firebase a pagamento e
  altra infrastruttura da mantenere).
- **Politica di retention.** Uno storico illimitato cresce per sempre e
  costa (storage + letture Firestore). Serve decidere un limite ragionevole
  (es. tenere solo le ultime N versioni, oppure una versione al giorno per
  gli ultimi M giorni) e chi/cosa fa la pulizia.
- **Costo.** Ogni salvataggio diventerebbe (almeno) due scritture Firestore
  invece di una. Per un menù che cambia poche volte a settimana è
  trascurabile; va comunque tenuto presente se in futuro il salvataggio
  diventasse più frequente (es. con l'autosave della voce 1 — **attenzione**:
  quell'autosave è pensato come bozza *locale*, non deve mai scrivere su
  Firestore, altrimenti moltiplicherebbe lo storico inutilmente).
- **UI per navigare e ripristinare.** Serve una vista (probabilmente dentro
  Admin) che elenchi le versioni passate con data/ora, permetta un'anteprima
  prima di ripristinare, e confermi prima di sovrascrivere il menù corrente
  con una versione vecchia (stesso pattern di conferma già usato per
  eliminare categorie/voci in `Admin.jsx`, vedi `confirmDelete`).

**Raccomandazione:** questa voce va discussa e progettata (anche solo in una
sessione di planning, non implementazione) prima di scrivere codice — le
decisioni sopra cambiano parecchio la complessità finale.

---

## Altri punti emersi dall'analisi (backlog secondario, priorità minore)

- **Concorrenza in scrittura**: `handleSave` in `src/MenuApp.jsx` fa
  `setDoc` con last-write-wins, senza controllo di versione — se due persone
  salvano quasi contemporaneamente, l'ultima sovrascrive l'altra in
  silenzio. Rischio basso (il menù cambia poco) ma la mitigazione (campo
  `updatedAt` controllato prima di scrivere) è economica.
- **Sicurezza account admin**: un solo account email/password (Firebase
  Auth), nessuna 2FA. Se la password trapela, chiunque può riscrivere il
  menù pubblico. Da valutare se vale la pena per il contesto d'uso.
- **Accessibilità**: i bottoni di categoria e i toggle in `src/ClientView.jsx`
  / `src/Admin.jsx` comunicano lo stato solo via colore, non via ARIA
  (`aria-selected`, `aria-pressed`) — non letto dagli screen reader. I
  contrasti dei temi (specialmente "Notte di Cirò", scuro) andrebbero
  verificati con uno strumento automatico (es. axe).
- **Copertura test**: come già scritto in `CLAUDE.md`, i flussi Admin
  autenticati (editing, upload immagini Cloudinary, link social, export/
  import, PDF) non sono coperti da Playwright — nessun account di test
  configurato. È il rischio più alto di regressioni silenziose su ogni
  nuova modifica a `Admin.jsx`.
- **Igiene `.env.example`**: se mai finiscono lì credenziali reali invece
  dei placeholder vuoti in fase di commit, va ripulito prima di qualsiasi
  commit (`git restore --staged .env.example` + rimettere i placeholder).

---

## Come usare questo documento in una nuova sessione

Esempio di prompt minimo per una sessione a contesto zero:

> Leggi `ROADMAP.md` nella root del progetto. Occupati della voce "1.
> Autosave locale e avviso modifiche non salvate". Implementa, poi
> verifica con `npm run test:e2e` come richiesto da `CLAUDE.md`.

Aggiorna questo documento man mano che le voci vengono affrontate: sposta
il riassunto in "✅ Già implementato" e togli i dettagli della voce
completata, così il documento resta snello invece di accumulare la
cronologia di ogni modifica passata (per quella c'è già `git log`).
