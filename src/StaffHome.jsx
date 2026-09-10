// Single landing page for staff: after login, shows the areas the account
// has access to based on role (staff/{uid}.role) and lets them choose where
// to go. Reached from the "Area riservata" button at the bottom of the
// public menu (ClientView) — access only granted after authentication.
//
// /cameriere and /cucina remain directly reachable too (useful for a
// dedicated device, e.g. the fixed kitchen tablet): this page is the common
// entry point, not the only one.
import React, { useState, useEffect } from "react";
import { ShieldCheck, ClipboardList, ChefHat, CalendarDays, ArrowLeft, BarChart3 } from "lucide-react";
import { THEMES, ital, GlobalStyle, Logo, TYPE, currentShiftLabel, useUrlState } from "./shared";
import {
  useStaffSession, StaffLoginScreen, StaffMessageScreen, StaffLoadingScreen, staffLogout,
} from "./staff-shared";
import { subscribeOpenOrders } from "./orders";
import { subscribePendingReservations } from "./reservationsData";
import Admin from "./Admin";
import Waiter from "./Waiter";
import Kitchen from "./Kitchen";
import Reservations from "./Reservations";
import Stats from "./Stats";

const TODAY_LABEL = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" });

// "Dashboard" landing: besides letting you pick an area, it shows a few
// useful numbers at a glance at the start of a shift (open tables, pending
// reservations) — the subscriptions that feed it are only mounted when the
// Dashboard is actually shown (see StaffHome below), so a waiter-only or
// kitchen-only account, which jumps straight to its own area, doesn't pay
// the cost of listeners it will never see.
function Dashboard({ t, session, options, onChoose, openTablesCount, pendingReservationsCount }) {
  const countFor = (key) => {
    if (key === "waiter") return openTablesCount != null ? `${openTablesCount} ${openTablesCount === 1 ? "tavolo aperto" : "tavoli aperti"}` : null;
    if (key === "reservations" && pendingReservationsCount > 0) return `${pendingReservationsCount} da confermare`;
    return null;
  };

  return (
    <div className="mdp-root" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 24px 24px", gap: 26 }}>
      <GlobalStyle t={t} />
      <Logo width={110} />
      <div style={{ textAlign: "center" }}>
        <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.heading, fontWeight: 600, color: t.primary }}>
          Ciao, {session.name}
        </div>
        <div style={{ fontSize: TYPE.body, color: t.inkSoft, marginTop: 4, textTransform: "capitalize" }}>
          {TODAY_LABEL.format(new Date())} · Turno di {currentShiftLabel()}
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", maxWidth: 560 }}>
        {options.map((opt) => {
          const count = countFor(opt.key);
          const badge = opt.key === "reservations" ? pendingReservationsCount : 0;
          return (
            <button
              key={opt.key}
              onClick={() => onChoose(opt.key)}
              className="mdp-btn"
              style={{
                position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                width: 150, padding: "26px 16px", borderRadius: 14, cursor: "pointer",
                border: `1px solid ${t.line}`, background: t.card,
              }}
            >
              {badge > 0 && (
                <span style={{
                  position: "absolute", top: 10, right: 10, minWidth: 18, height: 18, borderRadius: 9,
                  background: t.accent2, color: "#fff", fontSize: TYPE.tiny, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px",
                }}>
                  {badge}
                </span>
              )}
              <opt.icon size={28} color={t.primary} />
              <span style={{ fontSize: TYPE.smallPlus, fontWeight: 600, color: t.ink, textAlign: "center" }}>{opt.label}</span>
              {count && (
                <span style={{ fontSize: TYPE.tiny, color: t.inkSoft, textAlign: "center" }}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <button onClick={staffLogout} className="mdp-btn" style={{ background: "none", border: "none", color: t.inkSoft, cursor: "pointer", fontSize: TYPE.smallPlus, marginTop: 10 }}>
        Esci
      </button>
    </div>
  );
}

function BackToAreasBar({ t, onBack }) {
  return (
    <div style={{ background: t.bgAlt, borderBottom: `1px solid ${t.line}`, padding: "6px 16px" }}>
      <button onClick={onBack} className="mdp-btn" style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: t.inkSoft, cursor: "pointer", fontSize: TYPE.tinyPlus }}>
        <ArrowLeft size={12} /> Cambia area
      </button>
    </div>
  );
}

export default function StaffHome({ menu, setMenu, onSave, saving, savedAt, saveError, onExit, onUndo, canUndo }) {
  const session = useStaffSession();
  // Section chosen in the Dashboard (admin/waiter/kitchen/reservations),
  // synced with ?sezione in the URL — so here too the browser's Back button
  // returns to the Dashboard instead of doing nothing (see useUrlState in
  // shared.jsx; cleared on exit from MenuApp.jsx).
  const [area, setArea] = useUrlState("sezione", null);
  const [openTablesCount, setOpenTablesCount] = useState(null);
  const [pendingReservationsCount, setPendingReservationsCount] = useState(0);
  const theme = menu?.theme;

  const canAdmin = session.status === "ready" && session.role === "admin";
  const canWaiter = session.status === "ready" && (session.role === "waiter" || session.role === "admin");
  const canKitchen = session.status === "ready" && (session.role === "kitchen" || session.role === "admin");
  // "Core" areas (unchanged from before): on their own they decide whether
  // to jump straight into an area when there's only one, and whether to
  // show the "Change area" bar — a waiter-only or kitchen-only account must
  // keep getting the same direct access to its own area as always, without
  // seeing the Dashboard, even now that a fourth entry exists (Reservations).
  const coreOptions = [
    canAdmin && { key: "admin", label: "Gestione menù", icon: ShieldCheck },
    canWaiter && { key: "waiter", label: "Sala", icon: ClipboardList },
    canKitchen && { key: "kitchen", label: "Cucina", icon: ChefHat },
  ].filter(Boolean);
  const canReservations = canWaiter; // same minimum eligibility as Sala
  const dashboardOptions = [
    ...coreOptions,
    canReservations && { key: "reservations", label: "Prenotazioni", icon: CalendarDays },
    // Statistics: concerns only Gestione menù (sales/revenue), so it
    // requires canAdmin like "admin" in coreOptions — not part of
    // coreOptions itself, so as not to change the Dashboard auto-skip for
    // single-role accounts (same reason Reservations is handled this way too).
    canAdmin && { key: "stats", label: "Statistiche", icon: BarChart3 },
  ].filter(Boolean);

  const chosen = area || (coreOptions.length === 1 ? coreOptions[0].key : null);
  const showingDashboard = session.status === "ready" && !chosen && coreOptions.length > 0;

  // The Dashboard's live counters are only mounted when the Dashboard is
  // actually shown: an account that jumps straight into an area
  // (waiter-only, kitchen-only) doesn't open these extra subscriptions.
  useEffect(() => {
    if (!showingDashboard || !canWaiter) { setOpenTablesCount(null); return; }
    return subscribeOpenOrders(
      (list) => setOpenTablesCount(list.length),
      (err) => console.error("[dashboard] Errore lettura tavoli aperti:", err)
    );
  }, [showingDashboard, canWaiter]);

  useEffect(() => {
    if (!showingDashboard || !canReservations) { setPendingReservationsCount(0); return; }
    return subscribePendingReservations(
      (list) => setPendingReservationsCount(list.length),
      (err) => console.error("[dashboard] Errore lettura prenotazioni da confermare:", err)
    );
  }, [showingDashboard, canReservations]);

  if (session.status === "loading") return <StaffLoadingScreen theme={theme} />;
  if (session.status === "signed-out") {
    return <StaffLoginScreen title="Area riservata" subtitle="Accedi con il tuo account del personale" theme={theme} />;
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

  if (!canAdmin && !canWaiter && !canKitchen) {
    return (
      <StaffMessageScreen
        theme={theme}
        title="Accesso non consentito"
        message="Questo account non è abilitato per nessuna area riservata."
        onLogout={staffLogout}
      />
    );
  }

  if (!chosen) {
    const t = THEMES[theme] || THEMES.minimal;
    return (
      <Dashboard
        t={t}
        session={session}
        options={dashboardOptions}
        onChoose={setArea}
        openTablesCount={openTablesCount}
        pendingReservationsCount={pendingReservationsCount}
      />
    );
  }

  const panel = chosen === "admin"
    ? (
      <Admin
        menu={menu}
        setMenu={setMenu}
        onSave={onSave}
        saving={saving}
        savedAt={savedAt}
        saveError={saveError}
        onExit={onExit}
        onUndo={onUndo}
        canUndo={canUndo}
      />
    )
    : chosen === "waiter"
      ? <Waiter menu={menu} />
      : chosen === "kitchen"
        ? <Kitchen menu={menu} />
        : chosen === "reservations"
          ? <Reservations menu={menu} />
          : <Stats menu={menu} />;

  // When more than one core area is available, show a bar to go back to the
  // choice screen (unchanged from before: a waiter-only or kitchen-only
  // account, which never saw the Dashboard, doesn't see this bar either
  // while in its only area).
  if (coreOptions.length > 1) {
    const t = THEMES[theme] || THEMES.minimal;
    return (
      <>
        <BackToAreasBar t={t} onBack={() => setArea(null)} />
        {panel}
      </>
    );
  }

  return panel;
}
