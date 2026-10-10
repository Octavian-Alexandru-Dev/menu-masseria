// Settings window logic (settings.html). Talks to the main process only
// through window.cassa (settings-preload.js).
const $ = (id) => document.getElementById(id);

function target() {
  return { host: $("host").value.trim(), port: Number($("port").value) };
}

function show(el, text, tone = "") {
  $(el).textContent = text;
  $(el).className = `msg ${tone}`;
}

async function busy(button, fn) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Attendere…";
  try { await fn(); } finally { button.disabled = false; button.textContent = label; }
}

function showSavedLogin(email) {
  $("login-saved").textContent = email ? `Credenziali salvate per: ${email}` : "Nessuna credenziale salvata.";
  if (email && !$("loginEmail").value) $("loginEmail").value = email;
}

function showUpdate(u) {
  const texts = {
    dev: "Versione di sviluppo: aggiornamenti automatici disattivati.",
    idle: "",
    checking: "Controllo aggiornamenti…",
    "up-to-date": "Il programma è aggiornato.",
    downloading: `Download della versione ${u.version || ""} in corso${u.progress != null ? ` (${u.progress}%)` : ""}…`,
    downloaded: `Versione ${u.version} pronta: verrà installata alla chiusura, oppure subito.`,
    error: `Aggiornamento non riuscito: ${u.error}`,
  };
  show("update-msg", texts[u.status] || "", u.status === "error" ? "error" : u.status === "downloaded" ? "ok" : "");
  $("btn-update-install").hidden = u.status !== "downloaded";
}

window.cassa.onUpdateState(showUpdate);

async function init() {
  const info = await window.cassa.get();
  const s = info.settings;
  $("host").value = s.printer.host;
  $("port").value = s.printer.port;
  $("startFullscreen").checked = s.startFullscreen;
  $("kiosk").checked = s.kiosk;
  $("zoomFactor").value = String(s.zoomFactor);
  $("launchAtLogin").checked = s.launchAtLogin;
  $("keyboardMode").value = s.keyboardMode;
  $("autoLogin").checked = s.autoLogin;
  showSavedLogin(info.savedEmail);
  showUpdate(info.update);
  $("stationName").value = s.stationName;
  $("appUrl").value = s.appUrl;
  $("version").textContent = `Versione ${info.version} · Electron ${info.electron}`;
  $("file").textContent = `File impostazioni: ${info.file}`;
}

$("btn-status").addEventListener("click", (e) => busy(e.target, async () => {
  show("printer-msg", "Verifica in corso…");
  const st = await window.cassa.status(target());
  if (!st.reachable) return show("printer-msg", st.error, "error");
  const parts = [`Raggiungibile${st.model ? ` — ${st.model}` : ""}`];
  if (st.online === false) parts.push("NON pronta (offline)");
  if (st.coverOpen) parts.push("coperchio aperto");
  if (st.paper === "out") parts.push("CARTA ESAURITA");
  else if (st.paper === "near-end") parts.push("carta quasi finita");
  else if (st.paper === "ok") parts.push("carta presente");
  const problem = st.online === false || st.coverOpen || st.paper === "out";
  show("printer-msg", parts.join(" · "), problem ? "error" : "ok");
}));

$("btn-test").addEventListener("click", (e) => busy(e.target, async () => {
  show("printer-msg", "Invio stampa di prova…");
  const res = await window.cassa.testPrint(target());
  show("printer-msg", res.ok ? "Stampa di prova inviata: controlla lo scontrino." : res.error, res.ok ? "ok" : "error");
}));

window.cassa.onDiscoverProgress((done, total) => show("printer-msg", `Ricerca in corso… ${Math.round((done / total) * 100)}%`));

$("btn-discover").addEventListener("click", (e) => busy(e.target, async () => {
  $("discover-results").innerHTML = "";
  show("printer-msg", "Ricerca in corso… (circa 30 secondi)");
  const found = await window.cassa.discover();
  if (found.length === 0) return show("printer-msg", "Nessun dispositivo con la porta 9100 aperta trovato su questa rete.", "error");
  show("printer-msg", `Trovati ${found.length} dispositivi. Le stampanti scontrini sono indicate con il modello.`, "ok");
  for (const p of found) {
    const row = document.createElement("div");
    row.className = "found";
    const label = document.createElement("span");
    label.textContent = `${p.host}:${p.port} — ${p.model || "stampante da ufficio / sconosciuta"}`;
    const use = document.createElement("button");
    use.textContent = "Usa questa";
    use.addEventListener("click", () => {
      $("host").value = p.host;
      $("port").value = p.port;
      show("save-msg", "Indirizzo inserito: premi Salva per confermare.");
    });
    row.append(label, use);
    $("discover-results").append(row);
  }
}));

$("btn-save").addEventListener("click", (e) => busy(e.target, async () => {
  const res = await window.cassa.save({
    printer: target(),
    startFullscreen: $("startFullscreen").checked,
    kiosk: $("kiosk").checked,
    zoomFactor: Number($("zoomFactor").value),
    launchAtLogin: $("launchAtLogin").checked,
    keyboardMode: $("keyboardMode").value,
    autoLogin: $("autoLogin").checked,
    stationName: $("stationName").value.trim() || "Cassa",
    appUrl: $("appUrl").value.trim(),
  });
  show("save-msg", res.ok ? "Impostazioni salvate." : res.errors.join(" "), res.ok ? "ok" : "error");
}));

$("btn-login-save").addEventListener("click", (e) => busy(e.target, async () => {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  if (!email || !password) return show("login-msg", "Inserisci email e password.", "error");
  const res = await window.cassa.credentials("save", email, password);
  if (!res.ok) return show("login-msg", res.error, "error");
  $("loginPassword").value = "";
  showSavedLogin(res.savedEmail);
  show("login-msg", "Credenziali salvate. Ricorda di premere Salva in basso se hai cambiato l'opzione di accesso automatico.", "ok");
}));

$("btn-login-clear").addEventListener("click", (e) => busy(e.target, async () => {
  const res = await window.cassa.credentials("clear");
  $("loginEmail").value = "";
  showSavedLogin(res.savedEmail);
  show("login-msg", "Credenziali rimosse.", "ok");
}));

$("btn-update-check").addEventListener("click", () => window.cassa.action("update-check"));
$("btn-update-install").addEventListener("click", () => window.cassa.action("update-install"));

$("btn-fullscreen").addEventListener("click", () => window.cassa.action("toggle-fullscreen"));
$("btn-reload").addEventListener("click", () => window.cassa.action("reload"));
$("btn-devtools").addEventListener("click", () => window.cassa.action("devtools"));
$("btn-quit").addEventListener("click", () => window.cassa.action("quit"));
$("btn-close").addEventListener("click", () => window.close());

init();
