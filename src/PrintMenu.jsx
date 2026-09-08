// Vista stampabile del menù, aperta in una scheda a parte dal pannello Admin
// ("Esporta PDF / Stampa" in Admin.jsx) tramite `?print=1`. Non è una copia
// dell'interfaccia web (impaginazione a lista invece di card/nav), ma
// riprende lo stesso tema visivo del menù digitale — stessi colori, stessi
// caratteri, stesso logo e stesso fregio decorativo (`BranchDivider`) — così
// il documento cartaceo si riconosce subito come lo stesso locale.
//
// Il menù da stampare arriva via sessionStorage (chiave STORAGE_KEY), scritto
// da Admin.jsx subito prima di aprire questa scheda con window.open(): per
// pagine aperte così, da script, dalla stessa origine, il browser copia la
// sessionStorage del chiamante nella nuova scheda — non serve un'altra
// richiesta a Firestore, e riflette anche modifiche non ancora salvate.
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

// Il prezzo non viene mai tradotto (resta il campo italiano, es. "22,00" o
// "SU RICHIESTA"): stessa logica di ClientView.jsx per riconoscere il caso
// "su richiesta" e mostrarlo nella lingua scelta per il PDF, invece del
// testo italiano letterale.
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

  // Niente stampa automatica all'apertura: parte solo quando l'admin preme
  // "Stampa" nel toolbar qui sotto (in precedenza partiva da sola non
  // appena le immagini finivano di caricare — oltre a essere indesiderata,
  // in sviluppo con React StrictMode l'effetto poteva rieseguirsi due volte
  // al montaggio e aprire due finestre di stampa in sequenza).
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

// Foglio di stile della vista stampabile. A schermo simula un foglio A4 su
// un tavolo di lettura neutro (per controllare l'impaginazione prima di
// stampare); in stampa il tavolo di sfondo e l'ombra spariscono, resta solo
// il foglio. Colori, caratteri e fregio decorativo sono quelli del tema del
// locale (stessi di ClientView.jsx) — non una tavolozza neutra fissa: se
// l'admin stampa col tema scuro "Notte di Cirò", il foglio segue quel tema.
// `print-color-adjust: exact` chiede al browser di stampare comunque i
// colori di sfondo invece di scartarli per risparmiare inchiostro (dipende
// comunque dall'opzione "Grafica di sfondo" nella finestra di stampa, che
// resta una scelta dell'utente, non forzabile da CSS).
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

      /* Di default una categoria PUÒ continuare su una nuova pagina se non
         entra tutta in quella corrente: le voci che entrano restano dov'erano
         (niente spazio bianco lasciato apposta), solo le rimanenti
         proseguono nella pagina dopo. Ogni singola voce (.mdp-print-item)
         resta comunque intera, non si spezza mai a metà. L'opzione "Non
         spezzare una categoria tra due pagine" in Admin applica invece
         .mdp-print-cat-avoid-split, che torna al comportamento opposto
         (l'intera categoria salta a una nuova pagina, lasciando eventuale
         spazio vuoto in quella precedente). */
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
