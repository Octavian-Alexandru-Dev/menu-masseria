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
  covers: { adults: number, children: number }
  notes: string                // es. allergie, richieste generali del tavolo
  waiterUid: string
  waiterName: string           // copiato da staff/{uid} al momento della creazione,
                                // per non dover fare un secondo lookup in cucina
  status: "open" | "closed" | "auto_closed"
  openedAt: Timestamp
  closedAt: Timestamp | null
  expireAt: Timestamp          // = closedAt + 30 giorni — usato dalla TTL policy (§6)

  items: [
    {
      lineId: string,          // id locale della riga, es. uid() già usato nel progetto
      menuItemId: string,      // riferimento alla voce in menu/data
      name: string,            // snapshot del nome al momento dell'ordine
      price: string,           // snapshot del prezzo (stesso formato "12,50" già in uso)
      quantity: number,
      course: "antipasto" | "primo" | "secondo" | "dolce" | "bevanda",
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

**Stato per riga, non per comanda intera**: la cucina segna "uscito" per
gruppi di portata (es. tutti gli antipasti del tavolo 4), aggiornando lo
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
   `closedAt: now`, `expireAt: now + 30 giorni`.
6. **Chiusura automatica di sicurezza**: se una comanda resta `"open"` da più
   di 24 ore, viene chiusa automaticamente (§6) con `status: "auto_closed"`
   invece di `"closed"`, per poterla distinguere in futuro se servisse capire
   quante comande sono state "dimenticate" aperte.

---

## 6. Pulizia automatica dei dati

Due meccanismi distinti, scelti per restare **interamente gratuiti** (nessun
upgrade al piano Firebase a consumo):

### 6.1 Cancellazione dopo 30 giorni — Firestore TTL policy

Feature nativa di Firestore (disponibile anche sul piano gratuito Spark):
si configura una policy TTL sul campo `expireAt` della collection `orders`
(dalla console Firebase, sezione Firestore → TTL). Da quel momento Firestore
cancella da solo, in background, ogni documento il cui `expireAt` è nel
passato — nessun codice server da scrivere o mantenere. L'eliminazione
avviene di norma entro 24-72 ore dalla scadenza, cosa irrilevante per un
archivio di 30 giorni.

L'unico compito del codice applicativo è scrivere correttamente `expireAt`
quando una comanda viene chiusa (manualmente o automaticamente).

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
- Apertura nuovo tavolo: numero, coperti (adulti/bambini), note.
- Selezione piatti: stessa struttura a categorie del menù pubblico, più
  sezione "Fuori menù" separata; per ogni voce, quantità e portata; campo
  note libere per riga.
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
