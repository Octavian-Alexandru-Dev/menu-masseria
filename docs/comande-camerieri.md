# Comande digitali per i camerieri — documento di progetto

Stato: **bozza approvata, pronta per l'implementazione**
Ultimo aggiornamento: 2026-09-04

Questo documento raccoglie tutte le decisioni prese in fase di brainstorming per
la nuova funzionalità di presa comande digitale riservata al personale di sala
e cucina. Va aggiornato se, durante l'implementazione, emergono scelte diverse
da quelle descritte qui.

---

## 1. Obiettivo

Permettere ai camerieri di prendere le ordinazioni dei tavoli da un
telefono/tablet, invece che su carta, e farle arrivare in tempo reale a uno
schermo dedicato in cucina. Obiettivo esplicito: interfacce semplici e rapide
da usare in piedi, durante il servizio — non un gestionale completo.

**Fuori scopo (esplicitamente escluso):**
- Nessuna integrazione con casse/sistemi fiscali.
- Nessuna stampa di scontrini/comande cartacee.
- Nessuna gestione di pagamenti: la funzione mostra solo un totale e l'elenco
  di ciò che è stato ordinato.

---

## 2. Architettura generale

La funzionalità **non** sarà un'app separata: vivrà nello stesso progetto
Firebase/React già esistente, come due nuove aree protette da autenticazione,
analoghe a come `Admin.jsx` è oggi un'area separata rispetto a `ClientView.jsx`:

- **Area cameriere** (es. componente `Waiter.jsx`, route `/cameriere` o `/waiter`)
- **Area cucina** (es. componente `Kitchen.jsx`, route `/cucina` o `/kitchen`),
  pensata per uno schermo/tablet fisso in cucina, sempre aperta durante il
  servizio.

**Perché non un'app a parte:** entrambe le aree devono leggere le voci del
menù (nome, prezzo, categoria, disponibilità) in tempo reale. Duplicare
questi dati in un progetto separato li farebbe andare fuori sincronia (es. un
piatto segnato esaurito nel menù ma ancora ordinabile dal cameriere). Restando
nello stesso progetto Firebase, entrambe le aree leggono la stessa fonte di
verità (`menu/data`, vedi §4).

Lo stack tecnico resta lo stesso: React + Vite + Firestore. La sincronizzazione
in tempo reale tra cameriere e cucina userà i listener realtime di Firestore
(`onSnapshot`), la stessa tecnologia già scelta per questo progetto (vedi
`persistentLocalCache` in `firebase-db.js`).

---

## 3. Autenticazione e ruoli

