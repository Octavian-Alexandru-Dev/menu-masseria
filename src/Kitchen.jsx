// Area cucina — schermo fisso che mostra le comande aperte, raggruppate per
// tavolo e per portata (vedi docs/comande-camerieri.md). Caricato solo su
// /cucina (lazy, vedi MenuApp.jsx), mai dal sito pubblico.
import React, { useState, useEffect, useRef } from "react";
import { LogOut, CheckCircle2, Clock, History } from "lucide-react";
import { THEMES, ital, GlobalStyle, Logo, TYPE, tableIdentity } from "./shared";
import { subscribeOpenOrders, markCategoryOut, autoCloseStaleOrders } from "./orders";
import {
  useStaffSession, StaffLoginScreen, StaffMessageScreen, StaffLoadingScreen, staffLogout,
} from "./staff-shared";
import OrderHistory from "./OrderHistory";

function elapsedLabel(openedAt) {
  const ms = openedAt?.toMillis ? Date.now() - openedAt.toMillis() : null;
  if (ms == null) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "appena arrivata";
  if (min < 60) return `${min} min fa`;
  return `${Math.floor(min / 60)}h ${min % 60}min fa`;
}

function formatTime(ts) {
  return ts?.toDate ? ts.toDate().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : null;
}

// Raggruppa le righe per categoria reale del menù (categoryId/categoryName,
// salvati come snapshot su ogni riga al momento dell'invio — vedi
// buildOrderLine in orders.js), non più per un elenco fisso di "portate":
// così il gruppo mostrato in cucina corrisponde sempre esattamente alla
// categoria scelta dal cameriere, senza possibilità di errore. L'ordine dei
// gruppi segue l'ordine in cui le categorie compaiono per la prima volta
// nell'array items (cioè l'ordine di invio).
function groupByCategory(items) {
  const order = [];
  const byId = new Map();
  for (const line of items) {
    const key = line.categoryId || "__other__";
    if (!byId.has(key)) {
      // categoryId resta il valore originale della riga (può essere null),
      // usato per il confronto in markCategoryOut — "key" è solo per il
      // raggruppamento locale.
      byId.set(key, { categoryId: line.categoryId, categoryName: line.categoryName || "Altro", lines: [] });
      order.push(key);
    }
    byId.get(key).lines.push(line);
  }
  return order.map((key) => byId.get(key));
}

