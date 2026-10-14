// Pieces shared by the staff areas (StaffHome.jsx, Waiter.jsx,
// Reservations.jsx): login with Firebase Auth + role check in staff/{uid}
// (see docs/comande-camerieri.md, §3). Loaded only by those (lazy-loaded in
// MenuApp.jsx), never by the public site.
import React, { useState, useEffect, useRef } from "react";
import { Lock, AlertCircle, LogOut, UserRound, LogIn } from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase-db";
import { auth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "./firebase-auth";
import { THEMES, GlobalStyle, Logo, FALLBACK_STYLE } from "./shared";
import { FONT, STATUS, TOUCH, TillButton, Field, tillInputStyle } from "./TillUi";
import { getDesktopBridge } from "./desktop";
import { confirmAction } from "./confirmDialog";
import { loginEmail, loginName } from "./staffUsername";
import { getLastStaffAccount, rememberStaffAccount, forgetLastStaffAccount, rememberStaffPassword, loadStaffPassword, forgetStaffPassword } from "./lastStaffAccount";

// Set by a deliberate, confirmed logout at the till: the login screen then
// waits for a tap on "Accedi come …" instead of signing straight back in
// (so another account can be used). Reset by reloading/restarting the
// client, which signs in automatically again.
let manualLogoutAtTill = false;

// A staff member's session state:
//  - "loading": don't know yet whether they're authenticated / don't know their role yet
//  - "signed-out": no authenticated user
//  - "no-role": authenticated, but no staff/{uid} document with a valid role
//  - "ready": authenticated and with an assigned role
export function useStaffSession() {
  const [fbUser, setFbUser] = useState(undefined); // undefined = not known yet
  const [staffDoc, setStaffDoc] = useState(undefined);

  useEffect(() => onAuthStateChanged(auth, (u) => setFbUser(u || null)), []);

  useEffect(() => {
    if (!fbUser) {
      setStaffDoc(undefined);
      return;
    }
    return onSnapshot(doc(db, "staff", fbUser.uid), (snap) => {
      const data = snap.exists() ? snap.data() : null;
      // Suggested again on the login screen after a logout ("Rientra come …").
      if (data?.role) rememberStaffAccount(fbUser.email, data.name);
      setStaffDoc(data);
    });
  }, [fbUser]);

  if (fbUser === undefined) return { status: "loading" };
  if (fbUser === null) return { status: "signed-out" };
  if (staffDoc === undefined) return { status: "loading" };
  if (!staffDoc || !staffDoc.role) return { status: "no-role", user: fbUser };
  return { status: "ready", user: fbUser, role: staffDoc.role, name: staffDoc.name || loginName(fbUser.email) };
}

const WRONG_CREDENTIALS = new Set(["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"]);

export function signInErrorMessage(code) {
  if (WRONG_CREDENTIALS.has(code)) return "Nome utente o password non corretti.";
  if (code === "auth/invalid-email") return "Nome utente non valido.";
  if (code === "auth/too-many-requests") return "Troppi tentativi. Riprova tra qualche minuto.";
  return "Accesso non riuscito. Riprova.";
}

// Sign-in used by both login screens (StaffLoginScreen, Admin.jsx's
// AdminLogin), with a username or an email (staffUsername.js). Returns null on success, the Firebase error code otherwise
// (the message is already shown). remember: keep the account (and the
// password, encrypted — lastStaffAccount.js) for "Rientra come …".
export async function staffSignIn(email, password, { remember = true } = {}) {
  const cred = await signInWithEmailAndPassword(auth, loginEmail(email), password);
  if (remember) {
    rememberStaffAccount(cred.user.email);
    await rememberStaffPassword(cred.user.email, password);
  }
  return cred;
}

// "Rientra come …" on a login screen: the last account that signed in on
// this device. use() signs straight back in with the remembered password;
// without one (never stored, or it changed since) it fills in the username and
// moves to the password field.
export function useLastStaffAccount({ signIn, setEmail, setError, passRef }) {
  const [account, setAccount] = useState(getLastStaffAccount);
  const use = async () => {
    const password = await loadStaffPassword(account.email);
    if (password) {
      const code = await signIn(account.email, password);
      if (!code) return;
      if (!WRONG_CREDENTIALS.has(code)) return; // e.g. offline: the error is shown, tap again later
      await forgetStaffPassword();
      setError("La password di questo account è cambiata: inseriscila di nuovo.");
    } else {
      setError("");
    }
    setEmail(loginName(account.email));
    passRef.current?.focus();
  };
  const forget = async () => {
    await forgetLastStaffAccount();
    setAccount(null);
    setEmail("");
  };
  return { account, use, forget };
}

export function StaffLoginScreen({ title, subtitle, theme }) {
  const t = THEMES[theme] || THEMES.minimal;
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Till account saved in the Windows client (desktop-client/credentials.js):
  // automatic sign-in, plus a one-tap button after a deliberate logout.
  const [savedLogin, setSavedLogin] = useState(null);
  const passRef = useRef(null);

  // remember: false for the till's saved account, already kept (encrypted)
  // by the client itself.
  const signIn = async (emailValue, passValue, failurePrefix = "", remember = true) => {
    setError("");
    setBusy(true);
    try {
      await staffSignIn(emailValue, passValue, { remember });
      return null;
    } catch (err) {
      const code = (err && err.code) || "unknown";
      setError(failurePrefix + signInErrorMessage(code));
      return code;
    } finally {
      setBusy(false);
    }
  };
  // Last account that signed in here: "Rientra come …".
  const last = useLastStaffAccount({ signIn, setEmail, setError, passRef });
  const lastAccount = last.account;

  const submit = (e) => {
    e.preventDefault();
    signIn(email, pass);
  };

  // The till's saved account already has its own one-tap button.
  const showLastAccount = lastAccount && lastAccount.email !== savedLogin?.email;

  const signInSaved = () => signIn(savedLogin.email, savedLogin.password, "Accesso con l'account della cassa non riuscito (controlla le credenziali in Impostazioni): ", false);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.getSavedLogin !== "function") return;
    let cancelled = false;
    bridge.getSavedLogin().then((login) => {
      if (cancelled || !login?.email || !login?.password) return;
      setSavedLogin(login);
      if (!manualLogoutAtTill) {
        signIn(login.email, login.password, "Accesso automatico non riuscito (controlla le credenziali in Impostazioni): ", false);
      }
    }).catch((err) => console.error("[login] Credenziali della cassa non disponibili:", err));
    return () => { cancelled = true; };
  }, []);

  const input = tillInputStyle(t);
  return (
    <StaffCard t={t}>
      <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
        <CardTitle t={t} title={title} subtitle={subtitle} />

        {savedLogin && (
          <>
            <TillButton t={t} variant="primary" size={60} icon={LogIn} onClick={signInSaved} disabled={busy}>
              {busy ? "Accesso…" : `Accedi come ${loginName(savedLogin.email)}`}
            </TillButton>
            <div style={{ textAlign: "center", fontSize: 15, color: t.inkSoft }}>oppure con un altro account:</div>
          </>
        )}

        {showLastAccount && (
          <LastAccountSuggestion t={t} account={lastAccount} busy={busy} onUse={last.use} onForget={last.forget} />
        )}

        <Field t={t} label="Nome utente">
          <input
            type="text" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!showLastAccount}
            autoComplete="username" aria-label="Nome utente" autoCapitalize="off" autoCorrect="off" spellCheck={false} style={input}
          />
        </Field>
        <Field t={t} label="Password">
          <input
            ref={passRef} type="password" value={pass} onChange={(e) => setPass(e.target.value)}
            autoComplete="current-password" aria-label="Password" style={input}
          />
        </Field>

        {error && (
          <div role="alert" style={{ display: "flex", gap: 8, alignItems: "flex-start", color: STATUS.danger, fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>
            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
          </div>
        )}

        <TillButton t={t} type="submit" variant="primary" size={56} icon={Lock} disabled={busy}>
          {busy ? "Accesso…" : "Accedi"}
        </TillButton>
      </form>
    </StaffCard>
  );
}

