// Prenotazioni — the same screen at the till (inside TillSala.jsx) and on
// phones (PhoneApp.jsx). Data and rules in reservationsData.js. At the till:
// a large month calendar on the left (bookings and covers per day at a
// glance), the selected day's reservations in the middle, and the side panel
// on the right for the selected reservation (details + actions) or the
// new/edit form. On a phone the same pieces in one column, the panel as a
// full-screen page. Times are picked from the same slots the public booking
// form offers (landing page) or typed ("Altro orario"), covers and table
// with steppers. `initialReservation`: opens straight on that reservation
// (tapped in Tavoli).
//
// The day's list shows the reservations still to come; the ones already
// started (the guests are at their table, see Tavoli), cancelled or not
// shown up are folded under "Mostra…", never deleted by a waiter (what was
// booked always leaves a trace). An admin can delete any reservation for
// good, to keep the calendar tidy: swipe its row to the left, or "Elimina"
// in its detail (enforced by firestore.rules too).
import React, { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Plus, Check, X, Play, Pencil, Phone, Users, CalendarDays, Trash2 } from "lucide-react";
import {
  subscribeReservationsForRange, subscribeReservationsForDate, dateKey, coversLabel, autoFlagNoShows, isBooked,
  createReservation, updateReservation, cancelReservation, deleteReservation,
  runDailyExpiredReservationsCleanup,
} from "./reservationsData";
import { confirmAction } from "./confirmDialog";
import { BackButton } from "./shared";
import { FONT, STATUS, TOUCH, SIDE_PANEL_WIDTH, TillButton, Stepper, SidePanel, SectionTitle, StatusPill, SwipeAction, useCompactLayout } from "./TillUi";
import { isAdminRole } from "./staffData";

const MONTH_LABEL = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });
const WEEKDAY_LABEL = new Intl.DateTimeFormat("it-IT", { weekday: "short" });
const DAY_LABEL = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" });
const CELL_DATE_LABEL = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" });

// Same slots as the public booking form (landing_page/index.html).
const LUNCH_SLOTS = ["12:30", "12:45", "13:00", "13:15", "13:30", "13:45", "14:00", "14:15", "14:30"];
const DINNER_SLOTS = ["20:00", "20:15", "20:30", "20:45", "21:00", "21:15", "21:30", "21:45", "22:00", "22:15", "22:30"];

const BOOKED = { label: "Prenotata", color: STATUS.ok };
const STATUS_INFO = {
  started: { label: "Al tavolo", color: STATUS.info },
  rejected: { label: "Rifiutata", color: STATUS.idle }, // only on old documents
  cancelled: { label: "Annullata", color: STATUS.idle },
  no_show: { label: "Non presentata", color: STATUS.idle },
};
const statusInfo = (r) => (isBooked(r) ? BOOKED : STATUS_INFO[r.status] || BOOKED);
// Still to come, counted for the day: the ones already at their table are
// in Tavoli now.
const isActive = isBooked;

function parseKey(key) {
  return new Date(`${key}T00:00:00`);
}
function shiftDay(key, delta) {
  const d = parseKey(key);
  d.setDate(d.getDate() + delta);
  return dateKey(d);
}
function monthStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/* -------------------------------- calendar -------------------------------- */

