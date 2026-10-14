# Prenotazioni tavoli — documento di progetto

Stato: **implementato**
Ultimo aggiornamento: 2026-10-14

Questo documento descrive il modello dati e le scelte di progetto della
funzionalità di gestione prenotazioni tavoli, riservata al personale (stesso
stile di `docs/comande-camerieri.md` per le comande).

---

## 1. Obiettivo

Permettere di registrare manualmente le prenotazioni telefoniche/di persona
avendo sotto controllo i coperti già prenotati per il giorno, e farle apparire automaticamente in Sala il giorno stesso perché
il cameriere possa "avviarle" (aprire la comanda) senza dover ridigitare
tavolo/coperti/note.

**Fuori scopo per questa prima versione** (idee valutate ma non implementate,
vedi §6):
- Ricerca prenotazioni per nome/telefono.
- Split esplicito pranzo/cena nella vista giornaliera.
- Avvisi di overbooking/capacità massima per turno.
- Riconoscimento cliente abituale (storico per numero di telefono).
- Stampa/esportazione della lista prenotazioni del giorno.
- Un ruolo "bar" dedicato: la panoramica coperti è visibile a chiunque acceda
  a Prenotazioni (cameriere e admin), che copre l'esigenza senza introdurre
  un nuovo ruolo in `staff/{uid}`.

---

## 2. Architettura

Stessa filosofia delle comande: nessuna app/servizio separato, un'area
riservata in più nello stesso progetto React/Firebase, raggiungibile da tre
punti (tutti verso la stessa schermata `src/TillReservations.jsx`, la stessa
su telefono e cassa):

- Route diretta `/prenotazioni` (o `/reservations`), utile per un dispositivo
  dedicato (es. tablet alla reception), gestita in `MenuApp.jsx` come già
  avviene per `/cameriere` e `/cucina`.
- Sezione "Prenotazioni" nella barra in basso dell'app del telefono
  (`PhoneApp.jsx`, vedi §6), per tutti gli account cameriere e admin.

Dati e logica di scrittura/lettura in `src/reservationsData.js`, seguendo
esattamente le convenzioni di `src/orders.js` (stesso stile di listener,
stesso uso di `serverTimestamp`/`Timestamp`, stessa pulizia lazy).

---

## 3. Modello dati Firestore

```
reservations/{id}
  date: "YYYY-MM-DD"        // stringa locale, non Timestamp — vedi nota sotto
  time: "HH:MM" | ""
  name: string
  phone: string
  covers: { adults: number, children: number }
  notes: string
  tableNumber: number | null   // assegnazione facoltativa in anticipo

  status: "confirmed" | "started" | "no_show" | "cancelled"
          // + "pending" / "rejected" solo su documenti vecchi (vedi sotto)

  createdBy: { uid, name }, createdAt: Timestamp
  confirmedBy: { uid, name } | null, confirmedAt: Timestamp | null
  rejectedBy:  { uid, name } | null, rejectedAt:  Timestamp | null
  cancelledBy: { uid, name } | null, cancelledAt: Timestamp | null
  noShowAt: Timestamp | null

  orderId: string | null    // valorizzato quando la prenotazione viene "avviata"
  startedAt: Timestamp | null
  expireAt: Timestamp | null  // pulizia lazy dopo 30 giorni, come orders.js
```

**Perché `date` come stringa e non `Timestamp`**: il calendario ragiona per
giorno, non per istante — una stringa `"YYYY-MM-DD"` evita bug di fuso
orario ed è direttamente confrontabile per range (`where("date", ">=", ...)`),
senza bisogno di un indice composito, esattamente come `closedAt` viene già
usato in `orders.js`.

### Ciclo di stato

```
(salva) ──▶ confirmed ──avvia──▶ started (con orderId collegato)
               ├──annulla──▶ cancelled
               └──(data passata, mai avviata)──▶ no_show (automatico)
```

`started`, `cancelled`, `no_show` sono stati terminali. Nella schermata
Prenotazioni l'elenco del giorno (e il riepilogo del calendario) mostra solo
le prenotazioni ancora da arrivare (`isBooked`): appena avviata, una
prenotazione passa ai Tavoli e finisce, con annullate e non presentate,
sotto **"Mostra avviate, annullate e non presentate"**.

**Eliminazione (solo admin, ottobre 2026).** Un amministratore può togliere
per sempre qualunque prenotazione (avviata, annullata, non presentata o
inserita per errore) per tenere in ordine il calendario: **swipe verso
sinistra** sulla riga (corto: compare "Elimina" da toccare; lungo: chiede
subito la conferma) oppure **"Elimina prenotazione"** nella scheda delle
prenotazioni non più da arrivare; sempre con conferma
(`deleteReservation()`, `reservationsData.js`). Il tavolo già aperto da una
prenotazione avviata resta com'è. Un cameriere non vede né lo swipe né il
pulsante, e le regole lo impediscono anche lato server (§4): può creare,
modificare, annullare e avviare, ma tutto ciò che fa resta tracciato.