- Ogni cameriere ha un **account individuale** (Firebase Auth, email/password
  — stesso meccanismo già usato per l'admin in `firebase-auth.js`).
- Introduciamo una collection Firestore `staff/{uid}` con il ruolo di ogni
  utente autenticato:
  ```
  staff/{uid}
    name: string        // es. "Marco"
    role: "admin" | "waiter" | "kitchen"
  ```
  Questo evita di dover toccare la logica di login esistente per l'admin: si
  aggiunge solo un controllo "che ruolo ha questo uid" dopo il login, per
  decidere quale area mostrare (o negare l'accesso).
- L'area cucina può usare un account condiviso con `role: "kitchen"` (uno
  schermo fisso, non serve identificare la singola persona), oppure un
  account per persona se in futuro servisse sapere chi ha "battuto" un
  piatto come uscito — decisione rimandabile, non blocca l'MVP.
- Le regole di sicurezza Firestore (`firestore.rules`) andranno estese per
  permettere lettura/scrittura di `orders/*` solo a uid presenti in `staff`
  con ruolo appropriato (un cameriere può creare/modificare comande, la
  cucina può solo aggiornare lo stato delle righe, non i prezzi).

---

## 4. Modello dati Firestore

### 4.1 Voci di menù riservate allo staff ("fuori menù")

Riusiamo la struttura esistente in `menu/data` (categorie → voci, vedi
`Admin.jsx`), aggiungendo un solo campo booleano alle voci che il cameriere
può ordinare ma che **non** devono comparire nel menù pubblico:

```
menu/data
  categories[]
    items[]
      id, name, price, description, image, visible   // già esistenti
      staffOnly: boolean   // NUOVO — default false
```

- `ClientView.jsx` filtra le voci con `staffOnly: true` esattamente come già
  fa oggi con `visible: false` (nessuna nuova logica di filtro, solo una
  condizione in più).
- `Admin.jsx` aggiunge una checkbox "Riservato allo staff (fuori menù)"
  accanto al toggle `visible` già esistente per ogni voce.
- Nell'area cameriere, le voci `staffOnly` compaiono in una sezione separata
  ("Fuori menù"), chiaramente etichettata, così il cameriere sa che non è
  una voce che il cliente ha visto sul menù.

Questa scelta (riusare lo stesso documento menù invece di una collection a
parte) evita di duplicare tutta l'interfaccia di gestione voci in Admin per
un secondo tipo di "piatto".

### 4.2 Comande

Seguendo lo stesso stile già usato nel progetto (un documento che contiene la
struttura annidata, come `menu/data`), ogni comanda è **un documento**, con le
righe ordine incorporate come array — non una subcollection. Con al massimo
poche decine di righe per tavolo, un array in un singolo documento è più
semplice da leggere in tempo reale, da aggiornare atomicamente e da associare
a un'unica data di scadenza.

```
orders/{orderId}
  tableNumber: number          // scalare, es. 4 — nessun limite massimo configurato
  tableName: string            // facoltativo, es. "Famiglia Rossi", "Compleanno" — aggiunto dopo il primo giro di test
  covers: { adults: number, children: number }
  notes: string                // es. allergie, richieste generali del tavolo
  waiterUid: string
  waiterName: string           // copiato da staff/{uid} al momento della creazione,
                                // per non dover fare un secondo lookup in cucina
  status: "open" | "closed" | "auto_closed"
  openedAt: Timestamp
  closedAt: Timestamp | null
  expireAt: null               // sempre null dalle comande chiuse non scadono più (§6.1, §12)

  items: [
    {
      lineId: string,          // id locale della riga, es. uid() già usato nel progetto
      menuItemId: string,      // riferimento alla voce in menu/data
      name: string,            // snapshot del nome al momento dell'ordine
      price: string,           // snapshot del prezzo (stesso formato "12,50" già in uso)
      quantity: number,
      categoryId: string,      // snapshot dell'id della categoria menù di appartenenza
      categoryName: string,    // snapshot del nome della categoria (es. "Antipasti", "Primi")
      notes: string,           // es. "senza cipolla"
      status: "sent" | "preparing" | "out",
      sentAt: Timestamp
    },
    ...
  ]
```

**Perché uno snapshot di nome/prezzo dentro la riga** invece di leggerli
sempre da `menu/data`: se un piatto cambia prezzo o viene rinominato dopo che
la comanda è stata inviata, la comanda già in cucina deve restare coerente
con quello che è stato effettivamente ordinato (stesso principio di qualsiasi
sistema di ordinazione).

**Perché la categoria e non una "portata" scelta a mano**: la prima versione
prevedeva una portata fissa (antipasto/primo/secondo/dolce/bevanda) scelta
manualmente dal cameriere prima di aggiungere i piatti. In prova reale questo
si è rivelato fonte di errori (es. un piatto aggiunto per sbaglio sotto
"Bevande" con la selezione rimasta sulla portata precedente) ed era comunque
un elenco scollegato dalle categorie vere del menù. La categoria del piatto
(la stessa mostrata ai clienti) viene quindi presa automaticamente
dall'articolo selezionato, senza alcuna scelta manuale: non può più esserci
disallineamento tra cosa si clicca e come viene classificato.

**Stato per riga, non per comanda intera**: la cucina segna "uscito" per
intera categoria (es. tutti gli antipasti del tavolo 4), aggiornando lo
`status` delle righe corrispondenti. Il cameriere vede l'aggiornamento in
tempo reale sul proprio schermo.

---

## 5. Ciclo di vita di una comanda

1. **Apertura**: il cameriere seleziona un numero di tavolo (scalare, nessuna
   mappa tavoli precostituita — vedi §3 della discussione), inserisce coperti
   (adulti/bambini) ed eventuali note, poi aggiunge piatti dal menù normale
   e/o dalla sezione "fuori menù".
2. **Invio**: ogni riga (o gruppo di righe aggiunte insieme) viene scritta su
   Firestore con `status: "sent"`. L'interfaccia mostra un badge di stato
   finché la scrittura non è confermata dal server (§7).
3. **Cucina**: lo schermo cucina mostra le comande aperte raggruppate per
   tavolo e per portata. Quando una portata è pronta, la cucina marca tutte
   le righe di quella portata come `"out"` con un solo tocco.
4. **Consultazione stato**: il cameriere vede in tempo reale quali portate
   sono uscite, senza dover tornare in cucina a chiedere.
5. **Chiusura**: il cameriere chiude il tavolo manualmente (mostra il totale
   e l'elenco ordinato, nessuna stampa/pagamento) → `status: "closed"`,
   `closedAt: now`, `expireAt: null` (nessuna scadenza, §6.1).
6. **Chiusura automatica di sicurezza**: se una comanda resta `"open"` da più
   di 24 ore, viene chiusa automaticamente (§6) con `status: "auto_closed"`
   invece di `"closed"`, per poterla distinguere in futuro se servisse capire
   quante comande sono state "dimenticate" aperte.

---

## 6. Pulizia automatica dei dati

Due meccanismi distinti, scelti per restare **interamente gratuiti** (nessun
upgrade al piano Firebase a consumo):

### 6.1 Nessuna cancellazione delle comande chiuse (storico permanente)

In origine le comande chiuse venivano cancellate 30 giorni dopo la chiusura
(pulizia lato client su `expireAt`, per restare sul piano gratuito Spark
senza dover attivare una policy TTL nativa, che richiede il piano a consumo
Blaze). Questo meccanismo è stato **rimosso** (§12): le comande chiuse restano
per sempre, perché sono la base dati della Dashboard statistiche (analisi
vendite/incassi su range temporali arbitrari, anche a distanza di anni).

- `closeOrder()` e `autoCloseStaleOrders()` scrivono ora `expireAt: null`
  invece di calcolare una data di scadenza; il campo resta nello schema solo
  per compatibilità con i documenti scritti prima di questo cambiamento (che
  avevano un `expireAt` valorizzato, oggi semplicemente ignorato).
- Impatto sui costi valutato trascurabile alla scala del locale (poche
  decine di tavoli/giorno): crescita di storage nell'ordine di pochi MB/anno,
  ben entro il GB gratuito del piano Spark; le query della dashboard restano
  entro le quote gratuite di lettura giornaliere finché evitano di rileggere
  l'intero storico ad ogni interazione (cache lato client per range già
  caricato).
- Se in futuro il volume di comande crescesse di ordini di grandezza, va
  rivalutato lo storage/i costi di lettura, eventualmente introducendo
  aggregati permanenti separati (es. un riepilogo per giorno) invece di
  leggere sempre le comande grezze.

### 6.2 Chiusura automatica dopo 24 ore — controllo lato client

A differenza della cancellazione, chiudere una comanda significa
**modificare** un documento (cambiare `status` e impostare `expireAt`), cosa
che la TTL non può fare. Per restare sul piano gratuito (niente Cloud
Functions schedulate, che richiederebbero il piano Blaze), la scelta è un
controllo "pigro" lato client:

- Ogni volta che l'area cameriere o l'area cucina carica/aggiorna l'elenco
  delle comande aperte, il codice controlla se ce ne sono con `openedAt` più
  vecchio di 24 ore e, in caso, le chiude automaticamente
  (`status: "auto_closed"`, imposta `closedAt` ed `expireAt`).
- In un locale che usa l'app quotidianamente, questo converge nella pratica
  allo stesso risultato di un job schedulato: la comanda dimenticata viene
  chiusa alla prima apertura utile dell'app il giorno dopo, non esattamente
  allo scoccare del ventiquattresimo minuto.
- Se in futuro servisse precisione esatta indipendente dall'uso dell'app, si
  potrà migrare a una Cloud Function schedulata senza toccare il resto del
  modello dati (basta spostare la stessa logica di controllo lato server).

---

## 7. Indicatore di invio / stato di sincronizzazione

Requisito: il cameriere deve vedere chiaramente se una comanda **non è ancora
stata confermata** dal server, anche se il WiFi sembra funzionare (la
connessione locale può essere a posto ma la scrittura non ancora confermata
per sovraccarico temporaneo, rete del locale instabile, ecc.).

Implementazione: Firestore espone, per ogni snapshot letto in locale, il
metadato `hasPendingWrites` — vero finché quella scrittura non è confermata
dal server. L'interfaccia cameriere usa questo metadato per mostrare:

- **"Invio in corso…"** — scrittura locale accettata, in attesa di conferma
  dal server (`hasPendingWrites: true`).
- **"Inviata ✓"** — confermata dal server (`hasPendingWrites: false`).
- Un avviso più esplicito se una scrittura resta pendente oltre una soglia
  ragionevole (es. 10-15 secondi), a indicare un problema di connessione
  reale.

Questa logica va nel componente che crea/modifica le righe d'ordine fin
dall'inizio, non aggiunta in un secondo momento.

---

## 8. Interfaccia — bozza funzionale

### Area cameriere
- Elenco tavoli con comande aperte (numero tavolo, tempo trascorso
  dall'apertura, indicatore se ci sono portate pronte da servire).
- Apertura nuovo tavolo: numero, nome facoltativo, coperti (adulti/bambini), note.
- Selezione piatti: stessa struttura a categorie del menù pubblico, più
  sezione "Fuori menù" separata; la portata è sempre la categoria reale del
  piatto cliccato (nessuna scelta manuale, vedi §4.2); per ogni voce,
  quantità e campo note libere per riga.
- Vista comanda del tavolo: elenco righe con stato (inviata/in
  preparazione/uscita), totale calcolato.
- Chiusura tavolo: conferma, mostra elenco e totale finale.

### Area cucina
- Vista per tavolo (o vista unica per portata, da valutare durante
  l'implementazione) con tutte le comande aperte.
- Per ogni tavolo, righe raggruppate per portata, con un tocco per marcare
  l'intera portata come "uscita".
- Aggiornamento in tempo reale non appena un cameriere invia una nuova riga.

---

## 9. Fasi di implementazione proposte

**Fase 1 — MVP funzionante**
- Modello dati `orders` + campo `staffOnly` su `menu/data`.
- Ruoli in `staff/{uid}`, login cameriere/cucina.
- Area cameriere: apertura tavolo, aggiunta piatti (menù + fuori menù),
  invio, indicatore di sincronizzazione.
- Area cucina: vista comande aperte, marcatura portata come uscita.
- Chiusura manuale con totale.

**Fase 2 — automazioni**
- Chiusura automatica dopo 24 ore (§6.2).
- TTL policy a 30 giorni (§6.1).

**Fase 3 — rifiniture** (da valutare in base all'uso reale)
- Modifica/annullo di una riga già inviata.
- Storico comande chiuse consultabile (entro i 30 giorni di retention).
- Eventuali statistiche (piatti più ordinati, tempi medi per portata).

---

## 10. Testing

Come da convenzione del progetto (`CLAUDE.md`), ogni nuova UI va verificata
con Playwright prima di considerarla completa:
- `tests/waiter-order.spec.js` (nuovo): apertura tavolo, aggiunta piatti,
  invio, verifica indicatore di stato.
- `tests/kitchen-view.spec.js` (nuovo): ricezione comanda in tempo reale,
  marcatura portata come uscita.
- Serve un account di test per ciascun ruolo (cameriere/cucina), come già
  notato per l'admin in `tests/admin-login.spec.js` — da creare come utenza
  Firebase Auth dedicata ai test, non un account reale dello staff.

---

## 11. Decisioni ancora aperte (non bloccanti per iniziare)

- Account cucina condiviso vs. individuale (§3) — di default: condiviso,
  rivedibile in Fase 3.
- Vista cucina per tavolo vs. per portata trasversale a tutti i tavoli — da
  decidere/affinare durante l'implementazione della Fase 1, osservando come
  viene usata.

---

## 12. Aggiornamenti successivi al primo giro di prova

Dopo il primo giro di test reale, sono emerse alcune modifiche rispetto al
piano iniziale (già implementate):

- **Tutti i camerieri vedono e gestiscono tutti i tavoli** (nessun filtro per
  cameriere che ha aperto il tavolo), così come tutta la cucina vede tutte le
  comande — era già così fin dalla Fase 1, confermato esplicitamente.
- **Nome tavolo facoltativo**, oltre al numero (es. "Famiglia Rossi").
- **Coperti modificabili anche a tavolo già aperto** (non solo alla
  creazione): persone che arrivano dopo o non si presentano.
- **Orari per riga**: oltre a `sentAt` (già previsto), ogni riga registra
  anche `outAt` (quando la cucina l'ha segnata uscita), mostrato sia nelle
  viste live sia nello storico.
- **Storico comande chiuse** (`src/OrderHistory.jsx`, condiviso tra area
  cameriere e cucina): le comande chiuse non erano più consultabili da
  nessuna parte dell'app una volta archiviate. Lo storico carica a pagine
  (20 alla volta, "carica altre") le comande con `closedAt` valorizzato,
  ordinate dalla più recente, raggruppate per giorno ("Oggi", "Ieri", poi
  data). Non è realtime (un aggiornamento manuale è sufficiente per uno
  storico) — usa `getDocs` con cursore su `closedAt`, non `onSnapshot`.
- **Landing page unica per il personale** (`src/StaffHome.jsx`): il pulsante
  "Area riservata" in fondo al menù pubblico (ex "Gestione menù") porta ora
  qui invece che dritto al login di Gestione menù. Dopo l'accesso, in base al
  ruolo (`staff/{uid}.role`) mostra solo le aree a cui l'account è abilitato:
  un admin vede Gestione menù + Sala + Cucina (con un pulsante "Cambia area"
  per passare dall'una all'altra), un cameriere solo Sala, un account cucina
  solo Cucina — se c'è una sola area disponibile si entra direttamente, senza
  scelta. `/cameriere` e `/cucina` restano comunque raggiungibili
  direttamente (utile per un dispositivo dedicato, es. il tablet fisso in
  cucina).
- **Identificativo tavolo**: se è stato dato un nome, quello è
  l'identificativo principale ovunque compaia il tavolo (elenco, dettaglio,
  cucina, storico) e il numero passa in secondo piano; altrimenti resta il
  solo numero (`tableIdentity()` in `shared.jsx`).
- **Prezzo del coperto** (comune nei ristoranti italiani): configurabile in
  Gestione menù, separato per adulti/bambini (`menu.coperto`), fatto uno
  snapshot su ogni comanda al momento dell'apertura del tavolo (`order.coperto`)
  — coerente con lo stesso principio già usato per nome/prezzo dei piatti: se
  il prezzo cambia in futuro, le comande già aperte o nello storico restano
  coerenti con quanto applicato quel giorno. Incluso nel totale
  (`orderTotalCents` = piatti + coperto × persone), mostrato separatamente
  ("di cui coperto…") ovunque compaia un totale.
- **Pulizia dei dati di test**: i test Playwright ora eliminano (non solo
  chiudono) le comande che creano — `tests/firestore-cleanup.js`. In
  precedenza le comande di test, anche chiuse, restavano visibili per sempre
  nello Storico comande reale (fino alla scadenza dei 30 giorni), confondendo
  chi consultava lo storico con numeri di tavolo a 4 cifre senza senso.
- **Rimossa la cancellazione delle comande chiuse dopo 30 giorni** (§6.1):
  le comande restano per sempre, per poter alimentare una Dashboard
  statistiche (incassi/piatti più venduti su range temporali arbitrari,
  anche di più anni) senza perdere dati storici. `runDailyExpiredOrdersCleanup()`
  è stata rimossa da `src/orders.js` (e le sue chiamate da `Waiter.jsx` e
  `Kitchen.jsx`); `closeOrder()`/`autoCloseStaleOrders()` scrivono
  `expireAt: null`. Vedi §6.1 per l'analisi costi.

---

## 13. Turno di servizio e preconto

### 13.1 Comande chiuse visibili durante il turno

Una comanda chiusa non sparisce più del tutto dalla schermata cameriere:
resta visibile in una sezione "Chiusi nel turno" sotto l'elenco dei tavoli
aperti, fino al cambio turno — dopo (o per i giorni precedenti) resta
consultabile solo dallo Storico.

Il turno (Pranzo/Cena) è determinato in automatico dall'orario, senza alcuna
configurazione: prima delle 17:00 è pranzo (dalla mezzanotte), da quell'ora
in poi è cena (`currentShiftStart()`/`currentShiftLabel()` in `shared.jsx`).
Se gli orari reali del locale sono diversi, `SHIFT_BOUNDARY_HOUR` è l'unica
costante da cambiare. Il calcolo avviene una volta all'apertura della
schermata; se l'app resta aperta a cavallo del cambio turno, una ricarica
della pagina aggiorna la sezione — stessa filosofia "pigra" già usata per la
chiusura automatica a 24h e la pulizia dei 30 giorni.

### 13.2 Preconto (non fiscale)

Pulsante "Preconto" nel dettaglio del tavolo: apre un riepilogo in stile
scontrino (nome locale, tavolo, orario, cameriere, righe con prezzo, coperto,
totale), **esplicitamente etichettato "documento non fiscale"** — non
un'integrazione con cassa/stampante fiscale (resta fuori scopo, §1), solo un
riepilogo stampabile via browser (`window.print()`, come già fa `PrintMenu.jsx`
per il menù) per dare un'occhiata condivisa col tavolo prima del conto vero.

- **Stampa**: usa la stampa nativa del browser; un CSS `@media print` nasconde
  tutto il resto della pagina e i controlli non pertinenti (pulsanti di
  modifica), lasciando solo il riepilogo.
- **Modifica**: dopo aver generato il preconto, si possono rimuovere
  righe sbagliate (`removeOrderLine`) — per aggiungerne di nuove si chiude il
  riquadro e si usa "Aggiungi piatti" come al solito, poi si riapre per un
  riepilogo aggiornato.
- **Conferma preconto**: salva sulla comanda (`order.receipt`) un
  timestamp di stampa (`printedAt`), un timestamp di conferma (`confirmedAt`)
  e uno snapshot delle righe/totale al momento della conferma — sincronizzato
  in tempo reale su tutti i client, e recuperabile in futuro dallo Storico
  (badge "preconto confermato alle…").
- **"Fine modifica"**: in modalità modifica si può uscire senza chiudere e
  riaprire tutta la card (le rimozioni righe sono comunque già salvate subito
  su Firestore ad ogni tocco, non è un "annulla" delle modifiche già fatte).
- **Stampa anche per comande già chiuse**: lo stesso pulsante di stampa
  (icona stampante) compare su ogni riga sia nella sezione "Chiusi nel turno"
  sia nello Storico — apre lo stesso riquadro ma in sola lettura (`readOnly`):
  solo "Stampa", niente "Modifica"/"Conferma" (una comanda chiusa non si
  modifica più). Componente estratto in `src/ReceiptOverlay.jsx`, condiviso
  tra `Waiter.jsx` e `OrderHistory.jsx` (usato sia dall'area cameriere sia
  dall'area cucina).
