# Stampa preconti alla cassa — client Windows "Masseria Cassa"

Il preconto (documento **non fiscale**) si stampa sulla stampante termica
della cassa premendo "Stampa", da qualunque dispositivo dello staff: il
telefono di un cameriere, un tablet o la cassa stessa. Sulla stessa
stampante esce anche la **comanda per la cucina** a ogni "Invia comanda",
solo con i piatti segnati "In comanda" (§2.1).

**Download dell'installer:**
[Masseria-Cassa-Setup.exe](https://github.com/Octavian-Alexandru-Dev/menu-masseria/releases/latest/download/Masseria-Cassa-Setup.exe)
(Windows 10/11 a 64 bit, sempre l'ultima versione).

## 1. La stampante

| | |
|---|---|
| Etichetta | Buffetti PRT 105 (stampante termica non fiscale, 80 mm, Ethernet) |
| Modello reale | **POSBANK A6E**, firmware `SV2.00.18R` (letto con `GS I`) |
| Indirizzo | `192.168.1.164`, porta raw **9100**, MAC `44:a8:c2:f1:ee:4e` |
| Protocollo | ESC/POS |
| Larghezza | **42 colonne** in Font A (circa 512 punti stampabili) |
| Code page | **CP858** (`ESC t 19`): accenti italiani ed **€**. CP850 e CP437 stampano "?" al posto dell'euro |
| Taglio | `GS V 66 0` (taglio parziale con avanzamento), verificato |

Questi valori sono stati verificati con prove di stampa reali. **Consiglio:**
riserva l'IP `192.168.1.164` nel DHCP del router per il MAC qui sopra, così
non cambia dopo un riavvio. Se dovesse cambiare comunque, si risolve da
*Impostazioni → Cerca stampanti in rete* (§5).

## 2. Come funziona

```
Telefono cameriere / cassa                   Firestore                    Client Windows (cassa)
  "Stampa" nel preconto  ──addDoc──►  printJobs/{id} status=pending  ──onSnapshot──►  PrintStation.jsx
                                                                            transazione: pending → printing
  "Invia comanda"       ──addDoc──►  (type=kitchen, solo piatti
                                      "In comanda")
  stato in tempo reale  ◄──────────  printing → printed | error  ◄──────  escpos.js → bytes
  (preconto, OrderUi.jsx,                                                  window.mdpDesktop.printRaw
   sotto "Invia comanda")                                                  → main.js → TCP 9100 → stampante
```

- Un browser non può aprire una connessione TCP diretta verso la stampante:
  per questo la stampa passa da una **coda su Firestore** (`printJobs`, vedi
  `docs/data-model.md`) e la esegue il client della cassa.
- **Interfaccia aggiornata a ogni deploy:** il client carica il sito di
  produzione (`https://menu.masseria-della-piana.it/?area=staff`). Anche il
  layout dello scontrino (`src/escpos.js`) e la stazione di stampa
  (`src/PrintStation.jsx`) fanno parte della web app, quindi **ogni deploy
  li aggiorna anche alla cassa**. Il client Windows si limita a inviare byte
  alla stampante e cambia raramente.
- **Aggiornamenti senza interruzioni:** ogni 10 minuti il client controlla
  se il sito è cambiato. Se sì, mostra un banner "È disponibile una nuova
  versione dell'app — Aggiorna ora", senza ricaricare la pagina mentre
  qualcuno sta lavorando. All'avvio il client riparte sempre dalla versione
  più recente.
- **Nessuna stampa doppia:** se ci sono più casse accese, una transazione
  assegna ogni richiesta a una sola cassa.
- **Richieste vecchie:** una richiesta rimasta in coda per più di 10 minuti
  (per esempio con la cassa spenta) viene segnata come "scaduta" e non viene
  stampata.
- **Accesso:** la stazione di stampa si attiva solo dopo il login di un
  account dello staff nel client, perché la coda è protetta dalle regole
  Firestore come le comande.

### Stati della stampa visibili nel preconto

| Stato | Testo mostrato |
|---|---|
| `pending` | "Inviato alla cassa, in attesa…". Dopo 15 secondi: "La cassa non ha ancora preso la stampa: il programma della cassa è acceso e connesso?" |
| `printing` | "Stampa in corso alla cassa…" |
| `printed` | "Stampato alla cassa" |
| `error` | "Stampa non riuscita: <motivo>" e pulsante **Riprova stampa** |
| `expired` | "Richiesta scaduta: nessuna cassa l'ha stampata." e pulsante **Riprova stampa** |

"Stampa dal browser" resta disponibile come alternativa (stampa nativa con
qualunque stampante).

### Contenuto dello scontrino

Logo (convertito per la termica: oro e nero in nero pieno, grigi della casa
retinati), "Preconto - Tavolo N", data e ora, righe (quantità, nome, note,
importo allineato a destra), coperto, **TOTALE** a doppia altezza, riquadro
"**Qualcosa non torna?** Controlla il tuo conto e se trovi un errore, dillo a
uno di noi. Lo sistemiamo subito con un sorriso.", "Grazie e a presto!",
"DOCUMENTO NON FISCALE", taglio.

### 2.1 Comanda per la cucina

In cucina non c'è uno schermo: le comande si appendono al tabellone. A ogni
**Invia comanda** (dal telefono o dalla cassa) la cassa stampa un biglietto
con **solo i piatti appena inviati che hanno "In comanda" acceso** nel menù
(`src/kitchenTicket.js`). Le bevande, per esempio, non si stampano.

- **Il flag "In comanda"** si imposta per ogni piatto: alla cassa in
  *Menù → piatto → In comanda*, oppure per tutta la categoria con *Tutti in
  comanda / Nessuno in comanda*; dal telefono in Gestione menù
  (interruttore "In comanda (stampato in cucina)"). Se un piatto non ha
  ancora il campo vale **sì**: meglio una bibita stampata per sbaglio che un
  piatto che la cucina non vede. Un piatto nuovo eredita l'impostazione
  della sua categoria.
- **Cosa c'è sul biglietto** (`buildKitchenTicket` in `src/escpos.js`):
  - in alto il **numero del tavolo** a dimensione tripla, poi il nome del
    tavolo se c'è;
  - ora, coperti e chi ha inviato;
  - **AGGIUNTA** in negativo se il tavolo aveva già piatti per la cucina;
  - le note del tavolo (allergie) in negativo;
  - i piatti per portata, nell'ordine del menù: nome della categoria, poi
    "2x Orecchiette" a doppia altezza e larghezza (21 caratteri per riga) e
    la nota del piatto in negativo.
- **Pensata per essere letta da lontano e con poca carta:** tutto in
  grassetto, nessun logo, nessun prezzo, nessuna riga vuota né testo finale,
  taglio subito dopo l'ultimo piatto.
- **Righe e comanda insieme:** i piatti inviati e il loro biglietto sono
  scritti in un'unica operazione (`sendOrderLinesWithKitchenTicket` in
  `src/printJobs.js`): con la rete lenta, anche se la pagina si ricarica a
  metà invio, non può succedere che i piatti arrivino sul tavolo senza il
  biglietto. I piatti toccati mentre l'invio è in corso finiscono in una
  nuova bozza, non si perdono.
- **Stato visibile a chi invia:** sotto "Invia comanda" compare "Comanda
  cucina: Stampato alla cassa" (o in attesa, come per il preconto) per il
  biglietto dell'ultimo invio. Se nessun piatto va in cucina, non viene
  stampato nulla e non compare nessuno stato.
- **Una comanda non stampata non si perde:** lo stato è letto dalla coda di
  stampa per ogni tavolo (`useOrderKitchenTickets` in
  `src/usePrintJob.js`), non dallo schermo che l'ha inviata. Se la stampa
  fallisce (carta finita, stampante spenta), scade o si interrompe:
  - il tavolo lo dice nell'elenco dei tavoli, su telefono e cassa
    ("Comanda cucina non stampata", in rosso alla cassa);
  - aprendo il tavolo, da qualunque dispositivo e anche dopo altri invii,
    ogni comanda non stampata ha **Ristampa comanda cucina** (cassa) /
    **Ristampa** (telefono) e **Ignora** (con conferma, se la cucina ha
    già quei piatti);
  - si vede anche mentre si stanno aggiungendo altri piatti.
- **Ordine di stampa:** se la cassa era spenta e trova più richieste in
  coda, le stampa nell'ordine in cui sono state fatte (mai un'AGGIUNTA
  prima della comanda di cui fa parte).
