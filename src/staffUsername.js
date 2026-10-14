// Staff log in with a username ("marco"), not an email. Firebase Auth's
// email/password accounts need an email, so a username stands for an
// internal address on a domain that receives no mail
// ("marco@staff.masseria.local"): nobody sees or types it. What's typed
// with an "@" is used as it is, so the accounts created with a real email
// (in the console, or before usernames) keep working.
// No mail means no "forgot password" by email: for a forgotten password the
// account is removed and created again (GUIDA.md).
export const USERNAME_DOMAIN = "staff.masseria.local";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
const USERNAME_PATTERN = new RegExp(`^[a-z0-9][a-z0-9._-]{${USERNAME_MIN_LENGTH - 1},${USERNAME_MAX_LENGTH - 1}}$`);

export function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

// Lowercase letters, digits, ".", "_", "-"; starts with a letter or digit.
export function isValidUsername(value) {
  return USERNAME_PATTERN.test(normalizeUsername(value));
}

// What's typed in the login field → the email Firebase Auth signs in with.
export function loginEmail(value) {
  const v = normalizeUsername(value);
  if (!v || v.includes("@")) return v;
  return `${v}@${USERNAME_DOMAIN}`;
}

// An account's email → what to show and type: the username, or the email
// itself for an account with a real one.
export function loginName(email) {
  const suffix = `@${USERNAME_DOMAIN}`;
  return email && email.toLowerCase().endsWith(suffix) ? email.slice(0, -suffix.length) : email || "";
}
