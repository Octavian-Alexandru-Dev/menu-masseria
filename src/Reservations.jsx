// Table reservations area — calendar, confirm/reject, starting an order
// (see docs/prenotazioni.md). Loaded only at /prenotazioni or from the
// shortcut in Sala (lazy, see MenuApp.jsx/Waiter.jsx), never from the
// public site. Accessible to waiters and admins.
import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from "react";
import {
  ChevronLeft, ChevronRight, ArrowLeft, LogOut, Plus, Check, X,
  Play, Users, Phone, ChevronDown, ChevronUp,
} from "lucide-react";
import { THEMES, ital, GlobalStyle, Logo, TYPE } from "./shared";
import {
  useStaffSession, StaffLoginScreen, StaffMessageScreen, StaffLoadingScreen, staffLogout,
} from "./staff-shared";
import {
  dateKey, createReservation, updateReservation, confirmReservation, rejectReservation,
  cancelReservation, startReservation, subscribeReservationsForRange,
  autoFlagNoShows, runDailyExpiredReservationsCleanup, coversLabel,
} from "./reservationsData";

const MONTH_LABEL = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });
const WEEKDAY_LABEL = new Intl.DateTimeFormat("it-IT", { weekday: "short" });
const DAY_HEADER_LABEL = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" });
const CELL_DATE_LABEL = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" });

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}
// Adds `delta` days to a "YYYY-MM-DD" key (or Date) and returns a new key —
// used to size/slide the agenda's rolling day window.
function addDays(dateKeyOrDate, delta) {
  const base = typeof dateKeyOrDate === "string" ? new Date(dateKeyOrDate + "T00:00:00") : dateKeyOrDate;
  return dateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta));
}
function monthRangeKeys(date) {
  const start = startOfMonth(date);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { startKey: dateKey(start), endKey: dateKey(end) };
}
// Monday-first grid: getDay() is 0=Sunday..6=Saturday, we convert it to
// 0=Monday..6=Sunday.
function firstWeekdayOffset(date) {
  return (new Date(date.getFullYear(), date.getMonth(), 1).getDay() + 6) % 7;
}
function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
const ACTIVE_STATUSES = ["pending", "confirmed", "started"];

