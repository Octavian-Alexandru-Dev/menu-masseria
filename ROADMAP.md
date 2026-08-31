# Roadmap & backlog — Masseria della Piana (menù digitale)

Questo documento raccoglie i miglioramenti individuati con un'analisi critica
dell'app (fatta il 2026-08-31) e le richieste del proprietario del progetto.
È pensato per essere dato in pasto a una sessione Claude Code **partendo da
zero**: ogni sezione è autosufficiente — contiene contesto, file coinvolti,
perché conta, e opzioni — così puoi assegnare "occupati della sezione 3" senza
dover rispiegare il resto del progetto.

Prima di iniziare qualsiasi voce: leggi `CLAUDE.md` (convenzioni di test e
nota sulle sessioni concorrenti) e, se tocchi UI, esegui `npm run test:e2e`
dopo le modifiche come richiesto lì.

Stato di ogni voce: 🔲 da fare · 🔎 da analizzare prima di implementare · ✅ fatto.

---

## 1. 🔲 Qualità e affidabilità della traduzione multilingua

**Stato: implementato il 2026-08-31, in verifica manuale lato Admin
autenticato (test reale dell'utente, non automatizzato — vedi nota sotto).**
Codice scritto in `src/shared.jsx`, `src/Admin.jsx`, `src/ClientView.jsx`
secondo il design sotto. `npm run build` e `npm run test:e2e` passano
entrambi (6/6, suite invariata — copre solo la vista pubblica/login, non il
pannello Admin autenticato).

**Bug trovato e corretto durante il test manuale (2026-08-31):** generare la
traduzione EN e salvare falliva sempre con
`Function setDoc() called with invalid data. Unsupported field value:
undefined (found in field translations.en.categories.*.items.*.description)`.
Causa: in `collectMissingTranslations` (`src/shared.jsx`), un campo con testo
italiano sorgente **vuoto** (es. `description: ""`, molto comune nel menù)
non veniva mai schedulato per la traduzione (giustamente, non c'è nulla da
tradurre) ma restava `undefined` nella bozza invece di diventare `""` —
Firestore rifiuta qualsiasi documento con un `undefined` annidato, quindi
ogni salvataggio dopo aver generato una traduzione falliva sistematicamente,
dando l'impressione che "la traduzione non fosse stata fatta" (in realtà non
veniva mai salvata). Corretto: ogni campo mancante ora riceve o un job di
traduzione (se c'è testo da tradurre) o `""` subito (se il sorgente è
vuoto) — non resta mai `undefined`. Chi riprende questa voce: se il bug
dovesse ripresentarsi con lo stesso messaggio d'errore, il sospetto numero
uno è di nuovo un valore `undefined` finito dentro `menu` prima di
`setDoc` in `src/MenuApp.jsx`.

Come già annotato nel backlog secondario, i flussi Admin autenticati non
hanno un account di test Playwright configurato: la verifica del selettore
lingua/editor per lingua è manuale, condotta direttamente dal proprietario.
Non passare questa voce a ✅ finché il proprietario non conferma che
generazione + salvataggio + visualizzazione lato cliente funzionano
end-to-end.

**File coinvolti:** `src/shared.jsx` (`translateText`, `translateBatch`,
`translateMenu`, cache in `loadTranslationCache`/`saveTranslationCache` —
tutte da rivedere, vedi sotto), `src/Admin.jsx` (`AdminPanel` — nuovo
selettore lingua + editor traduzioni), `src/ClientView.jsx` (useEffect di
traduzione runtime — da rimuovere).

