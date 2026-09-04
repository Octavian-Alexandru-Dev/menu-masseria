// Pezzi condivisi tra il sito pubblico (ClientView) e il pannello di gestione (Admin):
// temi grafici, dati di default del menù, utility di traduzione automatica, piccoli
// componenti decorativi. Nessun import di Firebase qui: restano fuori dal bundle pubblico.
import React from "react";

/* ============================== THEME PRESETS ============================== */
export const THEMES = {
  rustica: {
    name: "Calabria Rustica",
    bg: "#F2E9D4", bgAlt: "#E8D9B7", card: "#FBF6E9",
    ink: "#2B2115", inkSoft: "#5B4A34",
    primary: "#6E2A2A", secondary: "#4B5A38", accent: "#C79A3E", accent2: "#B5602F",
    line: "rgba(43,33,21,0.18)",
    fontDisplay: "'Fraunces', serif", fontBody: "'Work Sans', sans-serif", italic: true,
  },
  ciro: {
    name: "Notte di Cirò",
    bg: "#221A17", bgAlt: "#2C221D", card: "#2A211C",
    ink: "#F2E9D4", inkSoft: "#D8C6A0",
    primary: "#D9B26B", secondary: "#C77B5B", accent: "#D9B26B", accent2: "#8C3B3B",
    line: "rgba(242,233,212,0.18)",
    fontDisplay: "'Fraunces', serif", fontBody: "'Work Sans', sans-serif", italic: true,
  },
  uliveto: {
    name: "Uliveto",
    bg: "#F4F1E4", bgAlt: "#E7E6D2", card: "#FBFAF1",
    ink: "#2A2F1E", inkSoft: "#525A3E",
    primary: "#4B5A38", secondary: "#8C6A3F", accent: "#B5602F", accent2: "#6E2A2A",
    line: "rgba(42,47,30,0.18)",
    fontDisplay: "'Fraunces', serif", fontBody: "'Work Sans', sans-serif", italic: true,
  },
  minimal: {
    name: "Essenziale",
    bg: "#FFFFFF", bgAlt: "#F5F5F4", card: "#FFFFFF",
    ink: "#1A1A1A", inkSoft: "#6B6B6B",
    primary: "#1A1A1A", secondary: "#8A8A8A", accent: "#B5602F", accent2: "#8A8A8A",
    line: "rgba(0,0,0,0.12)",
    fontDisplay: "'Roboto', sans-serif", fontBody: "'Roboto', sans-serif", italic: false,
  },
};

// True for themes with an italic display font (Fraunces); false renders upright (Roboto).
export const ital = (t) => (t.italic === false ? "normal" : "italic");

/* ============================== TYPE / SPACING SCALE ==============================
   Nomi per le dimensioni di font e spaziatura già in uso in ClientView/Admin/
   PrintMenu. Ogni valore qui sotto è un pixel già usato da qualche parte oggi:
   questo raggruppa sotto un nome, non cambia nessuna dimensione visibile. */
export const TYPE = {
  micro: 9.5, tiny: 10, tinyPlus: 10.5, label: 11, labelPlus: 11.5,
  small: 12, smallPlus: 12.5, body: 13, bodyPlus: 13.5, bodyLg: 14,
  lead: 15, itemName: 16, subhead: 17, heading: 20, modalTitle: 22,
  display: 26, hero: "clamp(30px, 7vw, 52px)",
};

export const SPACE = { xxs: 4, xs: 6, sm: 8, smPlus: 10, md: 12, mdPlus: 14, lg: 16, lgPlus: 18, xl: 20, xlPlus: 22, xxl: 24 };

// Usato solo dalle schermate di caricamento/errore che compaiono PRIMA che
// menu.theme sia noto (MenuApp.jsx, Admin.jsx, PrintMenu.jsx): non possono
// usare un token di THEMES, serve un neutro leggibile su tutti e 4 gli sfondi.
export const FALLBACK_STYLE = { color: "#3A3A3A", fontFamily: "'Work Sans', sans-serif", background: "#F7F5F1" };

// Il documento Firestore che contiene l'intero menù.
export const MENU_DOC_PATH = ["menu", "data"];

export const uid = () => Math.random().toString(36).slice(2, 10);

