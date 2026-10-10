// Saved login for the till account, so nobody has to type it again after a
// restart or a logout. The password is encrypted with Electron's safeStorage
// (DPAPI on Windows: readable only by the same Windows user on the same PC)
// and stored in its own file next to settings.json.
const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");

function file() {
  return path.join(app.getPath("userData"), "login.json");
}

function save(email, password) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("La cifratura di Windows non è disponibile: credenziali non salvate.");
  const data = { email, password: safeStorage.encryptString(password).toString("base64") };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(data));
}

// Only the e-mail, for display in the settings window.
function savedEmail() {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")).email || null;
  } catch {
    return null;
  }
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(file(), "utf8"));
    return { email: data.email, password: safeStorage.decryptString(Buffer.from(data.password, "base64")) };
  } catch {
    return null;
  }
}

function clear() {
  fs.rmSync(file(), { force: true });
}

module.exports = { save, load, savedEmail, clear };