- **Emoji nelle note** (dalla tastiera del telefono): stampate come "?",
  la stampante non le ha.
- **Limite noto:** le modifiche dopo l'invio (quantità cambiata, riga
  rimossa) non stampano un biglietto di variazione. Va detto a voce in
  cucina, oppure si può aggiungere in futuro.

## 3. Installazione sulla cassa

1. Scarica [Masseria-Cassa-Setup.exe](https://github.com/Octavian-Alexandru-Dev/menu-masseria/releases/latest/download/Masseria-Cassa-Setup.exe)
   (se Edge blocca il download, vedi §3.1) ed eseguilo. L'installer non è
   firmato digitalmente, quindi Windows mostra "PC protetto da Windows":
   scegli **Ulteriori informazioni → Esegui comunque**.
2. Si apre a schermo intero. Apri **menu Cassa → Impostazioni stampante →
   Account della cassa**, inserisci email e password dell'account della cassa
   (§3.3) e premi **Salva credenziali**. Da quel momento l'accesso è
   automatico.
3. In Impostazioni premi **Stampa di prova**. Se esce lo scontrino di prova,
   è tutto pronto.
4. Facoltativo: spunta "Avvia all'accensione del computer" e premi **Salva**.

### 3.1 Edge blocca il download

Edge (con Microsoft Defender SmartScreen) blocca gli eseguibili **non firmati
digitalmente** e "scaricati raramente". Il blocco riguarda il singolo file,
quindi **si ripresenterebbe a ogni nuova versione**. Per questo:

- **La soluzione definitiva è l'aggiornamento automatico** (§3.2): dalla
  versione 1.1.0 il programma si aggiorna da solo, senza passare dal browser,
  quindi Edge non entra più in gioco. Il download dal browser serve solo per
  la prima installazione su un PC nuovo (o per passare dalla 1.0.0 alla
  1.1.0, l'ultima volta).
- **Quando serve comunque scaricarlo da Edge:** nel pannello dei download
  (icona freccia in alto a destra) passa sul file bloccato → **⋯ → Mantieni**.
  Se compare "Assicurati di considerare attendibile…", scegli **Mostra
  altro → Mantieni comunque**. Se il pulsante non c'è, prova da un altro
  browser (Chrome mostra un avviso più semplice da superare).
- **Togliere il blocco per davvero, per tutti** richiede di **firmare
  l'installer** con un certificato di firma del codice. L'opzione più
  economica è *Azure Trusted Signing* di Microsoft (abbonamento mensile di
  qualche euro), integrabile nel workflow di release. Prima verifica i
  requisiti di idoneità aggiornati per attività/persone in Italia. Con
  certificati tradizionali (OV) l'avviso sparisce dopo che il file ha
  accumulato "reputazione".
- **Da evitare:** disattivare SmartScreen in Edge
  (`edge://settings/privacy`). Funziona, ma toglie una protezione a tutto il
  computer della cassa.

**Bookmark consigliato** (scarica sempre l'ultima versione, il nome del file
non cambia mai):
`https://github.com/Octavian-Alexandru-Dev/menu-masseria/releases/latest/download/Masseria-Cassa-Setup.exe`

### 3.2 Aggiornamenti e reinstallazione

- **Automatici (dalla 1.1.0):** il programma controlla gli aggiornamenti
  all'avvio e ogni 6 ore e li scarica in background. Un banner in basso
  racconta cosa succede (dalla 1.2.0):
  - "Download dell'aggiornamento del programma (versione X) in corso — 42%.
    Puoi continuare a lavorare.";
  - "Aggiornamento del programma pronto (versione X)…" con **Aggiorna ora**:
    toccandolo compare un conto alla rovescia di 5 secondi ("il programma si
    chiude e si riapre da solo, non riaprirlo nel frattempo"). Poi il
    programma si chiude e l'installer lavora **senza finestre** per circa un
    minuto: una notifica di Windows lo ricorda (dalla 1.3.0). Infine il
    programma si riapre da solo. Se ignori il banner, l'aggiornamento si
    installa alla prossima chiusura;
  - "Aggiornamento del programma non riuscito: riproverà da solo più tardi"
    (chiudibile), per esempio senza internet;
  - dopo il riavvio: "Programma aggiornato alla versione X." per qualche
    secondo.

  Lo stesso vale per l'interfaccia: "È disponibile una nuova versione
  dell'interfaccia" → **Aggiorna ora** → "Aggiornamento dell'interfaccia in
  corso…" → "Interfaccia aggiornata all'ultima versione.". Il semplice
  controllo degli aggiornamenti non mostra nulla. Lo stato si vede in *Impostazioni →
  Aggiornamenti del programma* (con "Controlla aggiornamenti").
- **Installare una nuova versione sopra quella già presente** (es. dal
  bookmark): è un aggiornamento sul posto. L'installer riconosce il
  programma già installato, sostituisce i file e **conserva impostazioni,
  credenziali salvate e accesso**, che stanno in `%APPDATA%\Masseria Cassa`,
  fuori dalla cartella del programma. Se il programma è aperto, l'installer
  chiede di chiuderlo (o lo chiude lui). Non serve disinstallare prima.
- Disinstallando da *Impostazioni di Windows → App* le impostazioni restano
  comunque in `%APPDATA%\Masseria Cassa` (cancellale a mano se vuoi
  ripartire da zero).
- Le modifiche all'interfaccia (sito) **non** passano da qui: arrivano col
  normale deploy (banner "Aggiorna ora" entro 10 minuti).

### 3.3 Creare l'account della cassa

Un account dedicato, invece di quello personale di qualcuno, rende chiaro
chi fa cosa e si può revocare senza toccare gli altri.

1. Da un amministratore, nell'app: **Menù → Impostazioni → Personale →
   Nuovo account**. Nome `Cassa`, email ad esempio
   `cassa@masseria-della-piana.it` (non deve esistere davvero: serve solo
   come nome utente), una password robusta e il ruolo:
   - **Cameriere** (vede la Sala con preconti e chiusura tavoli, oltre a
     storico e prenotazioni);
   - **Amministratore** se alla cassa devono servire anche le sezioni
     **Menù** e **Statistiche** (§4.1).

   **Crea account**: l'account esiste subito, con il suo ruolo, senza passare
   dalla Console Firebase.
2. Sul PC della cassa: *menu Cassa → Impostazioni stampante → Account della
   cassa* → email e password → **Salva credenziali**.

La password viene cifrata con la protezione dati di Windows (DPAPI): è
leggibile solo dallo stesso utente Windows sullo stesso PC, e la riceve solo
il sito dell'app.

## 4. Menu Cassa e impostazioni

Il pulsante con la **rotella delle impostazioni** in basso a sinistra mostra
lo stato della stampante con un pallino:
verde = pronta, arancione = stampa in corso, rosso = errore (il motivo
compare accanto), grigio = serve il login. Toccandolo si apre il **menu
Cassa**:

- **Tastiera**: mostra/nasconde la tastiera virtuale di Windows. Il tipo si
  sceglie in Impostazioni: touch moderna, oppure tastiera su schermo
  classica (una finestra mobile, utile se quella touch non compare).
  Suggerimento: in *Impostazioni di Windows → Ora e lingua → Digitazione →
  Tastiera virtuale* puoi farla comparire **da sola** toccando un campo di
  testo.
- **Esci da schermo intero / Schermo intero** (esce anche dalla modalità
  chiosco).
- **Impostazioni stampante** (anche con Ctrl+Maiusc+P).
- **Chiudi programma**, con conferma: finché è chiuso le stampe dai telefoni
  restano in coda.

**"Esci" (logout) alla cassa chiede conferma.** Dopo un'uscita voluta non
rientra da solo, così si può accedere con un altro account, ma basta un
tocco su **"Accedi come cassa@…"**. Riavviando o ricaricando il programma
l'accesso torna automatico. Sui telefoni "Esci" funziona come prima, senza
conferma.

**"Rientra come …" (telefono e cassa).** Dopo un'uscita, voluta o per
sbaglio, la schermata di accesso mostra sopra email e password l'ultimo
account entrato da quel dispositivo ("Rientra come Mario", con l'email
sotto): un tocco e si rientra, senza riscrivere la password. Email e nome
stanno in `localStorage`; la password è cifrata (AES-GCM) in IndexedDB con
una chiave creata sul dispositivo e non esportabile (`src/lastStaffAccount.js`):
una copia della memoria del browser non la rivela, solo questa pagina su
questo dispositivo può usarla. Se nel frattempo la password è cambiata, il
tocco compila l'email e chiede la password nuova. "Non sei tu?" toglie
suggerimento e password (telefono o portatile condiviso). Alla cassa, se
l'ultimo account è quello salvato nel programma resta solo "Accedi come …",
che usa le credenziali del programma.

Impostazioni:

- **Stampante:** indirizzo IP e porta, **Verifica stato** (raggiungibile,
  modello, carta presente/quasi finita/esaurita, coperchio aperto, offline),
  **Stampa di prova** (funziona anche senza internet), **Cerca stampanti in
  rete** (scansione della rete locale sulla porta 9100, con modello e
  pulsante "Usa questa").
- **Account della cassa:** credenziali salvate e accesso automatico (§3.3).
- **Schermo e tastiera:** avvio a schermo intero, modalità chiosco
  (impedisce di uscire dallo schermo intero da tastiera), zoom
  dell'interfaccia (80–150%, utile sul 12"), avvio automatico, tipo di
  tastiera virtuale.
- **Aggiornamenti del programma:** stato, "Controlla aggiornamenti",
  "Installa e riavvia".
- **Avanzate:** nome della postazione (registrato su ogni stampa),
  indirizzo dell'app, **Ricarica app**, strumenti sviluppatore, **Chiudi
  programma**.

Tasti, se è collegata una tastiera: **F11** schermo intero, **F5** o
**Ctrl+R** ricarica, **Ctrl+Maiusc+P** impostazioni, **Ctrl+Maiusc+I**
strumenti sviluppatore.

Le impostazioni sono salvate in `%APPDATA%\Masseria Cassa\settings.json`,
le credenziali (cifrate) in `login.json` nella stessa cartella.

## 4.1 Interfaccia della cassa (Sala)

Dentro il client Windows la Sala ha un'interfaccia propria, a tutto schermo
e in stile cassa POS (`src/TillSala.jsx`). Usa gli stessi dati e le stesse
regole della Sala da telefono (`src/sala-shared.jsx`), quindi la cassa può
sostituire il telefono di un cameriere: aprire tavoli, prendere e inviare
comande, preconto, chiusura.

- **Un'unica interfaccia, senza Dashboard:** alla cassa si entra subito
  nella Sala. Le sezioni stanno sempre nella barra in alto: **Tavoli ·
  Prenotazioni · Storico** e, per gli account admin, **Menù · Statistiche**.
  A destra ci sono l'ora, il turno e l'utente. L'area Cucina non esiste più
  (né alla cassa né sui telefoni): in cucina arriva la comanda stampata
  (§2.1). Un account rimasto con il vecchio ruolo "cucina" vede un
  messaggio che chiede di cambiargli ruolo.
- **Tavoli:** griglia che riempie lo schermo, ordinata per numero. Ogni
  riquadro mostra numero, nome, coperti, tempo, totale e lo stato **scritto**
  su un colore fisso (vedi *Stato dei tavoli senza cucina* sotto). A destra
  ci sono le prenotazioni di oggi (`ReservationCard`, `OrderUi.jsx`):
  toccando la scheda si apre la prenotazione in Prenotazioni (dettagli,
  modifica, avvio), "Avvia" apre subito il tavolo.
- **Nuovo tavolo:** tastierino numerico a schermo (la cassa non ha
  tastiera), coperti con +/−, nome e note facoltativi. Se il tavolo è già
  aperto lo segnala e offre "Vai al tavolo".
- **Comanda:** a sinistra **tutte le categorie in una griglia** sempre
  visibile (nome, quanti piatti e quanti "da inviare", mai una striscia che
  scorre di lato), la ricerca e i piatti a riquadri con la **foto in
  miniatura** quando c'è (la stessa del menù dei clienti; tocco = +1, con il
  conteggio sul riquadro); a destra, nella barra
  laterale, lo scontrino del tavolo ("Da inviare" e "Già inviato") e, sempre
  nello stesso posto in basso, Totale, **Invia comanda**, **Stampa
  preconto** (stampa diretta, con lo stato della stampa sotto) e **Chiudi
  tavolo** (con conferma).
- **Modifica di una riga** (anche già inviata): si tocca la riga nello
  scontrino e l'editor si apre **nella barra laterale**, senza cambiare
  schermata (il totale e il tavolo restano in vista: è il modello delle
  casse POS più diffuse). Si possono cambiare **quantità**, **prezzo**
  (*Pieno*, *Offerto* = 0 €, sconti rapidi *−10/−20/−50%*, *Altro* = prezzo
  libero dal tastierino, in centesimi come sulle casse), **nota** e
  **rimuovere** la riga (con conferma se già inviata). Nulla cambia finché
  non si preme **Salva**. Il prezzo cambiato resta sulla riga con il motivo
  ("Offerto", "Sconto 20%", "Prezzo modificato") e il prezzo del menù: tutti
  i totali (preconto, storico, statistiche) usano il prezzo effettivo, e sul
  preconto stampato compare ad esempio "Caprese (offerto)". Con il preconto
  confermato le righe già inviate sono bloccate.
- **Stato dei tavoli senza cucina:** non c'è un tablet in cucina, quindi la
  cassa non mostra più stati "uscita": i riquadri dicono *Da ordinare*,
  *Comanda inviata* (verde) o *Preconto stampato / confermato* (blu).
- **Storico:** elenco delle comande chiuse per giorno a sinistra, dettaglio
  nella barra laterale con **Ristampa preconto** (e, per l'admin, elimina
  dallo storico con conferma).
- **Prenotazioni:** calendario grande a sinistra (per ogni giorno
  prenotazioni e coperti), prenotazioni del giorno al centro con lo stato
  scritto (*Prenotata*, *Al tavolo*, *Annullata*…), scheda o modulo nella barra
  laterale. Nel modulo gli orari si scelgono a tocco (gli stessi del modulo
  di prenotazione del sito: pranzo 12:30–14:30, cena 20:00–22:30), coperti e
  tavolo con +/−; un solo **Salva prenotazione** (nasce già confermata, non
  c'è più "da confermare"); azioni Modifica / Annulla e **Avvia**
  (il giorno stesso: apre il tavolo, chiedendo il numero col tastierino se
  manca).
- **Menù** (solo admin, `src/TillMenu.jsx`): stesso schema della comanda.
  A sinistra le categorie in griglia (con quanti piatti, "nascosta" se lo è)
  e i piatti a riquadri con la foto in miniatura; ogni riquadro dice
  prezzo e, scritto, *Non in comanda*, *Nascosto* o *Fuori menù*.
  - **Piatto nella barra laterale**: nome, prezzo dal tastierino (in
    centesimi; parte dal prezzo attuale e la prima cifra ne inizia uno
    nuovo) o "Su richiesta", interruttori grandi *In comanda* /
    *Disponibile* / *Fuori menù*, descrizione, etichetta, costo interno (dal
    tastierino), tag di ricerca, foto, categoria. Nulla cambia finché non si
    preme **Salva** (bloccato finché un tastierino è aperto: si conferma con
    «Usa»). In un piatto nuovo *In comanda* segue la categoria scelta, finché
    non lo si tocca a mano.
    *Sposta prima/dopo* ed *Elimina* (con conferma) agiscono subito.
  - **Nessun piatto selezionato**: la barra mostra la categoria (nome,
    sottotitolo, visibilità, *Tutti/Nessuno in comanda*, posizione,
    eliminazione).
  - **Impostazioni** (`src/MenuSettings.jsx`): un elenco, ogni voce un
    pannello con **Salva** in fondo — *Locale e grafica* (nome, località,
    frase di apertura, nota a piè di pagina, tema), *Coperto e ricerca*
    (coperto adulti/bambini dal tastierino, ricerca piatti), *Link e social*
    (recensioni Google/TripAdvisor, Instagram, Facebook, shop: link e
    interruttore "Mostra"), *Traduzioni* (per lingua: traduzione automatica
    dei testi mancanti, ogni testo correggibile a mano, eliminazione con
    conferma), *Personale* (nuovo account con nome, email, password
    e ruolo, oppure ruolo a un account esistente dal suo UID; "Togli
    accesso" con conferma, mai sul proprio account), *Stampa del menù* (lingua, contenuto, impaginazione,
    categorie → anteprima di stampa / PDF), *Backup* (scarica il JSON;
    ripristino da file con conferma, subito su tutti i dispositivi) e *Vedi
    il menù dei clienti*. Non c'è più un editor "completo" separato (ex
    `Admin.jsx`): tutto il menù si gestisce da qui, con una modifica alla
    volta salvata subito sul server — non esistono più modifiche "in
    sospeso" da salvare o scartare.
  - **Ogni "Salva" modifica solo i campi cambiati di quel piatto o di quella
    categoria** (non quelli rimasti com'erano all'apertura del pannello),
    dentro una
    transazione sul menù com'è sul server in quel momento: la cassa resta
    aperta tutto il giorno e non riscrive mai la sua copia intera,
    cancellando ciò che è stato cambiato nel frattempo da un telefono. Le
    modifiche fatte altrove compaiono da sole, senza ricaricare (anche nella
    Sala: prezzi e piatti nuovi).
- **Statistiche** (solo admin, `src/TillStats.jsx`): periodo a tocco (Oggi,
  Ieri, Ultimi 7 giorni, Ultimi 30 giorni, Mese corrente, Anno corrente) o
  date libere (Personalizzato), numeri grandi (incasso, scontrino medio,
  coperti, comande, piatti, margine), confronto con il periodo precedente o
  con un altro periodo (variazione scritta con freccia), classifica dei
  piatti per quantità/incasso/margine e, nella barra laterale, piatti
  ordinati meno, incasso per categoria, per cameriere, per ora e per giorno
  della settimana — elenchi con barre, leggibili senza grafici. Sezioni con
  il titolo, sempre nello stesso ordine: **Vendite**, **Visite al menù**,
  **Piatti più venduti**, poi i dettagli. *Visite al menù*
  (`src/menuViews.js`): visite nel periodo (con la variazione se c'è un
  confronto), media al giorno, giorno migliore e un grafico a colonne (una al
  giorno, una al mese oltre i ~2 mesi; tocco su una colonna → giorno e
  numero) oppure l'elenco. Una visita = un dispositivo che apre il menù
  pubblico in un giorno; non contano i dispositivi dello staff né la cassa.
- **Stampa interrotta:** se il programma della cassa si chiude mentre sta
  stampando, dopo 30 secondi chi ha chiesto la stampa vede "La stampa si è
  interrotta" e può premere **Riprova stampa**.
- **Niente "Esci"** in nessuna parte della web app alla cassa (client
  ≥ 1.4.0): il logout è in *Impostazioni → Account della cassa → Esci
  dall'account…*, nascosto in un pannello richiudibile e con doppia
  conferma. Le credenziali restano salvate: per rientrare basta "Accedi come …".

Principi seguiti (nessuna invenzione da zero):

- **Bersagli touch ≥ 48px**, distanziati: Material Design (48dp), Apple
  Human Interface Guidelines (44pt), WCAG 2.2 — 2.5.5 (44px, AAA) e 2.5.8
  (24px, minimo AA).
- **Icone con etichetta di testo sempre visibile**, in particolare per la
  navigazione (Nielsen Norman Group, "Icon Usability"): da qui il pulsante
  **Indietro** con freccia + testo, alto 48px e con bordo, sempre in alto a
  sinistra, sia sul telefono sia alla cassa (`BackButton` in `shared.jsx`).
- **Pratiche comuni delle casse per la ristorazione:** stato dei tavoli
  leggibile senza aprirli, colore mai unico indicatore, schermate semplici
  e senza ingombri durante la presa della comanda, comandi sempre nella
  stessa posizione, pensare a chi la usa per la prima volta.
- **Euristiche di Nielsen:** visibilità dello stato del sistema
  (sincronizzazione, stampa, aggiornamenti), prevenzione degli errori
  (conferme, tavolo già aperto), riconoscere invece di ricordare (riquadri e
  schede invece di codici).

Ogni funzione nuova va fatta in entrambe le versioni (regola in `CLAUDE.md`).

### 4.2 App del telefono (area staff)

Sul telefono (e in qualunque browser fuori dalla cassa) l'area staff è
un'app sola, `src/PhoneApp.jsx`, costruita con gli stessi principi e gli
stessi pezzi della cassa (`TillUi.jsx`, `OrderUi.jsx`), disposti per
l'uso a una mano su uno schermo da 6":

- **Niente Dashboard:** dopo l'accesso si apre subito **Tavoli**. Le sezioni
  stanno nella **barra in basso** (Tavoli · Prenotazioni · Storico e, per
  gli admin, Menù · Statistiche), con icona ed etichetta sempre visibili; i
  tavoli aperti sono il badge su Tavoli. In alto: nome della sezione, chi è
  collegato, il turno, **Zoom** ed "Esci". La sezione resta nell'URL (`?sezione=…`):
  il tasto Indietro e un ricaricamento restano lì.
- **Tavoli:** riquadri a due colonne (numero, nome, coperti, tempo, totale,
  stato scritto su colore fisso come alla cassa); **Nuovo tavolo** è il
  pulsante flottante in basso a destra. Il modulo del nuovo tavolo è a
  schermo intero (numero dalla tastiera numerica del telefono, coperti con
  +/−, avviso se il tavolo è già aperto con "Vai al tavolo"). In cima, le
  prenotazioni di oggi (stessa `ReservationCard` della cassa): toccando la
  scheda si apre la prenotazione in Prenotazioni, "Avvia" apre subito il
  tavolo.
- **Comanda:** schermata intera senza le barre dell'app. In alto il tavolo e
  i coperti; sotto, la ricerca e, già all'apertura, le **categorie in una
  griglia** (nome, quanti piatti, quanti "da inviare"): tutte visibili a
  colpo d'occhio senza toccare nulla, un tocco porta alla sezione. Quando la
  griglia esce dallo schermo compare sotto la ricerca il pulsante
  **Categorie · (categoria in vista)**, che segue lo scorrimento e riapre la
  griglia da qualunque punto; tornando in cima sparisce. I piatti a **riquadri in due
  colonne: un tocco = uno in più**, con il conteggio sul riquadro e la foto
  in miniatura quando c'è. In basso una barra che non si sposta mai: **Comanda** (quanti da
  inviare e totale) a sinistra, **Invia comanda (N)** — o **Preconto**
  quando non c'è nulla da inviare — a destra. Lo stato della comanda per la
  cucina (e "Ristampa"/"Ignora" se non è stata stampata) sta sopra la barra.
- **Comanda del tavolo** (tocco su "Comanda"): pagina a schermo intero con
  "Da inviare" (− / + su ogni riga; con una sola porzione il "−" diventa
  "Rimuovi") e "Inviata", totale, Invia comanda, Preconto e **Chiudi
  tavolo** (con conferma). Toccando una riga si apre la **modifica riga**
  della cassa: quantità, nota per la cucina, prezzo (Pieno, Offerto,
  −10/−20/−50%, Altro dal tastierino), Rimuovi — tutto solo con **Salva**.
- **Menù** (solo admin): la stessa schermata della cassa (`TillMenu.jsx`,
  `MenuSettings.jsx`) in una colonna: categorie in griglia, riquadri dei
  piatti con la foto, "Nuovo piatto", e in alto Nuova categoria / Impostazioni. Il
  piatto, la categoria e ogni impostazione si aprono a pagina intera con
  **Salva** sempre in fondo; ogni "Salva" modifica solo i campi cambiati.
- **Prenotazioni, Storico, Statistiche**: le stesse schermate della cassa
  (`TillReservations.jsx`, `TillHistory.jsx`, `TillStats.jsx`) in una
  colonna, con la scheda o il modulo a pagina intera. "Avvia" di una
  prenotazione porta ai Tavoli e apre la comanda; al contrario, toccando una
  delle prenotazioni di oggi nei Tavoli si apre la sua scheda in
  Prenotazioni (tornando poi a Prenotazioni dalla barra si riparte
  dall'elenco). Lo Storico apre ogni
  comanda come preconto (ristampa, "Stampa dal browser", per l'admin
  eliminazione e "Svuota storico", sempre con conferma). Le Statistiche
  hanno periodi a tocco o date libere, confronto con il periodo precedente
  o con un altro periodo, classifiche, incasso per ora e per giorno della
  settimana, piatti ordinati meno.
- **Preconto** (dalla comanda): pagina intera con l'anteprima del
  documento non fiscale, **Stampa** (alla cassa, con lo stato in tempo
  reale), "Stampa dal browser" e **Conferma preconto** (con conferma: le
  righe inviate non si modificano più). Per togliere una riga si usa la
  modifica riga, come alla cassa.
- **Accesso e messaggi** (`staff-shared.jsx`): la schermata di accesso,
  "Rientra come …" e i messaggi (account senza ruolo, ecc.) usano gli
  stessi pezzi e lo stesso aspetto dell'app.
- **Zoom** (solo telefono e tablet, `src/displayZoom.js`): dalla barra in
  alto, pagina intera con i livelli 80–150%. L'anteprima è immediata (la
  pagina si ridispone davvero: il livello cambia la larghezza del meta
  viewport, quindi anche la disposizione telefono/tablet di
  `useCompactLayout`); **Salva** lo tiene nel `localStorage` del dispositivo,
  tornando indietro senza salvare si torna al livello di prima. Su un
  computer la pagina rimanda allo zoom del browser (Ctrl/⌘ + e −), che lì
  esiste già. **Non c'è alla cassa**: il client Windows ignora il meta
  viewport e lo schermo della cassa è fisso.
- **Tablet** (oltre 760px di larghezza, es. 10" in verticale; un 7" in
  verticale usa la disposizione del telefono): i Tavoli usano tutta la
  larghezza (più colonne di tavoli, prenotazioni di oggi e chiusi nel
  turno affiancati); la comanda di un tavolo è divisa come alla cassa —
  piatti a sinistra, **comanda sempre visibile in una colonna a destra**
  (Invia, Preconto, Chiudi tavolo), dove si aprono anche la modifica riga e
  il preconto; niente barra in basso. Prenotazioni, Storico, Menù e
  Statistiche avevano già la disposizione della cassa.
- **Numero prima del nome:** ovunque (tavoli, comanda, Storico, preconto
  stampato) il tavolo è "Tavolo N" in grande e il nome (della prenotazione o
  scelto all'apertura) piccolo, in secondo piano (`tableIdentity`). Anche la
  scheda di una prenotazione di oggi nei Tavoli, se ha già il tavolo, mostra
  prima il numero.
- **Installabile:** nell'area staff (solo lì, non nel menù pubblico) c'è il
  manifest `public/staff.webmanifest`: da Chrome/Safari "Aggiungi a
  schermata Home" la apre a tutto schermo come un'app.

Principi in più rispetto alla cassa, per il telefono: azioni principali
nella parte bassa dello schermo, raggiungibile col pollice; barra di
navigazione in basso con 3–5 destinazioni (Material Design); schermate
operative a pagina intera invece di finestre sovrapposte; testo ≥ 16px nei
campi (niente zoom automatico su iOS); nessuno scorrimento laterale a
393px di larghezza.

## 5. Risoluzione problemi

| Sintomo | Cosa fare |
|---|---|
| Sul telefono resta "La cassa non ha ancora preso la stampa" | Il client della cassa è acceso? È stato fatto il login (pallino non grigio)? La cassa è connessa a internet? |
| "La stampante non risponde" / "Indirizzo non raggiungibile" | Stampante accesa, cavo di rete collegato? Poi **Verifica stato**. Se l'IP è cambiato: **Cerca stampanti in rete → Usa questa → Salva**. |
| "Carta esaurita" | Sostituisci il rotolo, poi **Riprova stampa** dal preconto. Per le comande cucina: i tavoli con "Comanda cucina non stampata" → apri il tavolo → **Ristampa comanda cucina**. |
| Una bibita esce sulla comanda della cucina (o un piatto non esce) | Cassa → Menù → tocca il piatto → **In comanda** → Salva. Per tutte le bevande insieme: scheda Bevande → **Nessuno in comanda**. |
| Alla cassa non ci sono Menù e Statistiche | Servono a un account **admin**: cambia `role` dell'account della cassa (§3.3). |
| Caratteri strani al posto di accenti o € | La stampante non è in CP858: segnalalo, il layout si corregge in `src/escpos.js` con un semplice deploy. |
| Schermata "Impossibile caricare l'app" | Manca internet sulla cassa. La pagina riprova da sola ogni 30 secondi, oppure premi **Riprova**. |
| Interfaccia troppo piccola o grande | Impostazioni → Zoom interfaccia. |
| "Accesso automatico non riuscito" | Password dell'account della cassa cambiata: aggiornala in Impostazioni → Account della cassa. |
| La tastiera touch non compare | Impostazioni → Tastiera virtuale → "Tastiera su schermo classica". |
| Il programma "non si apre" subito dopo un aggiornamento | Probabilmente l'installer sta ancora lavorando: aspetta un minuto, si riapre da solo. Dalla 1.3.0 riaprirlo in quel momento mostra la notifica "Aggiornamento in corso" ed esce senza fare danni; se è già aperto, toccare l'icona porta in primo piano la finestra esistente (mai una seconda copia). Nel Task Manager **una** sola copia del programma conta comunque 5–6 processi "Masseria Cassa" (principale, GPU, rete, pagina…): è normale. |
| Comportamenti strani da capire | Impostazioni → Avanzate → **Apri cartella log** (`%APPDATA%\Masseria Cassa\logs\main.log`): avvii, seconde aperture, aggiornamenti, errori di caricamento. |
| Download dell'installer bloccato da Edge | §3.1. Dalla 1.1.0 non serve più riscaricarlo: si aggiorna da solo. |

## 6. Sviluppo e rilascio

- Codice: `desktop-client/` (Electron 44). `src/main.js` (finestra, IPC,
  controllo aggiornamenti del sito), `src/printer.js` (TCP, stato, ricerca,
  stampa di prova), `src/keyboard.js` (tastiera virtuale), `src/credentials.js`
  (account della cassa, cifrato con safeStorage), `src/updater.js`
  (aggiornamento automatico del client, electron-updater), `src/preload.js` (bridge `window.mdpDesktop`, contratto
  in `src/desktop.js` della web app), `src/settings.*` (finestra impostazioni).
- Sicurezza: `contextIsolation` + `sandbox` attivi. Ogni chiamata del bridge
  viene accettata solo se arriva dall'origine dell'app configurata. I link
  ad altri siti si aprono nel browser di sistema.
- Avvio locale: `cd desktop-client && npm install && npx install-electron &&
  npm start`. Per puntarlo all'emulatore, imposta in Impostazioni
  l'indirizzo dell'app `http://localhost:5173/?area=staff` (con
  `npm run dev:local` avviato).
- Installer: `npm run dist:win` (funziona anche da macOS) genera
  `desktop-client/dist/Masseria-Cassa-Setup.exe` (+ `latest.yml` per gli
  aggiornamenti automatici).
- **Rilascio:** aggiorna `version` in `desktop-client/package.json`, poi
  `git tag cassa-v1.1.1 && git push origin cassa-v1.1.1` (la versione del tag
  vince comunque su quella del file).
  Il workflow `.github/workflows/desktop-client-release.yml` costruisce
  l'installer su Windows e lo pubblica come ultima GitHub Release, che è il
  file a cui punta il link di download. Serve **solo** quando cambia
  `desktop-client/`; il resto arriva con il normale deploy.

## 7. Matrice di copertura dei test

| Comportamento | Test |
|---|---|
| Codifica CP858 (accenti, €, caratteri tipografici, lettere sconosciute) | `tests/escpos.spec.js` |
| Nessuna riga oltre le 42 colonne; importo a destra sulla prima riga | `tests/escpos.spec.js` |
| Contenuto dello scontrino (righe, note, coperto, totale, messaggio, non fiscale, taglio) | `tests/escpos.spec.js` |
| Logo → raster `GS v 0` largo quanto la carta; fallback testuale senza logo | `tests/escpos.spec.js` |
| Telefono: "Stampa" accoda, stato "in attesa" con cassa spenta | `tests/receipt-printing.spec.js` |
| Cassa accesa dopo: prende la richiesta in coda, stampa, il telefono vede "Stampato" | `tests/receipt-printing.spec.js` |
| Browser normale: niente pulsante stampante, "Stampa dal browser" presente | `tests/receipt-printing.spec.js` |
| Errore di stampa: messaggio sul telefono, pallino rosso alla cassa, "Riprova stampa" | `tests/receipt-printing.spec.js` |
| Richiesta in coda da oltre 10 minuti → `expired`, non stampata | `tests/receipt-printing.spec.js` |
| Client Electron vero: carica la web app, espone il bridge, i byte arrivano alla stampante TCP | `tests/desktop-client.spec.js` |
| Impostazioni native: verifica stato, stampa di prova, errore comprensibile su porta sbagliata | `tests/desktop-client.spec.js` |
| Menu Cassa: tastiera, entra/esci da schermo intero, impostazioni, chiudi con conferma (annulla/conferma) | `tests/till-client.spec.js` |
| Client 1.0.0 già installato: il menu mostra solo "Impostazioni stampante" | `tests/till-client.spec.js` |
| Pulsante del menu Cassa: rotella delle impostazioni con pallino di stato | `tests/till-client.spec.js` |
| Banner interfaccia: nuova versione → "Aggiorna ora" → in corso → "Interfaccia aggiornata" dopo il ricaricamento | `tests/till-client.spec.js` |
| Banner programma: download con %, pronto, installazione; errore chiudibile; "Programma aggiornato alla versione X" una sola volta dopo il riavvio | `tests/till-client.spec.js` |
| Accesso automatico con credenziali salvate; credenziali sbagliate → errore comprensibile | `tests/till-client.spec.js` |
| "Esci" alla cassa: conferma, annulla, nessun rientro automatico dopo uscita voluta, rientro con un tocco | `tests/till-client.spec.js` |
| "Esci" nel browser normale: esce subito senza conferma | `tests/till-client.spec.js` |
| "Rientra come …" dopo l'uscita: ultimo account sopra i campi, rientro con un tocco (password mai in chiaro in `localStorage`), password cambiata → email compilata e password da riscrivere, "Non sei tu?" lo toglie; alla cassa anche senza account salvato e senza rientro automatico, nessun doppione con "Accedi come …" | `tests/staff-home.spec.js`, `tests/till-client.spec.js` |
| Seconda apertura del programma: esce subito, la finestra già aperta resta visibile, riga nel log | `tests/desktop-client.spec.js` |
| Aggiorna ora (programma): avviso con conto alla rovescia prima di chiudere | `tests/till-client.spec.js` |
| Client Electron vero: API 1.1.0/1.2.0 (stato schermo intero, nessuna credenziale, stato aggiornamenti "dev"), errore tastiera fuori da Windows | `tests/desktop-client.spec.js` |
| Cassa: griglia dei tavoli a tutta larghezza, schede e "Nuovo tavolo" ≥ 48px | `tests/till-sala.spec.js` |
| Cassa: apertura con tastierino, comanda a riquadri per categoria, nota dall'editor, invio, stato e totale sul riquadro del tavolo | `tests/till-sala.spec.js` |
| Cassa: ricerca piatti, tavolo già aperto segnalato con "Vai al tavolo", chiusura con conferma e tavolo nello Storico | `tests/till-sala.spec.js` |
| Nessun "Esci" alla cassa con client 1.4 (tutte le sezioni e le impostazioni del menù); logout dalle impostazioni senza rientro automatico; "Esci" con conferma per i client 1.1–1.3 | `tests/till-client.spec.js` |
| Telefono: "Indietro" con etichetta e alto almeno 48px | `tests/waiter-order.spec.js` |
| Cassa: modifica riga nella barra laterale (quantità, sconto, offerto, prezzo libero da tastierino), solo con "Salva"; su righe da inviare e già inviate; preconto stampato con "(sconto 20%)"/"(prezzo modificato)" | `tests/till-sala.spec.js` |
| Cassa: rimozione di una riga già inviata con conferma | `tests/till-sala.spec.js` |
| Cassa: nessuno stato "uscita"; riquadro "Comanda inviata" / "Preconto stampato" | `tests/till-sala.spec.js` |
| Cassa: preconto stampato direttamente dalla barra laterale, avviso se ci sono piatti non inviati | `tests/till-sala.spec.js` |
| Cassa: Storico con dettaglio e ristampa preconto | `tests/till-sala.spec.js` |
| Cassa: Prenotazioni — nuova con orari a tocco e un solo "Salva prenotazione" (subito valida, niente "da confermare"), avvio con tastierino che apre il tavolo; calendario con prenotazioni e coperti del giorno | `tests/till-sala.spec.js` |
| Cassa: Tavoli — toccando una prenotazione di oggi si apre la sua scheda in Prenotazioni (giorno e riga selezionati) e da lì si avvia; il tasto rapido "Avvia" sulla scheda apre subito il tavolo | `tests/till-sala.spec.js` |
| Cassa: Prenotazioni — un'avviata lascia l'elenco del giorno e si ritrova tra "avviate, annullate e non presentate"; il cameriere non la elimina (né pulsante né swipe); l'admin la elimina dalla scheda con conferma e il tavolo resta aperto ("Tavolo N (nome)"); swipe lungo col mouse → conferma → eliminata dal server | `tests/till-sala.spec.js` |
| Prenotazioni (telefono): avviata fuori dall'elenco del giorno e tra le avviate, cameriere senza "Elimina" né swipe; admin elimina un'annullata dalla scheda (≥ 48px, "Indietro" la lascia, sparisce anche dopo il ricaricamento); swipe corto scopre "Elimina" senza aprire la scheda, lungo chiede subito conferma | `tests/reservations.spec.js` |
| Regole Firestore: le prenotazioni le elimina solo un admin; quelle scadute anche un cameriere (pulizia automatica) | `tests/firestore-rules.spec.js` |
| Numero prima del nome: scheda di una prenotazione di oggi con tavolo assegnato ("Tavolo N · ora", nome sotto), intestazione della comanda "Tavolo N · nome", riquadro del tavolo "Tavolo N (nome)"; alla cassa "Comanda — Tavolo N" | `tests/reservations.spec.js`, `tests/till-sala.spec.js` |
| Zoom (telefono): dalla barra in alto (≥ 48px), anteprima immediata, "Indietro" senza salvare la annulla, "Salva" in fondo la tiene dopo il ricaricamento (`localStorage`), al 150% nessuno scorrimento laterale e comandi ≥ 48px, ritorno al 100%; dal computer rimanda allo zoom del browser | `tests/phone-app.spec.js` |
| Tablet 10" (800×1280): tavoli a tutta larghezza; comanda in una colonna sempre visibile accanto ai piatti (nessuna pagina intera né barra in basso), aggiunta e invio da lì, preconto nella stessa colonna e ritorno; con lo zoom al 125% passa alla disposizione del telefono | `tests/phone-app.spec.js` |
| Comanda per la cucina: solo piatti "In comanda", ordine del menù, piatti tolti dal menù stampati, AGGIUNTA solo se c'erano già piatti per la cucina, niente da stampare con sole bevande | `tests/escpos.spec.js` |
| Comanda stampata: tavolo a dimensione tripla, piatti a doppia (≤ 21 colonne), note e AGGIUNTA in negativo, grassetto, niente prezzi/logo, taglio subito | `tests/escpos.spec.js` |
| Piatto nuovo: "In comanda" ereditato dalla categoria | `tests/escpos.spec.js`, `tests/till-sala.spec.js` |
| Cassa: "Invia comanda" stampa la comanda (senza bevande), stato "Comanda cucina", nessuna stampa con sole bevande, AGGIUNTA al secondo invio | `tests/till-sala.spec.js` |
| Telefono: dopo "Invia comanda" lo stato della comanda cucina è visibile (in attesa con cassa spenta) | `tests/waiter-order.spec.js` |
| Comanda cucina non stampata (errore): tavolo segnalato nell'elenco, ristampa riaprendo il tavolo anche dopo altri invii e mentre si aggiungono piatti, "Ignora" con conferma | `tests/till-sala.spec.js`, `tests/waiter-order.spec.js` |
| Emoji nelle note stampate come "?", andare a capo sui caratteri stampati | `tests/escpos.spec.js` |
| Aggiungere un piatto/una categoria due volte (riprova dopo timeout) non crea copie | `tests/menu-edit.spec.js` |
| Telefono: comandi del tavolo (coperti, piatti, categorie, barra in basso, quantità, rimuovi, modifica riga, Invia comanda) ≥ 44px | `tests/waiter-order.spec.js` |
| Telefono 6" (393×851): nessuna schermata scorre di lato (sezioni, comanda, comanda del tavolo, modifica riga); barra delle sezioni in fondo con etichette intere | `tests/phone-app.spec.js` |
| Telefono: un tocco = un piatto in più col conteggio sul riquadro; "Invia comanda" nella barra in basso; riga inviata resa "Offerto" dall'editor con "Salva" | `tests/phone-app.spec.js` |
| Telefono: tutte le categorie in una griglia in cima, già tutta visibile all'apertura senza toccare nulla (con piatti e "da inviare", ≥ 48px, niente scorrimento laterale), che porta alla sezione; passata la griglia compare il pulsante "Categorie: …" che segue la sezione in vista e riapre la griglia (Esc la chiude), e sparisce tornando in cima; l'ultima resta evidenziata anche se non può salire in cima (bug corretto) | `tests/phone-app.spec.js` |
| Telefono: foto in miniatura sui piatti della comanda e della gestione menù (nessun riquadro vuoto senza foto); categorie del menù in griglia | `tests/phone-app.spec.js` |
| Cassa: categorie in una griglia sempre visibile (nessuna oltre il bordo), con piatti e "da inviare"; foto in miniatura sui piatti della comanda e del Menù | `tests/till-sala.spec.js` |
| Visite al menù: aprire il menù pubblico conta una visita per oggi, una sola al giorno per dispositivo; un dispositivo dello staff non conta | `tests/client-view.spec.js` |
| Statistiche (telefono): sezione "Visite al menù" — numero del giorno, variazione col periodo precedente, totale/media/giorno migliore, una colonna al giorno toccabile, elenco, periodo senza visite; sezione "Vendite" | `tests/stats-dashboard.spec.js` |
| Cassa: Statistiche — "Visite al menù" con il numero del giorno e una colonna al giorno | `tests/till-sala.spec.js` |
| Regole Firestore: visite al menù — chiunque può solo iniziare un giorno da 1 o aggiungere 1 (nessun altro valore o campo, nessuna eliminazione), solo il personale le legge | `tests/firestore-rules.spec.js` |
| Telefono: gestione menù rapida — piatto nuovo con prezzo dal tastierino, "Aggiungi piatto"/"Salva" in fondo allo schermo, "Disponibile" spento → "Nascosto" | `tests/phone-app.spec.js` |
| Telefono: area staff installabile (manifest solo nell'area staff) | `tests/phone-app.spec.js` |
| Telefono: niente Dashboard, sezioni nella barra in basso (Menù/Statistiche solo admin), tasto Indietro del browser tra le sezioni | `tests/staff-home.spec.js` |
| Telefono: nota, quantità e rimozione di una riga da inviare dalla comanda del tavolo | `tests/waiter-order.spec.js` |
| Menù pubblico: lingua scelta (`aria-pressed`) e categoria corrente (`aria-current`) leggibili dagli screen reader | `tests/client-view.spec.js` |
| Impostazioni del menù (telefono): elenco e ritorno; Locale e link salvano solo ciò che cambia e il menù pubblico li mostra; tema evidenziato; coperto dal tastierino solo con «Usa» | `tests/menu-settings.spec.js` |
| Impostazioni del menù (telefono): traduzione corretta a mano e lingua eliminata con conferma; ruolo dato a un account esistente (UID) e tolto con conferma | `tests/menu-settings.spec.js` |
| Personale (telefono): nuovo account con email e password (minimo 6 caratteri, "Mostra"), l'admin resta collegato, la persona entra subito col suo ruolo e vede i tavoli; email già usata → errore e nessuno aggiunto; il proprio accesso non si può togliere ("Tu"); niente scorrimento laterale, comandi ≥ 48px, "Crea account" in fondo | `tests/menu-settings.spec.js` |
| Cassa: Personale — l'admin crea un account amministratore senza uscire | `tests/till-sala.spec.js` |
| Regole Firestore: un account registrato da fuori o senza ruolo in uso (nessuno, "kitchen") non legge né scrive comande, prenotazioni, stampe, costi, menù, e non si dà un ruolo; il cameriere lavora ma non assegna ruoli; l'admin sì; menù pubblico in lettura | `tests/firestore-rules.spec.js` |
| Impostazioni del menù (telefono): stampa del menù — errore senza categorie, anteprima in una nuova scheda; backup scaricato, file non valido, ripristino che chiede conferma; "Vedi il menù dei clienti" | `tests/menu-settings.spec.js` |
| Costo interno del piatto dal tastierino nella scheda del piatto, salvato e mantenuto dopo il ricaricamento; scheda aperta prima dell'arrivo dei costi (bug corretto) | `tests/admin-menu-costs.spec.js` |
| Storico (telefono): "Carica altre", comanda come preconto in sola lettura con ristampa, cameriere senza eliminazione, admin elimina con conferma (persistente), "Svuota storico" con conferma | `tests/order-history.spec.js` |
| Prenotazioni (telefono): crea (subito valida, senza Conferma/Rifiuta né "da confermare") e annulla con conferma, vecchie prenotazioni "da confermare" mostrate come le altre (anche nei Tavoli), modulo con un solo "Salva prenotazione" obbligato dal nome e in basso, orario e data liberi, tutti i campi ritrovati in modifica, calendario con mesi e riepilogo per giorno, "Avvia" da Prenotazioni e dai Tavoli | `tests/reservations.spec.js` |
| Telefono: Tavoli — toccando una prenotazione di oggi (≥ 48px, nessuno scorrimento laterale) si apre la sua scheda in Prenotazioni, da cui si modifica e si avvia; tornando a Prenotazioni dalla barra si riparte dall'elenco | `tests/reservations.spec.js` |
| Statistiche (telefono): numeri e classifiche, importi esatti di "Ieri", esclusione delle chiusure automatiche, periodo personalizzato vuoto, margine senza costi noti, incasso per ora e per giorno in euro, confronto con il periodo precedente e con un altro periodo | `tests/stats-dashboard.spec.js` |
| Telefono: preconto a pagina intera; riga inviata tolta dalla modifica riga, preconto confermato che blocca le righe | `tests/waiter-order.spec.js` |
| Cassa (admin): sezioni Menù e Statistiche nella barra; un cameriere non le vede | `tests/till-sala.spec.js`, `tests/till-client.spec.js` |
| Cassa: Menù — piatto nuovo con prezzo dal tastierino, modifica (disponibile, in comanda) solo con "Salva", eliminazione con conferma, salvataggio verificato sul server | `tests/till-sala.spec.js` |
| Cassa: Menù — le modifiche da un altro dispositivo compaiono da sole e un salvataggio dalla cassa non le cancella (salva solo i campi cambiati, anche con il pannello già aperto) | `tests/till-sala.spec.js` |
| Cassa: Menù — "In comanda" del piatto nuovo segue la categoria scelta; tastierino che riparte dalla prima cifra; costo interno da tastierino; niente "Salva" con un tastierino aperto | `tests/till-sala.spec.js` |
| Cassa: impostazioni del menù nella barra laterale, valgono solo con "Salva" (coperto); nessuna "Gestione completa" | `tests/till-sala.spec.js`, `tests/till-client.spec.js` |
| Cassa: Menù — "Tutti/Nessuno in comanda" per categoria | `tests/till-sala.spec.js` |
| Cassa: Statistiche — periodo a tocco (≥ 48px), numeri, classifica, confronto con il periodo precedente | `tests/till-sala.spec.js` |
| Vecchio ruolo "cucina": nessuna area, messaggio che spiega perché (telefono con "Esci", cassa senza); admin senza area Cucina nella barra delle sezioni | `tests/staff-home.spec.js`, `tests/till-client.spec.js` |
| Non coperto automaticamente: stampa fisica su POSBANK (anche la leggibilità reale della comanda a doppia/tripla dimensione), ricerca in rete reale, installer NSIS e aggiornamento automatico su Windows, apertura durante l'installer (notifica + uscita), notifiche di Windows, tastiera touch/osk reale, cifratura DPAPI | Verifica manuale (§3) |
