// Landing page unica per il personale: dopo il login, mostra le aree a cui
// l'account ha accesso in base al ruolo (staff/{uid}.role) e permette di
// scegliere dove andare. Raggiunta dal pulsante "Area riservata" in fondo al
// menù pubblico (ClientView) — accesso consentito solo dopo autenticazione.
//
// /cameriere e /cucina restano comunque raggiungibili direttamente (utili
// per un dispositivo dedicato, es. il tablet fisso in cucina): questa
// pagina è il punto d'ingresso comune, non l'unico.
import React, { useState } from "react";
import { ShieldCheck, ClipboardList, ChefHat, ArrowLeft } from "lucide-react";
import { THEMES, ital, GlobalStyle, Logo, TYPE } from "./shared";
import {
  useStaffSession, StaffLoginScreen, StaffMessageScreen, StaffLoadingScreen, staffLogout,
} from "./staff-shared";
import Admin from "./Admin";
import Waiter from "./Waiter";
import Kitchen from "./Kitchen";

function AreaPicker({ t, session, options, onChoose }) {
  return (
    <div className="mdp-root" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, gap: 22 }}>
      <GlobalStyle t={t} />
      <Logo width={110} />
      <div style={{ textAlign: "center" }}>
        <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.heading, fontWeight: 600, color: t.primary }}>
          Ciao, {session.name}
        </div>
        <div style={{ fontSize: TYPE.body, color: t.inkSoft, marginTop: 4 }}>Dove vuoi andare?</div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", maxWidth: 480 }}>
        {options.map((opt) => (
          <button
            key={opt.key}
            onClick={() => onChoose(opt.key)}
            className="mdp-btn"
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
              width: 140, padding: "24px 16px", borderRadius: 14, cursor: "pointer",
              border: `1px solid ${t.line}`, background: t.card,
            }}
          >
            <opt.icon size={28} color={t.primary} />
            <span style={{ fontSize: TYPE.smallPlus, fontWeight: 600, color: t.ink, textAlign: "center" }}>{opt.label}</span>
          </button>
        ))}
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
  const [area, setArea] = useState(null);
  const theme = menu?.theme;

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

  const canAdmin = session.role === "admin";
  const canWaiter = session.role === "waiter" || session.role === "admin";
  const canKitchen = session.role === "kitchen" || session.role === "admin";

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

  const options = [
    canAdmin && { key: "admin", label: "Gestione menù", icon: ShieldCheck },
    canWaiter && { key: "waiter", label: "Sala", icon: ClipboardList },
    canKitchen && { key: "kitchen", label: "Cucina", icon: ChefHat },
  ].filter(Boolean);

  const chosen = area || (options.length === 1 ? options[0].key : null);

  if (!chosen) {
    const t = THEMES[theme] || THEMES.rustica;
    return <AreaPicker t={t} session={session} options={options} onChoose={setArea} />;
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
      : <Kitchen menu={menu} />;

  // Se c'è più di un'area disponibile e questa è stata scelta dal menù (non
  // l'unica possibile), mostra una barra per tornare alla scelta.
  if (options.length > 1) {
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
