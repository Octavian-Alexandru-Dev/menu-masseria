// Pieces of a table's order screen shared by the till (TillSala.jsx) and the
// phone (Waiter.jsx): the line editor, the covers control, the dish tile,
// the ticket line and the receipt page (also used by Storico). Same controls and labels on both, so a waiter who has
// used one can use the other; the phone just shows the editor as a
// full-screen page (`sheet`) instead of in the till's side panel.
import React, { useState } from "react";
import { Users, Gift, Percent, RotateCcw, Trash2, Check, Keyboard, Printer } from "lucide-react";
import { formatCentsAsPrice, parsePriceToCents, BackButton, tableIdentity } from "./shared";
import { updateCovers, orderTotalCents, copertoTotalCents, markReceiptPrinted, confirmFinalReceipt } from "./orders";
import { formatTime } from "./sala-shared";
import { usePrintJob } from "./usePrintJob";
import { confirmAction } from "./confirmDialog";
import { getDesktopBridge } from "./desktop";
import { optimizedImageUrl } from "./cloudinary";
import { TOUCH, FONT, STATUS, TillButton, Stepper, Keypad, SidePanel, SectionTitle, StatusPill, PrintStatusLine, DishThumb } from "./TillUi";

const DISCOUNTS = [10, 20, 50];

// Editor of one ticket line. Works on a local copy: nothing changes until
// "Salva" (a stray tap costs nothing). Price options follow what POS systems
// offer: back to the menu price, offered (0 €), quick percentage discounts,
// or any price from the keypad.
export function LineEditor({ t, line, sent, locked, onSave, onRemove, onClose, sheet = false, backLabel = "Comanda" }) {
  const menuPrice = line.originalPrice || line.price;
  const [quantity, setQuantity] = useState(line.quantity);
  const [price, setPrice] = useState(line.price);
  const [priceNote, setPriceNote] = useState(line.priceNote || null);
  const [notes, setNotes] = useState(line.notes || "");
  const [customDigits, setCustomDigits] = useState(null); // null = keypad closed
  const [saving, setSaving] = useState(false);

  const menuCents = parsePriceToCents(menuPrice);
  const unitCents = parsePriceToCents(price);
  const setPriceCents = (cents, note) => {
    setPrice(formatCentsAsPrice(cents));
    setPriceNote(note);
  };
  const pressCustom = (k) => {
    if (k === "C") setCustomDigits("");
    else if (k === "⌫") setCustomDigits((d) => (d || "").slice(0, -1));
    else setCustomDigits((d) => ((d || "").length >= 6 ? d : `${d || ""}${k}`.replace(/^0+/, "")));
  };
  const customCents = parseInt(customDigits || "0", 10);

  const save = async () => {
    setSaving(true);
    const changedPrice = price !== menuPrice;
    const ok = await onSave({
      quantity, price, notes: notes.trim(),
      priceNote: changedPrice ? priceNote : null,
      originalPrice: changedPrice ? menuPrice : null,
    });
    setSaving(false);
    if (ok !== false) onClose();
  };

  const option = (active) => ({
    minHeight: TOUCH, borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: locked ? "default" : "pointer", fontFamily: FONT,
    border: `1.5px solid ${active ? t.primary : t.line}`, background: active ? t.primary : t.card, color: active ? t.bg : t.ink,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: locked ? 0.5 : 1,
  });

  return (
    <SidePanel
      t={t}
      sheet={sheet}
      label="Modifica riga"
      header={(
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BackButton t={t} onClick={onClose} label={backLabel} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.2 }}>{line.name}</div>
            <div style={{ fontSize: 14, color: t.inkSoft }}>{line.categoryName}{sent ? ` · inviato ${formatTime(line.sentAt) || ""}` : " · da inviare"}</div>
          </div>
        </div>
      )}
      footer={locked ? (
        <div style={{ fontSize: 15, color: t.inkSoft, textAlign: "center" }}>Preconto confermato: le righe non si possono più modificare.</div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Totale riga</span>
            <span data-testid="till-line-total" style={{ fontSize: 26, fontWeight: 800 }}>€ {formatCentsAsPrice(unitCents * quantity)}</span>
          </div>
          <TillButton t={t} variant="primary" size={60} icon={Check} disabled={saving} onClick={save}>{saving ? "Salvataggio…" : "Salva"}</TillButton>
        </>
      )}
    >
      <div style={{ display: "grid", gap: 18, paddingTop: 6 }}>
        <div style={{ pointerEvents: locked ? "none" : "auto", opacity: locked ? 0.5 : 1 }}>
          <Stepper t={t} label="Quantità" value={quantity} min={1} onChange={setQuantity} />
        </div>

        <label style={{ fontSize: 15, fontWeight: 600, color: t.inkSoft }}>
          Nota per la cucina
          <input disabled={locked} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="es. senza glutine" aria-label={`Nota di ${line.name}`}
            style={{ width: "100%", minHeight: 52, marginTop: 6, padding: "0 14px", borderRadius: 12, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink, fontSize: 17, fontFamily: FONT, boxSizing: "border-box" }} />
        </label>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <SectionTitle t={t}>Prezzo unitario</SectionTitle>
            <span style={{ fontSize: 20, fontWeight: 700 }}>
              € {price}
              {price !== menuPrice && <span style={{ fontSize: 14, color: t.inkSoft, fontWeight: 500, textDecoration: "line-through", marginLeft: 8 }}>€ {menuPrice}</span>}
            </span>
          </div>
          {priceNote && price !== menuPrice && <StatusPill color={STATUS.info} style={{ marginBottom: 8 }}>{priceNote}</StatusPill>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            <button type="button" disabled={locked} aria-pressed={price === menuPrice} onClick={() => setPriceCents(menuCents, null)} className="mdp-btn" style={option(price === menuPrice)}>
              <RotateCcw size={16} /> Pieno
            </button>
            <button type="button" disabled={locked} aria-pressed={unitCents === 0} onClick={() => setPriceCents(0, "Offerto")} className="mdp-btn" style={option(unitCents === 0)}>
              <Gift size={16} /> Offerto
            </button>
            {DISCOUNTS.map((p) => {
              const cents = Math.round((menuCents * (100 - p)) / 100);
              const active = priceNote === `Sconto ${p}%`;
              return (
                <button key={p} type="button" disabled={locked} aria-pressed={active} aria-label={`Sconto ${p}%`} onClick={() => setPriceCents(cents, `Sconto ${p}%`)} className="mdp-btn" style={option(active)}>
                  <Percent size={15} /> −{p}%
                </button>
              );
            })}
            <button type="button" disabled={locked} aria-pressed={customDigits != null} onClick={() => setCustomDigits((d) => (d == null ? "" : null))} className="mdp-btn" style={option(customDigits != null)}>
              <Keyboard size={16} /> Altro
            </button>
          </div>
          {customDigits != null && !locked && (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: `1.5px solid ${t.line}`, background: t.bg }}>
              <div aria-label="Nuovo prezzo" role="textbox" aria-readonly="true" style={{
                minHeight: 56, borderRadius: 12, border: `2px solid ${t.primary}`, background: t.card, marginBottom: 10,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 700,
              }}>€ {formatCentsAsPrice(customCents)}</div>
              <Keypad t={t} onKey={pressCustom} keyHeight={52} />
              <TillButton t={t} variant="primary" style={{ width: "100%", marginTop: 10 }}
                onClick={() => { setPriceCents(customCents, customCents === 0 ? "Offerto" : "Prezzo modificato"); setCustomDigits(null); }}>
                Usa € {formatCentsAsPrice(customCents)}
              </TillButton>
            </div>
          )}
        </div>

        {!locked && (
          <TillButton t={t} variant="danger" icon={Trash2} onClick={onRemove}>Rimuovi dalla comanda</TillButton>
        )}
      </div>
    </SidePanel>
  );
}

