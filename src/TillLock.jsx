// The till's lock screen (settings and PIN: tillLockData.js). Only at the till
// (TillSala.jsx): a phone locks itself. The till underneath stays mounted,
// so the print station keeps printing while it's locked. Like the sheets of
// TillUi.jsx, the screen is mounted on <body> and the app's root is made
// inert: nothing behind it can be reached.
import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Lock, LockOpen, AlertCircle } from "lucide-react";
import { Logo, GlobalStyle } from "./shared";
import { FONT, STATUS, TillButton, Keypad } from "./TillUi";
import { subscribeTillLock, lockActive, pinMatches, rememberLocked, wasLocked, PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "./tillLockData";

// Touches that count as "someone is using the till" (not mouse moves: a
// cursor resting on the screen shouldn't keep it open).
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"];

// { config, active, locked, lock, unlock }: active = there is a lock to use.
export function useTillLock() {
  const [config, setConfig] = useState(null);
  const [locked, setLocked] = useState(false);
  const started = useRef(false);
  const active = lockActive(config);

  useEffect(() => subscribeTillLock(setConfig, (err) => console.error("[cassa] Lettura blocco cassa fallita:", err)), []);

  const lock = useCallback(() => { rememberLocked(true); setLocked(true); }, []);
  const unlock = useCallback(() => { rememberLocked(false); setLocked(false); }, []);

  // First settings read: locked at startup if chosen, or if it was locked
  // before a reload/restart.
  useEffect(() => {
    if (!config || started.current) return;
    started.current = true;
    if (active && (config.lockOnStart || wasLocked())) lock();
  }, [config, active, lock]);

  // Lock turned off (or PIN removed) meanwhile: nothing left to open it with.
  useEffect(() => {
    if (config && !active && locked) unlock();
  }, [config, active, locked, unlock]);

  // Locks after timeoutMinutes without touches.
  const timeoutMinutes = active ? config.timeoutMinutes : 0;
  useEffect(() => {
    if (!timeoutMinutes || locked) return undefined;
    let timer;
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, timeoutMinutes * 60_000);
    };
    restart();
    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, restart, { capture: true, passive: true }));
    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, restart, { capture: true }));
    };
  }, [timeoutMinutes, locked, lock]);

  return { config, active, locked, lock, unlock };
}

// The digits typed so far, as dots (never the digits themselves), with
// their count written out for screen readers and at a glance.
export function PinDots({ t, length, label = "PIN" }) {
  return (
    <div role="status" aria-label={`${label}: ${length} ${length === 1 ? "cifra" : "cifre"}`} style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, minHeight: 34 }}>
      {length === 0
        ? <span style={{ fontSize: 16, color: t.inkSoft }}>Nessuna cifra</span>
        : Array.from({ length }, (_, i) => (
          <span key={i} aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 8, background: t.ink }} />
        ))}
    </div>
  );
}

// Key from the on-screen keypad (or the keyboard) applied to a PIN.
export function pressPinKey(pin, key) {
  if (key === "C") return "";
  if (key === "⌫") return pin.slice(0, -1);
  return pin.length < PIN_MAX_LENGTH ? pin + key : pin;
}

export function TillLockScreen({ t, config, sessionName, onUnlock }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const root = document.getElementById("root");
    if (root) root.inert = true;
    return () => { if (root) root.inert = false; };
  }, []);

  // The right PIN opens straight away, without "Sblocca": its length isn't
  // stored, so every PIN long enough is tried.
  useEffect(() => {
    if (pin.length < PIN_MIN_LENGTH) return undefined;
    let cancelled = false;
    pinMatches(pin, config).then((ok) => { if (ok && !cancelled) onUnlock(); });
    return () => { cancelled = true; };
  }, [pin, config, onUnlock]);

  const press = (key) => {
    setError("");
    setPin((p) => pressPinKey(p, key));
  };
  const submit = async () => {
    setChecking(true);
    const ok = await pinMatches(pin, config);
    setChecking(false);
    if (ok) { onUnlock(); return; }
    setError("PIN errato. Riprova.");
    setPin("");
  };

  // A keyboard, when the till has one: digits, Backspace, Enter.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("⌫");
      else if (e.key === "Enter") submitRef.current();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Cassa bloccata" className="mdp-root" style={{
      position: "fixed", inset: 0, zIndex: 300, background: t.bg, color: t.ink, fontFamily: FONT,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20, overflowY: "auto",
    }}>
      <GlobalStyle t={t} />
      <div style={{ width: "100%", maxWidth: 380, display: "grid", gap: 16 }}>
        <div style={{ display: "grid", justifyItems: "center", gap: 8, textAlign: "center" }}>
          <Logo width={90} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 26, fontWeight: 700 }}>
            <Lock size={24} aria-hidden="true" /> Cassa bloccata
          </div>
          <div style={{ fontSize: 16, color: t.inkSoft }}>Inserisci il PIN per sbloccare{sessionName ? ` · ${sessionName}` : ""}</div>
        </div>
        <PinDots t={t} length={pin.length} label="PIN inserito" />
        {error && (
          <div role="alert" style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", color: STATUS.danger, fontSize: 16, fontWeight: 600 }}>
            <AlertCircle size={18} aria-hidden="true" /> {error}
          </div>
        )}
        <Keypad t={t} onKey={press} keyHeight={68} />
        <TillButton t={t} variant="primary" size={64} icon={LockOpen} disabled={checking || pin.length < PIN_MIN_LENGTH} onClick={submit}>
          Sblocca
        </TillButton>
        <div style={{ fontSize: 14, color: t.inkSoft, textAlign: "center", lineHeight: 1.45 }}>
          PIN dimenticato? Un amministratore lo cambia da Menù › Impostazioni › Blocco cassa, anche dal telefono.
        </div>
      </div>
    </div>,
    document.body,
  );
}