function ReservationCalendar({ t, visibleMonth, onChangeMonth, selectedDate, onSelectDate, countsByDate }) {
  const offset = firstWeekdayOffset(visibleMonth);
  const total = daysInMonth(visibleMonth);
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let day = 1; day <= total; day++) cells.push(day);
  const todayKey = dateKey();

  return (
    <div style={{ background: t.card, border: `1px solid ${t.line}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button aria-label="Mese precedente" onClick={() => onChangeMonth(addMonths(visibleMonth, -1))} className="mdp-btn" style={{ background: "none", border: `1px solid ${t.line}`, borderRadius: 6, width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: t.ink }}>
          <ChevronLeft size={16} />
        </button>
        <div style={{ fontSize: TYPE.bodyPlus, fontWeight: 600, color: t.ink, textTransform: "capitalize" }}>
          {MONTH_LABEL.format(visibleMonth)}
        </div>
        <button aria-label="Mese successivo" onClick={() => onChangeMonth(addMonths(visibleMonth, 1))} className="mdp-btn" style={{ background: "none", border: `1px solid ${t.line}`, borderRadius: 6, width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: t.ink }}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => {
          const d = new Date(2024, 0, 1 + i); // Monday Jan 1st 2024, only used for the weekday names
          return (
            <div key={i} style={{ textAlign: "center", fontSize: TYPE.tiny, color: t.inkSoft, textTransform: "uppercase", padding: "2px 0" }}>
              {WEEKDAY_LABEL.format(d)}
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((day, idx) => {
          if (day == null) return <div key={`b${idx}`} />;
          const key = dateKey(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day));
          const counts = countsByDate[key];
          const isSelected = key === selectedDate;
          const isToday = key === todayKey;
          const hasCounts = counts && counts.total > 0;
          const cellDate = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
          return (
            <button
              key={key}
              onClick={() => onSelectDate(key)}
              aria-label={hasCounts
                ? `${CELL_DATE_LABEL.format(cellDate)}, ${counts.total} prenotazioni, ${counts.covers} coperti`
                : CELL_DATE_LABEL.format(cellDate)}
              className="mdp-btn"
              style={{
                position: "relative", padding: "6px 0 5px", borderRadius: 8, cursor: "pointer",
                border: isToday ? `1px solid ${t.primary}` : "1px solid transparent",
                background: isSelected ? t.primary : "transparent",
                color: isSelected ? t.bg : t.ink,
                fontSize: TYPE.smallPlus, fontWeight: isToday ? 700 : 400,
              }}
            >
              {day}
              {/* Mini overview per day, à la Google Flights' price-per-date: n° prenotazioni · coperti.
                  Always reserves the line's height (visibility toggle, not conditional render) so
                  weeks with and without reservations keep the same row height in the grid. */}
              <div style={{
                fontSize: TYPE.micro, lineHeight: 1.2, marginTop: 1, fontWeight: 600,
                visibility: hasCounts ? "visible" : "hidden",
                color: counts?.pending > 0 ? (isSelected ? t.bg : t.accent2) : (isSelected ? t.bg : t.inkSoft),
              }}>
                {hasCounts ? `${counts.total}·${counts.covers}p` : "0·0p"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OverviewBar({ t, dayReservations }) {
  const active = dayReservations.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const adults = active.reduce((s, r) => s + (r.covers?.adults || 0), 0);
  const children = active.reduce((s, r) => s + (r.covers?.children || 0), 0);
  const pendingCount = dayReservations.filter((r) => r.status === "pending").length;

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12, marginBottom: 4,
    }}>
      <div style={{ flex: "1 1 140px", background: t.bgAlt, borderRadius: 10, padding: "10px 14px" }}>
        <div style={{ fontSize: TYPE.tiny, color: t.inkSoft, textTransform: "uppercase", letterSpacing: 0.6 }}>Prenotazioni</div>
        <div style={{ fontSize: TYPE.subhead, fontWeight: 700, color: t.ink }}>{active.length}</div>
      </div>
      <div style={{ flex: "1 1 180px", background: t.bgAlt, borderRadius: 10, padding: "10px 14px" }}>
        <div style={{ fontSize: TYPE.tiny, color: t.inkSoft, textTransform: "uppercase", letterSpacing: 0.6 }}>Coperti</div>
        <div style={{ fontSize: TYPE.subhead, fontWeight: 700, color: t.ink, display: "flex", alignItems: "center", gap: 6 }}>
          <Users size={15} /> {adults} adulti, {children} bambini
        </div>
      </div>
      {pendingCount > 0 && (
        <div style={{ flex: "1 1 140px", background: t.accent2, color: "#fff", borderRadius: 10, padding: "10px 14px" }}>
          <div style={{ fontSize: TYPE.tiny, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.9 }}>Da confermare</div>
          <div style={{ fontSize: TYPE.subhead, fontWeight: 700 }}>{pendingCount}</div>
        </div>
      )}
    </div>
  );
}

function ReservationRow({ t, r, isToday, busy, onOpen, onConfirm, onReject, onAvvia }) {
  const btnStyle = { padding: "6px 10px", borderRadius: 6, border: `1px solid ${t.line}`, background: "none", cursor: "pointer", fontSize: TYPE.tinyPlus, display: "flex", alignItems: "center", gap: 4 };
  return (
    <div style={{ border: `1px solid ${t.line}`, borderRadius: 10, padding: "10px 12px", background: t.card }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <button onClick={() => onOpen(r)} className="mdp-btn" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", flex: 1 }}>
          <div style={{ fontSize: TYPE.bodyPlus, fontWeight: 600, color: t.ink }}>
            {r.name || "Senza nome"}{r.time ? ` · ${r.time}` : ""}
          </div>
          <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft, marginTop: 2, display: "flex", flexWrap: "wrap", gap: 8 }}>
            <span>{coversLabel(r.covers)}</span>
            {r.tableNumber && <span>Tavolo {r.tableNumber}</span>}
            {r.phone && <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Phone size={11} /> {r.phone}</span>}
          </div>
          {r.notes && <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft, marginTop: 2, fontStyle: "italic" }}>{r.notes}</div>}
        </button>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {r.status === "pending" && (
            <>
              <button aria-label={`Conferma prenotazione di ${r.name || "senza nome"}`} disabled={busy} onClick={() => onConfirm(r)} className="mdp-btn" style={{ ...btnStyle, borderColor: t.secondary, color: t.secondary }}>
                <Check size={12} /> Conferma
              </button>
              <button aria-label={`Rifiuta prenotazione di ${r.name || "senza nome"}`} disabled={busy} onClick={() => onReject(r)} className="mdp-btn" style={{ ...btnStyle, borderColor: t.accent2, color: t.accent2 }}>
                <X size={12} /> Rifiuta
              </button>
            </>
          )}
          {r.status === "confirmed" && isToday && (
            <button aria-label={`Avvia prenotazione di ${r.name || "senza nome"}`} disabled={busy} onClick={() => onAvvia(r)} className="mdp-btn" style={{ ...btnStyle, background: t.primary, color: t.bg, borderColor: t.primary }}>
              <Play size={12} /> Avvia
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReservationForm({ t, selectedDate, initial, onCancel, onSave, onSaveAndConfirm, onCancelReservation, busy }) {
  const isEdit = !!initial;
  const [date, setDate] = useState(initial?.date || selectedDate);
  const [time, setTime] = useState(initial?.time || "");
  const [name, setName] = useState(initial?.name || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [adults, setAdults] = useState(initial ? String(initial.covers?.adults || "") : "");
  const [children, setChildren] = useState(initial ? String(initial.covers?.children || "") : "");
  const [tableNumber, setTableNumber] = useState(initial?.tableNumber ? String(initial.tableNumber) : "");
  const [notes, setNotes] = useState(initial?.notes || "");

  const inputStyle = { width: "100%", padding: "10px 12px", border: `1px solid ${t.line}`, borderRadius: 6, background: t.bg, color: t.ink, fontSize: TYPE.bodyLg };
  const labelStyle = { fontSize: TYPE.tiny, letterSpacing: 0.8, textTransform: "uppercase", color: t.inkSoft, display: "block", marginBottom: 4, marginTop: 12 };

  const fields = () => ({
    date, time,
    name: name.trim(),
    phone: phone.trim(),
    covers: { adults: parseInt(adults, 10) || 0, children: parseInt(children, 10) || 0 },
    tableNumber: tableNumber ? parseInt(tableNumber, 10) : null,
    notes,
  });

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: "20px 16px 100px" }}>
      <button onClick={onCancel} className="mdp-btn" style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: t.inkSoft, cursor: "pointer", fontSize: TYPE.smallPlus, marginBottom: 14 }}>
        <ArrowLeft size={14} /> Indietro
      </button>
      <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.heading, fontWeight: 600, color: t.primary, marginBottom: 10 }}>
        {isEdit ? "Modifica prenotazione" : "Nuova prenotazione"}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Data *</label>
          <input style={inputStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Ora</label>
          <input style={inputStyle} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>

      <label style={labelStyle}>Nome *</label>
      <input style={inputStyle} placeholder="es. Famiglia Rossi" value={name} onChange={(e) => setName(e.target.value)} autoFocus />

      <label style={labelStyle}>Telefono</label>
      <input style={inputStyle} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Adulti</label>
          <input style={inputStyle} type="number" min="0" inputMode="numeric" value={adults} onChange={(e) => setAdults(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Bambini</label>
          <input style={inputStyle} type="number" min="0" inputMode="numeric" value={children} onChange={(e) => setChildren(e.target.value)} />
        </div>
      </div>

      <label style={labelStyle}>Numero tavolo (opzionale)</label>
      <input style={inputStyle} type="number" min="1" inputMode="numeric" value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} />

      <label style={labelStyle}>Note (allergie, richieste…)</label>
      <textarea aria-label="Note (allergie, richieste…)" rows={2} style={{ ...inputStyle, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} />

      {!isEdit && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
          <button
            disabled={!name.trim() || !date || busy}
            onClick={() => onSaveAndConfirm(fields())}
            className="mdp-btn"
            style={{ padding: "12px 0", background: t.primary, color: t.bg, border: "none", borderRadius: 8, fontSize: TYPE.bodyPlus, fontWeight: 600, cursor: !name.trim() || !date || busy ? "default" : "pointer", opacity: !name.trim() || !date || busy ? 0.6 : 1 }}
          >
            {busy ? "Salvataggio…" : "Salva e conferma"}
          </button>
          <button
            disabled={!name.trim() || !date || busy}
            onClick={() => onSave(fields())}
            className="mdp-btn"
            style={{ padding: "11px 0", background: "none", color: t.ink, border: `1px solid ${t.line}`, borderRadius: 8, fontSize: TYPE.bodyPlus, cursor: !name.trim() || !date || busy ? "default" : "pointer", opacity: !name.trim() || !date || busy ? 0.6 : 1 }}
          >
            Salva (da confermare)
          </button>
        </div>
      )}

      {isEdit && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
          <button
            disabled={!name.trim() || !date || busy}
            onClick={() => onSave(fields())}
            className="mdp-btn"
            style={{ padding: "12px 0", background: t.primary, color: t.bg, border: "none", borderRadius: 8, fontSize: TYPE.bodyPlus, fontWeight: 600, cursor: !name.trim() || !date || busy ? "default" : "pointer", opacity: !name.trim() || !date || busy ? 0.6 : 1 }}
          >
            {busy ? "Salvataggio…" : "Salva modifiche"}
          </button>
          {initial.status === "confirmed" && (
            <button
              disabled={busy}
              onClick={onCancelReservation}
              className="mdp-btn"
              style={{ padding: "11px 0", background: "none", color: t.accent2, border: `1px solid ${t.accent2}`, borderRadius: 8, fontSize: TYPE.bodyPlus, cursor: busy ? "default" : "pointer" }}
            >
              Annulla prenotazione
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function AvviaModal({ t, reservation, onCancel, onConfirm, busy }) {
  const [tableNumber, setTableNumber] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,15,10,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 100 }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: t.card, borderRadius: 12, padding: 24, maxWidth: 340, width: "100%" }}>
        <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.heading, fontWeight: 600, color: t.primary, marginBottom: 10 }}>
          Avvia {reservation.name || "prenotazione"}
        </div>
        <div style={{ fontSize: TYPE.body, color: t.inkSoft, marginBottom: 14 }}>
          {coversLabel(reservation.covers)}{reservation.notes ? ` · ${reservation.notes}` : ""}
        </div>
        <label style={{ fontSize: TYPE.tiny, letterSpacing: 0.8, textTransform: "uppercase", color: t.inkSoft, display: "block", marginBottom: 4 }}>Numero tavolo *</label>
        <input
          autoFocus type="number" min="1" inputMode="numeric" value={tableNumber} onChange={(e) => setTableNumber(e.target.value)}
          style={{ width: "100%", padding: "10px 12px", border: `1px solid ${t.line}`, borderRadius: 6, background: t.bg, color: t.ink, fontSize: TYPE.bodyLg, marginBottom: 20 }}
        />
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} className="mdp-btn" style={{ flex: 1, padding: "10px 0", background: "none", border: `1px solid ${t.line}`, borderRadius: 8, cursor: "pointer" }}>Annulla</button>
          <button
            disabled={!tableNumber || busy}
            onClick={() => onConfirm(parseInt(tableNumber, 10))}
            className="mdp-btn"
            style={{ flex: 1, padding: "10px 0", background: t.primary, color: t.bg, border: "none", borderRadius: 8, cursor: !tableNumber || busy ? "default" : "pointer", opacity: !tableNumber || busy ? 0.6 : 1 }}
          >
            {busy ? "Apertura…" : "Apri comanda"}
          </button>
        </div>
      </div>
    </div>
  );
}

// One day's worth of reservations inside the agenda: a small date header
// (with its own mini overview) followed by the same status groups the old
// single-day list used. Kept as one component per day so each day gets its
// own independent "closed" toggle state, and so its header DOM node can be
// measured/ref'd by ReservationAgenda to know which day is on screen.
function DaySection({ t, dayKey, dayReservations, onOpen, onConfirm, onReject, onAvvia, busyId, headerRef }) {
  const isToday = dayKey === dateKey();
  const pending = dayReservations.filter((r) => r.status === "pending");
  const confirmed = dayReservations.filter((r) => r.status === "confirmed");
  const started = dayReservations.filter((r) => r.status === "started");
  const closed = dayReservations.filter((r) => ["rejected", "cancelled", "no_show"].includes(r.status));
  const [showClosed, setShowClosed] = useState(false);

  const activeCount = pending.length + confirmed.length + started.length;
  const covers = dayReservations
    .filter((r) => ACTIVE_STATUSES.includes(r.status))
    .reduce((s, r) => s + (r.covers?.adults || 0) + (r.covers?.children || 0), 0);

  const statusLabel = (s) => (s === "rejected" ? "Rifiutata" : s === "cancelled" ? "Annullata" : "No-show");

  return (
    <div style={{ marginTop: 26 }} data-day-key={dayKey}>
      <div
        ref={headerRef}
        style={{
          display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10,
          paddingBottom: 8, marginBottom: 12, borderBottom: `1px solid ${t.line}`,
        }}
      >
        <div style={{ fontSize: TYPE.bodyPlus, fontWeight: 600, color: isToday ? t.primary : t.ink, textTransform: "capitalize" }}>
          {DAY_HEADER_LABEL.format(new Date(dayKey + "T00:00:00"))}{isToday ? " · Oggi" : ""}
        </div>
        {activeCount > 0 && (
          <div style={{ fontSize: TYPE.tiny, color: t.inkSoft, whiteSpace: "nowrap", flexShrink: 0 }}>
            {activeCount} pren. · {covers}p
          </div>
        )}
      </div>

      {dayReservations.length === 0 && (
        <div style={{ textAlign: "center", color: t.inkSoft, fontSize: TYPE.smallPlus, padding: "6px 0 4px" }}>
          Nessuna prenotazione.
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: TYPE.small, letterSpacing: 1, textTransform: "uppercase", color: t.accent2, marginBottom: 8 }}>
            Da confermare — {pending.length}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {pending.map((r) => (
              <ReservationRow key={r.id} t={t} r={r} isToday={isToday} busy={busyId === r.id} onOpen={onOpen} onConfirm={onConfirm} onReject={onReject} onAvvia={onAvvia} />
            ))}
          </div>
        </div>
      )}

      {confirmed.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: TYPE.small, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 8 }}>
            Confermate — {confirmed.length}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {confirmed.map((r) => (
              <ReservationRow key={r.id} t={t} r={r} isToday={isToday} busy={busyId === r.id} onOpen={onOpen} onConfirm={onConfirm} onReject={onReject} onAvvia={onAvvia} />
            ))}
          </div>
        </div>
      )}

      {started.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: TYPE.small, letterSpacing: 1, textTransform: "uppercase", color: t.inkSoft, marginBottom: 8 }}>
            Avviate — {started.length}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {started.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${t.line}`, borderRadius: 10, padding: "10px 12px", background: t.bgAlt, opacity: 0.85 }}>
                <div style={{ fontSize: TYPE.bodyPlus, fontWeight: 600, color: t.ink }}>{r.name}{r.time ? ` · ${r.time}` : ""}</div>
                <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft, marginTop: 2 }}>{coversLabel(r.covers)} · Comanda aperta</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <div>
          <button onClick={() => setShowClosed((v) => !v)} className="mdp-btn" style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: t.inkSoft, cursor: "pointer", fontSize: TYPE.smallPlus, padding: 0, marginBottom: 8 }}>
            {showClosed ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Rifiutate / annullate / no-show ({closed.length})
          </button>
          {showClosed && (
            <div style={{ display: "grid", gap: 8 }}>
              {closed.map((r) => (
                <div key={r.id} style={{ border: `1px solid ${t.line}`, borderRadius: 10, padding: "10px 12px", opacity: 0.7 }}>
                  <div style={{ fontSize: TYPE.bodyPlus, fontWeight: 600, color: t.ink }}>{r.name}{r.time ? ` · ${r.time}` : ""}</div>
                  <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft, marginTop: 2 }}>{coversLabel(r.covers)} · {statusLabel(r.status)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Half-width, in days, of the rolling window loaded around the selected/
// jumped-to date, and the step by which that window grows when the user
// scrolls close to either edge — see ReservationAgenda below.
const AGENDA_INITIAL_SPAN = 15;
const AGENDA_EXTEND_STEP = 30;
// Rough height of the sticky top bar: a day header is treated as "the one
// in view" once it scrolls up past this line.
const AGENDA_HEADER_OFFSET = 72;

// Bidirectional infinite-scroll agenda: renders one DaySection per day in
// [rangeStart, rangeEnd] (a plain, page-scrolled list — no nested scroll
// container), and:
//  - reports which day is currently under the sticky header (onDateInView),
//    so the calendar above can keep its highlighted day in sync while
//    scrolling, à la a continuous agenda;
//  - asks the parent to slide the loaded window forward/backward
//    (onExtendForward/onExtendBackward) once the first/last day gets close
//    to the viewport, compensating scroll position when content is
//    prepended so the page doesn't visibly jump;
//  - handles "jumps" (tapping a date in the calendar that may fall outside
//    the currently loaded window) via the scrollRequest prop: re-centers
//    the window on that date if needed, then scrolls to it once its
//    section exists in the DOM.
function ReservationAgenda({
  t, rangeStart, rangeEnd, reservations, selectedDate, scrollRequest,
  onDateInView, onResetRange, onExtendBackward, onExtendForward,
  onOpen, onConfirm, onReject, onAvvia, busyId,
}) {
  const dayKeys = useMemo(() => {
    const keys = [];
    let cursor = rangeStart;
    let guard = 0;
    while (cursor <= rangeEnd && guard < 400) {
      keys.push(cursor);
      cursor = addDays(cursor, 1);
      guard += 1;
    }
    return keys;
  }, [rangeStart, rangeEnd]);

  const reservationsByDate = useMemo(() => {
    const map = {};
    reservations.forEach((r) => {
      (map[r.date] || (map[r.date] = [])).push(r);
    });
    return map;
  }, [reservations]);

  const dayRefs = useRef({});
  const extendingBackRef = useRef(false);
  const extendingFwdRef = useRef(false);
  const capturedHeightRef = useRef(null);
  const pendingJumpRef = useRef(null);
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;

  const scrollToDate = (date) => {
    const el = dayRefs.current[date];
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - AGENDA_HEADER_OFFSET;
    window.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });
  };

  // A tap on the calendar (scrollRequest changes): jump the window if the
  // target date isn't loaded yet, otherwise just scroll to it.
  useEffect(() => {
    if (!scrollRequest) return;
    const { date } = scrollRequest;
    if (date < rangeStart || date > rangeEnd) {
      pendingJumpRef.current = date;
      onResetRange(date);
    } else {
      scrollToDate(date);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest]);

  // Once a jump has re-centered the window, its DaySections exist as soon
  // as this commits (they're built from the range alone) — scroll to the
  // target on the next frame, once refs are attached.
  useLayoutEffect(() => {
    if (pendingJumpRef.current) {
      const target = pendingJumpRef.current;
      pendingJumpRef.current = null;
      requestAnimationFrame(() => scrollToDate(target));
    }
  }, [rangeStart, rangeEnd]);

  // Compensate the page scroll when days were prepended above (rangeStart
  // moved earlier from an edge-extend, not from a jump/reset), so content
  // already on screen doesn't visibly shift.
  useLayoutEffect(() => {
    if (capturedHeightRef.current != null) {
      const delta = document.documentElement.scrollHeight - capturedHeightRef.current;
      capturedHeightRef.current = null;
      if (delta > 0) window.scrollBy(0, delta);
    }
    extendingBackRef.current = false;
  }, [rangeStart]);

  useEffect(() => {
    extendingFwdRef.current = false;
  }, [rangeEnd]);

  useEffect(() => {
    let raf = null;
    let lastScrollY = window.scrollY;
    const handleScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const scrollY = window.scrollY;
        const scrollingUp = scrollY < lastScrollY;
        lastScrollY = scrollY;

        let current = null;
        for (const key of dayKeys) {
          const el = dayRefs.current[key];
          if (!el) continue;
          if (el.getBoundingClientRect().top - AGENDA_HEADER_OFFSET <= 8) current = key;
          else break;
        }
        if (current && current !== selectedDateRef.current) onDateInView(current);

        // Only grow the window backward while actually scrolling up and
        // near its start — otherwise the first day (right below the
        // calendar) would trigger this on every load/forward-scroll too.
        if (scrollingUp && !extendingBackRef.current) {
          const firstEl = dayRefs.current[dayKeys[0]];
          if (firstEl) {
            const top = firstEl.getBoundingClientRect().top;
            if (top > -50 && top < 500) {
              extendingBackRef.current = true;
              capturedHeightRef.current = document.documentElement.scrollHeight;
              onExtendBackward();
            }
          }
        }
        if (!extendingFwdRef.current) {
          const lastEl = dayRefs.current[dayKeys[dayKeys.length - 1]];
          if (lastEl && lastEl.getBoundingClientRect().bottom < window.innerHeight + 700) {
            extendingFwdRef.current = true;
            onExtendForward();
          }
        }
      });
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKeys]);

  return (
    <div>
      {dayKeys.map((key) => (
        <DaySection
          key={key}
          t={t}
          dayKey={key}
          dayReservations={reservationsByDate[key] || []}
          headerRef={(el) => { dayRefs.current[key] = el; }}
          onOpen={onOpen} onConfirm={onConfirm} onReject={onReject} onAvvia={onAvvia}
          busyId={busyId}
        />
      ))}
    </div>
  );
}

function ReservationsPanel({ menu, session, onBack }) {
  const t = THEMES[menu?.theme] || THEMES.minimal;
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(dateKey());
  // Set only when the calendar (not the agenda scroll itself) asks to jump
  // to a date, so ReservationAgenda can tell a tap apart from its own
  // scroll-driven onDateInView updates and avoid fighting the user's scroll.
  const [scrollRequest, setScrollRequest] = useState(null);
  const [monthReservations, setMonthReservations] = useState([]);
  // Rolling window of days loaded for the agenda (independent of the
  // calendar's visible month) — see ReservationAgenda.
  const [agendaRange, setAgendaRange] = useState(() => ({
    start: addDays(dateKey(), -AGENDA_INITIAL_SPAN),
    end: addDays(dateKey(), AGENDA_INITIAL_SPAN),
  }));
  const [agendaReservations, setAgendaReservations] = useState([]);
  const [view, setView] = useState({ mode: "day" }); // day | new | edit (view mode)
  const [busyId, setBusyId] = useState(null);
  const [avviaTarget, setAvviaTarget] = useState(null);
  const [avviaBusy, setAvviaBusy] = useState(false);

  useEffect(() => {
    const { startKey, endKey } = monthRangeKeys(visibleMonth);
    const unsubscribe = subscribeReservationsForRange(startKey, endKey, (list) => {
      setMonthReservations(list);
      autoFlagNoShows(list).catch(() => {});
    }, (err) => console.error("[reservations] Errore lettura mese:", err));
    return unsubscribe;
  }, [visibleMonth]);

  useEffect(() => {
    const unsubscribe = subscribeReservationsForRange(agendaRange.start, agendaRange.end, setAgendaReservations,
      (err) => console.error("[reservations] Errore lettura agenda:", err));
    return unsubscribe;
  }, [agendaRange.start, agendaRange.end]);

  // Keeps the calendar's visible month following the selected date — which
  // itself follows the agenda scroll — so the highlighted day is always
  // actually shown in the currently displayed month grid.
  useEffect(() => {
    const selectedMonth = startOfMonth(new Date(selectedDate + "T00:00:00"));
    setVisibleMonth((prev) => (prev.getTime() === selectedMonth.getTime() ? prev : selectedMonth));
  }, [selectedDate]);

  useEffect(() => {
    runDailyExpiredReservationsCleanup();
  }, []);

  // The selected date is always inside agendaRange (calendar taps that fall
  // outside it re-center the window before scrolling — see
  // ReservationAgenda), so it's safe to derive it from the agenda data
  // instead of running a second, separate single-day listener.
  const dayReservations = agendaReservations.filter((r) => r.date === selectedDate);

  const countsByDate = {};
  monthReservations.forEach((r) => {
    if (!countsByDate[r.date]) countsByDate[r.date] = { total: 0, pending: 0, covers: 0 };
    if (ACTIVE_STATUSES.includes(r.status)) {
      countsByDate[r.date].total += 1;
      countsByDate[r.date].covers += (r.covers?.adults || 0) + (r.covers?.children || 0);
    }
    if (r.status === "pending") countsByDate[r.date].pending += 1;
  });

  const handleCalendarSelectDate = (key) => {
    setSelectedDate(key);
    setScrollRequest({ date: key, token: Date.now() });
  };
  const handleDateInView = (key) => setSelectedDate(key);
  const handleResetAgendaRange = (centerKey) => {
    setAgendaRange({ start: addDays(centerKey, -AGENDA_INITIAL_SPAN), end: addDays(centerKey, AGENDA_INITIAL_SPAN) });
  };
  const handleExtendBackward = () => {
    setAgendaRange((r) => ({ ...r, start: addDays(r.start, -AGENDA_EXTEND_STEP) }));
  };
  const handleExtendForward = () => {
    setAgendaRange((r) => ({ ...r, end: addDays(r.end, AGENDA_EXTEND_STEP) }));
  };

  const by = { uid: session.user.uid, name: session.name };

  const handleConfirm = async (r) => {
    setBusyId(r.id);
    try { await confirmReservation(r.id, by); } catch (err) { console.error("[reservations] Conferma fallita:", err); } finally { setBusyId(null); }
  };
  const handleReject = async (r) => {
    setBusyId(r.id);
    try { await rejectReservation(r.id, by); } catch (err) { console.error("[reservations] Rifiuto fallito:", err); } finally { setBusyId(null); }
  };
  const handleAvvia = (r) => {
    if (r.tableNumber) {
      doAvvia(r, r.tableNumber);
    } else {
      setAvviaTarget(r);
    }
  };
  const doAvvia = async (r, tableNumber) => {
    setAvviaBusy(true);
    try {
      await startReservation(r, { waiterUid: session.user.uid, waiterName: session.name, coperto: menu?.coperto, tableNumber });
      setAvviaTarget(null);
    } catch (err) {
      console.error("[reservations] Avvio fallito:", err);
    } finally {
      setAvviaBusy(false);
    }
  };

  const handleSave = async (fields) => {
    setBusyId("form");
    try {
      if (view.mode === "edit") {
        await updateReservation(view.reservation.id, fields);
      } else {
        await createReservation({ ...fields, createdByUid: session.user.uid, createdByName: session.name });
      }
      setView({ mode: "day" });
    } catch (err) {
      console.error("[reservations] Salvataggio fallito:", err);
    } finally {
      setBusyId(null);
    }
  };
  const handleSaveAndConfirm = async (fields) => {
    setBusyId("form");
    try {
      const ref = await createReservation({ ...fields, createdByUid: session.user.uid, createdByName: session.name });
      await confirmReservation(ref.id, by);
      setView({ mode: "day" });
    } catch (err) {
      console.error("[reservations] Salvataggio fallito:", err);
    } finally {
      setBusyId(null);
    }
  };
  const handleCancelReservation = async () => {
    setBusyId("form");
    try {
      await cancelReservation(view.reservation.id, by);
      setView({ mode: "day" });
    } catch (err) {
      console.error("[reservations] Annullamento fallito:", err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mdp-root" style={{ minHeight: "100vh" }}>
      <GlobalStyle t={t} />
      <div style={{
        position: "sticky", top: 0, zIndex: 20, background: t.card, borderBottom: `1px solid ${t.line}`,
        padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo width={40} />
          <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.subhead, fontWeight: 600 }}>Prenotazioni — {session.name}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {onBack && (
            <button onClick={onBack} className="mdp-btn" style={{ background: "none", border: "none", color: t.inkSoft, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: TYPE.smallPlus, padding: "6px 8px" }}>
              <ArrowLeft size={14} /> Sala
            </button>
          )}
          <button onClick={staffLogout} className="mdp-btn" style={{ background: "none", border: "none", color: t.inkSoft, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: TYPE.smallPlus, padding: "6px 8px" }}>
            <LogOut size={14} /> Esci
          </button>
        </div>
      </div>

      {view.mode === "day" && (
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 100px" }}>
          <ReservationCalendar
            t={t} visibleMonth={visibleMonth} onChangeMonth={setVisibleMonth}
            selectedDate={selectedDate} onSelectDate={handleCalendarSelectDate} countsByDate={countsByDate}
          />

          <OverviewBar t={t} dayReservations={dayReservations} />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 4 }}>
            <div style={{ fontSize: TYPE.bodyPlus, fontWeight: 600, color: t.ink, textTransform: "capitalize" }}>
              {DAY_HEADER_LABEL.format(new Date(selectedDate + "T00:00:00"))}
            </div>
            <button onClick={() => setView({ mode: "new" })} className="mdp-btn" style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: t.primary, color: t.bg,
              border: "none", borderRadius: 8, fontSize: TYPE.smallPlus, fontWeight: 600, cursor: "pointer",
            }}>
              <Plus size={14} /> Nuova
            </button>
          </div>
          <div style={{ fontSize: TYPE.tiny, color: t.inkSoft, marginBottom: 4 }}>
            Scorri per i giorni successivi o precedenti
          </div>

          <ReservationAgenda
            t={t}
            rangeStart={agendaRange.start} rangeEnd={agendaRange.end} reservations={agendaReservations}
            selectedDate={selectedDate} scrollRequest={scrollRequest}
            onDateInView={handleDateInView} onResetRange={handleResetAgendaRange}
            onExtendBackward={handleExtendBackward} onExtendForward={handleExtendForward}
            onOpen={(r) => setView({ mode: "edit", reservation: r })}
            onConfirm={handleConfirm} onReject={handleReject} onAvvia={handleAvvia} busyId={busyId}
          />
        </div>
      )}

      {view.mode === "new" && (
        <ReservationForm
          t={t} selectedDate={selectedDate} initial={null}
          onCancel={() => setView({ mode: "day" })}
          onSave={handleSave} onSaveAndConfirm={handleSaveAndConfirm}
          busy={busyId === "form"}
        />
      )}
      {view.mode === "edit" && (
        <ReservationForm
          t={t} selectedDate={selectedDate} initial={view.reservation}
          onCancel={() => setView({ mode: "day" })}
          onSave={handleSave} onCancelReservation={handleCancelReservation}
          busy={busyId === "form"}
        />
      )}

      {avviaTarget && (
        <AvviaModal
          t={t} reservation={avviaTarget}
          onCancel={() => setAvviaTarget(null)}
          onConfirm={(tableNumber) => doAvvia(avviaTarget, tableNumber)}
          busy={avviaBusy}
        />
      )}
    </div>
  );
}

export default function Reservations({ menu, onBack }) {
  const session = useStaffSession();
  const theme = menu?.theme;

  if (session.status === "loading") return <StaffLoadingScreen theme={theme} />;
  if (session.status === "signed-out") {
    return <StaffLoginScreen title="Prenotazioni" subtitle="Accedi con il tuo account personale" theme={theme} />;
  }
  if (session.status === "no-role") {
    return (
      <StaffMessageScreen
        theme={theme}
        title="Account senza ruolo"
        message="Il tuo account non ha ancora un ruolo assegnato. Contatta l'amministratore per essere abilitato."
        onLogout={staffLogout}
      />
    );
  }
  if (session.role !== "waiter" && session.role !== "admin") {
    return (
      <StaffMessageScreen
        theme={theme}
        title="Accesso non consentito"
        message="Questo account non è abilitato all'area prenotazioni."
        onLogout={staffLogout}
      />
    );
  }

  if (!menu) return <StaffLoadingScreen theme={theme} />;

  return <ReservationsPanel menu={menu} session={session} onBack={onBack} />;
}
