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

/* ============================== DEFAULT MENU DATA ============================== */
export const DEFAULT_MENU = {
  restaurantName: "Masseria della Piana",
  tagline: "Sapori autentici dalla nostra terra alla vostra tavola",
  location: "Candidoni (RC) · Calabria",
  footerNote: "Fattoria della Piana",
  theme: "rustica",
  reviewLinks: {
    google: { url: "https://search.google.com/local/writereview?placeid=ChIJ2fN-wtETFRMR6-lHkqwbrD0", visible: true },
    tripadvisor: { url: "https://www.tripadvisor.it/Restaurant_Review-g2282898-d4770660-Reviews-Masseria_della_Piana-Rosarno_Province_of_Reggio_Calabria_Calabria.html", visible: true },
  },
  socialLinks: {
    instagram: { url: "", visible: false },
    facebook: { url: "", visible: false },
    shop: { url: "", visible: false },
  },
  categories: [
    {
      id: "cat-menu", name: "I Nostri Menù", subtitle: "Le nostre combinazioni", visible: true,
      items: [
        { id: "i1", name: "Antipasto completo + Primo del giorno + Grigliata mista", price: "22,00", description: "", image: "", visible: true },
        { id: "i2", name: "Antipasto completo + Primo del giorno", price: "16,00", description: "", image: "", visible: true },
        { id: "i3", name: "Antipasto + Grigliata", price: "20,00", description: "", image: "", visible: true },
      ],
    },
    {
      id: "cat-baby", name: "Menù Baby", subtitle: "Per i più piccoli", visible: true,
      items: [
        { id: "i4", name: "Menu baby completo", price: "12,00", description: "Antipasto freddo, penne al pomodoro, cotoletta di pollo e patatine fritte.", image: "", visible: true },
        { id: "i5", name: "Penne al pomodoro", price: "5,00", description: "", image: "", visible: true },
        { id: "i6", name: "Cotolette di pollo e patatine fritte", price: "8,00", description: "", image: "", visible: true },
      ],
    },
    {
      id: "cat-antipasti", name: "Antipasti", subtitle: "Piatti di apertura", visible: true,
      items: [
        { id: "i7", name: "Antipasto completo", price: "12,00", description: "", image: "", visible: true },
        { id: "i8", name: "Antipasto freddo", price: "8,00", description: "", image: "", visible: true },
        { id: "i9", name: "Tagliere di formaggi Riserva", price: "8,00", description: "", image: "", visible: true },
      ],
    },
    {
      id: "cat-primi", name: "Primi", subtitle: "Dalla nostra cucina", visible: true,
      items: [
        { id: "i10", name: "Paccheri alla Norma", price: "6,00", description: "Paccheri freschi con sugo di pomodoro, melanzane fritte a cubetti e ricotta salata affumicata.", image: "", visible: true },
      ],
    },
    {
      id: "cat-secondi", name: "Secondi", subtitle: "Le nostre carni", visible: true,
      items: [
        { id: "i11", name: "Grigliata mista", price: "8,00", description: "Il secondo ideale per chi vuole assaporare un po' di tutto. Una ricca selezione delle nostre carni, per gustare in un unico piatto i sapori genuini e autentici che caratterizzano la nostra cucina.", image: "", visible: true },
        { id: "i12", name: "Tagliata (280 gr. ca)", price: "18,00", description: "", image: "", visible: true },
        { id: "i13", name: "Fettina di scottona grigliata", price: "10,00", description: "", image: "", visible: true },
        { id: "i14", name: "Costoletta di maiale grigliata", price: "8,00", description: "", image: "", visible: true },
      ],
    },
    {
      id: "cat-contorni", name: "Contorni", subtitle: "Accompagnamenti", visible: true,
      items: [
        { id: "i15", name: "Patatine fritte", price: "3,00", description: "", image: "", visible: true },
        { id: "i16", name: "Insalata verde", price: "3,00", description: "", image: "", visible: true },
        { id: "i17", name: "Patate al forno", price: "3,50", description: "", image: "", visible: true },
      ],
    },
    {
      id: "cat-prenotazione", name: "Su Prenotazione", subtitle: "Preparati con anticipo, per garantire freschezza e cura nella lavorazione, nel rispetto della tradizione.", visible: true,
      items: [
        { id: "i18", name: "Costata (per 2 persone)", price: "38,00", description: "Costata ottenuta da bovini allevati direttamente nella nostra azienda, sottoposta a un'attenta frollatura per esaltarne tenerezza, succosità e profondità aromatica. Cotta alla griglia, regala un gusto intenso e autentico.", image: "", visible: true },
        { id: "i19", name: "Stinco di Suino al forno", price: "12,00", description: "Un grande classico della tradizione: stinco di maiale marinato e cotto lentamente al forno, servito con la sua crosta dorata e una carne che si scioglie in bocca.", image: "", visible: true },
        { id: "i20", name: "Agnello al forno con patate", price: "SU RICHIESTA", description: "", image: "", visible: true },
        { id: "i21", name: "Arrosticini di agnello", price: "10,00", description: "", image: "", visible: true },
      ],
    },
    {
      id: "cat-bibite", name: "Bibite e Birre", subtitle: "Selezione di bevande", visible: true,
      items: [
        { id: "i22", name: "Cinzano Bitter Soda", price: "4,00", description: "Aperitivo monodose a bassa gradazione. Dal colore rosso brillante, con bollicine frizzanti e l'inconfondibile sapore amarognolo.", image: "", visible: true },
        { id: "i23", name: "Acqua Minerale 75cl", price: "2,00", description: "Naturale o Frizzante.", image: "", visible: true },
        { id: "i24", name: "Coca-Cola", price: "2,00", description: "", image: "", visible: true },
        { id: "i25", name: "Coca-Cola Zero", price: "2,00", description: "", image: "", visible: true },
        { id: "i26", name: "Coca-Cola 1,5L", price: "4,00", description: "", image: "", visible: true },
        { id: "i27", name: "Fanta", price: "2,00", description: "", image: "", visible: true },
        { id: "i28", name: "Chinotto", price: "2,00", description: "", image: "", visible: true },
        { id: "i29", name: "Sprite", price: "2,00", description: "", image: "", visible: true },
        { id: "i30", name: "Birra Paulaner alla spina media (50cl)", price: "5,00", description: "Bionda bavarese, gusto pieno e aromatico con equilibrio tra malto e luppolo. Gustala in boccale ghiacciato, come piace a noi!", image: "", visible: true },
        { id: "i31", name: "Birra Paulaner alla spina piccola (30cl)", price: "3,00", description: "Bionda bavarese, gusto pieno e aromatico con equilibrio tra malto e luppolo. Gustala in boccale ghiacciato, come piace a noi!", image: "", visible: true },
      ],
    },
    {
      id: "cat-bollicine", name: "Bollicine", subtitle: "Spumanti", visible: true,
      items: [
        { id: "i32", name: "Almaneti, Brut metodo classico — Librandi", price: "22,00", description: "Spumante metodo classico da uve Chardonnay. Il nome significa \u201canima del Neto\u201d e rappresenta l'essenza delle zone fresche dell'omonima valle.", image: "", visible: true },
      ],
    },
    {
      id: "cat-vini", name: "Carta dei Vini", subtitle: "I Rossi, Rosati e Bianchi", visible: true,
      items: [
        { id: "i33", name: "Caloanda IGT — Librandi", price: "15,00", tag: "ROSSO", description: "Ricco, fruttato, avvolgente. Magliocco e Merlot in un'interpretazione moderna, morbido e dal tannino delicato. Ideale con antipasti rustici, salumi, formaggi e carni alla griglia.", image: "", visible: true },
        { id: "i34", name: "Gaglioppo IGT — Statti", price: "15,00", tag: "ROSSO", description: "100% Gaglioppo, di rara eleganza e piacevolezza. Perfetto con primi piatti importanti, carni arrosto e di cavallo.", image: "", visible: true },
        { id: "i35", name: "Gravello IGT — Librandi", price: "25,00", tag: "ROSSO", description: "Uvaggio di Gaglioppo e Cabernet Sauvignon. Elegante e strutturato, ideale con carni rosse, selvaggina e formaggi stagionati.", image: "", visible: true },
        { id: "i36", name: "Duca Sanfelice Cirò DOC Riserva", price: "25,00", tag: "ROSSO", description: "Il miglior Gaglioppo di cantina Librandi, da vecchie viti ad alberello. Strutturato e persistente, note speziate e tannini eleganti.", image: "", visible: true },
        { id: "i37", name: "Terre Lontane IGT — Librandi", price: "15,00", tag: "ROSATO", description: "Gaglioppo e Cabernet Franc: rosato delicato, vellutato e fruttato. Ideale con antipasti rustici, formaggi freschi, verdure e carni bianche.", image: "", visible: true },
        { id: "i38", name: "Critone Cirò Bianco IGT — Librandi", price: "15,00", tag: "BIANCO", description: "Chardonnay e Sauvignon Blanc: fresco e sapido, profondo e persistente. Ideale con antipasti, formaggi freschi, verdure e carni bianche.", image: "", visible: true },
        { id: "i39", name: "Greco IGT — Statti", price: "25,00", tag: "BIANCO", description: "Bianco di struttura, freschezza vibrante e marcata mineralità. Si abbina ad antipasti della tradizione, formaggi e carni bianche alla griglia.", image: "", visible: true },
        { id: "i40", name: "Vino della casa (Rosso o Bianco) 1L", price: "6,00", description: "", image: "", visible: true },
        { id: "i41", name: "Vino della casa (Rosso o Bianco) 0,5L", price: "4,00", description: "", image: "", visible: true },
        { id: "i42", name: "Vino della casa (Rosso o Bianco) 0,25L", price: "3,00", description: "", image: "", visible: true },
      ],
    },
    {
      id: "cat-digestivi", name: "Digestivi", subtitle: "Per la digestione", visible: true,
      items: [
        { id: "i43", name: "Vecchio Amaro del Capo", price: "2,00", description: "Ventinove tra erbe, fiori, frutti e radici. Colore scuro, gusto dolce, leggermente mandorlato, con retrogusto aromatico.", image: "", visible: true },
        { id: "i44", name: "Kaciuto", price: "2,00", description: "Amaro digestivo calabrese di Bova Marina: infuso di erbe, alloro, liquirizia e finocchietto selvatico.", image: "", visible: true },
        { id: "i45", name: "Kephas", price: "2,00", description: "Liquore digestivo artigianale dell'area grecanica: alloro, finocchietto selvatico e liquirizia.", image: "", visible: true },
        { id: "i46", name: "Limoncello", price: "2,00", description: "", image: "", visible: true },
        { id: "i47", name: "Finocchietto", price: "2,00", description: "Liquore naturale e artigianale Caffo, infusione di semi di finocchietto selvatico.", image: "", visible: true },
        { id: "i48", name: "Vecchia Grappa Caffo", price: "2,00", description: "", image: "", visible: true },
        { id: "i49", name: "Grappa Bianca Caffo", price: "2,00", description: "", image: "", visible: true },
      ],
    },
    {
      id: "cat-dolci", name: "Dolci & Gelati", subtitle: "Tartufi e freschezza", visible: true,
      items: [
        { id: "i50", name: "Sorbetto al limone", price: "5,00", description: "", image: "", visible: true },
        { id: "i51", name: "Gelato al cocco", price: "5,00", description: "", image: "", visible: true },
        { id: "i52", name: "Il Tartufo classico", price: "5,00", description: "Dalla tradizione di Pizzo: cioccolato e nocciola con goccia morbida, ricoperto di cacao amaro e zucchero.", image: "", visible: true },
        { id: "i53", name: "Tartufo al pistacchio", price: "7,00", description: "Gelato al pistacchio di Sicilia, cuore morbido di cioccolato fondente, granella di pistacchi.", image: "", visible: true },
        { id: "i54", name: "Tartufo Cioccolato Bianco", price: "5,00", description: "Gelato al caffè e crema fior di latte, cuore morbido di caffè fuso, granella all'amaretto.", image: "", visible: true },
        { id: "i55", name: "Gelato al Tiramisù", price: "4,00", description: "", image: "", visible: true },
        { id: "i56", name: "Ghiacciolo", price: "2,00", description: "", image: "", visible: true },
        { id: "i57", name: "Cremino", price: "2,00", description: "", image: "", visible: true },
        { id: "i58", name: "Il Duetto", price: "3,00", description: "", image: "", visible: true },
      ],
    },
  ],
};

