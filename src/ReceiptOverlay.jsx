// Preconto — riepilogo stampabile (non fiscale, via
// stampa del browser) sovrapposto al resto della schermata. Componente
// condiviso: usato dal dettaglio di un tavolo ancora aperto (Waiter.jsx,
// modificabile) e dalle righe di comande già chiuse — sezione "Chiusi nel
// turno" e Storico (OrderHistory.jsx, sola lettura: una comanda chiusa non
// si modifica più, si può solo ristampare).
import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Printer, Pencil, Check } from "lucide-react";
import { ital, TYPE, formatCentsAsPrice, parsePriceToCents, tableIdentity } from "./shared";
import { itemsTotalCents, copertoTotalCents, markReceiptPrinted, removeOrderLine, confirmFinalReceipt } from "./orders";

export default function ReceiptOverlay({ t, menu, order, onClose, readOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState(null);

  useEffect(() => {
    markReceiptPrinted(order.id).catch((err) => console.error("[receipt] Registrazione stampa fallita:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doPrint = () => window.print();

  const doRemove = async (lineId) => {
    setRemovingId(lineId);
    try {
      await removeOrderLine(order.id, order.items || [], lineId);
    } catch (err) {
      console.error("[receipt] Rimozione riga fallita:", err);
    } finally {
      setRemovingId(null);
    }
  };

  const doConfirm = async () => {
    setBusy(true);
    try {
      await confirmFinalReceipt(order.id, order);
      setEditing(false);
    } catch (err) {
      console.error("[receipt] Conferma preconto fallita:", err);
    } finally {
      setBusy(false);
    }
  };

  const items = order.items || [];
  const itemsTotal = itemsTotalCents(order);
  const coperto = copertoTotalCents(order);
  const grandTotal = itemsTotal + coperto;
  const confirmed = Boolean(order.receipt?.confirmedAt);
  const locked = readOnly || confirmed;

  return createPortal(
    <div className="mdp-receipt-overlay" style={{ position: "fixed", inset: 0, background: "rgba(20,15,10,0.6)", zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px 16px", overflowY: "auto" }}>
      <style>{`
        @media print {
          body > *:not(.mdp-receipt-overlay) { display: none !important; }
          .mdp-receipt-overlay { position: static !important; height: auto !important; padding: 0 !important; background: none !important; overflow: visible !important; }
          .mdp-receipt-print { position: static !important; box-shadow: none !important; height: auto !important; max-height: none !important; overflow: visible !important; }
          .mdp-receipt-noprint { display: none !important; }
        }
      `}</style>
      <div className="mdp-receipt-print" style={{ background: t.card, borderRadius: 12, padding: 24, maxWidth: 380, width: "100%", fontFamily: "'Work Sans', sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 14 }}>
          <button aria-label="Chiudi preconto" onClick={onClose} className="mdp-btn mdp-receipt-noprint" style={{ background: "none", border: "none", cursor: "pointer", color: t.inkSoft }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ textAlign: "center", marginBottom: 14, paddingBottom: 14, borderBottom: `1px dashed ${t.line}` }}>
          <div style={{ fontWeight: 600, fontSize: TYPE.bodyPlus, color: t.ink }}>{menu?.restaurantName}</div>
          <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft, marginTop: 2 }}>
            {tableIdentity(order).primary}{tableIdentity(order).secondary ? ` · ${tableIdentity(order).secondary}` : ""}
          </div>
          <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft }}>
            {new Date().toLocaleDateString("it-IT")} {new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div style={{ fontSize: TYPE.tinyPlus, color: "#a06a1a", fontStyle: "italic", marginTop: 4 }}>Documento non fiscale</div>
        </div>

        <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
          {items.length === 0 && <div style={{ fontSize: TYPE.smallPlus, color: t.inkSoft, textAlign: "center" }}>Nessun piatto ordinato.</div>}
          {items.map((l) => (
            <div key={l.lineId} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: TYPE.smallPlus, color: t.ink }}>
              <span style={{ flex: 1 }}>
                {l.quantity}× {l.name}{l.notes ? ` (${l.notes})` : ""}
              </span>
              <span style={{ whiteSpace: "nowrap" }}>€ {formatCentsAsPrice(parsePriceToCents(l.price) * l.quantity)}</span>
              {editing && !locked && (
                <button
                  onClick={() => doRemove(l.lineId)}
                  disabled={removingId === l.lineId}
                  className="mdp-btn mdp-receipt-noprint"
                  style={{ background: "none", border: "none", cursor: "pointer", color: t.accent2, padding: 0 }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
          {coperto > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: TYPE.smallPlus, color: t.inkSoft, paddingTop: 6, borderTop: `1px dashed ${t.line}` }}>
              <span>Coperto ({(order.covers?.adults || 0)} adulti, {(order.covers?.children || 0)} bambini)</span>
              <span>€ {formatCentsAsPrice(coperto)}</span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: TYPE.bodyPlus, fontWeight: 600, color: t.primary, paddingTop: 10, borderTop: `1px solid ${t.line}`, marginBottom: 16 }}>
          <span>Totale</span>
          <span>€ {formatCentsAsPrice(grandTotal)}</span>
        </div>

        {order.receipt?.confirmedAt && (
          <div style={{ fontSize: TYPE.tinyPlus, color: t.secondary, textAlign: "center", marginBottom: 12 }}>
            Preconto confermato
          </div>
        )}

        <div className="mdp-receipt-noprint" style={{ display: "grid", gap: 8 }}>
          <button onClick={doPrint} className="mdp-btn" style={{
            padding: "10px 0", background: "none", border: `1px solid ${t.line}`, borderRadius: 8,
            color: t.ink, fontSize: TYPE.smallPlus, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            <Printer size={13} /> Stampa
          </button>
          {!locked && (!editing ? (
            <button onClick={() => setEditing(true)} className="mdp-btn" style={{
              padding: "10px 0", background: "none", border: `1px solid ${t.line}`, borderRadius: 8,
              color: t.ink, fontSize: TYPE.smallPlus, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
              <Pencil size={13} /> Modifica
            </button>
          ) : (
            <>
              <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft, textAlign: "center" }}>
                Per aggiungere piatti, chiudi e usa "Aggiungi piatti".
              </div>
              <button onClick={() => setEditing(false)} className="mdp-btn" style={{
                padding: "10px 0", background: "none", border: `1px solid ${t.line}`, borderRadius: 8,
                color: t.ink, fontSize: TYPE.smallPlus, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                <Check size={13} /> Fine modifica
              </button>
            </>
          ))}
          {!locked && (
            <button onClick={doConfirm} disabled={busy || items.length === 0} className="mdp-btn" style={{
              padding: "11px 0", background: t.primary, color: t.bg, border: "none", borderRadius: 8,
              fontSize: TYPE.bodyPlus, fontWeight: 600, cursor: busy || items.length === 0 ? "default" : "pointer",
              opacity: busy || items.length === 0 ? 0.6 : 1,
            }}>
              {busy ? "Conferma…" : "Conferma preconto"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
