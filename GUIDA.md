# Guida: pubblicare il menù su Firebase (gratis)

Questa guida presuppone che tu non abbia esperienza tecnica: segui i passaggi
nell'ordine. Serve un account Google (puoi usarne uno che hai già, tipo Gmail).

---

## 1. Installa Node.js (una sola volta)

Scarica e installa la versione "LTS" da **https://nodejs.org** (va bene per
Windows e Mac). Serve per costruire il sito prima di pubblicarlo.

Per verificare che sia installato, apri il Terminale (Mac) o il Prompt dei
comandi/PowerShell (Windows) e scrivi:

```
node -v
```

Deve mostrare un numero di versione (es. `v20.11.0`).

---

## 2. Crea il progetto Firebase

1. Vai su **https://console.firebase.google.com**
2. Clicca **"Aggiungi progetto"**, dagli un nome (es. `masseria-menu`)
3. Puoi disattivare Google Analytics quando richiesto (non serve)
4. Attendi la creazione del progetto

### Attiva Firestore (il database)
1. Nel menù a sinistra: **Build → Firestore Database**
2. **Crea database**
3. Scegli **"Avvia in modalità produzione"**
4. Scegli una località vicina all'Italia (es. `eur3 (europe-west)`)

### Attiva l'accesso admin (Authentication)
1. Nel menù a sinistra: **Build → Authentication**
2. **Inizia**, poi scegli il provider **Email/Password** → attivalo
3. Vai sulla scheda **Users** → **Aggiungi utente**
4. Inserisci l'email e la password che userai TU per accedere alla gestione
   del menù (es. la tua email personale). Questa sostituisce il vecchio
   "admin / masseria2026".

### Recupera la configurazione dell'app web
1. Nel menù a sinistra, clicca sull'icona a forma di ingranaggio → **Impostazioni progetto**
2. In basso, sezione **"Le tue app"** → clicca l'icona **</>** (web)
3. Dai un nome all'app (es. `menu-web`) → **Registra app**
4. Ti mostrerà un blocco di codice con `apiKey`, `authDomain`, ecc. Tienilo
   a portata di mano, ti serve tra poco.

---

## 3. Prepara il progetto sul tuo computer

1. Estrai la cartella `masseria-menu-firebase` che ti ho fornito, in un
   punto comodo (es. Desktop)
2. Apri il Terminale/Prompt dei comandi **dentro quella cartella**
   (su Mac: trascina la cartella sull'icona del Terminale; su Windows: apri
   la cartella, poi Shift + tasto destro → "Apri finestra PowerShell qui")
3. Installa le librerie necessarie:

```
npm install
```

4. Copia il file `.env.example` e rinominalo in `.env`
5. Apri `.env` con un editor di testo e incolla i valori presi dal punto
   "Recupera la configurazione" qui sopra, uno per riga, ad esempio:

```
VITE_FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_FIREBASE_AUTH_DOMAIN=masseria-menu.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=masseria-menu
VITE_FIREBASE_STORAGE_BUCKET=masseria-menu.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
```

---

## 3bis. Foto dei piatti

Per poter caricare le foto dei piatti dal pannello di gestione, serve un
account gratuito su un servizio dedicato alle immagini (Cloudinary): il piano
free basta ampiamente per poche decine di foto e non richiede carta di
credito.

1. Vai su **https://cloudinary.com** → **Sign up free**
2. Una volta dentro, nella Dashboard trovi in alto il tuo **Cloud name**:
   tienilo a portata di mano
3. Vai su **Settings** (icona ingranaggio) → scheda **Upload**
4. Scorri fino a **Upload presets** → **Add upload preset**
5. Imposta:
   - **Signing Mode**: `Unsigned`
   - **Folder**: `menu` (facoltativo, tiene ordinate le foto)
   - Sotto **Upload Manipulations / Format and quality restrictions**, se
     disponibile, limita i formati accettati alle sole immagini
6. Salva e copia il **nome del preset** che hai scelto
7. Apri il file `.env` (creato al punto 3) e aggiungi in fondo:

```
VITE_CLOUDINARY_CLOUD_NAME=il-tuo-cloud-name
VITE_CLOUDINARY_UPLOAD_PRESET=il-nome-del-preset
```

Da qui in poi, nel pannello di gestione, ogni voce del menù avrà un pulsante
**"Carica foto"**: la foto viene caricata su Cloudinary e mostrata
automaticamente sia nel pannello che nel menù pubblico, già ottimizzata
(formato moderno e dimensione ridotta) senza bisogno di comprimerla a mano
prima di caricarla.

Se cambi o aggiungi queste variabili dopo aver già pubblicato il sito, ricordati
di rifare i comandi del punto 6 (`npm run build` e `firebase deploy`) per
renderle effettive online.

---

## 4. Installa lo strumento di pubblicazione Firebase

Nello stesso Terminale:

```
npm install -g firebase-tools
firebase login
```

Si aprirà il browser per accedere con lo stesso account Google usato per
Firebase: consenti l'accesso.

Poi collega la cartella al progetto creato prima:

```
firebase use --add
```

Scegli il progetto dalla lista (es. `masseria-menu`) e dagli l'alias `default`
quando richiesto.

---

## 5. Pubblica le regole di sicurezza del database

```
firebase deploy --only firestore:rules
```

Questo pubblica il file `firestore.rules` già incluso, che permette a
chiunque di **vedere** il menù ma solo a te (da autenticato) di **modificarlo**.

---

## 6. Costruisci e pubblica il sito

Ogni volta che vuoi aggiornare il sito online (anche in futuro, dopo altre
modifiche), esegui questi due comandi dalla cartella del progetto:

```
npm run build
firebase deploy --only hosting
```

Al termine, il Terminale mostrerà un indirizzo tipo:

```
Hosting URL: https://masseria-menu.web.app
```

Quello è il link pubblico del tuo menù, utilizzabile da subito (anche per un
QR code sul tavolo).

---

## 7. Come accedere alla gestione del menù

Vai sul tuo sito → in fondo alla pagina clicca **"Gestione menù"** → accedi
con l'email e la password create al punto 2 ("Attiva l'accesso admin").

---

## Domande frequenti

**Posso aggiungere altri utenti che possono modificare il menù?**
Sì: Firebase Authentication → Users → Aggiungi utente, con un'altra email.

**Posso usare un mio dominio (es. menu.masseriadellapiana.it)?**
Sì, gratis: Firebase Hosting → "Aggiungi dominio personalizzato" e segui le
istruzioni per puntare il dominio (richiede accesso al pannello DNS di dove
hai registrato il dominio).

**Ho dimenticato la password admin, come la reimposto?**
Firebase Authentication → Users → clicca sui tre puntini accanto al tuo
utente → "Reimposta password", oppure elimina l'utente e ricrealo.

**Quanto costa nel tempo?**
Per un solo ristorante con traffico normale resti sempre nella fascia
gratuita ("Spark") di Firebase: nessun costo, nessuna pubblicità, nessun
limite di tempo. Anche le foto dei piatti restano gratis: con poche decine di
immagini sei molto lontano dai limiti del piano free di Cloudinary (25 GB al
mese, storage + banda + trasformazioni comprese).