**Stato attuale (perché va cambiato):** ogni volta che un cliente cambia
lingua (IT→EN/ES/DE/FR), il browser chiama l'API pubblica e gratuita
**MyMemory** (`api.mymemory.translated.net`) per ogni stringa non ancora in
cache. La cache è in `localStorage`, quindi **per dispositivo**, non
condivisa tra clienti né persistita lato server. Problemi concreti:
MyMemory ha limiti di frequenza bassi per uso anonimo (~5000 caratteri/
giorno per IP), più clienti sullo stesso Wi-Fi la stessa sera possono
saturarlo; la qualità su nomi di piatti regionali calabresi ("Gaglioppo
IGT", "Tartufo al pistacchio") è spesso goffa; l'admin non ha modo di
correggere una traduzione sbagliata — è tutto automatico e invisibile fino
a quando un cliente la legge.

**Decisione: cambio di modello, da "traduzione runtime lato cliente" a
"traduzione pre-generata e rivedibile lato admin".** Il menù cambia poche
volte al mese: non ha senso ritradurlo ad ogni visita/dispositivo. Si
traduce una volta (con l'aiuto della stessa API MyMemory, ma come bozza
editabile, non come output diretto al cliente), l'admin la rivede/corregge,
e da quel momento il cliente sceglie solo quale testo già scaricato
visualizzare — zero chiamate di rete al cambio lingua.

### Modello dati

Nuovo campo di primo livello sul documento menù, opzionale (assente = nessuna
traduzione ancora generata, tutto ricade sull'italiano — **nessuna rottura
per i menù salvati oggi**):

```js
menu.translations = {
  en: {
    restaurantName: "...", tagline: "...", footerNote: "...",
    categories: {
      "cat-antipasti": {
        name: "...", subtitle: "...",
        items: {
          "i7": { name: "...", description: "...", tag: "..." },
          // solo le voci già tradotte; una voce assente = fallback IT
        },
      },
      // solo le categorie già tradotte
    },
  },
  es: { ... }, de: { ... }, fr: { ... },
}
```

Chiavi per **id** di categoria/voce (non per posizione): se l'admin
aggiunge, riordina o rinomina voci, le traduzioni esistenti restano valide e
solo la voce nuova risulta mancante, invece di disallinearsi silenziosamente
come accadrebbe con un array parallelo. `price`, `image`, `visible`, `tag`
come colore non sono mai tradotti (`tag` sì che lo è, es. "ROSSO"→"RED"; il
prezzo no, resta lo stesso numero per tutte le lingue, coerente con
`translateMenu` oggi). `location` resta sempre in italiano, come già oggi.

### Lato Admin

Sopra la lista delle categorie (dopo il blocco "Identità del locale"),
un selettore di lingua identico nello spirito a quello già presente lato
cliente: **IT · EN · ES · DE · FR**.

- **IT selezionato** (default): l'editor si comporta esattamente come oggi
  — si modifica il testo sorgente (`menu.restaurantName`, `cat.name`,
  `item.description`, ...).
- **Una lingua non-IT selezionata**: lo stesso editor (stessa struttura,
  stesse categorie/voci, stesso layout) ma i campi di testo sono legati a
  `menu.translations[lang].*` invece che ai campi italiani. Il campo prezzo
  non compare in questa vista (non è mai tradotto). Se per quella lingua non
  esiste ancora nulla, al posto dell'editor compare un solo pulsante:
  **"Genera traduzione automatica (EN)"**.
- Il pulsante genera lato client, tramite `translateBatch`/MyMemory, **solo
  le stringhe mancanti** per quella lingua (alla primissima generazione:
  tutte; dopo aver aggiunto una voce nuova al menù: solo quella voce) — mai
  sovrascrive un campo che l'admin ha già scritto o corretto a mano.
  Popola `menu.translations[lang]` con la bozza tradotta, poi mostra
  l'editor già valorizzato, pronto per la revisione manuale.
  Se restano voci senza traduzione per quella lingua (es. appena aggiunte),
  un piccolo banner con lo stesso pulsante ("Genera traduzione mancante")
  resta visibile finché non sono tutte coperte.
- Il salvataggio è lo stesso di sempre: `menu.translations` è solo un altro
  campo di `menu`, quindi "Salva modifiche" (`handleSave` esistente) lo
  persiste su Firestore insieme al resto — nessun flusso di salvataggio
  separato da costruire.
- **Nota di implementazione:** oggi `footerNote` viene già tradotto da
  `translateMenu` ma **non ha un campo di editing in Admin** (si può
  impostare solo modificando `DEFAULT_MENU` nel codice). Va aggiunto un
  input per `footerNote` nel blocco "Identità del locale" insieme a questa
  modifica, altrimenti l'admin si troverebbe a tradurre un campo che non può
  nemmeno vedere/modificare in italiano.

### Lato cliente (`ClientView.jsx`)

Il selettore lingua resta identico visivamente, ma cambia cosa fa: non
avvia più alcuna chiamata di rete. Il cambio lingua diventa una lettura
sincrona di dati già scaricati con il resto del menù (stessa richiesta
Firestore di oggi, `menu.translations` è solo un campo in più sullo stesso
documento):

```js
const displayMenu = lang === "it" ? menu : applyTranslation(menu, menu.translations?.[lang]);
```

dove `applyTranslation` (nuova funzione pura in `shared.jsx`) sovrappone i
campi tradotti disponibili e ricade sull'italiano campo per campo quando
mancano (voce non ancora tradotta, o lingua mai generata per questo menù).
Si può eliminare: lo stato `translating`/il messaggio "Traduzione in
corso…" (`ui.translating`), l'intero `useEffect` che chiama `translateMenu`,
e la cache `localStorage` per-dispositivo (`loadTranslationCache`/
`saveTranslationCache`/`TRANSLATION_CACHE_KEY`) — non serve più: la
"cache" condivisa tra tutti i clienti è ora `menu.translations` su
Firestore. **Resta invariato** `TRANSLATION_LANG_KEY` (ricorda solo quale
lingua il cliente aveva scelto l'ultima volta, non il testo tradotto).

### Cosa NON cambia (già a posto oggi)

I testi fissi dell'interfaccia — pulsanti "Lascia una recensione su
Google/TripAdvisor", "Seguici su Instagram/Facebook", "Vai al nostro shop
online", "Gestione menù" — vivono in `UI_STRINGS` (`src/shared.jsx`), già
tradotti a mano per le 5 lingue, mai passati per MyMemory, non editabili da
Admin. Sono esattamente il tipo di "traduzione pre-scritta e affidabile"
verso cui si sta spostando anche il contenuto del menù: non richiedono
alcuna modifica.

### Effetti collaterali da tenere a mente

- **Peso del documento**: 4 lingue aggiuntive più che raddoppiano il testo
  del documento menù. Improbabile che avvicini il limite di 900KB già
  controllato in `handleSave` (le immagini pesano molto di più del testo),
  ma va tenuto presente se in futuro si aggiungessero molte descrizioni
  lunghe.
- **Collegamento con il punto 3** (export/import): i campi `translations`
  diventano naturalmente parte dello schema esportabile — nessun lavoro
  aggiuntivo, l'export serializza semplicemente tutto `menu`.
- **Collegamento con il punto 4bis** (`DEFAULT_MENU` → JSON): lo stesso
  schema (incluso il campo `translations`, anche vuoto) va usato lì.

---

## 2. 🔲 Autosave e "Annulla ultima modifica" nel pannello Admin

**File coinvolti:** `src/Admin.jsx` (`AdminPanel`, tutte le funzioni
`update*`/`add*`/`remove*` che chiamano `setMenu`), `src/MenuApp.jsx`
(`handleSave`, stato `menu` in `App`).

**Stato attuale:** l'unico modo di non perdere lavoro è premere "Salva
modifiche", che scrive su Firestore. Non c'è alcun salvataggio intermedio,
nessun avviso prima di uscire con modifiche non salvate, e nessun modo di
tornare indietro su un cambiamento fatto per errore (es. cancellare per
sbaglio la descrizione di una voce, o togliere la spunta "visibile" a una
categoria intera).

**Perché conta:** chi gestisce il menù lo fa spesso da telefono, tra un
servizio e l'altro, con distrazioni frequenti (standby del telefono, tab
chiusa per sbaglio, connessione che cade). Perdere 10 minuti di modifiche non
salvate senza preavviso è il tipo di frustrazione che fa smettere di fidarsi
dello strumento.

**Due funzionalità distinte da tenere separate in fase di design:**
- **Autosave locale** (bozza, non pubblicazione): salvare periodicamente lo
  stato `menu` corrente in `localStorage` (debounced, es. ogni 2-3s dopo
  l'ultima modifica) — *non* è un `setDoc` su Firestore, è solo protezione
  contro la perdita di lavoro nel browser. Al riavvio dell'Admin, se c'è una
  bozza più recente del documento salvato, proporre "riprendi la bozza non
  salvata?".
- **Undo dell'ultima modifica**: uno stack in memoria (array di stati
  precedenti di `menu`, o meglio un array di "patch"/diff per non appesantire
  la memoria) con un pulsante "Annulla" che ripristina lo stato precedente.
  Va scoping-ato bene: undo di un singolo campo/azione, non un time-travel
  completo — probabilmente basta tenere le ultime N (es. 20) modifiche prima
  del salvataggio corrente.

**Nota:** l'avviso "hai modifiche non salvate" prima di chiudere/uscire
(`beforeunload`, o intercettare `onExit`) è a basso sforzo e ad alto valore —
va quasi sempre insieme a queste due funzionalità.

---

## 3. 🔲 Esportazione / Importazione del menù in JSON

**File coinvolti:** `src/Admin.jsx` (`AdminPanel`, dove vivono i pulsanti di
azione come "Ripristina menù predefinito"), `src/shared.jsx` (forma dei dati:
vedi `DEFAULT_MENU` come riferimento della struttura completa da esportare).

**Obiettivo (richiesto dal proprietario):** un modo rapido per scaricare
l'intero menù corrente come file `.json` (backup manuale, prima di modifiche
rischiose, o per spostare il menù su un altro ambiente), e per ricaricarlo da
un file `.json` in futuro.