function Calendar({ t, month, onMonth, selected, onSelect, counts, compact = false }) {
  const first = monthStart(month);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const todayKey = dateKey();
  const navBtn = {
    width: TOUCH, height: TOUCH, borderRadius: 12, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink,
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
  };
  return (
    <div style={{ fontFamily: FONT, color: t.ink }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button type="button" aria-label="Mese precedente" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="mdp-btn" style={navBtn}><ChevronLeft size={22} /></button>
        <div style={{ fontSize: 20, fontWeight: 700, textTransform: "capitalize" }}>{MONTH_LABEL.format(month)}</div>
        <button type="button" aria-label="Mese successivo" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="mdp-btn" style={navBtn}><ChevronRight size={22} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: compact ? 4 : 6 }}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 13, fontWeight: 600, color: t.inkSoft, textTransform: "uppercase" }}>
            {WEEKDAY_LABEL.format(new Date(2024, 0, 1 + i))}
          </div>
        ))}
        {cells.map((day, idx) => {
          if (day == null) return <div key={`b${idx}`} />;
          const date = new Date(month.getFullYear(), month.getMonth(), day);
          const key = dateKey(date);
          const c = counts[key];
          const isSel = key === selected;
          const isToday = key === todayKey;
          return (
            <button key={key} type="button" onClick={() => onSelect(key)} aria-pressed={isSel} className="mdp-btn"
              aria-label={c?.total ? `${CELL_DATE_LABEL.format(date)}, ${c.total} prenotazioni, ${c.covers} coperti` : CELL_DATE_LABEL.format(date)}
              style={{
                minHeight: compact ? 48 : 58, borderRadius: compact ? 10 : 12, cursor: "pointer", fontFamily: FONT, padding: "4px 2px",
                border: `1.5px solid ${isSel ? t.primary : isToday ? t.ink : t.line}`,
                background: isSel ? t.primary : t.card, color: isSel ? t.bg : t.ink,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
              }}>
              <span style={{ fontSize: compact ? 16 : 18, fontWeight: isToday ? 800 : 600 }}>{day}</span>
              <span style={{ fontSize: compact ? 10 : 11, fontWeight: 700, visibility: c?.total ? "visible" : "hidden", whiteSpace: "nowrap" }}>
                {compact ? `${c?.total || 0}·${c?.covers || 0}p` : `${c?.total || 0} · ${c?.covers || 0}p`}
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 10, fontSize: 13, color: t.inkSoft }}>«3 · 12p» = 3 prenotazioni, 12 coperti</div>
    </div>
  );
}

/* ---------------------------------- form ---------------------------------- */

function SlotGrid({ t, title, slots, value, onPick }) {
  return (
    <div>
      <SectionTitle t={t} style={{ margin: "4px 0 6px" }}>{title}</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))", gap: 8 }}>
        {slots.map((s) => {
          const active = value === s;
          return (
            <button key={s} type="button" aria-pressed={active} onClick={() => onPick(active ? "" : s)} className="mdp-btn" style={{
              minHeight: TOUCH, borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
              border: `1.5px solid ${active ? t.primary : t.line}`, background: active ? t.primary : t.card, color: active ? t.bg : t.ink,
            }}>{s}</button>
          );
        })}
      </div>
    </div>
  );
}

