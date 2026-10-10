// Minimal file log of the main process (startup, instances, windows,
// updates), to understand after the fact what happened on the till — e.g.
// a launch during an update. %APPDATA%\Masseria Cassa\logs\main.log, kept
// under ~1 MB (the older half is dropped). "Apri cartella log" in Impostazioni.
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const MAX_BYTES = 1024 * 1024;

function dir() {
  return path.join(app.getPath("userData"), "logs");
}

function file() {
  return path.join(dir(), "main.log");
}

function log(...parts) {
  const line = `${new Date().toISOString()} [pid ${process.pid}] ${parts.map((p) => (p instanceof Error ? p.stack || p.message : typeof p === "string" ? p : JSON.stringify(p))).join(" ")}\n`;
  try {
    fs.mkdirSync(dir(), { recursive: true });
    try {
      if (fs.statSync(file()).size > MAX_BYTES) {
        const content = fs.readFileSync(file(), "utf8");
        fs.writeFileSync(file(), content.slice(content.length / 2));
      }
    } catch { /* no file yet */ }
    fs.appendFileSync(file(), line);
  } catch { /* logging must never break the app */ }
}

module.exports = { log, dir };
