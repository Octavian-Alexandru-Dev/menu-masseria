// The staff area on a phone (or any browser outside the till): one app with
// its sections in a bottom navigation bar — Tavoli · Prenotazioni · Storico
// and, for admins, Menù · Statistiche. The same sections as the till's
// TillSala.jsx: Prenotazioni, Storico, Menù and Statistiche are the very
// same screens (TillReservations/TillHistory/TillMenu/TillStats), laid out
// in one column on a phone; Tavoli has its own phone layout (Waiter.jsx).
// The tabs sit at the bottom, within reach of the thumb, as in native phone
// apps (Material navigation bar: 3–5 destinations, icon + visible label).
//
//  - top bar: the section's name, who is signed in and the shift, "Zoom"
//    (size of the whole interface on this device, displayZoom.js) and "Esci";
//  - bottom bar: the sections, with the number of open tables as a badge
//    on Tavoli;
//  - task screens (a table's order, a new table, a dish being edited, the
//    full menu editor) take the whole screen, without the two bars, and
//    have their own "back" at the top left (`setImmersive`).
//
// The section is kept in the URL (?sezione=…, useUrlState) so the browser's
// Back button and a reload stay where they were.
import React, { useState, useEffect, Suspense, lazy } from "react";
import { LayoutGrid, CalendarDays, History, BookOpen, BarChart3, LogOut, ZoomIn } from "lucide-react";
import { THEMES, GlobalStyle, currentShiftLabel, useUrlState, scrollBehavior, BackButton } from "./shared";
import { staffLogout, logoutHiddenAtTill } from "./staff-shared";
import { subscribeOpenOrders } from "./orders";
import { ZOOM_LEVELS, zoomLabel, getSavedZoom, saveZoom, applyZoom, zoomSupported } from "./displayZoom";
import { FONT, TOUCH, TillButton, SidePanel, Segmented, SectionTitle, useCompactLayout } from "./TillUi";
import { isAdminRole } from "./staffData";

const WaiterPanel = lazy(() => import("./Waiter").then((m) => ({ default: m.WaiterPanel })));
const TillReservations = lazy(() => import("./TillReservations"));
const TillHistory = lazy(() => import("./TillHistory"));
const TillMenu = lazy(() => import("./TillMenu"));
const TillStats = lazy(() => import("./TillStats"));

export const TOP_BAR_HEIGHT = 60;
export const BOTTOM_NAV_HEIGHT = 68;