function ReservationForm({ t, initial, defaultDate, busy, onCancel, onSave, sheet = false }) {
  const isEdit = Boolean(initial);
  const [date, setDate] = useState(initial?.date || defaultDate);
  const [time, setTime] = useState(initial?.time || "");
  const [name, setName] = useState(initial?.name || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [adults, setAdults] = useState(initial?.covers?.adults ?? 2);
  const [children, setChildren] = useState(initial?.covers?.children ?? 0);
  const [tableNumber, setTableNumber] = useState(initial?.tableNumber || 0);
  const [notes, setNotes] = useState(initial?.notes || "");
  const valid = name.trim() && date;
  const fields = () => ({
    date, time, name: name.trim(), phone: phone.trim(), notes,
    covers: { adults, children }, tableNumber: tableNumber || null,
  });
  const extraSlot = time && !LUNCH_SLOTS.includes(time) && !DINNER_SLOTS.includes(time) ? [time] : [];
  const input = {
    width: "100%", minHeight: 52, padding: "0 14px", borderRadius: 12, border: `1.5px solid ${t.line}`,
    background: t.bg, color: t.ink, fontSize: 17, fontFamily: FONT, boxSizing: "border-box", marginTop: 6,
  };
  const label = { display: "block", fontSize: 15, fontWeight: 600, color: t.inkSoft };
  const smallNav = {
    width: TOUCH, height: TOUCH, borderRadius: 10, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink,
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
  };

  return (
    <SidePanel
      t={t}
      sheet={sheet}
      label={isEdit ? "Modifica prenotazione" : "Nuova prenotazione"}
      header={(
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BackButton t={t} onClick={onCancel} label="Annulla" />
          <div style={{ fontSize: 22, fontWeight: 700 }}>{isEdit ? "Modifica prenotazione" : "Nuova prenotazione"}</div>
        </div>
      )}
      footer={(
        <TillButton t={t} variant="primary" size={60} icon={Check} disabled={!valid || busy} onClick={() => onSave(fields())}>
          {busy ? "Salvataggio…" : isEdit ? "Salva modifiche" : "Salva prenotazione"}
        </TillButton>
      )}
    >
      <div style={{ display: "grid", gap: 16, paddingTop: 4 }}>
        <div>
          <span style={label}>Data</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <button type="button" aria-label="Giorno precedente" onClick={() => setDate((d) => shiftDay(d, -1))} className="mdp-btn" style={smallNav}><ChevronLeft size={20} /></button>
            <span aria-label="Data della prenotazione" style={{ flex: 1, textAlign: "center", fontSize: 18, fontWeight: 700, textTransform: "capitalize" }}>{DAY_LABEL.format(parseKey(date))}</span>
            <button type="button" aria-label="Giorno successivo" onClick={() => setDate((d) => shiftDay(d, 1))} className="mdp-btn" style={smallNav}><ChevronRight size={20} /></button>
          </div>
          <label style={{ ...label, marginTop: 10, fontWeight: 500, fontSize: 14 }}>
            Oppure scegli la data
            <input type="date" aria-label="Scegli la data" style={input} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
        </div>
        <div>
          <span style={label}>Orario</span>
          <SlotGrid t={t} title="Pranzo" slots={[...LUNCH_SLOTS, ...extraSlot]} value={time} onPick={setTime} />
          <SlotGrid t={t} title="Cena" slots={DINNER_SLOTS} value={time} onPick={setTime} />
          <label style={{ ...label, marginTop: 10, fontWeight: 500, fontSize: 14 }}>
            Altro orario
            <input type="time" aria-label="Altro orario" style={input} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <label style={label}>
          Nome *
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Famiglia Rossi" />
        </label>
        <label style={label}>
          Telefono
          <input style={input} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <Stepper t={t} label="Adulti" value={adults} onChange={setAdults} />
        <Stepper t={t} label="Bambini" value={children} onChange={setChildren} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 600 }}>Tavolo <span style={{ fontWeight: 400, color: t.inkSoft, fontSize: 15 }}>(facoltativo)</span></span>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" aria-label="Diminuisci tavolo" onClick={() => setTableNumber((n) => Math.max(0, n - 1))} className="mdp-btn" style={{ ...smallNav, width: 56, height: 56 }}>−</button>
            <span aria-label="Tavolo" style={{ minWidth: 44, textAlign: "center", fontSize: 24, fontWeight: 700 }}>{tableNumber || "—"}</span>
            <button type="button" aria-label="Aumenta tavolo" onClick={() => setTableNumber((n) => n + 1)} className="mdp-btn" style={{ ...smallNav, width: 56, height: 56 }}>+</button>
          </span>
        </div>
        <label style={label}>
          Note (allergie, richieste…)
          <input style={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
    </SidePanel>
  );
}

/* --------------------------------- detail --------------------------------- */

