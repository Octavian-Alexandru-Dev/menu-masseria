// Minimal Firestore REST client for the Cloudflare Worker runtime.
//
// Why not the Admin SDK: firebase-admin is Node-only (grpc, node:fs, ...)
// and doesn't run in the Workers V8-isolate runtime. Rather than pull in a
// generic third-party wrapper, this talks to the plain Firestore REST API
// (https://firestore.googleapis.com/v1/...) directly, authenticated with a
// Google service-account JWT signed via the standard Web Crypto API.
//
// A request authenticated this way (OAuth2 access token for a service
// account, scope "datastore") bypasses firestore.rules entirely — the same
// trust boundary the app's own client already grants any signed-in staff
// account (see docs/data-model.md, "Trust boundary"). No rules change is
// needed for the bot; the service account key itself is the sensitive
// secret (see docs/telegram-bot.md).

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";

// Cached across requests handled by the same Worker isolate (best-effort —
// a cold start just re-mints one, which costs a single extra fetch).
let cachedToken = null; // { accessToken, expiresAtMs }

function base64UrlFromBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlFromString(str) {
  return base64UrlFromBytes(new TextEncoder().encode(str));
}

function normalizePrivateKey(rawKey) {
  // Secrets are pasted as a single line; a literal "\n" (backslash-n) in
  // that string needs turning back into a real newline before it's a valid
  // PEM block. A key pasted with real newlines already is left untouched.
  return rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
}

async function importPrivateKey(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function mintAccessToken(env) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const unsigned = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claims))}`;

  const key = await importPrivateKey(normalizePrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY));
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${base64UrlFromBytes(new Uint8Array(signature))}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google OAuth token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return { accessToken: json.access_token, expiresAtMs: Date.now() + (json.expires_in - 60) * 1000 };
}

async function getAccessToken(env) {
  if (cachedToken && cachedToken.expiresAtMs > Date.now()) return cachedToken.accessToken;
  cachedToken = await mintAccessToken(env);
  return cachedToken.accessToken;
}

function baseUrl(env) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

async function authedFetch(env, url, options = {}) {
  const token = await getAccessToken(env);
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
}

/* ------------------------- value (de)serialization ------------------------ */

export function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === "object") return { mapValue: { fields: toFirestoreFields(value) } };
  throw new Error(`Unsupported value type for Firestore: ${typeof value}`);
}

export function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === undefined) continue; // Firestore rejects nested undefined, same rule as the client SDK
    fields[key] = toFirestoreValue(value);
  }
  return fields;
}

export function fromFirestoreValue(fv) {
  if (!fv) return null;
  if ("nullValue" in fv) return null;
  if ("booleanValue" in fv) return fv.booleanValue;
  if ("integerValue" in fv) return Number(fv.integerValue);
  if ("doubleValue" in fv) return fv.doubleValue;
  if ("stringValue" in fv) return fv.stringValue;
  if ("timestampValue" in fv) return new Date(fv.timestampValue);
  if ("arrayValue" in fv) return (fv.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in fv) return fromFirestoreFields(fv.mapValue.fields || {});
  throw new Error(`Unsupported Firestore value: ${JSON.stringify(fv)}`);
}

export function fromFirestoreFields(fields) {
  const obj = {};
  for (const [key, value] of Object.entries(fields || {})) obj[key] = fromFirestoreValue(value);
  return obj;
}

function docIdFromName(name) {
  return name.split("/").pop();
}

export function fromFirestoreDoc(doc) {
  if (!doc) return null;
  return { id: docIdFromName(doc.name), ...fromFirestoreFields(doc.fields || {}) };
}

/* --------------------------------- CRUD ---------------------------------- */

// path: e.g. "menu/data", "orders/abc123", "staff/uid1"
export async function getDocument(env, path) {
  const res = await authedFetch(env, `${baseUrl(env)}/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET ${path} failed: ${res.status} ${await res.text()}`);
  return fromFirestoreDoc(await res.json());
}

// Full-field replace (updateMask covers exactly the top-level keys in
// `data`, matching the same "rewrite the whole field" pattern the app's own
// orders.js already uses for array fields like `items`).
export async function patchDocument(env, path, data) {
  const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const res = await authedFetch(env, `${baseUrl(env)}/${path}?${mask}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) throw new Error(`Firestore PATCH ${path} failed: ${res.status} ${await res.text()}`);
  return fromFirestoreDoc(await res.json());
}

// collectionPath: e.g. "orders". documentId omitted => Firestore auto-generates one.
export async function createDocument(env, collectionPath, data, documentId) {
  const qs = documentId ? `?documentId=${encodeURIComponent(documentId)}` : "";
  const res = await authedFetch(env, `${baseUrl(env)}/${collectionPath}${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) throw new Error(`Firestore POST ${collectionPath} failed: ${res.status} ${await res.text()}`);
  return fromFirestoreDoc(await res.json());
}

export async function deleteDocument(env, path) {
  const res = await authedFetch(env, `${baseUrl(env)}/${path}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Firestore DELETE ${path} failed: ${res.status} ${await res.text()}`);
  }
}

// Simple single-collection equality query (the only shape the bot needs:
// "find the staff doc with this telegramChatId", "find the open order for
// this table"). `filters` is an array of [fieldPath, value] AND-ed together.
export async function queryEquals(env, collectionId, filters, limit = 1) {
  const fieldFilters = filters.map(([fieldPath, value]) => ({
    fieldFilter: { field: { fieldPath }, op: "EQUAL", value: toFirestoreValue(value) },
  }));
  const where =
    fieldFilters.length === 1 ? fieldFilters[0] : { compositeFilter: { op: "AND", filters: fieldFilters } };

  const res = await authedFetch(env, `${baseUrl(env)}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: { from: [{ collectionId }], where, limit },
    }),
  });
  if (!res.ok) throw new Error(`Firestore query on ${collectionId} failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows.filter((row) => row.document).map((row) => fromFirestoreDoc(row.document));
}

// Exposed for tests only, to reset the module-level token cache between runs.
export function _resetTokenCacheForTests() {
  cachedToken = null;
}
