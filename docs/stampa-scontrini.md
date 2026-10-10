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

1. Scarica [Masseria-Cassa-Setup.exe](https://github.com/Octavian-Alexandru-Dev/menu-masseria/releases/latest/download/Masseria-Cassa-Setup.exe) ed eseguilo.
   L'installer non è firmato digitalmente, quindi Windows mostra "PC protetto
   da Windows": scegli **Ulteriori informazioni → Esegui comunque**.
2. Si apre a schermo intero. Accedi con un account dello staff (un account
   dedicato alla cassa è la scelta più ordinata).
3. In basso a sinistra c'è il **pulsante stampante**, con un pallino colorato:
   verde = pronta, arancione = stampa in corso, rosso = errore (il motivo
   compare accanto al pulsante), grigio = serve il login.
   Toccalo per aprire le **Impostazioni**.
4. In Impostazioni premi **Stampa di prova**. Se esce lo scontrino di prova,
   è tutto pronto.
5. Facoltativo: spunta "Avvia all'accensione del computer".

## 4. Impostazioni (pulsante stampante, oppure Ctrl+Maiusc+P)

- **Stampante:** indirizzo IP e porta, **Verifica stato** (raggiungibile,
  modello, carta presente/quasi finita/esaurita, coperchio aperto, offline),
  **Stampa di prova** (funziona anche senza internet), **Cerca stampanti in
  rete** (scansione della rete locale sulla porta 9100, con modello e
  pulsante "Usa questa").
- **Schermo:** avvio a schermo intero, modalità chiosco (impedisce di uscire
  dallo schermo intero), zoom dell'interfaccia (80–150%, utile sul 12"),
  avvio automatico.
- **Avanzate:** nome della postazione (registrato su ogni stampa),
  indirizzo dell'app, **Ricarica app**, strumenti sviluppatore, **Chiudi
  programma** (utile in modalità chiosco).

Tasti, se è collegata una tastiera: **F11** schermo intero, **F5** o
**Ctrl+R** ricarica, **Ctrl+Maiusc+P** impostazioni, **Ctrl+Maiusc+I**
strumenti sviluppatore.

Le impostazioni sono salvate in `%APPDATA%\Masseria Cassa\settings.json`.

## 5. Risoluzione problemi

| Sintomo | Cosa fare |
|---|---|
| Sul telefono resta "La cassa non ha ancora preso la stampa" | Il client della cassa è acceso? È stato fatto il login (pallino non grigio)? La cassa è connessa a internet? |
| "La stampante non risponde" / "Indirizzo non raggiungibile" | Stampante accesa, cavo di rete collegato? Poi **Verifica stato**. Se l'IP è cambiato: **Cerca stampanti in rete → Usa questa → Salva**. |
| "Carta esaurita" | Sostituisci il rotolo, poi **Riprova stampa** dal preconto. |
| Caratteri strani al posto di accenti o € | La stampante non è in CP858: segnalalo, il layout si corregge in `src/escpos.js` con un semplice deploy. |
| Schermata "Impossibile caricare l'app" | Manca internet sulla cassa. La pagina riprova da sola ogni 30 secondi, oppure premi **Riprova**. |
| Interfaccia troppo piccola o grande | Impostazioni → Zoom interfaccia. |

## 6. Sviluppo e rilascio

- Codice: `desktop-client/` (Electron 44). `src/main.js` (finestra, IPC,
  controllo aggiornamenti), `src/printer.js` (TCP, stato, ricerca,
  stampa di prova), `src/preload.js` (bridge `window.mdpDesktop`, contratto
  in `src/desktop.js` della web app), `src/settings.*` (finestra impostazioni).
- Sicurezza: `contextIsolation` + `sandbox` attivi. Ogni chiamata del bridge
  viene accettata solo se arriva dall'origine dell'app configurata. I link
  ad altri siti si aprono nel browser di sistema.
- Avvio locale: `cd desktop-client && npm install && npx install-electron &&
  npm start`. Per puntarlo all'emulatore, imposta in Impostazioni
  l'indirizzo dell'app `http://localhost:5173/?area=staff` (con
  `npm run dev:local` avviato).
- Installer: `npm run dist:win` (funziona anche da macOS) genera
  `desktop-client/dist/Masseria-Cassa-Setup.exe`.
- **Rilascio:** `git tag cassa-v1.0.1 && git push origin cassa-v1.0.1`.
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
| Stazione inattiva senza login; pulsante stampante → impostazioni | `tests/receipt-printing.spec.js` |
| Banner "nuova versione" → "Aggiorna ora" ricarica | `tests/receipt-printing.spec.js` |
| Client Electron vero: carica la web app, espone il bridge, i byte arrivano alla stampante TCP | `tests/desktop-client.spec.js` |
| Impostazioni native: verifica stato, stampa di prova, errore comprensibile su porta sbagliata | `tests/desktop-client.spec.js` |
| Non coperto automaticamente: stampa fisica su POSBANK, ricerca in rete reale, installer NSIS su Windows | Verifica manuale (§3) |