// The card the staff screens before the app (login, messages) sit in: same
// look as the rest of the staff area (TillUi.jsx).
function StaffCard({ t, children }) {
  return (
    <div className="mdp-root" style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: t.bg, fontFamily: FONT, color: t.ink }}>
      <GlobalStyle t={t} />
      <div style={{ width: "100%", maxWidth: 400, padding: "28px 22px", borderRadius: 20, border: `1.5px solid ${t.line}`, background: t.card, boxShadow: "0 10px 30px rgba(0,0,0,0.06)" }}>
        {children}
      </div>
    </div>
  );
}

function CardTitle({ t, title, subtitle }) {
  return (
    <div style={{ textAlign: "center", display: "grid", gap: 6, justifyItems: "center" }}>
      <Logo width={110} />
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 15, color: t.inkSoft, lineHeight: 1.4 }}>{subtitle}</div>}
    </div>
  );
}

// "Rientra come …" above the username/password fields (StaffLoginScreen and
// Gestione menù's login in Admin.jsx): the last account that signed in on
// this device. A tap fills in its username and moves to the password; "Non sei
// tu?" removes the suggestion (a shared phone or laptop).
export function LastAccountSuggestion({ t, account, busy, onUse, onForget }) {
  const login = loginName(account.email);
  const who = account.name && account.name !== account.email ? account.name : login;
  return (
    <div role="group" aria-label="Ultimo account usato" style={{ display: "grid", gap: 4 }}>
      <button type="button" onClick={onUse} disabled={busy} autoFocus className="mdp-btn" aria-label={`Rientra come ${who} (${login})`} style={{
        width: "100%", minHeight: 64, padding: "10px 14px", background: `${t.primary}10`, color: t.ink,
        border: `1.5px solid ${t.primary}`, borderRadius: 12, cursor: "pointer", fontFamily: FONT,
        display: "flex", alignItems: "center", gap: 12, textAlign: "left",
      }}>
        <UserRound size={24} color={t.primary} aria-hidden="true" style={{ flexShrink: 0 }} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 17, fontWeight: 700 }}>{busy ? "Accesso…" : `Rientra come ${who}`}</span>
          {who !== login && (
            <span style={{ display: "block", fontSize: 14, color: t.inkSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {login}
            </span>
          )}
        </span>
      </button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 14, color: t.inkSoft }}>oppure un altro account:</span>
        <button type="button" onClick={onForget} disabled={busy} className="mdp-btn" style={{
          minHeight: TOUCH, padding: "0 4px", background: "none", border: "none", fontFamily: FONT,
          color: t.inkSoft, fontSize: 15, textDecoration: "underline", cursor: "pointer",
        }}>
          Non sei tu?
        </button>
      </div>
    </div>
  );
}

