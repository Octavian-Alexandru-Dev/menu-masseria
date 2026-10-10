// Raw ESC/POS over TCP (port 9100) to the thermal printer at the till.
//
// The receipt itself is built by the web app (src/escpos.js) and arrives
// here as bytes: this module only moves bytes and asks the printer about its
// state, so the receipt layout can change with a web deploy, without
// reinstalling this client.
const net = require("node:net");
const os = require("node:os");

const CONNECT_TIMEOUT_MS = 4000;

function friendlyError(err, host, port) {
  const code = err && err.code;
  if (code === "ECONNREFUSED") return `La stampante (${host}:${port}) ha rifiutato la connessione. Controlla la porta nelle impostazioni.`;
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return `Indirizzo ${host} non raggiungibile: il computer è collegato alla stessa rete della stampante?`;
  if (code === "ETIMEDOUT" || code === "TIMEOUT") return `La stampante (${host}) non risponde: è accesa e collegata alla rete? L'indirizzo IP è corretto?`;
  return `Errore di comunicazione con la stampante (${host}:${port}): ${(err && err.message) || err}`;
}

function connect(host, port, timeoutMs = CONNECT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" }));
    }, timeoutMs);
    socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
    socket.once("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

// Sends a query and collects whatever the printer answers within waitMs.
async function query(host, port, bytes, waitMs = 700) {
  const socket = await connect(host, port);
  return new Promise((resolve) => {
    const chunks = [];
    socket.on("data", (d) => chunks.push(d));
    socket.on("error", () => {});
    socket.write(Buffer.from(bytes));
    setTimeout(() => { socket.destroy(); resolve(Buffer.concat(chunks)); }, waitMs);
  });
}

function cString(buf) {
  return buf.toString("latin1").replace(/^_/, "").replace(/[\0\r\n]+/g, " ").trim();
}

// DLE EOT (real-time status) + GS I (identification). Each answer is
// optional: not every ESC/POS printer implements every query.
async function getStatus({ host, port }) {
  try {
    const [online, cover, paper, maker, model] = [
      await query(host, port, [0x10, 0x04, 0x01]),
      await query(host, port, [0x10, 0x04, 0x02]),
      await query(host, port, [0x10, 0x04, 0x04]),
      await query(host, port, [0x1d, 0x49, 0x42]),
      await query(host, port, [0x1d, 0x49, 0x43]),
    ];
    const paperByte = paper[0];
    return {
      reachable: true,
      online: online.length ? !(online[0] & 0x08) : null,
      coverOpen: cover.length ? Boolean(cover[0] & 0x04) : null,
      paper: paperByte === undefined ? null : paperByte & 0x60 ? "out" : paperByte & 0x0c ? "near-end" : "ok",
      model: [cString(maker), cString(model)].filter(Boolean).join(" ") || null,
    };
  } catch (err) {
    return { reachable: false, error: friendlyError(err, host, port) };
  }
}

async function printRaw({ host, port }, bytes) {
  // Quick paper check first: "carta esaurita" is a far more useful message
  // than a receipt silently lost. Printers that don't answer the query are
  // printed to anyway.
  try {
    const paper = await query(host, port, [0x10, 0x04, 0x04], 500);
    if (paper.length && paper[0] & 0x60) throw Object.assign(new Error("Carta esaurita: sostituisci il rotolo e riprova."), { code: "PAPER_OUT" });
  } catch (err) {
    if (err.code === "PAPER_OUT") throw err;
    throw new Error(friendlyError(err, host, port));
  }
  let socket;
  try {
    socket = await connect(host, port);
  } catch (err) {
    throw new Error(friendlyError(err, host, port));
  }
  await new Promise((resolve, reject) => {
    socket.once("error", (err) => reject(new Error(friendlyError(err, host, port))));
    socket.end(Buffer.from(bytes), resolve);
  });
}

// Short ASCII + CP858 test page, independent from the web app: it must work
// even when the web app can't be loaded (no internet), to tell a printer
// problem apart from a network one.
function testPageBytes({ host, port, stationName }) {
  const ESC = 0x1b, GS = 0x1d;
  const text = (s) => [...Buffer.from(s, "latin1")];
  const now = new Date();
  return [
    ESC, 0x40, ESC, 0x74, 19,
    ESC, 0x61, 1, GS, 0x21, 0x11, ...text("PROVA STAMPA\n"), GS, 0x21, 0x00,
    ...text(`${stationName || "Cassa"}\n${now.toLocaleDateString("it-IT")} ${now.toLocaleTimeString("it-IT")}\n`),
    ESC, 0x61, 0,
    ...text("-".repeat(42) + "\n"),
    ...text(`Stampante: ${host}:${port}\n`),
    ...text("Accenti: "), 0x85, 0x20, 0x8a, 0x20, 0x82, 0x20, 0x8d, 0x20, 0x95, 0x20, 0x97, ...text("\n"),
    ...text("Euro: "), 0xd5, ...text(" 12,50\n"),
    ...text("-".repeat(42) + "\n"),
    ESC, 0x61, 1, ...text("Se leggi tutto correttamente,\nla stampante funziona.\n"), ESC, 0x61, 0,
    0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00,
  ];
}

// Scans every local IPv4 /24 network for hosts with port 9100 open and asks
// each one for its maker/model — the same procedure used to find the
// printer the first time (docs/stampa-scontrini.md).
async function discover({ port = 9100, onProgress } = {}) {
  const prefixes = new Set();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) prefixes.add(a.address.split(".").slice(0, 3).join("."));
    }
  }
  const candidates = [...prefixes].flatMap((p) => Array.from({ length: 254 }, (_, i) => `${p}.${i + 1}`));
  const open = [];
  let done = 0;
  const probe = async (host) => {
    try {
      const s = await connect(host, port, 600);
      s.destroy();
      open.push(host);
    } catch { /* closed or no host */ }
    done += 1;
    if (onProgress && done % 25 === 0) onProgress(done, candidates.length);
  };
  for (let i = 0; i < candidates.length; i += 64) {
    await Promise.all(candidates.slice(i, i + 64).map(probe));
  }
  const results = [];
  for (const host of open.sort((a, b) => Number(a.split(".")[3]) - Number(b.split(".")[3]))) {
    let model = null;
    try {
      const maker = cString(await query(host, port, [0x1d, 0x49, 0x42], 500));
      const name = cString(await query(host, port, [0x1d, 0x49, 0x43], 500));
      model = [maker, name].filter(Boolean).join(" ") || null;
    } catch { /* ignore */ }
    results.push({ host, port, model, escpos: Boolean(model) });
  }
  return results;
}

module.exports = { getStatus, printRaw, testPageBytes, discover };