function TableCard({ t, order, onMarkOut }) {
  const byCategory = groupByCategory(order.items || []);

  if (byCategory.length === 0) return null;

  return (
    <div data-testid={`table-card-${order.tableNumber}`} style={{ border: `1px solid ${t.line}`, borderRadius: 12, background: t.card, padding: 16, breakInside: "avoid" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.heading, fontWeight: 600, color: t.primary }}>
          {tableIdentity(order).primary}
          {tableIdentity(order).secondary && (
            <span style={{ fontWeight: 400, fontSize: TYPE.body, color: t.inkSoft }}> · {tableIdentity(order).secondary}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: TYPE.tinyPlus, color: t.inkSoft }}>
          <Clock size={12} /> {elapsedLabel(order.openedAt)}
        </div>
      </div>
      {order.notes && (
        <div style={{ fontSize: TYPE.tinyPlus, color: t.accent2, marginBottom: 10 }}>⚠ {order.notes}</div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {byCategory.map(({ categoryId, categoryName, lines }) => {
          const allOut = lines.every((l) => l.status === "out");
          return (
            <div key={categoryId || "__other__"} style={{ borderTop: `1px solid ${t.line}`, paddingTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: TYPE.smallPlus, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, color: allOut ? t.secondary : t.ink }}>
                  {categoryName}
                </span>
                {!allOut && (
                  <button
                    onClick={() => onMarkOut(order, categoryId)}
                    className="mdp-btn"
                    style={{
                      padding: "5px 12px", fontSize: TYPE.tinyPlus, borderRadius: 20, cursor: "pointer",
                      background: t.primary, color: t.bg, border: "none",
                    }}
                  >
                    Segna uscita
                  </button>
                )}
                {allOut && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4, color: t.secondary, fontSize: TYPE.tinyPlus }}>
                    <CheckCircle2 size={13} /> Uscita
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gap: 3 }}>
                {lines.map((l) => (
                  <div key={l.lineId} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: TYPE.body, color: t.ink, opacity: l.status === "out" ? 0.5 : 1 }}>
                    <span style={{ textDecoration: l.status === "out" ? "line-through" : "none" }}>
                      {l.quantity}× {l.name}
                      {l.notes && <span style={{ color: t.accent2, fontStyle: "italic" }}> — {l.notes}</span>}
                    </span>
                    <span style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft, whiteSpace: "nowrap" }}>
                      {formatTime(l.sentAt)}{l.outAt ? ` → ${formatTime(l.outAt)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KitchenPanel({ theme, menu, session }) {
  const t = THEMES[theme] || THEMES.minimal;
  const [orders, setOrders] = useState([]);
  const [ready, setReady] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const closingRef = useRef(new Set());

  useEffect(() => {
    const unsubscribe = subscribeOpenOrders((list) => {
      setOrders(list);
      setReady(true);
    }, (err) => console.error("[kitchen] Errore lettura comande:", err));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!ready) return;
    const toClose = orders.filter((o) => !closingRef.current.has(o.id));
    toClose.forEach((o) => closingRef.current.add(o.id));
    autoCloseStaleOrders(toClose).catch(() => {});
  }, [orders, ready]);

  const handleMarkOut = async (order, categoryId) => {
    try {
      await markCategoryOut(order.id, order.items || [], categoryId);
    } catch (err) {
      console.error("[kitchen] Aggiornamento categoria fallito:", err);
    }
  };

  const sorted = [...orders]
    .filter((o) => (o.items || []).length > 0)
    .sort((a, b) => (a.openedAt?.toMillis?.() || 0) - (b.openedAt?.toMillis?.() || 0));

  return (
    <div className="mdp-root" style={{ minHeight: "100vh" }}>
      <GlobalStyle t={t} />
      <div style={{
        position: "sticky", top: 0, zIndex: 20, background: t.card, borderBottom: `1px solid ${t.line}`,
        padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo width={40} />
          <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.subhead, fontWeight: 600 }}>Cucina</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={() => setShowHistory(true)} className="mdp-btn" style={{ background: "none", border: "none", color: t.inkSoft, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: TYPE.smallPlus, padding: "6px 8px" }}>
            <History size={14} /> Storico
          </button>
          <button onClick={staffLogout} className="mdp-btn" style={{ background: "none", border: "none", color: t.inkSoft, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: TYPE.smallPlus, padding: "6px 8px" }}>
            <LogOut size={14} /> Esci
          </button>
        </div>
      </div>

      {showHistory && <OrderHistory t={t} menu={menu} onBack={() => setShowHistory(false)} isAdmin={session.role === "admin"} />}

      {!showHistory && !ready && <div style={{ textAlign: "center", padding: 40, color: t.inkSoft }}>Caricamento comande…</div>}

      {!showHistory && ready && sorted.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: t.inkSoft, fontSize: TYPE.bodyLg }}>
          Nessuna comanda in corso.
        </div>
      )}

      {!showHistory && ready && sorted.length > 0 && (
        <div style={{
          padding: 20, display: "grid", gap: 16,
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        }}>
          {sorted.map((order) => (
            <TableCard key={order.id} t={t} order={order} onMarkOut={handleMarkOut} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Kitchen({ menu }) {
  const session = useStaffSession();
  const theme = menu?.theme;

  if (session.status === "loading") return <StaffLoadingScreen theme={theme} />;
  if (session.status === "signed-out") {
    return <StaffLoginScreen title="Area cucina" subtitle="Accedi con l'account della cucina" theme={theme} />;
  }
  if (session.status === "no-role") {
    return (
      <StaffMessageScreen
        theme={theme}
        title="Account senza ruolo"
        message="Il tuo account non ha ancora un ruolo assegnato. Contatta l'amministratore per essere abilitato per la cucina."
        onLogout={staffLogout}
      />
    );
  }
  if (session.role !== "kitchen" && session.role !== "admin") {
    return (
      <StaffMessageScreen
        theme={theme}
        title="Accesso non consentito"
        message="Questo account non è abilitato all'area cucina."
        onLogout={staffLogout}
      />
    );
  }

  return <KitchenPanel theme={theme} menu={menu} session={session} />;
}
