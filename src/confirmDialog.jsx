// Touch-friendly confirmation dialog, callable from anywhere as a promise:
//   if (await confirmAction({ title, message, confirmLabel })) { ... }
// Used where an accidental tap is costly on the till's touch screen
// (logout, closing the client — see staff-shared.jsx, PrintStation.jsx).
// Mounted on demand in its own root, so callers don't need any state or
// markup of their own; window.confirm would show a small native box that's
// awkward on a touch screen (and is disabled in some embedded contexts).
import React from "react";
import { createRoot } from "react-dom/client";

function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger, onDone }) {
  const btn = {
    minHeight: 52, padding: "0 22px", borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: "pointer",
    fontFamily: "inherit",
  };
  return (
    <div
      role="presentation"
      onClick={() => onDone(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 400, background: "rgba(20,15,10,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        fontFamily: "'Work Sans', system-ui, sans-serif",
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", color: "#2b2620", borderRadius: 14, padding: "24px 24px 20px", width: "100%", maxWidth: 400, boxShadow: "0 12px 40px rgba(0,0,0,0.25)" }}
      >
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        {message && <div style={{ fontSize: 15, color: "#5c554b", lineHeight: 1.45, marginBottom: 20 }}>{message}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" autoFocus onClick={() => onDone(false)} style={{ ...btn, background: "#fff", color: "#2b2620", border: "1px solid #cfc6b4" }}>
            {cancelLabel}
          </button>
          <button type="button" onClick={() => onDone(true)} style={{ ...btn, background: danger ? "#b03a2e" : "#2b2620", color: "#fff", border: "none" }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function confirmAction({ title, message = "", confirmLabel = "Conferma", cancelLabel = "Annulla", danger = false }) {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onDone = (result) => {
      root.unmount();
      host.remove();
      resolve(result);
    };
    root.render(
      <ConfirmDialog title={title} message={message} confirmLabel={confirmLabel} cancelLabel={cancelLabel} danger={danger} onDone={onDone} />
    );
  });
}