/* ============================== COMANDE (staff) ============================== */
// Somma prezzi salvati come stringa in stile italiano ("12,50") e restituisce
// una stringa nello stesso formato — coerente con come i prezzi sono già
// salvati nel menù (mai come number).
export function parsePriceToCents(price) {
  const n = parseFloat(String(price ?? "0").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
export function formatCentsAsPrice(cents) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

// Turno di servizio corrente (pranzo/cena), determinato in automatico
// dall'orario — nessuna configurazione richiesta. Soglia fissata alle 17:00:
// prima è pranzo, da quell'ora in poi è cena. Se gli orari reali del locale
// sono diversi, questa è l'unica costante da cambiare.
const SHIFT_BOUNDARY_HOUR = 17;

export function currentShiftLabel() {
  return new Date().getHours() < SHIFT_BOUNDARY_HOUR ? "Pranzo" : "Cena";
}

// Inizio del turno in corso (oggi): mezzanotte per il pranzo, dalle 17:00
// per la cena — usato per capire quali comande chiuse fanno parte del
// turno attuale (vs. turni/giorni precedenti, già nello Storico).
export function currentShiftStart() {
  const start = new Date();
  if (start.getHours() < SHIFT_BOUNDARY_HOUR) {
    start.setHours(0, 0, 0, 0);
  } else {
    start.setHours(SHIFT_BOUNDARY_HOUR, 0, 0, 0);
  }
  return start;
}

// Identificativo di un tavolo/comanda ovunque compaia nell'interfaccia
// (elenco tavoli, dettaglio, cucina, storico): se è stato dato un nome,
// quello è l'identificativo principale e il numero passa in secondo piano;
// altrimenti il numero resta l'unico identificativo.
export function tableIdentity(order) {
  if (order.tableName) {
    return { primary: order.tableName, secondary: `Tavolo ${order.tableNumber}` };
  }
  return { primary: `Tavolo ${order.tableNumber}`, secondary: null };
}

/* ============================== LINGUE (lato clienti) ============================== */
export const LANGUAGES = [
  { code: "it", label: "IT" },
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
  { code: "de", label: "DE" },
  { code: "fr", label: "FR" },
];

// Testi fissi dell'interfaccia: tradotti a mano, non richiedono chiamate API.
export const UI_STRINGS = {
  it: { onRequest: "Su richiesta", manageMenu: "Area riservata", reviewGoogle: "Lascia una recensione su Google", reviewTripadvisor: "Lascia una recensione su TripAdvisor", linkInstagram: "Seguici su Instagram", linkFacebook: "Seguici su Facebook", linkShop: "Vai al nostro shop online", closeZoom: "Chiudi" },
  en: { onRequest: "On request", manageMenu: "Staff area", reviewGoogle: "Leave a review on Google", reviewTripadvisor: "Leave a review on TripAdvisor", linkInstagram: "Follow us on Instagram", linkFacebook: "Follow us on Facebook", linkShop: "Visit our online shop", closeZoom: "Close" },
  es: { onRequest: "Bajo pedido", manageMenu: "Área reservada", reviewGoogle: "Deja una reseña en Google", reviewTripadvisor: "Deja una reseña en TripAdvisor", linkInstagram: "Síguenos en Instagram", linkFacebook: "Síguenos en Facebook", linkShop: "Visita nuestra tienda online", closeZoom: "Cerrar" },
  de: { onRequest: "Auf Anfrage", manageMenu: "Mitarbeiterbereich", reviewGoogle: "Bewertung auf Google hinterlassen", reviewTripadvisor: "Bewertung auf TripAdvisor hinterlassen", linkInstagram: "Folge uns auf Instagram", linkFacebook: "Folge uns auf Facebook", linkShop: "Besuche unseren Online-Shop", closeZoom: "Schließen" },
  fr: { onRequest: "Sur demande", manageMenu: "Espace réservé", reviewGoogle: "Laisser un avis sur Google", reviewTripadvisor: "Laisser un avis sur TripAdvisor", linkInstagram: "Suivez-nous sur Instagram", linkFacebook: "Suivez-nous sur Facebook", linkShop: "Visitez notre boutique en ligne", closeZoom: "Fermer" },
};

export const TRANSLATION_LANG_KEY = "mdp-lang";

// Traduce un singolo testo con MyMemory (API pubblica e gratuita, nessuna chiave richiesta),
// usando una cache di sola durata della chiamata per non richiamarla due volte per lo
// stesso testo nello stesso batch di generazione.
async function translateText(text, lang, cache) {
  if (!text || !text.trim() || lang === "it") return text || "";
  const key = lang + "|" + text;
  if (cache[key]) return cache[key];
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=it|${lang}`
    );
    const data = await res.json();
    const translated = data && data.responseData && data.responseData.translatedText;
    if (translated && data.responseStatus === 200) {
      cache[key] = translated;
      return translated;
    }
  } catch (e) {
    // Nessuna connessione o servizio non raggiungibile: si ricade sul testo italiano.
  }
  return text;
}

// Traduce più testi con concorrenza limitata, per non sovraccaricare l'API gratuita.
async function translateBatch(texts, lang, cache, concurrency = 4) {
  const results = new Array(texts.length);
  let i = 0;
  async function worker() {
    while (i < texts.length) {
      const idx = i++;
      results[idx] = await translateText(texts[idx], lang, cache);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// Costruisce, a partire dal menù sorgente (italiano) e da una traduzione parziale
// già salvata, l'elenco dei soli campi ancora mancanti per una lingua ("jobs", con
// una funzione "apply" per scrivere il risultato nella bozza) più la bozza stessa
// (che contiene già intatto tutto ciò che era stato tradotto/corretto in precedenza).
// Usata sia per generare le traduzioni mancanti, sia per mostrare all'admin quante
// voci restano da tradurre.
function collectMissingTranslations(menu, translation) {
  const existing = translation || {};
  const jobs = [];
  const draft = {
    restaurantName: existing.restaurantName,
    tagline: existing.tagline,
    footerNote: existing.footerNote,
    categories: {},
  };

  // Un campo mai tradotto (currentValue === undefined) o riceve un job di
  // traduzione (se c'è del testo sorgente da tradurre), oppure viene
  // riempito subito con "" (se il sorgente è vuoto, es. descrizione non
  // compilata) — non deve MAI restare undefined: Firestore rifiuta interi
  // documenti che contengono un undefined annidato, quindi lasciarlo tale
  // farebbe fallire ogni salvataggio successivo alla generazione.
  const track = (sourceText, currentValue, apply) => {
    if (currentValue !== undefined) return;
    if (sourceText && sourceText.trim()) {
      jobs.push({ text: sourceText, apply });
    } else {
      apply("");
    }
  };

  track(menu.restaurantName, draft.restaurantName, (v) => { draft.restaurantName = v; });
  track(menu.tagline, draft.tagline, (v) => { draft.tagline = v; });
  track(menu.footerNote, draft.footerNote, (v) => { draft.footerNote = v; });

  menu.categories.forEach((cat) => {
    const existingCat = existing.categories?.[cat.id] || {};
    const draftCat = { name: existingCat.name, subtitle: existingCat.subtitle, items: {} };
    track(cat.name, draftCat.name, (v) => { draftCat.name = v; });
    track(cat.subtitle, draftCat.subtitle, (v) => { draftCat.subtitle = v; });

    cat.items.forEach((item) => {
      const existingItem = existingCat.items?.[item.id] || {};
      const draftItem = { name: existingItem.name, description: existingItem.description, tag: existingItem.tag };
      track(item.name, draftItem.name, (v) => { draftItem.name = v; });
      track(item.description || "", draftItem.description, (v) => { draftItem.description = v; });
      track(item.tag || "", draftItem.tag, (v) => { draftItem.tag = v; });
      draftCat.items[item.id] = draftItem;
    });

    draft.categories[cat.id] = draftCat;
  });

  return { draft, jobs };
}

// Quante voci restano da tradurre per una lingua (0 = traduzione completa).
export function countMissingTranslations(menu, translation) {
  return collectMissingTranslations(menu, translation).jobs.length;
}

// Genera (via MyMemory) solo le traduzioni mancanti per una lingua, senza mai
// toccare un campo già tradotto/corretto a mano dall'admin. Va chiamata esplicitamente
// dal pannello Admin (mai lato cliente): il risultato è pensato per essere rivisto
// dall'admin e poi salvato dentro `menu.translations[lang]`.
export async function generateMissingTranslations(menu, lang, translation) {
  const { draft, jobs } = collectMissingTranslations(menu, translation);
  if (lang === "it" || jobs.length === 0) return draft;
  const cache = {};
  const translated = await translateBatch(jobs.map((j) => j.text), lang, cache);
  jobs.forEach((job, i) => job.apply(translated[i]));
  return draft;
}

// Sovrappone al menù sorgente (italiano) la traduzione salvata per una lingua,
// ricadendo sul testo italiano campo per campo dove manca (voce non ancora
// tradotta, o lingua senza alcuna traduzione generata). Pura e sincrona: nessuna
// chiamata di rete — il cliente sceglie solo quale testo, già scaricato insieme
// al resto del menù, visualizzare.
export function applyTranslation(menu, translation) {
  if (!translation) return menu;
  return {
    ...menu,
    restaurantName: translation.restaurantName ?? menu.restaurantName,
    tagline: translation.tagline ?? menu.tagline,
    footerNote: translation.footerNote ?? menu.footerNote,
    categories: menu.categories.map((cat) => {
      const tc = translation.categories?.[cat.id];
      return {
        ...cat,
        name: tc?.name ?? cat.name,
        subtitle: tc?.subtitle ?? cat.subtitle,
        items: cat.items.map((item) => {
          const ti = tc?.items?.[item.id];
          return {
            ...item,
            name: ti?.name ?? item.name,
            description: ti?.description ?? item.description,
            tag: ti?.tag ?? item.tag,
          };
        }),
      };
    }),
  };
}

// Logo caricato dall'utente (Fattoria della Piana), incorporato come immagine.

/* ============================== GLOBAL STYLE ============================== */
export function GlobalStyle({ t }) {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,600&family=Work+Sans:wght@300;400;500;600&family=Roboto:ital,wght@0,300;0,400;0,500;0,700;1,400&display=swap');
      * { box-sizing: border-box; }
      .mdp-root {
        background: ${t.bg};
        color: ${t.ink};
        font-family: ${t.fontBody};
        min-height: 100vh;
        transition: background .4s ease, color .4s ease;
      }
      .mdp-display { font-family: ${t.fontDisplay}; }
      .mdp-hairline { border: none; border-top: 1px solid ${t.line}; }
      .mdp-scrollbar::-webkit-scrollbar { height: 6px; }
      .mdp-scrollbar::-webkit-scrollbar-thumb { background: ${t.line}; border-radius: 3px; }
      .mdp-tab { transition: color .2s ease, border-color .2s ease; white-space: nowrap; }
      .mdp-tab:hover { color: ${t.primary}; }
      .mdp-row { transition: background .2s ease; }
      .mdp-row:hover { background: ${t.bgAlt}; }
      .mdp-btn { transition: transform .15s ease, filter .15s ease; }
      .mdp-btn:hover:not(:disabled) { filter: brightness(1.08); }
      .mdp-btn:active:not(:disabled) { transform: scale(0.97); filter: brightness(0.94); }
      .mdp-btn:disabled { opacity: 0.5; cursor: not-allowed; filter: none; }
      .mdp-btn:focus-visible, .mdp-tab:focus-visible, .mdp-row:focus-visible,
      input:focus-visible, textarea:focus-visible, select:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px ${t.bg}, 0 0 0 4px ${t.accent};
      }
      .mdp-toggle:focus-within { box-shadow: 0 0 0 2px ${t.bg}, 0 0 0 4px ${t.accent}; border-radius: 22px; }
      .mdp-fade-in { animation: mdpFade .5s ease both; }
      @keyframes mdpFade { from { opacity:0; transform: translateY(6px);} to {opacity:1; transform:none;} }
      .mdp-modal-backdrop { animation: mdpBackdropIn .2s ease both; }
      .mdp-modal-card { animation: mdpModalIn .25s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes mdpBackdropIn { from { opacity:0; } to { opacity:1; } }
      @keyframes mdpModalIn { from { opacity:0; transform: scale(.94) translateY(8px); } to { opacity:1; transform:none; } }
      @media (prefers-reduced-motion: reduce) {
        .mdp-fade-in, .mdp-modal-backdrop, .mdp-modal-card { animation: none; }
      }
      input, textarea, select {
        font-family: ${t.fontBody};
      }
    `}</style>
  );
}