**Proposta implementativa:**
- **Export**: pulsante nel pannello Admin che serializza lo stato `menu`
  corrente (`JSON.stringify(menu, null, 2)`) e lo offre come download (blob +
  link `<a download>` generato al volo, revocato dopo il click).
- **Import**: `<input type="file" accept="application/json">` che legge il
  file, fa `JSON.parse`, **valida la forma** prima di sostituire lo stato
  (controllare almeno: è un oggetto, ha `categories` come array, ogni
  categoria ha `items` come array — per evitare che un JSON malformato o
  incollato da un'altra fonte mandi in crash l'editor o salvi dati corrotti
  su Firestore). In caso di validazione fallita, errore chiaro invece di
  accettare silenziosamente.
- Import **non** salva automaticamente su Firestore: sostituisce solo lo
  stato locale di `menu` nell'editor (come fa già `onReset`), lasciando
  all'admin la scelta consapevole di premere "Salva modifiche" dopo aver
  rivisto l'anteprima. Coerente con il pattern già esistente di
  `handleReset`.
- Considerare un piccolo controllo di dimensione/campo `image` (come già
  fatto in `handleSave` in `MenuApp.jsx` con il limite di 900KB) per evitare
  che un import con immagini incollate come base64 superi i limiti di
  Firestore al salvataggio successivo.

