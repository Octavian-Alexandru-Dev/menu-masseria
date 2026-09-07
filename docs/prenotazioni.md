# Prenotazioni tavoli — documento di progetto

Stato: **implementato**
Ultimo aggiornamento: 2026-09-05

Questo documento descrive il modello dati e le scelte di progetto della
funzionalità di gestione prenotazioni tavoli, riservata al personale (stesso
stile di `docs/comande-camerieri.md` per le comande).

---

## 1. Obiettivo

Permettere di registrare manualmente le prenotazioni telefoniche/di persona,
confermarle o rifiutarle avendo sotto controllo i coperti già prenotati per
il giorno, e farle apparire automaticamente in Sala il giorno stesso perché
il cameriere possa "avviarle" (aprire la comanda) senza dover ridigitare
tavolo/coperti/note.

**Fuori scopo per questa prima versione** (idee valutate ma non implementate,
vedi §6):
- Ricerca prenotazioni per nome/telefono.
- Split esplicito pranzo/cena nella vista giornaliera.
- Avvisi di overbooking/capacità massima per turno.
- Riconoscimento cliente abituale (storico per numero di telefono).
- Stampa/esportazione della lista prenotazioni del giorno.
- Link diretto dalla comanda avviata al suo dettaglio in Sala.
- Un ruolo "bar" dedicato: la panoramica coperti è visibile a chiunque acceda
  a Prenotazioni (cameriere e admin), che copre l'esigenza senza introdurre
  un nuovo ruolo in `staff/{uid}`.

---

## 2. Architettura

Stessa filosofia delle comande: nessuna app/servizio separato, un'area
riservata in più nello stesso progetto React/Firebase, raggiungibile da tre
punti (tutti verso lo stesso componente `src/Reservations.jsx`):

- Route diretta `/prenotazioni` (o `/reservations`), utile per un dispositivo
  dedicato (es. tablet alla reception), gestita in `MenuApp.jsx` come già
  avviene per `/cameriere` e `/cucina`.
- Tile "Prenotazioni" nella Dashboard (`StaffHome.jsx`).
- Scorciatoia nell'header dell'area cameriere (`Waiter.jsx`), necessaria
  perché un account solo-cameriere salta la Dashboard (vedi §5).

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

  status: "pending" | "confirmed" | "rejected" | "started" | "no_show" | "cancelled"

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
pending ──conferma──▶ confirmed ──avvia──▶ started (con orderId collegato)
   │                      │
   └──rifiuta──▶ rejected └──annulla──▶ cancelled
                          └──(data passata, mai avviata)──▶ no_show (automatico)
```

`started`, `rejected`, `cancelled`, `no_show` sono stati terminali.

---

## 4. Regole di sicurezza

`firestore.rules` estende alla nuova collection lo stesso confine di fiducia
già usato per `staff/*` e `orders/*`: qualunque account autenticato può
leggere/scrivere, la distinzione cameriere/admin resta solo lato interfaccia
(gli account sono creati a mano dall'amministratore, non c'è
autoregistrazione pubblica).

---

## 5. Integrazione con l'area cameriere

All'inizio del turno, `Waiter.jsx` sottoscrive le prenotazioni confermate per
la data odierna (`subscribeReservationsForDate(dateKey())`) e le mostra in
una sezione "Prenotazioni di oggi" sopra il pulsante "Nuovo tavolo". Il
pulsante "Avvia" richiama `startReservation()`, che:

1. apre una comanda (`openOrder()` di `orders.js`) con tavolo (se già
   assegnato, altrimenti chiesto al momento con un piccolo modal),
   nome/coperti/note già presi dalla prenotazione;
2. collega la comanda appena creata alla prenotazione (`orderId`, stato
   `"started"`).

Il cameriere continua poi a lavorare sulla comanda esattamente come su un
tavolo aperto normalmente — nessuna differenza da quel punto in poi.

Un account solo-cameriere salta direttamente in Sala dalla Dashboard (vedi
§6 di `docs/comande-camerieri.md`, invariato): per questo Sala offre anche
una scorciatoia diretta al calendario/conferma-rifiuto completo
(`Reservations.jsx`), non solo alle prenotazioni del giorno.

---

## 6. Dashboard (`StaffHome.jsx`)

La schermata di scelta area (ex 3 pulsanti spogli) mostra ora: saluto +
data/turno corrente, un tile per area con un'informazione live dove utile
(tavoli aperti su "Sala", conteggio "da confermare" su "Prenotazioni" con un
badge). Le sottoscrizioni che alimentano questi numeri si montano solo
quando la Dashboard è effettivamente mostrata, così un account
solo-cameriere o solo-cucina — che salta dritto alla propria area — non paga
il costo di listener che non vedrà mai. Il criterio di skip automatico
(un'unica area disponibile → nessuna scelta da fare) resta calcolato solo
sulle tre aree "core" (Gestione menù/Sala/Cucina), non su Prenotazioni:
altrimenti un account solo-cameriere perderebbe l'attuale accesso diretto a
Sala non appena gli si desse accesso anche a Prenotazioni.

---

## 7. Pulizia automatica

Stesso meccanismo "pigro" lato client di `orders.js` (§6 di
`docs/comande-camerieri.md`), per restare sul piano Firebase gratuito:

- Le prenotazioni `confirmed` con data ormai passata e mai avviate vengono
  marcate `no_show` al successivo caricamento del calendario
  (`autoFlagNoShows`).
- Le prenotazioni in stato terminale vengono cancellate 30 giorni dopo
  (`runDailyExpiredReservationsCleanup`, richiamata sia da `Reservations.jsx`
  sia da `Waiter.jsx`).

---

## 8. Testing

`tests/reservations.spec.js` (Playwright, stesso stile di
`tests/waiter-order.spec.js`): login richiesto, creazione, conferma,
rifiuto, navigazione tra i mesi del calendario, e il flusso end-to-end
"avvia da Sala → apre comanda con i dati corretti". Dati sentinella
randomizzati e cleanup dedicato in `tests/firestore-cleanup.js`
(`deleteTestReservationByName`).

I pulsanti di azione per riga (Conferma/Rifiuta/Avvia) hanno un
`aria-label` che include il nome della prenotazione: sono infatti ripetuti
identici per ogni riga della lista (a differenza dei tavoli in Sala,
identificati dal numero), e i test girano con `fullyParallel: true` — più
prenotazioni di test possono comparire insieme nella stessa giornata da
worker diversi, quindi ogni pulsante deve restare selezionabile in modo
univoco.