// Adults/children of an open table, saved at once (covers count on the bill).
// compact: the phone's two-column layout (label above its − n + group).
export function CoversControl({ t, order, compact = false }) {
  const [busy, setBusy] = useState(false);
  const change = async (field, delta) => {
    const next = {
      adults: order.covers?.adults || 0,
      children: order.covers?.children || 0,
      [field]: Math.max(0, (order.covers?.[field] || 0) + delta),
    };
    setBusy(true);
    try {
      await updateCovers(order.id, next);
    } catch (err) {
      console.error("[sala] Modifica coperti fallita:", err);
    } finally {
      setBusy(false);
    }
  };
  const btn = {
    width: TOUCH, height: TOUCH, borderRadius: 10, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink,
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 22, fontFamily: FONT,
  };
  const group = (field, label) => (
    <span style={compact
      ? { display: "grid", gridTemplateColumns: `${TOUCH}px 1fr ${TOUCH}px`, gridTemplateRows: "auto auto", alignItems: "center", rowGap: 4 }
      : { display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 15, color: t.inkSoft, ...(compact ? { gridColumn: "1 / -1", fontWeight: 600 } : null) }}>{label}</span>
      <button type="button" aria-label={`Diminuisci ${label.toLowerCase()}`} disabled={busy} onClick={() => change(field, -1)} className="mdp-btn" style={btn}>−</button>
      <span style={{ minWidth: 24, textAlign: "center", fontSize: 20, fontWeight: 700 }}>{order.covers?.[field] || 0}</span>
      <button type="button" aria-label={`Aumenta ${label.toLowerCase()}`} disabled={busy} onClick={() => change(field, 1)} className="mdp-btn" style={btn}>+</button>
    </span>
  );
  if (compact) {
    return (
      <div role="group" aria-label="Coperti" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontFamily: FONT }}>
        {group("adults", "Adulti")}
        {group("children", "Bambini")}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <Users size={18} color={t.inkSoft} />
      {group("adults", "Adulti")}
      {group("children", "Bambini")}
    </div>
  );
}