**Collegamento con il punto 4bis:** definire il formato JSON di export/import
per primo, poi riusare esattamente quel formato per `DEFAULT_MENU` (vedi
4bis) — così esiste un solo schema dati JSON in tutto il progetto, invece di
uno per l'export e uno (implicito, nell'oggetto JS) per il default.

---

## 4bis. 🔲 Spostare `DEFAULT_MENU` fuori dal codice sorgente (in JSON) — collegato al punto 3

**File coinvolti:** `src/shared.jsx` (`DEFAULT_MENU`, oggi ~180 righe di
oggetto JS letterale), `src/MenuApp.jsx` (usa `DEFAULT_MENU` come fallback
quando Firestore è lento/offline/documento assente), `src/Admin.jsx`
(pulsante "Ripristina menù predefinito" → `onReset` → `handleReset` in
`MenuApp.jsx`, che assegna `DEFAULT_MENU` allo stato).

**Obiettivo (richiesto dal proprietario):** togliere i dati statici del menù
scritti a mano dentro il codice sorgente e tenerli invece come JSON, **nello
stesso formato che avrà il file esportato dal punto 3** — così il "menù di
default" è, letteralmente, un file che si potrebbe ottenere esportando il
menù reale, non un oggetto JS mantenuto a mano e duplicato concettualmente
dal formato di export.

