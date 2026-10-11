// Building blocks of the till screens (TillSala.jsx, TillHistory.jsx,
// TillReservations.jsx, TillMenu.jsx, TillStats.jsx): one set of sizes, colours and controls, so every
// till screen looks and behaves the same — consistency is what lets people
// use a POS without training.
//
//  - every control is at least 48px (Material 48dp / Apple 44pt / WCAG
//    2.5.5), primary actions 56–64px;
//  - status colours are fixed (not tied to the menu theme, some themes are
//    nearly monochrome) and always paired with a written label;
//  - the right-hand side panel is the one place where the selected thing
//    (a table's ticket, a closed order, a reservation, a dish) is shown and
//    edited; form edits apply only on "Salva".
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

// prefix: what is being printed, when more than one print status can be on
// screen (e.g. "Comanda cucina" next to the receipt's).
export function PrintStatusLine({ status, label = "Stato stampa", prefix }) {
  if (!status) return null;
  const color = status.tone === "error" ? STATUS.danger : status.tone === "ok" ? STATUS.ok : status.tone === "warn" ? STATUS.waiting : "#5c554b";
  return (
    <div role="status" aria-label={label} style={{ fontSize: 15, fontWeight: 600, color, textAlign: "center", lineHeight: 1.35, fontFamily: FONT }}>
      {prefix ? `${prefix}: ` : ""}{status.text}
    </div>
  );
}

export function tillInputStyle(t) {
  return {
    width: "100%", minHeight: 52, padding: "0 14px", borderRadius: 12, border: `1.5px solid ${t.line}`,
    background: t.bg, color: t.ink, fontSize: 17, fontFamily: FONT, boxSizing: "border-box",
  };
}

// A labelled form field: the label is always visible above the control
// (never a placeholder used as the only label).
export function Field({ t, label, hint, children }) {
  return (
    <label style={{ display: "grid", gap: 6, fontSize: 15, fontWeight: 600, color: t.inkSoft, fontFamily: FONT }}>
      {label}
      {children}
      {hint && <span style={{ fontSize: 13, fontWeight: 400 }}>{hint}</span>}
    </label>
  );
}

// On/off setting as one big row (the whole row is the target, not a small
// knob): label and what it means on the left, the switch and its state
// written on the right — state never shown by colour alone.
export function SwitchRow({ t, label, description, checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)} className="mdp-btn" style={{
        display: "flex", alignItems: "center", gap: 14, width: "100%", minHeight: 64, padding: "10px 14px",
        borderRadius: 12, border: `1.5px solid ${checked ? t.primary : t.line}`, background: t.card, color: t.ink,
        textAlign: "left", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: FONT,
      }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 17, fontWeight: 600 }}>{label}</span>
        {description && <span style={{ display: "block", fontSize: 14, color: t.inkSoft, marginTop: 2, lineHeight: 1.35 }}>{description}</span>}
      </span>
      <span style={{ fontSize: 14, fontWeight: 700, color: checked ? STATUS.ok : t.inkSoft, minWidth: 24 }}>{checked ? "Sì" : "No"}</span>
      <span aria-hidden="true" style={{
        position: "relative", width: 56, height: 32, borderRadius: 16, flexShrink: 0,
        background: checked ? STATUS.ok : t.line, transition: "background .15s",
      }}>
        <span style={{
          position: "absolute", top: 3, left: checked ? 27 : 3, width: 26, height: 26, borderRadius: 13,
          background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)", transition: "left .15s",
        }} />
      </span>
    </button>
  );
}

// Exclusive choice among a few options, all visible at once.
export function Segmented({ t, label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" aria-pressed={active} onClick={() => onChange(o.value)} className="mdp-btn" style={{
            minHeight: TOUCH, padding: "0 16px", borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
            border: `1.5px solid ${active ? t.primary : t.line}`, background: active ? t.primary : t.card, color: active ? t.bg : t.ink,
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

// A price entered from the on-screen keypad, in cents like a cash register
// ("6", "5", "0" → 6,50): no keyboard needed, no decimal separator to find.
// Opens showing the current amount; the first digit typed starts a new one
// (like a calculator), instead of being appended to it.
export function PriceKeypad({ t, label = "Nuovo prezzo", initialCents = 0, onUse, onCancel }) {
  const [digits, setDigits] = React.useState(initialCents ? String(initialCents) : "");
  const [fresh, setFresh] = React.useState(Boolean(initialCents));
  const cents = parseInt(digits || "0", 10);
  const press = (k) => {
    setFresh(false);
    if (k === "C") setDigits("");
    else if (k === "⌫") setDigits((d) => d.slice(0, -1));
    else setDigits((d) => {
      const base = fresh ? "" : d;
      return base.length >= 6 ? base : `${base}${k}`.replace(/^0+/, "");
    });
  };
  const euro = `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
  return (
    <div style={{ padding: 12, borderRadius: 14, border: `1.5px solid ${t.line}`, background: t.bg }}>
      <div aria-label={label} role="textbox" aria-readonly="true" style={{
        minHeight: 56, borderRadius: 12, border: `2px solid ${t.primary}`, background: t.card, marginBottom: 10,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 700, fontFamily: FONT, color: t.ink,
      }}>€ {euro}</div>
      <Keypad t={t} onKey={press} keyHeight={52} />
      <div style={{ display: "grid", gridTemplateColumns: onCancel ? "1fr 2fr" : "1fr", gap: 10, marginTop: 10 }}>
        {onCancel && <TillButton t={t} onClick={onCancel}>Annulla</TillButton>}
        <TillButton t={t} variant="primary" onClick={() => onUse(cents)}>Usa € {euro}</TillButton>
      </div>
    </div>
  );
}

// A one-line outcome under a group of actions ("Salvato", an error…).
export function Notice({ notice }) {
  if (!notice) return null;
  const color = notice.tone === "error" ? STATUS.danger : notice.tone === "ok" ? STATUS.ok : "#5c554b";
  return (
    <div role={notice.tone === "error" ? "alert" : "status"} style={{ fontSize: 15, fontWeight: 600, color, lineHeight: 1.35, fontFamily: FONT }}>
      {notice.text}
    </div>
  );
}