**Niente più "da confermare" (ottobre 2026).** Lo staff registra solo
prenotazioni già concordate col cliente, quindi il passaggio di conferma
creava soltanto confusione: `createReservation()` salva direttamente
`confirmed` (con `confirmedBy` = chi la inserisce) e l'interfaccia non
distingue più tra confermate e non confermate (stato scritto: *Prenotata*).
Le prenotazioni salvate prima come `pending` restano nel database così come
sono, senza migrazione: `isBooked()` (`reservationsData.js`) le tratta come
`confirmed` ovunque (Prenotazioni, Tavoli, no-show automatico). Le vecchie
`rejected` compaiono tra le "annullate e non presentate" come *Rifiutata*
finché la pulizia dei 30 giorni non le cancella.

---

## 4. Regole di sicurezza

`firestore.rules`: leggere, creare e modificare (annullare, avviare) le
prenotazioni può tutto il personale (account con un ruolo in `staff/{uid}`);
**eliminarle solo un amministratore**. Unica eccezione: le prenotazioni
scadute (`expireAt` passato, §7) le può eliminare anche il dispositivo di un
cameriere, perché la pulizia automatica gira su qualunque dispositivo dello
staff. Coperto da `tests/firestore-rules.spec.js`.

---

## 5. Integrazione con l'area cameriere

All'inizio del turno, la Sala (`useSalaData` in `sala-shared.jsx`, per
`Waiter.jsx` e `TillSala.jsx`) sottoscrive le prenotazioni della data
odierna (`subscribeReservationsForDate(dateKey())`, solo quelle `isBooked`,
in ordine di orario) e le mostra come "Prenotazioni di oggi": in cima ai
Tavoli sul telefono, nella colonna a destra alla cassa. Ogni prenotazione è
una scheda (`ReservationCard`, `OrderUi.jsx`, la stessa sui due
dispositivi):

- **toccando la scheda** si apre la prenotazione in Prenotazioni
  (`TillReservations` con `initialReservation`): dettagli, Modifica, Annulla
  e "Avvia (apri il tavolo)";
- il pulsante **"Avvia"** sulla scheda resta come scorciatoia e richiama
  `startReservation()`, che:

1. apre una comanda (`openOrder()` di `orders.js`) con tavolo (se già
   assegnato, altrimenti chiesto al momento con un piccolo modal),
   nome/coperti/note già presi dalla prenotazione;
2. collega la comanda appena creata alla prenotazione (`orderId`, stato
   `"started"`).

Il cameriere continua poi a lavorare sulla comanda esattamente come su un
tavolo aperto normalmente — nessuna differenza da quel punto in poi.

Il calendario completo è sempre a un tocco dalla Sala:
è la sezione "Prenotazioni" della barra in basso, oltre alle prenotazioni
del giorno mostrate in cima ai Tavoli.

---

## 6. Sezioni dell'app (ex Dashboard, `PhoneApp.jsx`)

Sul telefono la Dashboard a riquadri non c'è più: l'area staff è un'app con
le sezioni nella barra in basso (Tavoli · Prenotazioni · Storico e, per gli
admin, Menù · Statistiche — vedi `docs/stampa-scontrini.md` §4.2). I tavoli
aperti sono il badge su **Tavoli**; Prenotazioni non ha badge (non c'è più
nulla "da confermare"). `/prenotazioni` apre la stessa app sulla
sezione Prenotazioni.

---

## 7. Pulizia automatica

Stesso meccanismo "pigro" lato client di `orders.js` (§6 di
`docs/comande-camerieri.md`), per restare sul piano Firebase gratuito:

- Le prenotazioni `confirmed` (o vecchie `pending`) con data ormai passata e mai avviate vengono
  marcate `no_show` al successivo caricamento del calendario
  (`autoFlagNoShows`).
- Le prenotazioni in stato terminale vengono cancellate 30 giorni dopo
  (`runDailyExpiredReservationsCleanup`, richiamata sia dalle Prenotazioni,
  `TillReservations.jsx`, sia dalla Sala, `sala-shared.jsx`).

---

## 8. Testing

`tests/reservations.spec.js` (Playwright, stesso stile di
`tests/waiter-order.spec.js`): login richiesto, creazione (subito valida,
senza conferma), vecchie `pending` mostrate come le altre
(`tests/helpers/reservations.js`), annullamento, navigazione tra i mesi del
calendario, la scheda nei Tavoli che apre la prenotazione, e il flusso
end-to-end "avvia da Sala → apre comanda con i dati corretti". Alla cassa
lo stesso in `tests/till-sala.spec.js`. Dati sentinella
randomizzati e cleanup dedicato in `tests/firestore-cleanup.js`
(`deleteTestReservationByName`).

I pulsanti di azione per riga ("Avvia", la scheda nei Tavoli) hanno un
`aria-label` che include il nome della prenotazione: sono infatti ripetuti
identici per ogni riga della lista (a differenza dei tavoli in Sala,
identificati dal numero), e i test girano con `fullyParallel: true` — più
prenotazioni di test possono comparire insieme nella stessa giornata da
worker diversi, quindi ogni pulsante deve restare selezionabile in modo
univoco.