/* ============================== DECORATIVE SVGs ============================== */
export function BranchDivider({ color }) {
  return (
    <svg width="180" height="18" viewBox="0 0 180 18" fill="none" style={{ display: "block" }}>
      <path d="M2 9 H178" stroke={color} strokeWidth="1" opacity="0.55" />
      <path d="M90 9 C 84 2, 74 2, 70 9 C 74 16, 84 16, 90 9 Z" fill={color} opacity="0.9" />
      <circle cx="60" cy="9" r="2" fill={color} opacity="0.7" />
      <circle cx="120" cy="9" r="2" fill={color} opacity="0.7" />
    </svg>
  );
}

// Il logo è un file immagine leggero e separato (public/logo.webp + fallback
// public/logo.jpg), NON più incorporato come testo nel codice: si scarica
// una sola volta e resta in cache nel browser del cliente, invece di
// appesantire ogni caricamento della pagina.
export function Logo({ width = 160 }) {
  return (
    <picture>
      <source srcSet="/logo.webp" type="image/webp" />
      <img
        src="/logo.jpg"
        alt="Fattoria della Piana"
        width={width}
        loading="eager"
        style={{ width, height: "auto", display: "block", margin: "0 auto" }}
      />
    </picture>
  );
}

export function WaxSeal({ t, size = 96 }) {
  const initials = "MdP";
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="47" fill={t.primary} />
      <circle cx="50" cy="50" r="47" fill="none" stroke={t.accent} strokeWidth="1.5" opacity="0.6" />
      <circle cx="50" cy="50" r="39" fill="none" stroke={t.accent} strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
      <text x="50" y="58" textAnchor="middle" fontFamily="Fraunces, serif" fontStyle="italic" fontSize="30" fill={t.bg}>{initials}</text>
    </svg>
  );
}

/* ============================== CLIENT (PUBLIC) VIEW ============================== */
