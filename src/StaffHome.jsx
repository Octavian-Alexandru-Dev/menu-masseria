// Landing page unica per il personale: dopo il login, mostra le aree a cui
// l'account ha accesso in base al ruolo (staff/{uid}.role) e permette di
// scegliere dove andare. Raggiunta dal pulsante "Area riservata" in fondo al
// menù pubblico (ClientView) — accesso consentito solo dopo autenticazione.
//
// /cameriere e /cucina restano comunque raggiungibili direttamente (utili
// per un dispositivo dedicato, es. il tablet fisso in cucina): questa
// pagina è il punto d'ingresso comune, non l'unico.
import React, { useState, useEffect } from "react";
import { ShieldCheck, ClipboardList, ChefHat, CalendarDays, ArrowLeft } from "lucide-react";
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

const TODAY_LABEL = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" });

// Landing "Dashboard": oltre alla scelta dell'area, mostra a colpo d'occhio
// qualche numero utile a inizio turno (tavoli aperti, prenotazioni da
// confermare) — le sottoscrizioni che lo alimentano vengono montate solo
// quando la Dashboard è davvero mostrata (vedi StaffHome), così un account
// solo-cameriere o solo-cucina, che salta dritto alla propria area, non
// paga il costo di listener che non vedrà mai.
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
  // Sezione scelta nella Dashboard (admin/waiter/kitchen/reservations),
  // sincronizzata con ?sezione nell'URL — così anche qui il pulsante
  // Indietro del browser torna alla Dashboard invece di non fare nulla
  // (vedi useUrlState in shared.jsx; ripulito all'uscita da MenuApp.jsx).
  const [area, setArea] = useUrlState("sezione", null);
  const [openTablesCount, setOpenTablesCount] = useState(null);
  const [pendingReservationsCount, setPendingReservationsCount] = useState(0);
  const theme = menu?.theme;

  const canAdmin = session.status === "ready" && session.role === "admin";
  const canWaiter = session.status === "ready" && (session.role === "waiter" || session.role === "admin");
  const canKitchen = session.status === "ready" && (session.role === "kitchen" || session.role === "admin");
  // Aree "core" (invariate rispetto a prima): determinano da sole se saltare
  // direttamente in un'area quando ce n'è una sola, e se mostrare la barra
  // "Cambia area" — un account solo-cameriere o solo-cucina deve continuare
  // ad avere l'accesso diretto alla propria area di sempre, senza vedere la
  // Dashboard, anche ora che esiste una quarta voce (Prenotazioni).
  const coreOptions = [
    canAdmin && { key: "admin", label: "Gestione menù", icon: ShieldCheck },
    canWaiter && { key: "waiter", label: "Sala", icon: ClipboardList },
    canKitchen && { key: "kitchen", label: "Cucina", icon: ChefHat },
  ].filter(Boolean);
  const canReservations = canWaiter; // stessa idoneità minima di Sala
  const dashboardOptions = [
    ...coreOptions,
    canReservations && { key: "reservations", label: "Prenotazioni", icon: CalendarDays },
  ].filter(Boolean);

  const chosen = area || (coreOptions.length === 1 ? coreOptions[0].key : null);
  const showingDashboard = session.status === "ready" && !chosen && coreOptions.length > 0;

  // I contatori live della Dashboard si montano solo quando la Dashboard è
  // davvero mostrata: un account che salta dritto in un'area (waiter-only,
  // kitchen-only) non apre queste sottoscrizioni in più.
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
    const t = THEMES[theme] || THEMES.rustica;
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
        : <Reservations menu={menu} />;

  // Se c'è più di un'area core disponibile, mostra una barra per tornare
  // alla scelta (invariato rispetto a prima: un account solo-cameriere o
  // solo-cucina, che non ha mai visto la Dashboard, non vede nemmeno questa
  // barra quando è nella sua unica area).
  if (coreOptions.length > 1) {
    const t = THEMES[theme] || THEMES.rustica;
    return (
      <>
        <BackToAreasBar t={t} onBack={() => setArea(null)} />
        {panel}
      </>
    );
  }

  return panel;
}
