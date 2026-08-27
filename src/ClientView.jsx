// Vista pubblica del menù (quella che vedono i clienti). File volutamente
// leggero: nessun import di Firebase Authentication, nessun codice del
// pannello di gestione — solo React e Firestore per leggere il menù.
import React, { useState, useEffect, useRef } from "react";
import {
  THEMES, ital, LANGUAGES, UI_STRINGS, TRANSLATION_LANG_KEY,
  loadTranslationCache, saveTranslationCache, translateMenu,
  GlobalStyle, BranchDivider, Logo,
} from "./shared";

function reviewBtnStyle(t) {
  return {
    display: "inline-block",
    border: `1px solid ${t.line}`,
    borderRadius: 20,
    padding: "8px 16px",
    fontSize: 11.5,
    letterSpacing: 0.3,
    color: t.primary,
    textDecoration: "none",
    fontFamily: t.fontBody,
  };
}

export default function ClientView({ menu, onGoAdmin }) {
  const t = THEMES[menu.theme] || THEMES.rustica;

  // Lingua scelta dal cliente, ricordata tra una visita e l'altra.
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem(TRANSLATION_LANG_KEY) || "it";
    } catch {
      return "it";
    }
  });
  const [displayMenu, setDisplayMenu] = useState(menu);
  const [translating, setTranslating] = useState(false);
  const cacheRef = useRef(loadTranslationCache());
  const ui = UI_STRINGS[lang] || UI_STRINGS.it;

  useEffect(() => {
    try {
      localStorage.setItem(TRANSLATION_LANG_KEY, lang);
    } catch {
      // ignore
    }
    if (lang === "it") {
      setDisplayMenu(menu);
      setTranslating(false);
      return;
    }
    let cancelled = false;
    setTranslating(true);
    translateMenu(menu, lang, cacheRef.current).then((result) => {
      if (cancelled) return;
      setDisplayMenu(result);
      setTranslating(false);
      saveTranslationCache(cacheRef.current);
    });
    return () => {
      cancelled = true;
    };
  }, [lang, menu]);

  // Solo le categorie visibili, e al loro interno solo i piatti visibili.
  const visibleCategories = displayMenu.categories
    .filter((c) => c.visible !== false)
    .map((c) => ({ ...c, items: c.items.filter((i) => i.visible !== false) }))
    .filter((c) => c.items.length > 0);

  // menu.reviewLinks può mancare nei menù salvati prima dell'introduzione di questa funzione.
  const google = menu.reviewLinks?.google || { url: "", visible: false };
  const tripadvisor = menu.reviewLinks?.tripadvisor || { url: "", visible: false };

  const [active, setActive] = useState(visibleCategories[0]?.id);
  const refs = useRef({});

  const scrollTo = (id) => {
    setActive(id);
    refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const renderPrice = (price) => {
    const isRequest = /richiesta/i.test(price || "");
    return (
      <span className="mdp-display" style={{ fontStyle: ital(t), fontWeight: 600, color: t.accent, fontSize: isRequest ? 13 : 17, letterSpacing: isRequest ? 1 : 0 }}>
        {isRequest ? ui.onRequest : `€ ${price}`}
      </span>
    );
  };

  return (
    <div className="mdp-root">
      <GlobalStyle t={t} />

      {/* Selettore lingua */}
      <div style={{ display: "flex", justifyContent: "center", gap: 6, paddingTop: 16, flexWrap: "wrap" }}>
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            onClick={() => setLang(l.code)}
            className="mdp-btn"
            style={{
              border: `1px solid ${t.line}`,
              background: lang === l.code ? t.primary : "transparent",
              color: lang === l.code ? t.card : t.inkSoft,
              borderRadius: 20,
              padding: "4px 12px",
              fontSize: 11.5,
              letterSpacing: 0.5,
              cursor: "pointer",
              fontFamily: t.fontBody,
            }}
          >
            {l.label}
          </button>
        ))}
      </div>
      {translating && (
        <div style={{ textAlign: "center", fontSize: 11.5, color: t.inkSoft, marginTop: 8, fontStyle: ital(t) }}>
          {ui.translating}
        </div>
      )}

      {/* Hero */}
      <header style={{ padding: "24px 20px 40px", textAlign: "center", position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <Logo width={190} />
        </div>
        <div className="mdp-display" style={{ fontSize: "clamp(30px,7vw,52px)", fontStyle: ital(t), fontWeight: 600, lineHeight: 1.05 }}>
          {displayMenu.restaurantName}
        </div>
        <div style={{ marginTop: 12, fontSize: 15, color: t.inkSoft, maxWidth: 440, marginInline: "auto" }}>
          {displayMenu.tagline}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: t.secondary }}>
          {menu.location}
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
          <BranchDivider color={t.secondary} />
        </div>
      </header>

      {/* Sticky nav */}
      <nav
        className="mdp-scrollbar"
        style={{
          position: "sticky", top: 0, zIndex: 10, background: t.bg,
          borderBottom: `1px solid ${t.line}`, display: "flex", gap: 22,
          overflowX: "auto", padding: "12px 20px", backdropFilter: "blur(6px)",
        }}
      >
        {visibleCategories.map((c) => (
          <button
            key={c.id}
            onClick={() => scrollTo(c.id)}
            className="mdp-tab"
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontFamily: t.fontBody, fontSize: 12.5, letterSpacing: 1,
              textTransform: "uppercase", paddingBottom: 6,
              color: active === c.id ? t.primary : t.inkSoft,
              borderBottom: active === c.id ? `2px solid ${t.accent}` : "2px solid transparent",
            }}
          >
            {c.name}
          </button>
        ))}
      </nav>

      {/* Sections */}
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "10px 20px 80px" }}>
        {visibleCategories.map((cat) => (
          <section
            key={cat.id}
            ref={(el) => (refs.current[cat.id] = el)}
            style={{ paddingTop: 44, scrollMarginTop: 60 }}
            className="mdp-fade-in"
          >
            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: t.secondary, marginBottom: 4, textAlign: "center" }}>
              {cat.subtitle}
            </div>
            <div className="mdp-display" style={{ fontSize: 26, fontStyle: ital(t), fontWeight: 600, color: t.primary, textAlign: "center" }}>
              {cat.name}
            </div>
            <div style={{ margin: "10px 0 20px", display: "flex", justifyContent: "center" }}>
              <BranchDivider color={t.secondary} />
            </div>

            <div>
              {cat.items.map((item) => (
                <div key={item.id} className="mdp-row" style={{ padding: "12px 8px", borderRadius: 6, display: "flex", gap: 14 }}>
                  {item.image && (
                    <img
                      src={item.image}
                      alt={item.name}
                      loading="lazy"
                      style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover", flexShrink: 0, border: `1px solid ${t.line}` }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 16, fontWeight: 500 }}>{item.name}</span>
                        {item.tag && (
                          <span style={{
                            fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase",
                            color: t.bg, background: t.secondary, padding: "2px 7px", borderRadius: 20,
                          }}>
                            {item.tag}
                          </span>
                        )}
                      </div>
                      <div style={{ flex: 1, borderBottom: `1px dotted ${t.line}`, marginBottom: 5, minWidth: 16 }} />
                      {renderPrice(item.price)}
                    </div>
                    {item.description && (
                      <div style={{ fontSize: 13, color: t.inkSoft, fontStyle: ital(t), marginTop: 4, maxWidth: 560 }}>
                        {item.description}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>

      <footer style={{ textAlign: "center", padding: "30px 20px 40px", borderTop: `1px solid ${t.line}` }}>
        <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: 15, color: t.primary }}>
          {displayMenu.restaurantName}
        </div>
        <div style={{ fontSize: 11.5, color: t.inkSoft, marginTop: 4 }}>
          {menu.location} · {displayMenu.footerNote}
        </div>
        <div style={{ fontSize: 10.5, color: t.inkSoft, opacity: 0.6, marginTop: 14 }}>
          © 2026 {displayMenu.restaurantName}
        </div>

        {(google.visible && google.url) || (tripadvisor.visible && tripadvisor.url) ? (
          <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", marginTop: 22 }}>
            {google.visible && google.url && (
              <a
                href={google.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mdp-btn"
                style={reviewBtnStyle(t)}
              >
                {ui.reviewGoogle}
              </a>
            )}
            {tripadvisor.visible && tripadvisor.url && (
              <a
                href={tripadvisor.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mdp-btn"
                style={reviewBtnStyle(t)}
              >
                {ui.reviewTripadvisor}
              </a>
            )}
          </div>
        ) : null}

        <button
          onClick={onGoAdmin}
          className="mdp-btn"
          style={{
            marginTop: 22, background: "none", border: "none", cursor: "pointer",
            fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: t.inkSoft, opacity: 0.55,
          }}
        >
          {ui.manageMenu}
        </button>
      </footer>
    </div>
  );
}

