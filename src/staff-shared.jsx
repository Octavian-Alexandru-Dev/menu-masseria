// Pieces shared by the staff areas (StaffHome.jsx, Waiter.jsx,
// Reservations.jsx): login with Firebase Auth + role check in staff/{uid}
// (see docs/comande-camerieri.md, §3). Loaded only by those (lazy-loaded in
// MenuApp.jsx), never by the public site.
import React, { useState, useEffect, useRef } from "react";
import { Lock, AlertCircle, LogOut, UserRound } from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase-db";
import { auth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "./firebase-auth";
import { THEMES, ital, GlobalStyle, Logo, TYPE, FALLBACK_STYLE } from "./shared";
import { getDesktopBridge } from "./desktop";
import { confirmAction } from "./confirmDialog";
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
  return { status: "ready", user: fbUser, role: staffDoc.role, name: staffDoc.name || fbUser.email };
}

const WRONG_CREDENTIALS = new Set(["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"]);

export function signInErrorMessage(code) {
  if (WRONG_CREDENTIALS.has(code)) return "Email o password non corretti.";
  if (code === "auth/invalid-email") return "Indirizzo email non valido.";
  if (code === "auth/too-many-requests") return "Troppi tentativi. Riprova tra qualche minuto.";
  return "Accesso non riuscito. Riprova.";
}

// Sign-in used by both login screens (StaffLoginScreen, Admin.jsx's
// AdminLogin). Returns null on success, the Firebase error code otherwise
// (the message is already shown). remember: keep the account (and the
// password, encrypted — lastStaffAccount.js) for "Rientra come …".
export async function staffSignIn(email, password, { remember = true } = {}) {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  if (remember) {
    rememberStaffAccount(cred.user.email);
    await rememberStaffPassword(cred.user.email, password);
  }
  return cred;
}

// "Rientra come …" on a login screen: the last account that signed in on
// this device. use() signs straight back in with the remembered password;
// without one (never stored, or it changed since) it fills in the email and
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
    setEmail(account.email);
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

  return (
    <div className="mdp-root" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <GlobalStyle t={t} />
      <form onSubmit={submit} style={{
        background: t.card, border: `1px solid ${t.line}`, borderRadius: 12,
        padding: "36px 30px", width: "100%", maxWidth: 340, boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <Logo width={120} />
        </div>
        <div className="mdp-display" style={{ textAlign: "center", fontStyle: ital(t), fontSize: TYPE.modalTitle, fontWeight: 600, color: t.primary }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ textAlign: "center", fontSize: TYPE.smallPlus, color: t.inkSoft, marginTop: 6, marginBottom: 22 }}>
            {subtitle}
          </div>
        )}

        {savedLogin && (
          <>
            <button type="button" onClick={signInSaved} disabled={busy} className="mdp-btn" style={{
              width: "100%", minHeight: 56, marginBottom: 18, background: t.primary, color: t.bg, border: "none",
              borderRadius: 8, fontSize: TYPE.bodyLg, fontWeight: 600, cursor: "pointer",
            }}>
              {busy ? "Accesso…" : `Accedi come ${savedLogin.email}`}
            </button>
            <div style={{ textAlign: "center", fontSize: TYPE.tinyPlus, color: t.inkSoft, marginBottom: 16 }}>
              oppure con un altro account:
            </div>
          </>
        )}

        {showLastAccount && (
          <LastAccountSuggestion t={t} account={lastAccount} busy={busy} onUse={last.use} onForget={last.forget} />
        )}

        <label style={{ fontSize: TYPE.label, letterSpacing: 1, textTransform: "uppercase", color: t.inkSoft }}>Email</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!showLastAccount}
          autoComplete="username" aria-label="Email"
          style={{ width: "100%", padding: "10px 12px", marginTop: 6, marginBottom: 16, border: `1px solid ${t.line}`, borderRadius: 6, background: t.bg, color: t.ink, fontSize: TYPE.bodyLg }}
        />
        <label style={{ fontSize: TYPE.label, letterSpacing: 1, textTransform: "uppercase", color: t.inkSoft }}>Password</label>
        <input
          ref={passRef} type="password" value={pass} onChange={(e) => setPass(e.target.value)}
          autoComplete="current-password" aria-label="Password"
          style={{ width: "100%", padding: "10px 12px", marginTop: 6, marginBottom: 8, border: `1px solid ${t.line}`, borderRadius: 6, background: t.bg, color: t.ink, fontSize: TYPE.bodyLg }}
        />

        {error && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", color: t.accent2, fontSize: TYPE.smallPlus, marginTop: 8 }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <button type="submit" disabled={busy} className="mdp-btn" style={{
          width: "100%", marginTop: 18, padding: "11px 0", background: t.primary, color: t.bg,
          border: "none", borderRadius: 6, fontSize: TYPE.bodyPlus, letterSpacing: 1, textTransform: "uppercase",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <Lock size={14} /> {busy ? "Accesso…" : "Accedi"}
        </button>
      </form>
    </div>
  );
}