**Attenzione — tensione da risolvere prima di implementare, non ovvia dal
solo codice:** `DEFAULT_MENU` oggi non è un semplice "dato di esempio": è il
fallback usato apposta per garantire che l'app mostri sempre qualcosa anche
a **connessione assente al primissimo avvio** (vedi il commento in testa a
`src/MenuApp.jsx` e la logica `LOAD_TIMEOUT_MS`). Perché questa garanzia
regga, il dato deve essere già disponibile nel browser **senza bisogno di
un'altra richiesta di rete** — cioè deve restare dentro il bundle JS iniziale
già scaricato. Le strade per "toglierlo dal codice" hanno effetti diversi su
questa garanzia:
1. **Import statico di un file `.json`** (`import defaultMenu from
   "./default-menu.json"`): Vite lo inserisce comunque nel bundle in fase di
   build. Risolve "niente più oggetto JS scritto a mano dentro `shared.jsx`,
   un solo formato dati condiviso con l'export/import", **ma non riduce il
   peso del bundle** — l'obiettivo di "rimuoverlo dal bundle", se inteso
   come riduzione di peso, non verrebbe raggiunto con questa opzione.
2. **`fetch()` a runtime di `public/default-menu.json`**: riduce
   davvero il bundle iniziale, ma introduce una richiesta di rete in più
   proprio nello scenario (connessione assente/lentissima al primo avvio)
   in cui il fallback deve funzionare *senza* rete — rischia di vanificare
   la garanzia attuale, a meno di aggiungere un service worker che precachi
   quel file dopo la prima visita andata a buon fine.
3. **Chunk separato via `import()` dinamico**: via di mezzo tra 1 e 2 —
   fuori dal bundle principale, ma scaricato (e quindi cacheabile dal
   browser) solo alla prima esecuzione che lo richiede davvero; stessa
   fragilità dell'opzione 2 al primissimo avvio in assoluto, prima che
   qualsiasi cache esista.

**Raccomandazione per chi affronta questa voce:** decidere esplicitamente se
l'obiettivo principale è "niente più dati scritti a mano nel codice sorgente,
un solo formato condiviso con l'export" (→ opzione 1, banale, nessun rischio)
oppure "ridurre davvero il peso del bundle iniziale" (→ opzione 2 o 3, ma
richiede anche di riconfermare/adattare la garanzia di fallback offline
descritta in `src/MenuApp.jsx`, eventualmente con un service worker). Non
implementare l'opzione 2/3 senza aver prima verificato che il caso "primo
avvio in assoluto, zero rete" resti gestito come oggi.

---

## 4. 🔎 Storico versioni del menù (DA ANALIZZARE prima di implementare)

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
  gli ultimi M giorni) e chi/cosa fa la pulizia (lato client al momento del
  salvataggio è semplice ma fragile; lato Cloud Function è più affidabile ma
  più complesso).