function ReservationDetail({ t, r, busy, onCancelReservation, onDelete, onEdit, onAvvia, onGoToTable, sheet = false, onClose }) {
  const info = statusInfo(r);
  const isToday = r.date === dateKey();
  const row = (lbl, val) => val ? (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "12px 0", borderBottom: `1px solid ${t.line}`, fontSize: 17 }}>
      <span style={{ color: t.inkSoft }}>{lbl}</span><span style={{ fontWeight: 600, textAlign: "right" }}>{val}</span>
    </div>
  ) : null;
  let footer = null;
  if (isBooked(r)) {
    footer = (
      <>
        {isToday && <TillButton t={t} variant="primary" size={60} icon={Play} disabled={busy} onClick={onAvvia}>Avvia (apri il tavolo)</TillButton>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <TillButton t={t} icon={Pencil} disabled={busy} onClick={onEdit}>Modifica</TillButton>
          <TillButton t={t} variant="danger" icon={X} disabled={busy} onClick={onCancelReservation}>Annulla</TillButton>
        </div>
      </>
    );
  } else {
    footer = (
      <>
        {r.status === "started" && r.orderId && (
          <TillButton t={t} variant="primary" size={60} icon={Play} onClick={() => onGoToTable(r.orderId)}>Vai al tavolo</TillButton>
        )}
        {onDelete && <TillButton t={t} variant="danger" icon={Trash2} disabled={busy} onClick={onDelete}>Elimina prenotazione</TillButton>}
      </>
    );
  }
  return (
    <SidePanel
      t={t}
      sheet={sheet}
      label="Dettaglio prenotazione"
      header={(
        <>
          {sheet && <BackButton t={t} onClick={onClose} label="Prenotazioni" style={{ marginBottom: 10 }} />}
          <StatusPill color={info.color}>{info.label}</StatusPill>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 8 }}>{r.name || "Senza nome"}</div>
          <div style={{ fontSize: 16, color: t.inkSoft, textTransform: "capitalize" }}>{DAY_LABEL.format(parseKey(r.date))}{r.time ? ` · ore ${r.time}` : ""}</div>
        </>
      )}
      footer={footer}
    >
      {row("Coperti", coversLabel(r.covers))}
      {row("Tavolo", r.tableNumber ? `Tavolo ${r.tableNumber}` : "da assegnare")}
      {row("Telefono", r.phone)}
      {row("Note", r.notes)}
      {row("Inserita da", r.createdBy?.name)}
      {isBooked(r) && !isToday && (
        <div style={{ fontSize: 15, color: t.inkSoft, paddingTop: 12 }}>Si potrà avviare (aprire il tavolo) il giorno della prenotazione.</div>
      )}
    </SidePanel>
  );
}

/* --------------------------------- screen --------------------------------- */