// "Rientra come …" above the email/password fields (StaffLoginScreen and
// Gestione menù's login in Admin.jsx): the last account that signed in on
// this device. A tap fills in its email and moves to the password; "Non sei
// tu?" removes the suggestion (a shared phone or laptop).
export function LastAccountSuggestion({ t, account, busy, onUse, onForget }) {
  const who = account.name && account.name !== account.email ? account.name : account.email;
  return (
    <div role="group" aria-label="Ultimo account usato" style={{ marginBottom: 18 }}>
      <button type="button" onClick={onUse} disabled={busy} autoFocus className="mdp-btn" aria-label={`Rientra come ${who} (${account.email})`} style={{
        width: "100%", minHeight: 56, padding: "10px 14px", background: t.bgAlt, color: t.ink,
        border: `1px solid ${t.line}`, borderRadius: 8, cursor: "pointer",
        display: "flex", alignItems: "center", gap: 12, textAlign: "left",
      }}>
        <UserRound size={22} color={t.primary} aria-hidden="true" style={{ flexShrink: 0 }} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: TYPE.bodyLg, fontWeight: 600, color: t.primary }}>{busy ? "Accesso…" : `Rientra come ${who}`}</span>
          {who !== account.email && (
            <span style={{ display: "block", fontSize: TYPE.smallPlus, color: t.inkSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {account.email}
            </span>
          )}
        </span>
      </button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft }}>oppure inserisci un altro account:</span>
        <button type="button" onClick={onForget} disabled={busy} className="mdp-btn" style={{
          minHeight: 44, padding: "0 4px", background: "none", border: "none",
          color: t.inkSoft, fontSize: TYPE.smallPlus, textDecoration: "underline", cursor: "pointer",
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
    <div className="mdp-root" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <GlobalStyle t={t} />
      <div style={{
        background: t.card, border: `1px solid ${t.line}`, borderRadius: 12,
        padding: "32px 28px", width: "100%", maxWidth: 380, textAlign: "center",
      }}>
        <AlertCircle size={28} color={t.accent2} style={{ marginBottom: 12 }} />
        <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.heading, fontWeight: 600, color: t.primary, marginBottom: 10 }}>
          {title}
        </div>
        <div style={{ fontSize: TYPE.body, color: t.inkSoft, marginBottom: 20, lineHeight: 1.5 }}>
          {message}
        </div>
        {!logoutHiddenAtTill() && <button onClick={onLogout} className="mdp-btn" style={{
          margin: "0 auto", padding: "9px 18px", background: "none", border: `1px solid ${t.line}`,
          borderRadius: 6, color: t.ink, fontSize: TYPE.smallPlus, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <LogOut size={13} /> Esci
        </button>}
      </div>
    </div>
  );
}

export function StaffLoadingScreen({ theme }) {
  const bg = theme ? (THEMES[theme]?.bg || FALLBACK_STYLE.background) : FALLBACK_STYLE.background;
  const color = theme ? (THEMES[theme]?.ink || FALLBACK_STYLE.color) : FALLBACK_STYLE.color;
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: bg, color, fontFamily: FALLBACK_STYLE.fontFamily }}>
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
