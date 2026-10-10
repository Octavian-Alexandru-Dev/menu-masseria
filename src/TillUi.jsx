// Building blocks of the till screens (TillSala.jsx, TillHistory.jsx,
// TillReservations.jsx): one set of sizes, colours and controls, so every
// till screen looks and behaves the same — consistency is what lets people
// use a POS without training.
//
//  - every control is at least 48px (Material 48dp / Apple 44pt / WCAG
//    2.5.5), primary actions 56–64px;
//  - status colours are fixed (not tied to the menu theme, some themes are
//    nearly monochrome) and always paired with a written label;
//  - the right-hand side panel is the one place where the selected thing
//    (a table's ticket, a closed order, a reservation) is shown and edited.
import React from "react";
import { Minus, Plus, Delete } from "lucide-react";

export const TOUCH = 48;
export const FONT = "'Work Sans', system-ui, sans-serif";
export const SIDE_PANEL_WIDTH = "minmax(380px, 34%)";

export const STATUS = {
  idle: "#7d7d7d",
  waiting: "#c77700",
  ok: "#2e7d4f",
  info: "#2f62a8",
  danger: "#b03a2e",
};

export function StatusPill({ color, children, style }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: 8, fontSize: 13, fontWeight: 700,
      color: "#fff", background: color, whiteSpace: "nowrap", ...style,
    }}>{children}</span>
  );
}

// variant: primary | secondary | danger | ghost
export function TillButton({ t, variant = "secondary", size = 56, icon: Icon, children, style, ...rest }) {
  const v = {
    primary: { background: t.primary, color: t.bg, border: "none" },
    secondary: { background: t.card, color: t.ink, border: `1.5px solid ${t.line}` },
    danger: { background: t.card, color: STATUS.danger, border: `1.5px solid ${STATUS.danger}` },
    ghost: { background: "none", color: t.inkSoft, border: "none" },
  }[variant];
  const disabled = rest.disabled;
  return (
    <button type="button" className="mdp-btn" {...rest} style={{
      minHeight: size, padding: "0 18px", borderRadius: 12, fontSize: size >= 60 ? 19 : 17, fontWeight: 600, fontFamily: FONT,
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
      cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1, ...v, ...style,
    }}>
      {Icon && <Icon size={size >= 60 ? 22 : 20} />} {children}
    </button>
  );
}

export function Stepper({ t, label, value, onChange, min = 0, size = 56 }) {
  const btn = {
    width: size, height: size, borderRadius: 12, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink,
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontFamily: FONT }}>
      <span style={{ fontSize: 17, fontWeight: 600 }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" aria-label={`Diminuisci ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} className="mdp-btn" style={{ ...btn, opacity: value <= min ? 0.4 : 1 }}><Minus size={22} /></button>
        <span aria-label={label} style={{ minWidth: 36, textAlign: "center", fontSize: 26, fontWeight: 700 }}>{value}</span>
        <button type="button" aria-label={`Aumenta ${label.toLowerCase()}`} onClick={() => onChange(value + 1)} className="mdp-btn" style={btn}><Plus size={22} /></button>
      </span>
    </div>
  );
}

// On-screen numeric keypad (the till has no keyboard). onKey receives a
// digit, "C" (clear) or "⌫" (backspace).
export function Keypad({ t, onKey, keyHeight = 64 }) {
  const keyStyle = {
    minHeight: keyHeight, borderRadius: 14, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink,
    fontSize: 26, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT,
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map((k) => (
        <button key={k} type="button" onClick={() => onKey(k)} className="mdp-btn"
          aria-label={k === "C" ? "Cancella numero" : k === "⌫" ? "Cancella ultima cifra" : `Cifra ${k}`}
          style={{ ...keyStyle, ...(k === "C" || k === "⌫" ? { fontSize: 20, color: t.inkSoft } : null) }}>
          {k === "⌫" ? <Delete size={26} /> : k}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ t, children, color, style }) {
  return (
    <div style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: color || t.inkSoft, fontFamily: FONT, ...style }}>
      {children}
    </div>
  );
}

// The right-hand panel: header, scrolling body, footer fixed at the bottom
// (primary actions always in the same place).
export function SidePanel({ t, label, header, footer, children }) {
  return (
    <section aria-label={label} style={{ display: "flex", flexDirection: "column", minHeight: 0, borderLeft: `1px solid ${t.line}`, background: t.card, fontFamily: FONT, color: t.ink }}>
      {header && <div style={{ padding: "16px 18px 10px" }}>{header}</div>}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 18px 12px" }}>{children}</div>
      {footer && <div style={{ padding: "14px 18px 18px", borderTop: `1px solid ${t.line}`, display: "grid", gap: 10 }}>{footer}</div>}
    </section>
  );
}

export function PrintStatusLine({ status }) {
  if (!status) return null;
  const color = status.tone === "error" ? STATUS.danger : status.tone === "ok" ? STATUS.ok : status.tone === "warn" ? STATUS.waiting : "#5c554b";
  return (
    <div role="status" aria-label="Stato stampa" style={{ fontSize: 15, fontWeight: 600, color, textAlign: "center", lineHeight: 1.35, fontFamily: FONT }}>
      {status.text}
    </div>
  );
}
