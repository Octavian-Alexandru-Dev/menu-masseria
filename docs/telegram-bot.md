# Chatbot Telegram per lo staff — documento di progetto

Stato: **implementato (MVP)** — il codice è pronto, ma richiede la
configurazione di alcuni account esterni prima di poter essere usato (§7).
Nessuno di questi servizi è ancora collegato a un account reale: finché §7
non viene completato, il bot non esiste per l'utente finale.

Questo documento descrive il modello, le scelte di progetto e la procedura
di attivazione della funzionalità che permette a cameriere e admin di
modificare il menù e gestire le comande via Telegram (testo o messaggio
vocale), stesso stile di `docs/comande-camerieri.md` e `docs/prenotazioni.md`.

---

## 1. Obiettivo

Permettere a un account staff di eseguire via chat Telegram (testo o
vocale) le stesse azioni che potrebbe fare dall'interfaccia web:
nascondere/mostrare un piatto, cambiarne il prezzo, aprire un tavolo,
aggiungere piatti a una comanda, chiudere un tavolo.

**Fuori scopo per questa prima versione** (idee valutate ma non
implementate):
- Interfaccia a bottoni/tastiera inline Telegram (la conferma delle azioni
  distruttive è testuale: "sì"/"no", §6).
- Più azioni in un unico messaggio ("nascondi la parmigiana e apri il
  tavolo 5") — un solo tool-call per messaggio, per design (§5).
- Un'interfaccia di gestione (nel pannello Admin) per collegare il
  `telegramChatId`: per ora si imposta a mano su Firestore, come già oggi si
  creano gli account staff (`docs/comande-camerieri.md` §3).
- Rimozione di righe già inviate o modifica dei coperti via chat (si fa già
  da `Waiter.jsx`, non è stato duplicato qui).
- Log/audit strutturato dei comandi eseguiti oltre ai log di Cloudflare
  Workers (`wrangler tail`) — vedi §8 per il ragionamento sui rischi.

## 2. Perché un servizio separato (Cloudflare Worker) e non Firebase Functions

Il resto del progetto è una SPA che parla direttamente a Firestore, senza
alcun backend (`docs/architecture.md`). Ricevere un webhook Telegram
richiede però un endpoint HTTPS sempre raggiungibile, quindi *un* backend è
inevitabile.

La scelta è **Cloudflare Workers** invece di Firebase Cloud
Functions/Cloud Run, per un motivo di costo: Cloud Functions (anche la
quota gratuita) richiede di passare il progetto Firebase dal piano Spark al
piano Blaze, cioè collegare una carta di pagamento a Google Cloud. Cloudflare
Workers ha un piano gratuito reale, senza carta. Il rovescio della medaglia:
niente SDK Admin di Firebase (è Node-only, non gira nella runtime V8 dei
Workers), quindi l'accesso a Firestore passa dalla sua **REST API**,
autenticata con un JWT di service account firmato a mano con la Web Crypto
API (`bot/src/firestoreRest.js`) invece che dalla libreria ufficiale.

Una richiesta autenticata così (token OAuth2 di un service account, scope
`datastore`) **bypassa `firestore.rules`** — esattamente come fa già l'SDK
Admin lato server. Non serve quindi nessuna modifica alle regole di
sicurezza per questa funzionalità: il canale del bot è, di proposito, un
canale di fiducia separato da quello del client web.

## 3. Servizi esterni coinvolti e costi attesi

| Servizio | Uso | Costo atteso |
|---|---|---|
| Telegram Bot API | ricezione/invio messaggi | $0, nessun limite pratico |
| Cloudflare Workers | hosting del webhook | $0 (piano free, ben sotto i 100k/giorno) |
| Groq — Whisper `large-v3-turbo` | trascrizione vocali | $0 (piano free, 2.000 richieste/giorno) |
| Groq — `llama-3.3-70b-versatile` | interpretazione comando + tool-calling | $0 (piano free) |
| Google Cloud (service account) | accesso REST a Firestore | $0 — resta nella quota gratuita giornaliera di Firestore piano Spark, nessuna carta richiesta |

Nessun punto dell'architettura richiede una carta di credito collegata.

## 4. Flusso end-to-end

```
Cameriere/Admin → Telegram (testo o vocale)
   → webhook Telegram → Cloudflare Worker (bot/src/index.js)
        1. verifica l'header segreto (la richiesta è davvero da Telegram)
        2. chat.id → staff/{uid} con telegramChatId corrispondente → ruolo
           trovato? no → messaggio "non sei autorizzato" (con il chat id,
           perché l'admin possa collegarlo) e stop
        3. se vocale: scarica l'audio da Telegram → Groq Whisper → testo
        4. legge menu/data e i tavoli aperti per dare contesto al modello
        5. chiama Groq (tool-calling) con solo gli strumenti permessi per
           quel ruolo (§5)
        6. se il modello non ha chiamato nessuno strumento (comando
           ambiguo o fuori scopo): inoltra la sua risposta testuale
        7. se lo strumento è "distruttivo" (§6): salva un'azione in sospeso
           e chiede conferma testuale, non esegue subito
        8. altrimenti valida i riferimenti (l'itemId/tableNumber esiste
           davvero?) e scrive subito su Firestore via REST
        9. risponde su Telegram con una conferma leggibile
```

## 5. Modello dati (aggiunte)

Nessuna modifica a `firestore.rules` (§2). Due aggiunte allo schema
esistente, documentate anche in `docs/data-model.md`:

- **`staff/{uid}.telegramChatId`** (string, opzionale): collega un account
  staff già esistente al suo chat Telegram. Impostato a mano dall'admin
  (Firebase Console), come gli account stessi (§7.5).
- **`botPending/{chatId}`** (una collection nuova): l'azione "distruttiva"
  in attesa di conferma per quel chat (§6) — `{ toolName, args, staffUid,
  staffName, createdAt }`. TTL applicativo di 5 minuti (`bot/src/index.js`,
  `PENDING_TTL_MS`); non è pensata come storico, solo come stato
  transitorio tra un comando e la sua conferma.

## 6. Strumenti disponibili, per ruolo, e conferme

| Strumento | admin | waiter | kitchen | Conferma richiesta |
|---|:-:|:-:|:-:|:-:|
| `hide_menu_item` / `show_menu_item` | ✓ | | | solo per `hide` |
| `update_menu_item_price` | ✓ | | | sì |
| `open_table` | ✓ | ✓ | | no |
| `add_order_items` | ✓ | ✓ | | no |
| `close_table` | ✓ | ✓ | | sì |

`kitchen` non ha strumenti: la cucina ha già il proprio schermo in tempo
reale, il bot non duplica quella superficie.

La conferma (`DESTRUCTIVE_TOOLS` in `bot/src/tools.js`) è riservata alle
azioni che cambiano cosa vede il cliente (nascondere un piatto, cambiarne il
prezzo) o che chiudono definitivamente un'operazione (chiudere un tavolo).
Aprire un tavolo o aggiungere righe a una comanda restano immediati: hanno
lo stesso livello di attrito di un tap nell'interfaccia esistente (una riga
si può sempre rimuovere da `Waiter.jsx`, un tavolo resta aperto).