export default function TillReservations({ t, session, initialReservation = null, onAvvia, onGoToTable }) {
  const compact = useCompactLayout();
  const startDate = initialReservation?.date || dateKey();
  const [month, setMonth] = useState(() => monthStart(parseKey(startDate)));
  const [selectedDate, setSelectedDate] = useState(startDate);
  const [monthList, setMonthList] = useState([]);
  const [dayList, setDayList] = useState([]);
  const [panel, setPanel] = useState(() => (initialReservation ? { mode: "detail", id: initialReservation.id } : { mode: "none" })); // none | detail {id} | new | edit {r}
  const [busy, setBusy] = useState(false);
  const [showOthers, setShowOthers] = useState(false);

  useEffect(() => { runDailyExpiredReservationsCleanup(); }, []);

  useEffect(() => {
    const start = dateKey(month);
    const end = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    return subscribeReservationsForRange(start, end, (list) => {
      setMonthList(list);
      autoFlagNoShows(list).catch(() => {});
    }, (err) => console.error("[till] Lettura prenotazioni del mese fallita:", err));
  }, [month]);

  useEffect(() => subscribeReservationsForDate(selectedDate, setDayList,
    (err) => console.error("[till] Lettura prenotazioni del giorno fallita:", err)), [selectedDate]);

  const counts = {};
  monthList.forEach((r) => {
    if (!isActive(r)) return;
    if (!counts[r.date]) counts[r.date] = { total: 0, covers: 0 };
    counts[r.date].total += 1;
    counts[r.date].covers += (r.covers?.adults || 0) + (r.covers?.children || 0);
  });

  const byTime = (a, b) => (a.time || "99").localeCompare(b.time || "99");
  const active = dayList.filter(isActive).sort(byTime);
  const others = dayList.filter((r) => !isActive(r)).sort(byTime);
  const dayCovers = active.reduce((s, r) => s + (r.covers?.adults || 0) + (r.covers?.children || 0), 0);
  const selected = panel.mode === "detail" ? dayList.find((r) => r.id === panel.id) : null;
  const by = { uid: session.user.uid, name: session.name };
  const canDelete = isAdminRole(session.role);

  const selectDate = (key) => {
    setSelectedDate(key);
    const m = monthStart(parseKey(key));
    if (m.getTime() !== month.getTime()) setMonth(m);
    if (panel.mode === "detail") setPanel({ mode: "none" });
  };

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (err) { console.error("[till] Operazione sulla prenotazione fallita:", err); } finally { setBusy(false); }
  };

  const save = (fields) => run(async () => {
    if (panel.mode === "edit") {
      await updateReservation(panel.r.id, fields);
      selectDate(fields.date);
      setPanel({ mode: "detail", id: panel.r.id });
    } else {
      const ref = await createReservation({ ...fields, createdByUid: session.user.uid, createdByName: session.name });
      selectDate(fields.date);
      setPanel({ mode: "detail", id: ref.id });
    }
  });

  const cancel = async (r) => {
    if (await confirmAction({ title: `Annullare la prenotazione di ${r.name || "senza nome"}?`, message: "Ad esempio se il cliente ha disdetto.", confirmLabel: "Annulla prenotazione", cancelLabel: "Indietro", danger: true })) {
      run(() => cancelReservation(r.id, by));
    }
  };

  const remove = async (r) => {
    const started = r.status === "started";
    if (await confirmAction({
      title: `Eliminare la prenotazione di ${r.name || "senza nome"}?`,
      message: started
        ? "Sparisce dal calendario. Il tavolo già aperto resta com'è, con la sua comanda."
        : "Sparisce dal calendario e non si può recuperare.",
      confirmLabel: "Elimina", cancelLabel: "Indietro", danger: true,
    })) {
      run(async () => {
        await deleteReservation(r.id);
        if (panel.mode === "detail" && panel.id === r.id) setPanel({ mode: "none" });
      });
    }
  };

  const rowFor = (r) => {
    const info = statusInfo(r);
    const isSel = panel.mode === "detail" && panel.id === r.id;
    const row = (
      <button key={r.id} type="button" onClick={() => setPanel({ mode: "detail", id: r.id })} aria-pressed={isSel} className="mdp-btn"
        aria-label={`${r.name || "Senza nome"}${r.time ? `, ore ${r.time}` : ""}, ${coversLabel(r.covers)}, ${info.label}`}
        style={{
          display: "flex", alignItems: "center", gap: 14, minHeight: 72, padding: "10px 16px", borderRadius: 14, textAlign: "left",
          border: `1.5px solid ${isSel ? t.primary : t.line}`, background: isSel ? `${t.primary}12` : t.card, color: t.ink,
          cursor: "pointer", fontFamily: FONT,
        }}>
        <span style={{ minWidth: 64, fontSize: 22, fontWeight: 800 }}>{r.time || "—"}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 18, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name || "Senza nome"}</span>
          <span style={{ fontSize: 14, color: t.inkSoft, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Users size={14} /> {coversLabel(r.covers)}</span>
            {r.tableNumber && <span>Tavolo {r.tableNumber}</span>}
            {r.phone && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Phone size={13} /> {r.phone}</span>}
          </span>
        </span>
        <StatusPill color={info.color}>{info.label}</StatusPill>
      </button>
    );
    if (!canDelete) return row;
    return (
      <SwipeAction key={r.id} actionLabel={`Elimina la prenotazione di ${r.name || "senza nome"}`} actionText="Elimina" icon={Trash2} onAction={() => remove(r)}>
        {row}
      </SwipeAction>
    );
  };

  let side;
  if (panel.mode === "new" || panel.mode === "edit") {
    side = <ReservationForm key={panel.mode === "edit" ? panel.r.id : `new-${selectedDate}`} t={t} sheet={compact} initial={panel.mode === "edit" ? panel.r : null}
      defaultDate={selectedDate} busy={busy} onCancel={() => setPanel(panel.mode === "edit" ? { mode: "detail", id: panel.r.id } : { mode: "none" })} onSave={save} />;
  } else if (selected) {
    side = <ReservationDetail t={t} r={selected} busy={busy} sheet={compact} onClose={() => setPanel({ mode: "none" })}
      onCancelReservation={() => cancel(selected)}
      onDelete={canDelete ? () => remove(selected) : null}
      onEdit={() => setPanel({ mode: "edit", r: selected })}
      onAvvia={() => onAvvia(selected)}
      onGoToTable={onGoToTable} />;
  } else if (!compact) {
    side = (
      <SidePanel t={t} label="Dettaglio prenotazione"
        footer={<TillButton t={t} variant="primary" size={60} icon={Plus} onClick={() => setPanel({ mode: "new" })}>Nuova prenotazione</TillButton>}>
        <div style={{ color: t.inkSoft, fontSize: 17, padding: "28px 0", lineHeight: 1.5 }}>
          Tocca una prenotazione per vederla e gestirla, oppure creane una nuova.
        </div>
      </SidePanel>
    );
  }

  const calendar = (
    <>
      <Calendar t={t} month={month} onMonth={setMonth} selected={selectedDate} onSelect={selectDate} counts={counts} compact={compact} />
      <TillButton t={t} icon={CalendarDays} onClick={() => selectDate(dateKey())} style={{ width: "100%", marginTop: 14 }}>Oggi</TillButton>
    </>
  );
  const dayView = (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: compact ? 20 : 24, fontWeight: 700, textTransform: "capitalize" }}>
            {selectedDate === dateKey() ? "Oggi · " : ""}{DAY_LABEL.format(parseKey(selectedDate))}
          </div>
          <div style={{ fontSize: 16, color: t.inkSoft, marginTop: 2 }}>
            {active.length} {active.length === 1 ? "prenotazione" : "prenotazioni"} · {dayCovers} coperti
          </div>
        </div>
        {!compact && <TillButton t={t} variant="primary" icon={Plus} onClick={() => setPanel({ mode: "new" })}>Nuova</TillButton>}
      </div>
      {active.length === 0 && <div style={{ color: t.inkSoft, fontSize: 17, padding: "12px 0" }}>Nessuna prenotazione per questo giorno.</div>}
      <div style={{ display: "grid", gap: 10 }}>{active.map(rowFor)}</div>
      {others.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <TillButton t={t} variant="ghost" onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers} style={{ paddingLeft: 0, textAlign: "left" }}>
            {showOthers ? "Nascondi" : "Mostra"} avviate, annullate e non presentate ({others.length})
          </TillButton>
          {showOthers && <div style={{ display: "grid", gap: 10, marginTop: 8, opacity: 0.8 }}>{others.map(rowFor)}</div>}
        </div>
      )}
    </>
  );

  if (compact) {
    return (
      <div style={{ fontFamily: FONT, color: t.ink, padding: "16px 16px 96px", display: "grid", gap: 22 }}>
        <section aria-label="Calendario">{calendar}</section>
        <section aria-label="Prenotazioni del giorno">{dayView}</section>
        {/* Primary action of the screen, floating above the bottom bar. */}
        <button type="button" onClick={() => setPanel({ mode: "new" })} className="mdp-btn" style={{
          position: "fixed", right: 16, bottom: "calc(var(--mdp-bottom-nav, 0px) + 16px)", zIndex: 30,
          minHeight: 60, padding: "0 22px 0 18px", borderRadius: 18, border: "none", background: t.primary, color: t.bg,
          fontSize: 17, fontWeight: 700, fontFamily: FONT, cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
          boxShadow: "0 6px 18px rgba(0,0,0,0.22)",
        }}>
          <Plus size={24} strokeWidth={2.5} /> Nuova prenotazione
        </button>
        {side}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `minmax(340px, 420px) minmax(0, 1fr) ${SIDE_PANEL_WIDTH}`, fontFamily: FONT, color: t.ink }}>
      <section aria-label="Calendario" style={{ minHeight: 0, overflowY: "auto", padding: "18px 18px 96px", borderRight: `1px solid ${t.line}` }}>
        {calendar}
      </section>

      <section aria-label="Prenotazioni del giorno" style={{ minHeight: 0, overflowY: "auto", padding: "18px 20px 96px" }}>
        {dayView}
      </section>

      {side}
    </div>
  );
}
