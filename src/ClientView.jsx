// Vista pubblica del menù (quella che vedono i clienti). File volutamente
// leggero: nessun import di Firebase Authentication, nessun codice del
// pannello di gestione — solo React e Firestore per leggere il menù.
import React, { useState, useEffect, useRef, useMemo } from "react";
import { X, Expand, ShoppingBag } from "lucide-react";
import {
  THEMES, ital, LANGUAGES, UI_STRINGS, TRANSLATION_LANG_KEY,
  applyTranslation,
  GlobalStyle, BranchDivider, Logo,
} from "./shared";
import { optimizedImageUrl } from "./cloudinary";

// Logo Google ("G" multicolore) ricreato come SVG vettoriale: nessuna immagine
// da scaricare, e il testo del pulsante resta HTML vero (traducibile), non
// pixel incorporati in una figura.
function GoogleGIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}

// Icona TripAdvisor (occhi/binocolo verdi, ispirati al gufo "Ollie"),
// ricreata in SVG con il verde ufficiale del brand (#00AF87).
function TripAdvisorIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#00AF87" d="M12 8.3c-1.7-1.6-4.2-2.2-6.6-1.6C6.5 5.8 8 5.3 9.7 5.3h4.6c1.7 0 3.2.5 4.3 1.4-2.4-.6-4.9 0-6.6 1.6z" />
      <circle cx="12" cy="13" r="10.2" fill="none" stroke="#00AF87" strokeWidth="1.6" />
      <circle cx="6.8" cy="13" r="4" fill="#fff" stroke="#00AF87" strokeWidth="1.4" />
      <circle cx="17.2" cy="13" r="4" fill="#fff" stroke="#00AF87" strokeWidth="1.4" />
      <circle cx="6.8" cy="13" r="1.5" fill="#00AF87" />
      <circle cx="17.2" cy="13" r="1.5" fill="#00AF87" />
    </svg>
  );
}

// Icona Instagram (glifo fotocamera + gradiente ufficiale del brand),
// ricreata in SVG vettoriale.
function InstagramIcon({ size = 18 }) {
  const gradId = "mdp-ig-grad";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <radialGradient id={gradId} cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#fdf497" />
          <stop offset="5%" stopColor="#fdf497" />
          <stop offset="45%" stopColor="#fd5949" />
          <stop offset="60%" stopColor="#d6249f" />
          <stop offset="90%" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill={`url(#${gradId})`} />
      <rect x="6.5" y="6.5" width="11" height="11" rx="3.2" fill="none" stroke="#fff" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3.4" fill="none" stroke="#fff" strokeWidth="1.6" />
      <circle cx="16.4" cy="7.6" r="1" fill="#fff" />
    </svg>
  );
}

// Icona Facebook ("f" bianca su cerchio blu ufficiale del brand).
function FacebookIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#1877F2" />
      <path fill="#fff" d="M13.5 21v-7.2h2.4l.36-2.8h-2.76V9.1c0-.81.22-1.36 1.39-1.36h1.48V5.23A20 20 0 0 0 13.9 5.1c-1.98 0-3.34 1.21-3.34 3.43v1.47H8.1v2.8h2.46V21h2.94z" />
    </svg>
  );
}