**Validazione**: prima di ogni scrittura, il Worker rilegge lo stato reale
da Firestore e verifica che gli id/tavoli indicati dal modello esistano
davvero (`bot/src/tools.js`, `findMenuItem`/`findOpenOrder`). Se il modello
ha "allucinato" un id inesistente, l'azione viene rifiutata con un
messaggio chiaro invece di scrivere dati sporchi.

## 7. Setup — account da configurare

Questa è l'unica parte che va fatta a mano, fuori dal codice.

### 7.1 Bot Telegram (BotFather)

1. Apri una chat con [@BotFather](https://t.me/BotFather) su Telegram.
2. `/newbot`, scegli un nome e uno username (deve finire in `bot`).
3. BotFather restituisce un **token** (`123456:ABC-...`) — è
   `TELEGRAM_BOT_TOKEN`.
4. Scegli tu stesso una stringa segreta a caso (es. generata con
   `openssl rand -hex 32`) — sarà `TELEGRAM_WEBHOOK_SECRET`, usata per
   verificare che le richieste in arrivo vengano davvero da Telegram.

### 7.2 Service account Google Cloud (per l'accesso REST a Firestore)

Il progetto Firebase esiste già (`menu-masseria-della-pian`), quindi si
lavora sullo stesso progetto GCP, **senza serve passare a Blaze**: creare un
service account e usare Firestore via API resta nel piano gratuito Spark.

1. [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts)
   → seleziona il progetto `menu-masseria-della-pian` → "Crea account di
   servizio".
2. Nome a piacere (es. `telegram-bot`). Ruolo: **"Cloud Datastore User"**
   (`roles/datastore.user`) — non Owner/Editor: è il minimo che serve per
   leggere/scrivere Firestore.
3. Sull'account appena creato → tab "Chiavi" → "Aggiungi chiave" → JSON.
   Scarica il file: contiene `client_email` (→
   `GOOGLE_SERVICE_ACCOUNT_EMAIL`) e `private_key` (→
   `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`).
4. **Questo file JSON è un segreto quanto una password root**: chi lo
   possiede può leggere/scrivere qualunque documento Firestore del
   progetto, bypassando `firestore.rules` (§2). Non va mai committato, mai
   condiviso via chat/email in chiaro — solo incollato nei secret di
   Cloudflare (§7.4).

### 7.3 Groq

1. Crea un account su [console.groq.com](https://console.groq.com) (gratuito,
   nessuna carta richiesta).
2. "API Keys" → crea una chiave → `GROQ_API_KEY`.

### 7.4 Cloudflare Workers

1. Crea un account su [dash.cloudflare.com](https://dash.cloudflare.com) se
   non ne hai già uno (gratuito, nessuna carta richiesta per il piano
   Workers Free).
2. Dentro `bot/`: `npm install`, poi `npx wrangler login` (apre il browser
   per autorizzare l'account).
3. Imposta i secret (uno alla volta, ognuno chiede il valore a runtime —
   non finiscono mai in un file):
   ```
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   npx wrangler secret put GROQ_API_KEY
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
   ```
   Per `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, incolla il valore del campo
   `private_key` del JSON scaricato al punto 7.2 così com'è (comprese le
   righe `-----BEGIN/END PRIVATE KEY-----` e le sequenze `\n` letterali:
   `bot/src/firestoreRest.js` le converte da solo in vere andate a capo).
4. `FIREBASE_PROJECT_ID` non è un segreto (è già pubblico nel bundle web):
   aggiungilo come variabile normale in `bot/wrangler.toml` sotto `[vars]`
   con il valore `menu-masseria-della-pian`, invece di metterlo tra i
   secret.
5. `npm run deploy` (cioè `wrangler deploy`) — restituisce l'URL pubblico
   del Worker (es. `https://menu-masseria-bot.<tuo-account>.workers.dev`).

### 7.5 Collegare il webhook Telegram al Worker

```
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "<URL DEL WORKER>", "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"}'
```

Usa esattamente gli stessi valori impostati al punto 7.4. Una risposta
`{"ok":true,...}` conferma che Telegram ora inoltra i messaggi al Worker.

### 7.6 Collegare gli account staff al proprio chat Telegram

1. L'account staff (`staff/{uid}`) deve già esistere (creato come oggi,
   `docs/comande-camerieri.md` §3).
2. La persona scrive `/start` al bot su Telegram (o qualunque messaggio):
   se non è ancora collegata, il bot risponde con il proprio **chat id**.
3. L'admin apre Firebase Console → Firestore → `staff/{uid}` di quella
   persona → aggiunge il campo `telegramChatId` (string) con quel valore.
4. Da quel momento i messaggi di quella persona vengono eseguiti con il
   ruolo già assegnato in `staff/{uid}.role`.

## 8. Sicurezza

- **Autorizzazione**: solo i chat collegati a un account `staff/{uid}` con
  ruolo valido possono eseguire comandi (§5, `bot/src/auth.js`) — stesso
  confine di fiducia già documentato in `docs/data-model.md` ("Trust
  boundary"): un account fidato può fare tutto quello che il suo ruolo
  permette, non c'è una gerarchia di permessi più fine.
- **Il segreto più sensibile è la chiave del service account** (§7.2, punto
  4): dà accesso completo a Firestore bypassando le regole. Vive solo nei
  secret di Cloudflare, mai nel repository.
- **Webhook**: ogni richiesta in arrivo deve portare l'header
  `X-Telegram-Bot-Api-Secret-Token` con il valore configurato in `setWebhook`
  (§7.5); altrimenti il Worker risponde `401` senza toccare Firestore.
- **Validazione prima di scrivere** (§6): nessuna scrittura avviene senza
  aver riverificato che l'id/tavolo indicato dal modello esista davvero.
- **Conferma testuale per le azioni difficili da annullare** (§6).
- Non esiste ancora un log strutturato dei comandi eseguiti oltre a quanto
  visibile con `wrangler tail` (i log del Worker, effimeri) — è nella lista
  "fuori scopo" (§1): se in futuro serve un log persistente per audit
  (utile visto che il bot bypassa `firestore.rules`), è naturale scriverlo
  come una nuova collection Firestore, sul modello di `orders`.

## 9. Testing

Il bot non ha interfaccia React: non serve (e non esiste) uno spec
Playwright dedicato — la regola di `CLAUDE.md` sui contract test E2E riguarda
le aree UI del progetto principale.

`bot/test/*.test.js` (Vitest) copre invece:
- conversione dei valori JS ↔ formato REST di Firestore
  (`firestoreValues.test.js`);
- firma del JWT del service account, scambio del token, chiamate REST reali
  con `fetch` mockato al confine di rete (`firestoreRest.test.js`) — la
  parte più delicata, perché non c'è un SDK ufficiale a garantirne la
  correttezza;
- validazione e scrittura di ogni strumento (`tools.test.js`): un id
  inesistente viene rifiutato, un tavolo già aperto/chiuso viene rifiutato,
  le righe di comanda scritte hanno la stessa forma prodotta da
  `src/orders.js`;
- risoluzione chat→ruolo (`auth.test.js`);
- l'intero flusso del webhook, incluso il ciclo di conferma "sì"/"no" e la
  sua scadenza (`index.test.js`).

```
cd bot
npm install
npm test
```

## 10. Idee future (non implementate)

- UI in `Admin.jsx` per collegare/scollegare un `telegramChatId`, invece di
  passare da Firebase Console.
- Un log persistente dei comandi eseguiti dal bot (collection Firestore
  dedicata), utile sia per audit sia per debug.
- Tastiera inline Telegram per le conferme, invece della risposta testuale
  "sì"/"no".
- Più tool-call per messaggio (oggi: uno solo, per design — vedi §1).
