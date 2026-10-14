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
import { createPortal } from "react-dom";
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

// Phones (and narrow browser windows) get the same screens as the till,
// laid out for one hand: the side panel becomes a full-screen page (see
// SidePanel's `sheet`), grids drop to two columns. Shared by the phone shell
// (PhoneApp.jsx) and the screens it reuses from the till (TillMenu.jsx).
export const COMPACT_QUERY = "(max-width: 760px)";

export function useCompactLayout() {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(COMPACT_QUERY).matches;
  const [compact, setCompact] = React.useState(get);
  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return compact;
}

// The right-hand panel: header, scrolling body, footer fixed at the bottom
// (primary actions always in the same place).
// sheet: on a phone the same panel opens as a full-screen page above
// everything (like a native app's pushed screen): header at the top, the
// footer with the primary action at the bottom, in reach of the thumb.
let openSheets = 0;

export function SidePanel({ t, label, header, footer, children, sheet = false }) {
  // While a sheet is open the app underneath neither scrolls nor can be
  // reached (screen readers, keyboard): the sheet is mounted on <body>, the
  // app's root is made inert. A counter, so sheets opened one over the other
  // restore it only when the last one closes.
  React.useEffect(() => {
    if (!sheet) return undefined;
    const root = document.getElementById("root");
    openSheets += 1;
    document.body.style.overflow = "hidden";
    if (root) root.inert = true;
    return () => {
      openSheets -= 1;
      if (openSheets === 0) {
        document.body.style.overflow = "";
        if (root) root.inert = false;
      }
    };
  }, [sheet]);
  const sheetStyle = sheet ? {
    position: "fixed", inset: 0, zIndex: 150, borderLeft: "none", background: t.bg,
    animation: "mdpSheetIn .18s ease-out",
  } : null;
  const panel = (
    <section aria-label={label} role={sheet ? "dialog" : undefined} aria-modal={sheet ? "true" : undefined} style={{ display: "flex", flexDirection: "column", minHeight: 0, borderLeft: `1px solid ${t.line}`, background: t.card, fontFamily: FONT, color: t.ink, ...sheetStyle }}>
      {sheet && <style>{"@keyframes mdpSheetIn { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } } @media (prefers-reduced-motion: reduce) { [role=dialog] { animation: none !important; } }"}</style>}
      {header && (
        <div style={sheet
          ? { padding: "calc(8px + env(safe-area-inset-top)) 16px 8px", background: t.card, borderBottom: `1px solid ${t.line}` }
          : { padding: "16px 18px 10px" }}>{header}</div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: sheet ? "12px 16px 16px" : "0 18px 12px" }}>{children}</div>
      {footer && (
        <div style={{
          padding: sheet ? "12px 16px calc(12px + env(safe-area-inset-bottom))" : "14px 18px 18px",
          borderTop: `1px solid ${t.line}`, display: "grid", gap: 10, background: t.card,
          boxShadow: sheet ? "0 -6px 18px rgba(0,0,0,0.06)" : undefined,
        }}>{footer}</div>
      )}
    </section>
  );
  return sheet ? createPortal(panel, document.body) : panel;
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

// Every category at a glance, as a grid of big buttons that wraps onto as
// many rows as needed — never a strip that scrolls sideways (what's off
// screen gets missed: Baymard measured 27% of users overlooking content
// behind horizontal tabs). Each button: the name (wraps, never cut off) and
// a short detail line in words, e.g. "6 piatti · 2 da inviare", so the state
// doesn't rely on the colour. `minWidth` decides how many columns fit.
// categories: [{ id, name, detail?, icon?, accent?, highlight? }]
export function CategoryGrid({ t, label, categories, activeId, onSelect, minWidth = 110, buttonRef }) {
  return (
    <div role="tablist" aria-label={label} style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(min(${minWidth}px, 100%), 1fr))`, gap: 8 }}>
      {categories.map((c) => {
        const active = c.id === activeId;
        const accent = c.accent || t.ink;
        return (
          <button key={c.id} ref={buttonRef ? (el) => buttonRef(c.id, el) : undefined} type="button" role="tab" aria-selected={active}
            onClick={() => onSelect(c.id)} className="mdp-btn" style={{
              display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, minWidth: 0, minHeight: 56, padding: "8px 12px",
              borderRadius: 12, textAlign: "left", cursor: "pointer", fontFamily: FONT,
              border: `1.5px ${c.accent && !active ? "dashed" : "solid"} ${active ? t.primary : c.accent || t.line}`,
              background: active ? t.primary : c.highlight ? `${t.primary}14` : t.card, color: active ? t.bg : accent,
            }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 16, fontWeight: 700, lineHeight: 1.2, overflowWrap: "anywhere" }}>
              {c.icon}{c.name}
            </span>
            {c.detail && <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.25, color: active ? t.bg : t.inkSoft, opacity: active ? 0.85 : 1 }}>{c.detail}</span>}
          </button>
        );
      })}
    </div>
  );
}

// A dish's photo in small (the same one the customers see on the menu), to
// recognise it at a glance. Nothing when the dish has no photo. The URL is
// already sized by the caller (optimizedImageUrl in cloudinary.js).
export function DishThumb({ t, src, size = 52 }) {
  const [failed, setFailed] = React.useState(false);
  if (!src || failed) return null;
  return (
    <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} style={{
      width: size, height: size, flexShrink: 0, borderRadius: 10, objectFit: "cover", background: t.bgAlt || t.line, display: "block",
    }} />
  );
}

// A list row that slides to the left under the finger, as in phone apps'
// lists (Mail, Gmail…), revealing one action behind it on the right (e.g.
// "Elimina"): a short swipe leaves the action showing (tap it), a long one
// runs it straight away. The action must also exist somewhere visible (the
// item's detail page): a swipe can't be seen and isn't reachable without a
// finger or a mouse. The action itself asks for confirmation (confirmAction)
// when it can't be undone. Vertical scrolling stays the browser's
// (touch-action: pan-y); a swipe never counts as a tap on the row.
const SWIPE_ACTION_WIDTH = 104;

export function SwipeAction({ actionLabel, actionText, icon: Icon, color = STATUS.danger, onAction, radius = 14, children }) {
  const [offset, setOffsetState] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  // The latest offset for the pointer handlers (events can come faster than renders).
  const offsetRef = React.useRef(0);
  const setOffset = (value) => { offsetRef.current = value; setOffsetState(value); };
  const rowRef = React.useRef(null);
  const gesture = React.useRef(null); // { x, y, base, id, swiping }
  const swiped = React.useRef(false);
  const open = offset !== 0 && !dragging;

  const run = () => { setOffset(0); onAction(); };
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    gesture.current = { x: e.clientX, y: e.clientY, base: offsetRef.current, id: e.pointerId, swiping: false };
    swiped.current = false;
  };
  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.swiping) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) > Math.abs(dx)) { gesture.current = null; return; } // a vertical scroll
      g.swiping = true;
      swiped.current = true;
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    const width = rowRef.current?.offsetWidth || 400;
    setOffset(Math.min(0, Math.max(-width, g.base + dx)));
  };
  const onPointerEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.swiping) return;
    setDragging(false);
    const width = rowRef.current?.offsetWidth || 400;
    const end = offsetRef.current;
    if (end < -width * 0.55) run();
    else setOffset(end < -SWIPE_ACTION_WIDTH / 2 ? -SWIPE_ACTION_WIDTH : 0);
  };
  // The click that ends a swipe (or a tap on a row left open) only closes it.
  const onClickCapture = (e) => {
    const endsSwipe = swiped.current;
    swiped.current = false;
    if (endsSwipe || (open && !e.target.closest("[data-swipe-action]"))) {
      e.preventDefault();
      e.stopPropagation();
      if (!endsSwipe) setOffset(0);
    }
  };

  return (
    <div ref={rowRef} onClickCapture={onClickCapture} style={{ position: "relative", overflow: "hidden", borderRadius: radius }}>
      <button type="button" data-swipe-action onClick={run} aria-label={actionLabel} aria-hidden={!open} tabIndex={open ? 0 : -1} className="mdp-btn" style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: Math.max(SWIPE_ACTION_WIDTH, -offset), border: "none", background: color, color: "#fff",
        visibility: offset === 0 ? "hidden" : "visible",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
        fontSize: 15, fontWeight: 700, fontFamily: FONT, cursor: "pointer",
      }}>
        {Icon && <Icon size={22} />} {actionText}
      </button>
      <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
        style={{
          position: "relative", touchAction: "pan-y", transform: `translateX(${offset}px)`,
          transition: dragging ? "none" : "transform .18s ease-out", display: "grid", gridTemplateColumns: "minmax(0, 1fr)",
        }}>
        {children}
      </div>
    </div>
  );
}