// Il documento Firestore che contiene l'intero menù.
export const MENU_DOC_PATH = ["menu", "data"];

export const uid = () => Math.random().toString(36).slice(2, 10);

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
  it: { onRequest: "Su richiesta", manageMenu: "Gestione menù", translating: "Traduzione in corso…", reviewGoogle: "Lascia una recensione su Google", reviewTripadvisor: "Lascia una recensione su TripAdvisor", linkInstagram: "Seguici su Instagram", linkFacebook: "Seguici su Facebook", linkShop: "Vai al nostro shop online", closeZoom: "Chiudi" },
  en: { onRequest: "On request", manageMenu: "Menu management", translating: "Translating…", reviewGoogle: "Leave a review on Google", reviewTripadvisor: "Leave a review on TripAdvisor", linkInstagram: "Follow us on Instagram", linkFacebook: "Follow us on Facebook", linkShop: "Visit our online shop", closeZoom: "Close" },
  es: { onRequest: "Bajo pedido", manageMenu: "Gestión del menú", translating: "Traduciendo…", reviewGoogle: "Deja una reseña en Google", reviewTripadvisor: "Deja una reseña en TripAdvisor", linkInstagram: "Síguenos en Instagram", linkFacebook: "Síguenos en Facebook", linkShop: "Visita nuestra tienda online", closeZoom: "Cerrar" },
  de: { onRequest: "Auf Anfrage", manageMenu: "Menüverwaltung", translating: "Wird übersetzt…", reviewGoogle: "Bewertung auf Google hinterlassen", reviewTripadvisor: "Bewertung auf TripAdvisor hinterlassen", linkInstagram: "Folge uns auf Instagram", linkFacebook: "Folge uns auf Facebook", linkShop: "Besuche unseren Online-Shop", closeZoom: "Schließen" },
  fr: { onRequest: "Sur demande", manageMenu: "Gestion du menu", translating: "Traduction en cours…", reviewGoogle: "Laisser un avis sur Google", reviewTripadvisor: "Laisser un avis sur TripAdvisor", linkInstagram: "Suivez-nous sur Instagram", linkFacebook: "Suivez-nous sur Facebook", linkShop: "Visitez notre boutique en ligne", closeZoom: "Fermer" },
};

