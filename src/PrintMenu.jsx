// Printable menu view, opened in a separate tab from the Admin panel
// ("Esporta PDF / Stampa" in Admin.jsx) via `?print=1`. Not a copy of the
// web UI (list layout instead of cards/nav), but reuses the same visual
// theme as the digital menu — same colors, same fonts, same logo and same
// decorative flourish (`BranchDivider`) — so the printed document is
// immediately recognizable as the same place.
//
// The menu to print arrives via sessionStorage (key STORAGE_KEY), written by
// Admin.jsx right before opening this tab with window.open(): for pages
// opened this way, by script, from the same origin, the browser copies the
// caller's sessionStorage into the new tab — no extra Firestore request
// needed, and it also reflects changes not yet saved.
import React, { useEffect, useState } from "react";
import { THEMES, ital, Logo, BranchDivider, UI_STRINGS, FALLBACK_STYLE, TYPE } from "./shared";
import { optimizedImageUrl } from "./cloudinary";

const STORAGE_KEY = "mdp-print-payload";

const GENERATED_LABEL = { it: "Aggiornato al", en: "Updated on", es: "Actualizado el", de: "Aktualisiert am", fr: "Mis à jour le" };

function socialHandle(url, style) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const segment = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop();
    if (!segment) return u.hostname.replace(/^www\./, "");
    return style === "at" ? `@${segment}` : segment;
  } catch {
    return url;
  }
}

// The price is never translated (it stays the Italian field, e.g. "22,00" or
// "SU RICHIESTA"): same logic as ClientView.jsx to recognize the "on
// request" case and show it in the language chosen for the PDF, instead of
// the literal Italian text.
function formatPrice(price, ui) {
  const isRequest = /richiesta/i.test(price || "");
  return isRequest ? ui.onRequest : `€ ${price}`;
}