// A dish to add: one tap = one more in the draft, the count on the tile.
// With its photo (the one on the customers' menu) on the left, when it has one.
export function DishTile({ t, item, quantityInDraft, offMenu, onAdd, compact = false }) {
  const thumb = compact ? 48 : 56;
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={`Aggiungi ${item.name}, € ${item.price}`}
      className="mdp-btn"
      style={{
        position: "relative", display: "flex", alignItems: "flex-start", gap: compact ? 10 : 12, textAlign: "left",
        minHeight: compact ? 84 : 104, padding: compact ? "10px 12px" : "12px 14px", borderRadius: 14, cursor: "pointer", fontFamily: FONT, color: t.ink,
        border: offMenu ? `2px dashed ${STATUS.waiting}` : `${quantityInDraft ? 2 : 1.5}px solid ${quantityInDraft ? t.primary : t.line}`,
        background: quantityInDraft ? `${t.primary}14` : t.card, WebkitTapHighlightColor: "transparent",
      }}
    >
      <DishThumb t={t} src={item.image ? optimizedImageUrl(item.image, { width: thumb * 2 }) : ""} size={thumb} />
      <span style={{ flex: 1, minWidth: 0, alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <span style={{ fontSize: compact ? 16 : 17, fontWeight: 600, lineHeight: 1.25, paddingRight: quantityInDraft ? 30 : 0, overflowWrap: "anywhere" }}>{item.name}</span>
        <span style={{ fontSize: compact ? 15 : 16, color: t.inkSoft, marginTop: 6 }}>€ {item.price}</span>
      </span>
      {quantityInDraft > 0 && (
        <span aria-hidden="true" style={{
          position: "absolute", top: 8, right: 8, minWidth: 30, height: 30, borderRadius: 15, padding: "0 8px",
          background: t.primary, color: t.bg, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
        }}>{quantityInDraft}</span>
      )}
    </button>
  );
}

// One tappable line of the ticket (sent or to send): tap → its editor.
export function TicketLine({ t, line, sent, onSelect }) {
  const total = parsePriceToCents(line.price) * line.quantity;
  return (
    <button type="button" onClick={onSelect} className="mdp-btn"
      aria-label={`Modifica ${line.name}: ${line.quantity} × € ${line.price}${line.priceNote ? `, ${line.priceNote}` : ""}`}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 56, padding: "8px 4px", textAlign: "left",
        border: "none", borderBottom: `1px solid ${t.line}`, background: "none", color: t.ink, cursor: "pointer", fontFamily: FONT,
      }}>
      <span style={{ minWidth: 34, fontSize: 18, fontWeight: 800 }}>{line.quantity}×</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 17, fontWeight: 600 }}>{line.name}</span>
        <span style={{ fontSize: 13, color: t.inkSoft }}>
          {line.priceNote && <span style={{ color: STATUS.info, fontWeight: 700 }}>{line.priceNote} · </span>}
          {line.notes ? `${line.notes} · ` : ""}{sent ? `inviato ${formatTime(line.sentAt) || ""}` : line.categoryName}
        </span>
      </span>
      <span style={{ fontSize: 17, fontWeight: 700, whiteSpace: "nowrap" }}>€ {formatCentsAsPrice(total)}</span>
    </button>
  );
}