- **Costo.** Ogni salvataggio diventerebbe (almeno) due scritture Firestore
  invece di una. Per un menù che cambia poche volte a settimana è
  trascurabile; va comunque tenuto presente se in futuro il salvataggio
  diventasse più frequente (es. con l'autosave della voce 2 — **attenzione**:
  l'autosave della voce 2 è pensato come bozza *locale*, non deve mai
  scrivere su Firestore, altrimenti moltiplicherebbe lo storico inutilmente).
- **UI per navigare e ripristinare.** Serve una vista (probabilmente dentro
  Admin) che elenchi le versioni passate con data/ora, permetta un'anteprima
  prima di ripristinare, e confermi prima di sovrascrivere il menù corrente
  con una versione vecchia (con lo stesso pattern di conferma già usato per
  eliminare categorie/voci in `Admin.jsx`, vedi `confirmDelete`).

**Raccomandazione:** questa voce va discussa e progettata (anche solo in una
sessione di planning, non implementazione) prima di scrivere codice — le
decisioni sopra cambiano parecchio la complessità finale.

---

## 5. 🔲 SEO e discoverability

**File coinvolti:** `index.html` (oggi ha solo `<title>`), `public/`
(mancano `robots.txt`, `sitemap.xml`), nessun structured data.

**Stato attuale:** nessuna `meta description`, nessun tag Open Graph
(quindi condividendo il link su WhatsApp/Facebook/Instagram non compare né
immagine né descrizione — proprio i canali social che il footer del menù
promuove già, vedi i pulsanti social in `src/ClientView.jsx`), nessun
`robots.txt`/`sitemap.xml`, nessun dato strutturato `schema.org`
(`Restaurant`/`Menu`) che aiuterebbe Google a mostrare il menù direttamente
nei risultati di ricerca locale.

**Perché conta:** per un locale che vive di traffico "Google/social → sito",
è probabilmente il miglioramento con più ritorno per lo sforzo più basso di
tutta questa lista — sono quasi tutte modifiche statiche, senza logica
applicativa da scrivere.

**Cosa aggiungere:**
- `meta description` e `og:title`/`og:description`/`og:image`/`og:type` in
  `index.html` (l'immagine OG può riusare `public/logo.jpg` o una foto del
  locale, dimensioni consigliate 1200×630).
- `robots.txt` e `sitemap.xml` in `public/`.
- Dato strutturato JSON-LD `schema.org/Restaurant` (nome, indirizzo, link
  social) e, se conviene mantenerlo aggiornato senza troppo sforzo,
  `schema.org/Menu`/`MenuItem` per i piatti principali.
- `lang` dinamico su `<html>` se in futuro si vuole servire contenuto
  multilingua anche ai motori di ricerca (oggi è fisso `lang="it"`, coerente
  col fatto che oggi la traduzione è solo client-side — collegato alla voce
  1).

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
  autenticati (editing, upload immagini Cloudinary, link social) non sono
  coperti da Playwright — nessun account di test configurato. È il rischio
  più alto di regressioni silenziose su ogni nuova modifica a `Admin.jsx`.
- **Igiene `.env.example`**: nota storica — il 2026-08-31 il file conteneva
  temporaneamente credenziali reali (Firebase + Cloudinary) invece dei
  placeholder vuoti, in staging pronto per un commit. Se ricapita, va
  ripulito prima di qualsiasi commit (`git restore --staged .env.example` +
  rimettere i placeholder).

---

## Come usare questo documento in una nuova sessione

Esempio di prompt minimo per una sessione a contesto zero:

> Leggi `ROADMAP.md` nella root del progetto. Occupati della voce "2.
> Autosave e Annulla ultima modifica". Implementa, poi verifica con
> `npm run test:e2e` come richiesto da `CLAUDE.md`.

Aggiorna lo stato (🔲/🔎/✅) e aggiungi note man mano che le voci vengono
affrontate, così il documento resta la fonte di verità aggiornata invece di
sfasarsi rispetto al codice.
