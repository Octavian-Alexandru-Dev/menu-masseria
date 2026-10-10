// Client settings, stored as JSON in the user data folder
// (%APPDATA%\Masseria Cassa\settings.json on Windows). Editable from the
// settings window (settings.html) — no need to touch the file by hand.
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const DEFAULTS = {
  // The deployed web app: every hosting deploy reaches the till on the next
  // reload, nothing to reinstall here.
  appUrl: "https://menu.masseria-della-piana.it/?area=staff",
  printer: { host: "192.168.1.164", port: 9100 },
  stationName: "Cassa",
  startFullscreen: true,
  kiosk: false,
  zoomFactor: 1,
  launchAtLogin: false,
};

function file() {
  return path.join(app.getPath("userData"), "settings.json");
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), "utf8"));
    return { ...DEFAULTS, ...saved, printer: { ...DEFAULTS.printer, ...(saved.printer || {}) } };
  } catch {
    return { ...DEFAULTS, printer: { ...DEFAULTS.printer } };
  }
}

function validate(s) {
  const errors = [];
  try {
    const u = new URL(s.appUrl);
    if (u.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(u.hostname)) errors.push("L'indirizzo dell'app deve iniziare con https://");
  } catch {
    errors.push("Indirizzo dell'app non valido.");
  }
  if (!/^[a-zA-Z0-9.-]+$/.test(s.printer.host || "")) errors.push("Indirizzo IP della stampante non valido.");
  const port = Number(s.printer.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("Porta della stampante non valida.");
  const zoom = Number(s.zoomFactor);
  if (!(zoom >= 0.5 && zoom <= 2)) errors.push("Zoom non valido (tra 50% e 200%).");
  return errors;
}

function save(next) {
  const merged = {
    ...load(),
    ...next,
    printer: { host: String(next.printer.host).trim(), port: Number(next.printer.port) },
    zoomFactor: Number(next.zoomFactor),
  };
  const errors = validate(merged);
  if (errors.length) return { ok: false, errors };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(merged, null, 2));
  return { ok: true, settings: merged };
}

module.exports = { load, save, file, DEFAULTS };