// Pulsante a due zone (badge col logo + pannello colorato col testo), sullo
// stile dei bottoni "Lascia una recensione" più comuni: testo vero (non
// incorporato in un'immagine), quindi tradotto insieme al resto del menù.
// Riutilizzato anche per i pulsanti social e per il collegamento allo shop.
function LinkButton({ href, icon, bg, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mdp-btn"
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        borderRadius: 999,
        overflow: "hidden",
        textDecoration: "none",
        boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
      }}
    >
      <span style={{ background: "#fff", display: "flex", alignItems: "center", padding: "9px 12px" }}>
        {icon}
      </span>
      <span
        style={{
          background: bg, color: "#fff", display: "flex", alignItems: "center",
          padding: "9px 16px", fontSize: 12.5, fontWeight: 600, letterSpacing: 0.2, whiteSpace: "nowrap",
        }}
      >
        {children}
      </span>
    </a>
  );
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
  const ui = UI_STRINGS[lang] || UI_STRINGS.it;

  // Nessuna chiamata di rete al cambio lingua: la traduzione (se generata
  // dall'admin) è già scaricata insieme al resto del menù, dentro
  // `menu.translations`. Si legge soltanto quale testo mostrare.
  const displayMenu = useMemo(
    () => (lang === "it" ? menu : applyTranslation(menu, menu.translations?.[lang])),
    [menu, lang]
  );

  useEffect(() => {
    try {
      localStorage.setItem(TRANSLATION_LANG_KEY, lang);
    } catch {
      // ignore
    }
  }, [lang]);

  // Solo le categorie visibili, e al loro interno solo i piatti visibili.
  const visibleCategories = displayMenu.categories
    .filter((c) => c.visible !== false)
    .map((c) => ({ ...c, items: c.items.filter((i) => i.visible !== false) }))
    .filter((c) => c.items.length > 0);

  // menu.reviewLinks/socialLinks possono mancare nei menù salvati prima dell'introduzione di questi campi.
  const google = menu.reviewLinks?.google || { url: "", visible: false };
  const tripadvisor = menu.reviewLinks?.tripadvisor || { url: "", visible: false };
  const instagram = menu.socialLinks?.instagram || { url: "", visible: false };
  const facebook = menu.socialLinks?.facebook || { url: "", visible: false };
  const shop = menu.socialLinks?.shop || { url: "", visible: false };

  const [active, setActive] = useState(visibleCategories[0]?.id);
  const refs = useRef({});

  // Voce ingrandita (per id, non per riferimento): così se la traduzione
  // finisce di caricare mentre la schermata è aperta, il testo mostrato resta
  // aggiornato invece di restare bloccato sulla versione italiana iniziale.
  const [zoomedItemId, setZoomedItemId] = useState(null);
  const zoomedItem = zoomedItemId
    ? visibleCategories.flatMap((c) => c.items).find((i) => i.id === zoomedItemId) || null
    : null;

  useEffect(() => {
    if (!zoomedItemId) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setZoomedItemId(null);
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [zoomedItemId]);

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
              {cat.items.map((item) => {
                const hasImage = !!item.image;
                return (
                <div
                  key={item.id}
                  className="mdp-row"
                  role={hasImage ? "button" : undefined}
                  tabIndex={hasImage ? 0 : undefined}
                  onClick={hasImage ? () => setZoomedItemId(item.id) : undefined}
                  onKeyDown={hasImage ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setZoomedItemId(item.id); } } : undefined}
                  style={{ padding: "12px 8px", borderRadius: 6, display: "flex", gap: 14, cursor: hasImage ? "pointer" : "default", outline: "none" }}
                >
                  {hasImage && (
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <img
                        src={optimizedImageUrl(item.image, { width: 128 })}
                        alt={item.name}
                        loading="lazy"
                        style={{ width: 64, height: 64, borderRadius: 8, objectFit: "contain", background: t.bgAlt, display: "block", border: `1px solid ${t.line}` }}
                      />
                      <span style={{
                        position: "absolute", bottom: -5, right: -5, width: 20, height: 20, borderRadius: "50%",
                        background: t.primary, color: t.bg, border: `2px solid ${t.bg}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <Expand size={10} />
                      </span>
                    </div>
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
                );
              })}
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

        {(google.visible && google.url) || (tripadvisor.visible && tripadvisor.url) ||
        (instagram.visible && instagram.url) || (facebook.visible && facebook.url) || (shop.visible && shop.url) ? (
          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap", marginTop: 22 }}>
            {google.visible && google.url && (
              <LinkButton href={google.url} icon={<GoogleGIcon />} bg="#4285F4">
                {ui.reviewGoogle}
              </LinkButton>
            )}
            {tripadvisor.visible && tripadvisor.url && (
              <LinkButton href={tripadvisor.url} icon={<TripAdvisorIcon />} bg="#00AF87">
                {ui.reviewTripadvisor}
              </LinkButton>
            )}
            {instagram.visible && instagram.url && (
              <LinkButton href={instagram.url} icon={<InstagramIcon />} bg="#C13584">
                {ui.linkInstagram}
              </LinkButton>
            )}
            {facebook.visible && facebook.url && (
              <LinkButton href={facebook.url} icon={<FacebookIcon />} bg="#1877F2">
                {ui.linkFacebook}
              </LinkButton>
            )}
            {shop.visible && shop.url && (
              <LinkButton href={shop.url} icon={<ShoppingBag size={18} color={t.primary} />} bg={t.primary}>
                {ui.linkShop}
              </LinkButton>
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

      {zoomedItem && (
        <div
          className="mdp-modal-backdrop"
          onClick={() => setZoomedItemId(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(20,15,10,0.75)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20, zIndex: 100,
          }}
        >
          <div
            className="mdp-modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: t.card, borderRadius: 14, overflow: "hidden",
              width: "100%", maxWidth: 440, maxHeight: "88vh", overflowY: "auto",
              border: `1px solid ${t.line}`, boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ position: "relative", background: t.bgAlt, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <img
                src={optimizedImageUrl(zoomedItem.image, { width: 800 })}
                alt={zoomedItem.name}
                style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain", display: "block" }}
              />
              <button
                onClick={() => setZoomedItemId(null)}
                aria-label={ui.closeZoom}
                className="mdp-btn"
                style={{
                  position: "absolute", top: 10, right: 10, width: 32, height: 32, borderRadius: "50%",
                  background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: "20px 22px 24px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <span className="mdp-display" style={{ fontStyle: ital(t), fontSize: 22, fontWeight: 600, color: t.primary }}>
                  {zoomedItem.name}
                </span>
                {zoomedItem.tag && (
                  <span style={{
                    fontSize: 10, letterSpacing: 1, textTransform: "uppercase",
                    color: t.bg, background: t.secondary, padding: "3px 9px", borderRadius: 20,
                  }}>
                    {zoomedItem.tag}
                  </span>
                )}
              </div>
              <div style={{ marginBottom: zoomedItem.description ? 10 : 0 }}>
                {renderPrice(zoomedItem.price)}
              </div>
              {zoomedItem.description && (
                <div style={{ fontSize: 14, color: t.inkSoft, fontStyle: ital(t), lineHeight: 1.5 }}>
                  {zoomedItem.description}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