export function StaffMessageScreen({ theme, title, message, onLogout }) {
  const t = THEMES[theme] || THEMES.minimal;
  return (
    <StaffCard t={t}>
      <div style={{ display: "grid", gap: 14, textAlign: "center", justifyItems: "center" }}>
        <AlertCircle size={34} color={STATUS.waiting} />
        <div style={{ fontSize: 22, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 16, color: t.inkSoft, lineHeight: 1.5 }}>{message}</div>
        {!logoutHiddenAtTill() && (
          <TillButton t={t} icon={LogOut} onClick={onLogout} style={{ width: "100%", marginTop: 6 }}>Esci</TillButton>
        )}
      </div>
    </StaffCard>
  );
}

export function StaffLoadingScreen({ theme }) {
  const bg = theme ? (THEMES[theme]?.bg || FALLBACK_STYLE.background) : FALLBACK_STYLE.background;
  const color = theme ? (THEMES[theme]?.ink || FALLBACK_STYLE.color) : FALLBACK_STYLE.color;
  return (
    <div role="status" style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", gap: 14, alignItems: "center", justifyContent: "center", background: bg, color, fontFamily: FONT, fontSize: 17 }}>
      <style>{"@keyframes mdpStaffSpin { to { transform: rotate(360deg); } }"}</style>
      <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: "50%", border: `3px solid ${color}33`, borderTopColor: color, animation: "mdpStaffSpin .8s linear infinite" }} />
      Caricamento…
    </div>
  );
}

// At the till (client ≥ 1.4.0, whose settings window has its own "Esci
// dall'account") no "Esci" button is shown anywhere in the web app: logging
// out there is rare and deliberate, so it lives in the client's settings,
// out of the way of an accidental tap. Older clients keep the confirmed
// "Esci" below, otherwise they would have no way to log out at all.
export function logoutHiddenAtTill() {
  const bridge = getDesktopBridge();
  return Boolean(bridge && typeof bridge.onLogoutRequest === "function");
}

// Logout asked from the client's settings window (PrintStation.jsx listens
// for it): already confirmed there, so no dialog — and no automatic sign-in
// afterwards, the login screen offers "Accedi come …" instead.
export function tillLogout() {
  manualLogoutAtTill = true;
  return signOut(auth);
}

// Inside the till client a stray tap on "Esci" would leave the till logged
// out (and stop the print station): there it asks for confirmation first.
// On phones/browsers it logs out immediately, as before.
export async function staffLogout() {
  if (getDesktopBridge()) {
    const confirmed = await confirmAction({
      title: "Uscire dall'account?",
      message: "La cassa smetterà di stampare i preconti finché non si accede di nuovo.",
      confirmLabel: "Esci",
      danger: true,
    });
    if (!confirmed) return;
    manualLogoutAtTill = true;
  }
  return signOut(auth);
}
