// Pieces shared between the waiter area (Waiter.jsx) and the kitchen area
// (Kitchen.jsx): login with Firebase Auth + role check in staff/{uid} (see
// docs/comande-camerieri.md, §3). File loaded only by these two areas (both
// lazy-loaded in MenuApp.jsx), never by the public site.
import React, { useState, useEffect } from "react";
import { Lock, AlertCircle, LogOut } from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase-db";
import { auth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "./firebase-auth";
import { THEMES, ital, GlobalStyle, Logo, TYPE, FALLBACK_STYLE } from "./shared";
import { getDesktopBridge } from "./desktop";
import { confirmAction } from "./confirmDialog";

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
      setStaffDoc(snap.exists() ? snap.data() : null);
    });
  }, [fbUser]);

  if (fbUser === undefined) return { status: "loading" };
  if (fbUser === null) return { status: "signed-out" };
  if (staffDoc === undefined) return { status: "loading" };
  if (!staffDoc || !staffDoc.role) return { status: "no-role", user: fbUser };
  return { status: "ready", user: fbUser, role: staffDoc.role, name: staffDoc.name || fbUser.email };
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

  const signIn = async (emailValue, passValue, failurePrefix = "") => {
    setError("");
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, emailValue.trim(), passValue);
    } catch (err) {
      const code = err && err.code;
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
        setError(failurePrefix + "Email o password non corretti.");
      } else if (code === "auth/invalid-email") {
        setError(failurePrefix + "Indirizzo email non valido.");
      } else if (code === "auth/too-many-requests") {
        setError(failurePrefix + "Troppi tentativi. Riprova tra qualche minuto.");
      } else {
        setError(failurePrefix + "Accesso non riuscito. Riprova.");
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    signIn(email, pass);
  };

  const signInSaved = () => signIn(savedLogin.email, savedLogin.password, "Accesso con l'account della cassa non riuscito (controlla le credenziali in Impostazioni): ");

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.getSavedLogin !== "function") return;
    let cancelled = false;
    bridge.getSavedLogin().then((login) => {
      if (cancelled || !login?.email || !login?.password) return;
      setSavedLogin(login);
      if (!manualLogoutAtTill) {
        signIn(login.email, login.password, "Accesso automatico non riuscito (controlla le credenziali in Impostazioni): ");
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

        <label style={{ fontSize: TYPE.label, letterSpacing: 1, textTransform: "uppercase", color: t.inkSoft }}>Email</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
          style={{ width: "100%", padding: "10px 12px", marginTop: 6, marginBottom: 16, border: `1px solid ${t.line}`, borderRadius: 6, background: t.bg, color: t.ink, fontSize: TYPE.bodyLg }}
        />
        <label style={{ fontSize: TYPE.label, letterSpacing: 1, textTransform: "uppercase", color: t.inkSoft }}>Password</label>
        <input
          type="password" value={pass} onChange={(e) => setPass(e.target.value)}
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
        <button onClick={onLogout} className="mdp-btn" style={{
          margin: "0 auto", padding: "9px 18px", background: "none", border: `1px solid ${t.line}`,
          borderRadius: 6, color: t.ink, fontSize: TYPE.smallPlus, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <LogOut size={13} /> Esci
        </button>
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
