# Stampa preconti alla cassa — client Windows "Masseria Cassa"

Il preconto (documento **non fiscale**) si stampa sulla stampante termica
della cassa premendo "Stampa", da qualunque dispositivo dello staff: il
telefono di un cameriere, un tablet o la cassa stessa.

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
  stato in tempo reale  ◄──────────  printing → printed | error  ◄──────  escpos.js → bytes
  (ReceiptOverlay.jsx)                                                     window.mdpDesktop.printRaw
                                                                            → main.js → TCP 9100 → stampante
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
    toccandolo compare "Installazione… il programma si riavvierà da solo" e
    in pochi secondi riparte. Se lo ignori, si installa alla prossima
    chiusura;
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

1. [Console Firebase](https://console.firebase.google.com/) → progetto
   `menu-masseria-della-pian` → **Authentication → Users → Aggiungi utente**.
   Email, ad esempio `cassa@masseria-della-piana.it` (non deve esistere
   davvero: serve solo come nome utente), e una password robusta.
2. Copia l'**UID** dell'utente appena creato (colonna "UID utente").
3. **Firestore Database → collection `staff` → Aggiungi documento**, con ID
   documento = l'UID copiato e due campi stringa:
   - `name`: `Cassa`
   - `role`: `waiter` (vede la Sala con preconti e chiusura tavoli, oltre a
     storico e prenotazioni). Usa `admin` solo se alla cassa devono servire
     anche gestione menù e statistiche.

   In alternativa, dal pannello **Gestione menù** dell'app c'è la sezione
   staff per assegnare il ruolo a un UID.
4. Sul PC della cassa: *menu Cassa → Impostazioni stampante → Account della
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

## 5. Risoluzione problemi

| Sintomo | Cosa fare |
|---|---|
| Sul telefono resta "La cassa non ha ancora preso la stampa" | Il client della cassa è acceso? È stato fatto il login (pallino non grigio)? La cassa è connessa a internet? |
| "La stampante non risponde" / "Indirizzo non raggiungibile" | Stampante accesa, cavo di rete collegato? Poi **Verifica stato**. Se l'IP è cambiato: **Cerca stampanti in rete → Usa questa → Salva**. |
| "Carta esaurita" | Sostituisci il rotolo, poi **Riprova stampa** dal preconto. |
| Caratteri strani al posto di accenti o € | La stampante non è in CP858: segnalalo, il layout si corregge in `src/escpos.js` con un semplice deploy. |
| Schermata "Impossibile caricare l'app" | Manca internet sulla cassa. La pagina riprova da sola ogni 30 secondi, oppure premi **Riprova**. |
| Interfaccia troppo piccola o grande | Impostazioni → Zoom interfaccia. |
| "Accesso automatico non riuscito" | Password dell'account della cassa cambiata: aggiornala in Impostazioni → Account della cassa. |
| La tastiera touch non compare | Impostazioni → Tastiera virtuale → "Tastiera su schermo classica". |
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
| Client Electron vero: API 1.1.0/1.2.0 (stato schermo intero, nessuna credenziale, stato aggiornamenti "dev"), errore tastiera fuori da Windows | `tests/desktop-client.spec.js` |
| Non coperto automaticamente: stampa fisica su POSBANK, ricerca in rete reale, installer NSIS e aggiornamento automatico su Windows, tastiera touch/osk reale, cifratura DPAPI | Verifica manuale (§3) |