// Installable from the browser ("Aggiungi a schermata Home"): only the staff
// area links the manifest, so the public menu never offers to install it.
function useStaffAppMeta(t) {
  useEffect(() => {
    const added = [];
    const add = (tag, attrs) => {
      const el = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      document.head.appendChild(el);
      added.push(el);
    };
    if (!document.querySelector('link[rel="manifest"]')) add("link", { rel: "manifest", href: "/staff.webmanifest" });
    add("meta", { name: "theme-color", content: t.card });
    add("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
    add("meta", { name: "mobile-web-app-capable", content: "yes" });
    add("meta", { name: "apple-mobile-web-app-title", content: "Sala" });
    return () => added.forEach((el) => el.remove());
  }, [t.card]);
}

// A top-bar action: icon above a short label, like the bottom bar's (it
// keeps its label even at the largest zoom, where the bar is narrowest).
function TopBarButton({ t, icon: Icon, label, onClick }) {
  return (
    <button type="button" onClick={onClick} className="mdp-btn" style={{
      minWidth: 56, minHeight: TOUCH, padding: "2px 6px", borderRadius: 12, border: "none", background: "none",
      color: t.inkSoft, fontSize: 12, fontWeight: 600, fontFamily: FONT, cursor: "pointer", flexShrink: 0,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
    }}>
      <Icon size={22} /> {label}
    </button>
  );
}

function TopBar({ t, title, session, onZoom }) {
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 40, background: t.card, borderBottom: `1px solid ${t.line}`,
      padding: "env(safe-area-inset-top) 8px 0 16px", fontFamily: FONT, color: t.ink,
    }}>
      <div style={{ height: TOP_BAR_HEIGHT, display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, lineHeight: 1.15, fontFamily: FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</h1>
          <div style={{ fontSize: 13, color: t.inkSoft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {session.name} · turno di {currentShiftLabel()}
          </div>
        </div>
        <TopBarButton t={t} icon={ZoomIn} label="Zoom" onClick={onZoom} />
        {!logoutHiddenAtTill() && <TopBarButton t={t} icon={LogOut} label="Esci" onClick={staffLogout} />}
      </div>
    </header>
  );
}

// The size of the whole interface on this device (displayZoom.js), as a
// full-screen page. A level applies at once, as a preview — the page itself
// is redrawn at that size, so the effect is seen before deciding; "Salva"
// keeps it on this device, going back without saving restores the previous
// one. On a computer the browser has its own zoom: the page says so.
function ZoomPage({ t, backLabel, onClose }) {
  const supported = zoomSupported();
  const [saved] = useState(getSavedZoom);
  const [value, setValue] = useState(saved);
  const choose = (zoom) => { setValue(zoom); applyZoom(zoom); };
  const cancel = () => { applyZoom(saved); onClose(); };
  const save = () => { saveZoom(value); onClose(); };
  return (
    <SidePanel
      t={t}
      sheet
      label="Zoom"
      header={(
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BackButton t={t} onClick={cancel} label={backLabel} />
          <div style={{ fontSize: 21, fontWeight: 700, minWidth: 0 }}>Zoom</div>
        </div>
      )}
      footer={supported && (
        <TillButton t={t} variant="primary" size={60} disabled={value === saved} onClick={save}>
          {value === saved ? `Zoom ${zoomLabel(saved)} salvato` : `Salva zoom ${zoomLabel(value)}`}
        </TillButton>
      )}
    >
      <div style={{ maxWidth: 560, margin: "0 auto", display: "grid", gap: 16, paddingTop: 4, fontSize: 16, lineHeight: 1.45 }}>
        {supported ? (
          <>
            <p style={{ margin: 0 }}>
              Ingrandisci o rimpicciolisci testi e pulsanti di tutta l'app, solo su questo dispositivo.
              L'anteprima è immediata: premi «Salva» per tenerla anche le prossime volte.
            </p>
            <SectionTitle t={t}>Livello di zoom</SectionTitle>
            <Segmented t={t} label="Livello di zoom" value={value} onChange={choose}
              options={ZOOM_LEVELS.map((zoom) => ({ value: zoom, label: zoom === 1 ? "100% · normale" : zoomLabel(zoom) }))} />
            <p style={{ margin: 0, fontSize: 14, color: t.inkSoft }}>
              Più grande è più facile da leggere; più piccolo mostra più cose insieme. Su un tablet, ingrandendo
              si passa alla disposizione del telefono (una colonna).
            </p>
          </>
        ) : (
          <p role="status" style={{ margin: 0 }}>
            Su un computer usa lo zoom del browser: <b>Ctrl</b> e <b>+</b> o <b>−</b> (<b>⌘</b> su Mac).
            Questa impostazione serve su telefoni e tablet, dove il browser non ha uno zoom.
          </p>
        )}
      </div>
    </SidePanel>
  );
}

function BottomNav({ t, sections, current, onChoose }) {
  return (
    <nav aria-label="Sezioni" style={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40, background: t.card, borderTop: `1px solid ${t.line}`,
      paddingBottom: "env(safe-area-inset-bottom)", fontFamily: FONT,
    }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${sections.length}, 1fr)`, height: BOTTOM_NAV_HEIGHT, maxWidth: 640, margin: "0 auto" }}>
        {sections.map((s) => {
          const active = s.key === current;
          return (
            <button key={s.key} type="button" onClick={() => onChoose(s.key)} aria-current={active ? "page" : undefined} className="mdp-btn" style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
              minWidth: 0, border: "none", background: "none", cursor: "pointer", padding: "6px 0",
              color: active ? t.ink : t.inkSoft, fontFamily: FONT, WebkitTapHighlightColor: "transparent",
            }}>
              <span style={{
                position: "relative", width: 60, height: 32, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center",
                background: active ? `${t.primary}1f` : "transparent", transition: "background .15s",
              }}>
                <s.icon size={22} strokeWidth={active ? 2.4 : 2} color={active ? t.primary : t.inkSoft} />
                {s.badge > 0 && (
                  <span aria-hidden="true" style={{
                    position: "absolute", top: -4, right: 6, minWidth: 20, height: 20, borderRadius: 10, padding: "0 5px",
                    background: t.primary, color: "#fff", fontSize: 12, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${t.card}`,
                  }}>{s.badge}</span>
                )}
              </span>
              <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, letterSpacing: -0.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                {s.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// admin: menu editing props from StaffHome/MenuApp (onPatch, onRestore,
// onExit) — present only for admin accounts, it adds the Menù section.
export default function PhoneApp({ menu, session, admin = null, initialSection = "waiter" }) {
  const t = THEMES[menu?.theme] || THEMES.minimal;
  const isAdmin = isAdminRole(session.role);
  const [section, setSection] = useUrlState("sezione", initialSection);
  const [immersive, setImmersive] = useState(false);
  // From Prenotazioni to Tavoli: { type: "avvia", reservation } or { type: "open", orderId }.
  const [tableRequest, setTableRequest] = useState(null);
  // The other way: a reservation of today tapped in Tavoli, opened in Prenotazioni.
  const [reservationToOpen, setReservationToOpen] = useState(null);
  const [openTables, setOpenTables] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const compact = useCompactLayout();
  useStaffAppMeta(t);

  useEffect(() => subscribeOpenOrders(
    (list) => setOpenTables(list.length),
    (err) => console.error("[app] Errore lettura tavoli aperti:", err),
  ), []);

  const sections = [
    { key: "waiter", label: "Tavoli", title: "Tavoli", icon: LayoutGrid, badge: openTables },
    { key: "reservations", label: "Prenotazioni", title: "Prenotazioni", icon: CalendarDays },
    { key: "history", label: "Storico", title: "Storico", icon: History },
    ...(admin ? [{ key: "admin", label: "Menù", title: "Menù", icon: BookOpen }] : []),
    ...(isAdmin ? [{ key: "stats", label: "Statistiche", title: "Statistiche", icon: BarChart3 }] : []),
  ];
  const current = sections.find((s) => s.key === section) || sections[0];

  const choose = (key) => {
    if (key === current.key) { window.scrollTo({ top: 0, behavior: scrollBehavior() }); return; }
    setImmersive(false);
    setReservationToOpen(null);
    setSection(key);
    window.scrollTo(0, 0);
  };
  const openReservation = (reservation) => {
    setImmersive(false);
    setReservationToOpen(reservation);
    setSection("reservations");
    window.scrollTo(0, 0);
  };
  const goToTables = (request) => {
    setTableRequest(request);
    setSection("waiter");
    window.scrollTo(0, 0);
  };

  const loading = <div style={{ padding: 40, color: t.inkSoft, fontSize: 17, fontFamily: FONT, textAlign: "center" }}>Caricamento…</div>;

  let content;
  if (current.key === "reservations") {
    content = <TillReservations t={t} session={session} initialReservation={reservationToOpen} onAvvia={(reservation) => goToTables({ type: "avvia", reservation })} onGoToTable={(orderId) => goToTables({ type: "open", orderId })} />;
  } else if (current.key === "history") {
    content = <TillHistory t={t} menu={menu} isAdmin={isAdmin} />;
  } else if (current.key === "admin") {
    content = <TillMenu t={t} menu={menu} admin={admin} />;
  } else if (current.key === "stats") {
    content = <TillStats t={t} />;
  } else {
    content = <WaiterPanel menu={menu} session={session} setImmersive={setImmersive} request={tableRequest} onRequestHandled={() => setTableRequest(null)} onOpenReservation={openReservation} />;
  }
  // Wider screens (a tablet, a computer) get the till's layout of these
  // sections (list + side panel), which needs a fixed height between the
  // two bars; on a phone they flow in one column.
  if (!compact && current.key !== "waiter") {
    content = <div style={{ height: "calc(100dvh - var(--mdp-top-bar) - var(--mdp-bottom-nav))", display: "flex", flexDirection: "column" }}>{content}</div>;
  }

  return (
    <div className="mdp-root" style={{
      minHeight: "100dvh", background: t.bg, fontFamily: FONT,
      "--mdp-top-bar": immersive ? "0px" : `calc(${TOP_BAR_HEIGHT + 1}px + env(safe-area-inset-top))`,
      "--mdp-bottom-nav": immersive ? "0px" : `calc(${BOTTOM_NAV_HEIGHT + 1}px + env(safe-area-inset-bottom))`,
    }}>
      <GlobalStyle t={t} />
      {!immersive && <TopBar t={t} title={current.title} session={session} onZoom={() => setZoomOpen(true)} />}
      <main style={{ paddingBottom: "var(--mdp-bottom-nav)" }}>
        <Suspense fallback={loading}>{content}</Suspense>
      </main>
      {!immersive && <BottomNav t={t} sections={sections} current={current.key} onChoose={choose} />}
      {zoomOpen && <ZoomPage t={t} backLabel={current.title} onClose={() => setZoomOpen(false)} />}
    </div>
  );
}