export default function PrintMenu() {
  const [payload] = useState(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  // No auto-print on open: it only starts when the admin presses "Stampa" in
  // the toolbar below (it used to start on its own as soon as the images
  // finished loading — besides being unwanted, in development with React
  // StrictMode the effect could re-run twice on mount and open two print
  // dialogs in a row).
  useEffect(() => {
    if (!payload) return;
    document.title = payload.restaurantName ? `${payload.restaurantName} — menù` : "Menù";
  }, [payload]);

  if (!payload) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", ...FALLBACK_STYLE }}>
        Nessun menù da stampare. Apri questa pagina dal pulsante "Esporta PDF / Stampa" nel pannello Admin.
      </div>
    );
  }

  const t = THEMES[payload.theme] || THEMES.minimal;
  const ui = UI_STRINGS[payload.lang] || UI_STRINGS.it;
  const social = payload.socialLinks || {};
  const socialEntries = [
    social.instagram?.visible && social.instagram?.url && { label: "Instagram", value: socialHandle(social.instagram.url, "at") },
    social.facebook?.visible && social.facebook?.url && { label: "Facebook", value: socialHandle(social.facebook.url) },
  ].filter(Boolean);

  return (
    <>
      <PrintStyle t={t} paperSize={payload.paperSize} />
      <div className="mdp-print-toolbar no-print">
        <span>Anteprima di stampa — premi "Stampa" per continuare</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => window.print()}>Stampa</button>
          <button onClick={() => window.close()}>Chiudi</button>
        </div>
      </div>

      <div className="mdp-print-page">
        <header className="mdp-print-header">
          <div className="mdp-print-logo"><Logo width={120} /></div>
          <div className="mdp-print-title">{payload.restaurantName}</div>
          {payload.tagline && <div className="mdp-print-tagline">{payload.tagline}</div>}
          {payload.location && <div className="mdp-print-location">{payload.location}</div>}
          <div className="mdp-print-divider"><BranchDivider color={t.secondary} /></div>
        </header>

        {payload.categories.map((cat) => (
          <section
            key={cat.id}
            className={"mdp-print-cat" + (payload.avoidCategorySplit ? " mdp-print-cat-avoid-split" : "")}
          >
            <div className="mdp-print-cat-head">
              {cat.subtitle && <div className="mdp-print-cat-sub">{cat.subtitle}</div>}
              <div className="mdp-print-cat-name">{cat.name}</div>
              <div className="mdp-print-divider mdp-print-divider-sm"><BranchDivider color={t.secondary} /></div>
            </div>
            <div
              className="mdp-print-items"
              style={payload.columns === 2 ? { columnCount: 2, columnGap: 28 } : undefined}
            >
              {cat.items.map((item) => (
                <div key={item.id} className="mdp-print-item">
                  {payload.includeImages && item.image && (
                    <img className="mdp-print-item-img" src={optimizedImageUrl(item.image, { width: 160 })} alt="" />
                  )}
                  <div className="mdp-print-item-body">
                    <div className="mdp-print-item-row">
                      <span className="mdp-print-item-name">
                        {item.name}
                        {item.tag && <span className="mdp-print-item-tag">{item.tag}</span>}
                      </span>
                      {item.price && (
                        <>
                          <span className="mdp-print-leader" />
                          <span className="mdp-print-item-price">{formatPrice(item.price, ui)}</span>
                        </>
                      )}
                    </div>
                    {item.description && <div className="mdp-print-item-desc">{item.description}</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        {(payload.footerNote || payload.generatedDate || socialEntries.length > 0) && (
          <footer className="mdp-print-footer">
            {payload.footerNote && <div className="mdp-print-footer-note">{payload.footerNote}</div>}
            {socialEntries.length > 0 && (
              <div className="mdp-print-footer-social">
                {socialEntries.map((s) => (
                  <span key={s.label}>{s.label} · {s.value}</span>
                ))}
              </div>
            )}
            {payload.generatedDate && (
              <div className="mdp-print-footer-date">
                {(GENERATED_LABEL[payload.lang] || GENERATED_LABEL.it)} {payload.generatedDate}
              </div>
            )}
          </footer>
        )}
      </div>
    </>
  );
}

// Stylesheet for the printable view. On screen it simulates an A4 sheet on a
// neutral reading table (to check the layout before printing); when
// actually printed, the background table and shadow disappear, leaving only
// the sheet. Colors, fonts and decorative flourish are the restaurant's
// theme (same as ClientView.jsx) — not a fixed neutral palette: if the
// admin prints with the dark "Notte di Cirò" theme, the sheet follows that
// theme. `print-color-adjust: exact` asks the browser to print background
// colors instead of discarding them to save ink (still depends on the
// "Background graphics" option in the print dialog, which remains the
// user's choice, not something CSS can force).
function PrintStyle({ t, paperSize }) {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,600&family=Work+Sans:wght@300;400;500;600&family=Roboto:ital,wght@0,300;0,400;0,500;0,700;1,400&display=swap');

      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        font-family: ${t.fontBody};
        background: #3a3a3a;
        color: ${t.ink};
      }
      .mdp-print-toolbar {
        position: sticky; top: 0; z-index: 10;
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 20px; background: #1c1c1c; color: #fff; font-size: ${TYPE.body}px;
      }
      .mdp-print-toolbar button {
        font-family: inherit; font-size: ${TYPE.smallPlus}px; padding: 6px 14px; border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.3); background: transparent; color: #fff; cursor: pointer; margin-left: 8px;
      }
      .mdp-print-toolbar button:hover { background: rgba(255,255,255,0.12); }

      .mdp-print-page {
        max-width: 190mm; margin: 24px auto 60px; padding: 20mm 16mm;
        background: ${t.bg}; color: ${t.ink};
        box-shadow: 0 0 0 1px rgba(0,0,0,0.12), 0 10px 40px rgba(0,0,0,0.35);
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }

      .mdp-print-header { text-align: center; margin-bottom: 30px; }
      .mdp-print-logo { display: flex; justify-content: center; margin-bottom: 14px; }
      .mdp-print-title {
        font-family: ${t.fontDisplay}; font-style: ${ital(t)}; font-weight: 600;
        font-size: 30px; color: ${t.ink};
      }
      .mdp-print-tagline { font-size: ${TYPE.body}px; color: ${t.inkSoft}; margin-top: 8px; }
      .mdp-print-location {
        font-size: ${TYPE.tinyPlus}px; letter-spacing: 1.5px; text-transform: uppercase;
        color: ${t.secondary}; margin-top: 8px;
      }
      .mdp-print-divider { display: flex; justify-content: center; margin-top: 16px; }
      .mdp-print-divider-sm { margin-top: 8px; margin-bottom: 2px; transform: scale(0.85); }

      /* By default a category CAN continue on a new page if it doesn't all
         fit on the current one: the entries that fit stay where they were
         (no whitespace left on purpose), only the rest continues on the
         next page. Each individual entry (.mdp-print-item) always stays
         whole, never split mid-item. The "Don't split a category across two
         pages" option in Admin instead applies .mdp-print-cat-avoid-split,
         which reverts to the opposite behavior (the whole category jumps to
         a new page, possibly leaving empty space on the previous one). */
      .mdp-print-cat { margin-bottom: 26px; }
      .mdp-print-cat-avoid-split { break-inside: avoid; }
      .mdp-print-cat-head { text-align: center; margin-bottom: 14px; break-inside: avoid; break-after: avoid; }
      .mdp-print-cat-sub {
        font-size: ${TYPE.tiny}px; letter-spacing: 1.8px; text-transform: uppercase;
        color: ${t.secondary}; margin-bottom: 3px;
      }
      .mdp-print-cat-name {
        font-family: ${t.fontDisplay}; font-style: ${ital(t)}; font-weight: 600;
        font-size: ${TYPE.heading}px; color: ${t.primary};
      }

      .mdp-print-item { display: flex; gap: 10px; padding: 7px 0; break-inside: avoid; }
      .mdp-print-item-img { width: 46px; height: 46px; border-radius: 6px; object-fit: cover; flex-shrink: 0; background: ${t.bgAlt}; }
      .mdp-print-item-body { flex: 1; min-width: 0; }
      .mdp-print-item-row { display: flex; align-items: baseline; gap: 4px; }
      .mdp-print-item-name { font-size: ${TYPE.bodyPlus}px; font-weight: 500; color: ${t.ink}; min-width: 0; overflow-wrap: break-word; }
      .mdp-print-item-tag {
        font-size: 8.5px; font-weight: 600; letter-spacing: 0.5px; color: ${t.bg};
        background: ${t.secondary}; border-radius: 20px; padding: 1px 7px; margin-left: 6px; white-space: nowrap;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      .mdp-print-leader { flex: 1; border-bottom: 1.5px dotted ${t.line}; margin: 0 5px 3px; min-width: 12px; }
      .mdp-print-item-price {
        font-family: ${t.fontDisplay}; font-style: ${ital(t)}; font-weight: 600;
        font-size: ${TYPE.bodyLg}px; color: ${t.accent}; white-space: nowrap;
      }
      .mdp-print-item-desc { font-size: ${TYPE.label}px; font-style: italic; color: ${t.inkSoft}; margin-top: 2px; line-height: 1.4; }

      .mdp-print-footer {
        margin-top: 32px; padding-top: 16px; border-top: 1px solid ${t.line};
        text-align: center; font-size: ${TYPE.tinyPlus}px; color: ${t.inkSoft};
      }
      .mdp-print-footer-note { font-style: italic; margin-bottom: 4px; }
      .mdp-print-footer-social span { margin: 0 8px; }
      .mdp-print-footer-date { margin-top: 8px; font-size: ${TYPE.micro}px; opacity: 0.75; }

      @media print {
        .no-print { display: none !important; }
        body { background: ${t.bg}; }
        .mdp-print-page { box-shadow: none; margin: 0; padding: 0; max-width: none; }
        @page { size: ${paperSize === "Letter" ? "letter" : "A4"}; margin: 15mm 12mm; }
      }
    `}</style>
  );
}
