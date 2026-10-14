// Entry point of the staff area: login, role check (staff/{uid}.role), then
// the app for that device. Reached from the "Area riservata" button at the
// bottom of the public menu (ClientView) — access only granted after
// authentication.
//  - at the till (Windows client): the till's full-screen interface
//    (TillSala.jsx), every section in its top bar;
//  - on a phone or any other browser: the phone app (PhoneApp.jsx), the
//    same sections in a bottom navigation bar. No Dashboard in between: the
//    app opens on Tavoli, the live counts it used to show are badges on the
//    bottom bar.
//
// /cameriere and /prenotazioni remain directly reachable too (useful for a
// dedicated device): they open the same app on Tavoli / Prenotazioni
// (`entrySection`, MenuApp.jsx).
//
// There is no kitchen area any more: the kitchen works from the tickets
// printed at the till (kitchenTicket.js). Accounts still holding the old
// "kitchen" role get an explanation instead of an area.
import React, { Suspense, lazy } from "react";
import { useUrlState } from "./shared";
import {
  useStaffSession, StaffLoginScreen, StaffMessageScreen, StaffLoadingScreen, staffLogout,
} from "./staff-shared";
import { getDesktopBridge } from "./desktop";
import { MenuBootstrap } from "./MenuSettings";
import { isAdminRole, isStaffRole } from "./staffData";

// Each interface is loaded only when needed: a phone never downloads the
// till's screens, and the phone app loads each section on first use.
const TillSala = lazy(() => import("./TillSala"));
const PhoneApp = lazy(() => import("./PhoneApp"));

// Section (?sezione) → section of the till's top bar.
const TILL_TAB_FOR_AREA = { waiter: "floor", reservations: "reservations", history: "history", admin: "menu", stats: "stats" };

// menuMissing: the menu document doesn't exist on the server (an admin
// creates it from a backup). onPatch/onRestore/onExit: MenuApp.jsx.
export default function StaffHome({ menu, menuMissing = false, entrySection = "waiter", onPatch, onRestore, onExit }) {
  const session = useStaffSession();
  // Section in the URL (?sezione): the till opens on it; on a phone the app
  // keeps it in sync itself (PhoneApp.jsx).
  const [area] = useUrlState("sezione", entrySection);
  const theme = menu?.theme;

  // Owner and admin: the same areas (they differ only in Personale).
  const canAdmin = session.status === "ready" && isAdminRole(session.role);
  const canWaiter = session.status === "ready" && isStaffRole(session.role);
  const atTill = Boolean(getDesktopBridge()) && canWaiter;

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

  if (session.role === "kitchen") {
    return (
      <StaffMessageScreen
        theme={theme}
        title="L'area Cucina non c'è più"
        message="La cucina ora riceve le comande stampate dalla cassa. Chiedi all'amministratore di cambiare il ruolo di questo account (es. Cameriere)."
        onLogout={staffLogout}
      />
    );
  }

  if (!canAdmin && !canWaiter) {
    return (
      <StaffMessageScreen
        theme={theme}
        title="Accesso non consentito"
        message="Questo account non è abilitato per nessuna area riservata."
        onLogout={staffLogout}
      />
    );
  }

  // Menu editing (Menù section, admins only): every change is saved at once.
  const admin = canAdmin ? { onPatch, onRestore, onExit } : null;

  if (!menu) {
    if (!menuMissing) return <StaffLoadingScreen theme={theme} />;
    if (canAdmin) return <MenuBootstrap onRestore={onRestore} />;
    return (
      <StaffMessageScreen
        theme={theme}
        title="Menù non ancora disponibile"
        message="Il menù non è ancora stato creato. Chiedi a un amministratore di crearlo dall'area riservata."
        onLogout={staffLogout}
      />
    );
  }

  // At the till (Windows client) every section is part of one full-screen
  // interface (TillSala.jsx: Tavoli, Prenotazioni, Storico and, for admins,
  // Menù and Statistiche in its top bar).
  if (atTill) {
    return (
      <Suspense fallback={<StaffLoadingScreen theme={theme} />}>
        <TillSala menu={menu} session={session} initialTab={TILL_TAB_FOR_AREA[area] || "floor"} admin={admin} />
      </Suspense>
    );
  }

  // Phone / browser: the same sections in a bottom bar (PhoneApp.jsx).
  return (
    <Suspense fallback={<StaffLoadingScreen theme={theme} />}>
      <PhoneApp menu={menu} session={session} admin={admin} initialSection={entrySection} />
    </Suspense>
  );
}