// The receipt ("preconto", not a fiscal receipt) of a table, as a page:
// the open table's from the phone's order screen (Waiter.jsx), a closed
// one's from Storico (TillHistory.jsx, till and phone). "Stampa" sends it
// to the till's printer through the print queue (printJobs.js) and follows
// the job live; outside the till the browser's print stays available.
//  - closed: a closed order — reprint only (and, for admins, delete);
//  - otherwise "Conferma preconto" freezes the bill: lines already sent
//    can't be edited any more (OrderUi LineEditor `locked`).
export function ReceiptPanel({ t, menu, order, sheet = false, closed = false, label = "Preconto", backLabel = "Indietro", onClose, onDelete }) {
  const printer = usePrintJob();
  const [busy, setBusy] = useState(false);
  const id = tableIdentity(order);
  const items = order.items || [];
  const coperto = copertoTotalCents(order);
  const confirmed = Boolean(order.receipt?.confirmedAt);
  const atTill = Boolean(getDesktopBridge());
  const when = closed && order.closedAt?.toDate ? order.closedAt.toDate() : new Date();

  const print = () => {
    printer.print(order, menu);
    if (!closed) markReceiptPrinted(order.id).catch((err) => console.error("[preconto] Registrazione stampa fallita:", err));
  };
  const confirmReceipt = async () => {
    const ok = await confirmAction({
      title: "Confermare il preconto?",
      message: "Il conto viene fissato: le righe già inviate non si possono più modificare.",
      confirmLabel: "Conferma preconto",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await confirmFinalReceipt(order.id, order);
    } catch (err) {
      console.error("[preconto] Conferma fallita:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      t={t}
      sheet={sheet}
      label={label}
      header={(
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {onClose && <BackButton t={t} onClick={onClose} label={backLabel} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.2 }}>{id.primary}{id.secondary && <span style={{ fontSize: 15, fontWeight: 500, color: t.inkSoft }}> · {id.secondary}</span>}</div>
            <div style={{ fontSize: 14, color: t.inkSoft }}>
              {closed
                ? `${formatTime(order.openedAt) || "—"}–${formatTime(order.closedAt) || "—"} · ${order.waiterName || "—"}${order.status === "auto_closed" ? " · chiusura automatica" : ""}`
                : "Preconto"}
            </div>
          </div>
        </div>
      )}
      footer={(
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>Totale</span>
            <span data-testid="receipt-total" style={{ fontSize: 28, fontWeight: 800 }}>€ {formatCentsAsPrice(orderTotalCents(order))}</span>
          </div>
          <TillButton t={t} variant="primary" size={60} icon={printer.failed ? RotateCcw : Printer} disabled={printer.busy} onClick={print}>
            {printer.failed ? "Riprova stampa" : closed ? "Ristampa preconto" : "Stampa"}
          </TillButton>
          <PrintStatusLine status={printer.status} />
          {!atTill && (
            <TillButton t={t} variant="ghost" size={TOUCH} onClick={() => window.print()}>Stampa dal browser</TillButton>
          )}
          {!closed && !confirmed && (
            <TillButton t={t} icon={Check} disabled={busy || items.length === 0} onClick={confirmReceipt}>
              {busy ? "Conferma…" : "Conferma preconto"}
            </TillButton>
          )}
          {closed && onDelete && <TillButton t={t} variant="danger" icon={Trash2} onClick={onDelete}>Elimina dallo storico</TillButton>}
        </>
      )}
    >
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .mdp-receipt-print, .mdp-receipt-print * { visibility: visible !important; }
          .mdp-receipt-print { position: absolute !important; left: 0; top: 0; width: 100%; }
        }
      `}</style>
      <div className="mdp-receipt-print" style={{ padding: "8px 0", fontFamily: FONT }}>
        <div style={{ textAlign: "center", paddingBottom: 12, marginBottom: 8, borderBottom: `1.5px dashed ${t.line}` }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{menu?.restaurantName}</div>
          <div style={{ fontSize: 14, color: t.inkSoft }}>{id.primary}{id.secondary ? ` · ${id.secondary}` : ""}</div>
          <div style={{ fontSize: 14, color: t.inkSoft }}>{when.toLocaleDateString("it-IT")} {when.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: STATUS.waiting, marginTop: 4 }}>Documento non fiscale</div>
          {confirmed && <StatusPill color={STATUS.info} style={{ marginTop: 8 }}>Preconto confermato</StatusPill>}
        </div>
        {items.length === 0 && <div style={{ color: t.inkSoft, fontSize: 16, padding: "12px 0", textAlign: "center" }}>Nessun piatto ordinato.</div>}
        {items.map((l) => (
          <div key={l.lineId} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 0", borderBottom: `1px solid ${t.line}`, fontSize: 16 }}>
            <span>
              <strong>{l.quantity}×</strong> {l.name}
              {l.priceNote && <span style={{ color: STATUS.info, fontWeight: 600 }}> · {l.priceNote}</span>}
              {l.notes && <span style={{ color: t.inkSoft }}> ({l.notes})</span>}
            </span>
            <span style={{ whiteSpace: "nowrap", fontWeight: 600 }}>€ {formatCentsAsPrice(parsePriceToCents(l.price) * l.quantity)}</span>
          </div>
        ))}
        {coperto > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 16, color: t.inkSoft }}>
            <span>Coperto ({order.covers?.adults || 0} adulti, {order.covers?.children || 0} bambini)</span>
            <span>€ {formatCentsAsPrice(coperto)}</span>
          </div>
        )}
      </div>
    </SidePanel>
  );
}
