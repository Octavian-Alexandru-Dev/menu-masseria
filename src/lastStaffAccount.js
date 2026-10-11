// The last staff account that signed in successfully on this device/browser,
// so the login screen can suggest "Rientra come …" after a logout (wanted or
// not). Only email and display name are kept — never the password: the
// suggestion fills in the email and leaves the password to the person (or
// the browser's password manager). At the till, the client's saved account
// (getSavedLogin, desktop.js) still signs in with one tap on its own.
const KEY = "mdp.lastStaffAccount";

export function getLastStaffAccount() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    return value && typeof value.email === "string" && value.email ? value : null;
  } catch {
    return null;
  }
}

// name is optional: without it (Gestione menù's own login, which doesn't
// read staff/{uid}) the name saved earlier for the same email is kept.
export function rememberStaffAccount(email, name) {
  if (!email) return;
  const previous = getLastStaffAccount();
  const keptName = name || (previous?.email === email ? previous.name : "") || "";
  if (previous?.email === email && previous.name === keptName) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ email, name: keptName }));
  } catch { /* storage unavailable: just no suggestion next time */ }
}

export function forgetLastStaffAccount() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