const TRANSLATION_CACHE_KEY = "mdp-translation-cache-v1";
export const TRANSLATION_LANG_KEY = "mdp-lang";

export function loadTranslationCache() {
  try {
    const raw = localStorage.getItem(TRANSLATION_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveTranslationCache(cache) {
  try {
    localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage pieno o non disponibile: pazienza, si ritraduce alla prossima visita.
  }
}

// Traduce un singolo testo con MyMemory (API pubblica e gratuita, nessuna chiave richiesta),
// usando una cache locale per non richiamarla due volte per lo stesso testo/lingua.
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

// Traduce l'intero oggetto menù (nomi, sottotitoli, descrizioni, tag) in una lingua.
// I prezzi non vengono mai tradotti: restano numeri, oppure "SU RICHIESTA" che viene
// visualizzato tramite UI_STRINGS in base alla lingua scelta.
export async function translateMenu(menu, lang, cache) {
  if (lang === "it") return menu;

  const fields = [menu.restaurantName, menu.tagline, menu.footerNote];
  menu.categories.forEach((cat) => {
    fields.push(cat.name, cat.subtitle);
    cat.items.forEach((item) => {
      fields.push(item.name, item.description || "", item.tag || "");
    });
  });

  const translated = await translateBatch(fields, lang, cache);

  let idx = 0;
  const next = { ...menu };
  next.restaurantName = translated[idx++];
  next.tagline = translated[idx++];
  next.footerNote = translated[idx++];
  next.categories = menu.categories.map((cat) => {
    const name = translated[idx++];
    const subtitle = translated[idx++];
    const items = cat.items.map((item) => {
      const iname = translated[idx++];
      const idesc = translated[idx++];
      const itag = translated[idx++];
      return { ...item, name: iname, description: idesc, tag: itag };
    });
    return { ...cat, name, subtitle, items };
  });
  return next;
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
      .mdp-row { transition: background .2s ease; }
      .mdp-row:hover { background: ${t.bgAlt}; }
      .mdp-btn { transition: transform .15s ease, opacity .15s ease; }
      .mdp-btn:active { transform: scale(0.97); }
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
