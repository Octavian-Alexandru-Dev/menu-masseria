// Pieces shared between the public site (ClientView) and the management
// panel (Admin): visual themes, default menu data, auto-translation
// utilities, small decorative components. No Firebase import here: they
// stay out of the public bundle.
import React, { useState, useEffect, useCallback, useRef } from "react";

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
   Names for the font size / spacing values already in use in ClientView/Admin/
   PrintMenu. Every value below is a pixel value already used somewhere today:
   this just groups them under a name, it doesn't change any visible size. */
export const TYPE = {
  micro: 9.5, tiny: 10, tinyPlus: 10.5, label: 11, labelPlus: 11.5,
  small: 12, smallPlus: 12.5, body: 13, bodyPlus: 13.5, bodyLg: 14,
  lead: 15, itemName: 16, subhead: 17, heading: 20, modalTitle: 22,
  display: 26, hero: "clamp(30px, 7vw, 52px)",
};

export const SPACE = { xxs: 4, xs: 6, sm: 8, smPlus: 10, md: 12, mdPlus: 14, lg: 16, lgPlus: 18, xl: 20, xlPlus: 22, xxl: 24 };

// Only used by the loading/error screens that appear BEFORE menu.theme is
// known (MenuApp.jsx, Admin.jsx, PrintMenu.jsx): they can't use a THEMES
// token, they need a neutral color readable on all 4 backgrounds.
export const FALLBACK_STYLE = { color: "#3A3A3A", fontFamily: "'Work Sans', sans-serif", background: "#F7F5F1" };

// The Firestore document holding the entire menu.
export const MENU_DOC_PATH = ["menu", "data"];

export const uid = () => Math.random().toString(36).slice(2, 10);

/* ============================== DISH SEARCH ============================== */
// Case/accent-insensitive comparison ("crema di pomodoro" matches "Crémá"),
// used both by the customer menu and by the waiter's order-taking screen.
function normalizeSearch(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
// Searches for a dish by name/description in ANY language the menu has been
// translated into, not just the one currently shown on screen: a waiter
// working on the Italian menu can type "steak" and still find "Costata" if
// the English translation exists, useful with foreign customers asking for
// a dish by its name in their own language. Searches by id (stable across
// languages), not by the text currently displayed.
function candidateMatches(candidate, q) {
  return !!candidate && (normalizeSearch(candidate.name).includes(q) || normalizeSearch(candidate.description).includes(q));
}
export function itemMatchesSearch(menu, categoryId, itemId, query) {
  const q = normalizeSearch(query);
  if (!q) return true;
  const rawCategory = menu?.categories?.find((c) => c.id === categoryId);
  const rawItem = rawCategory?.items?.find((i) => i.id === itemId);
  if (candidateMatches(rawItem, q)) return true;
  const translations = menu?.translations || {};
  return Object.values(translations).some((t) => candidateMatches(t?.categories?.[categoryId]?.items?.[itemId], q));
}

/* ============================== NAVIGATION (browser history) ============================== */
// Syncs a piece of state with a query string parameter, so the main screens
// (public menu / restricted area / chosen section) stay reachable from the
// URL and navigable with the browser's Back button — without introducing a
// router: every change pushes a history entry (unless { replace: true } is
// passed), and a "popstate" listener realigns the state when the user goes
// forward/back.
export function useUrlState(paramName, defaultValue) {
  const readValue = () => {
    if (typeof window === "undefined") return defaultValue;
    const params = new URLSearchParams(window.location.search);
    return params.has(paramName) ? params.get(paramName) : defaultValue;
  };

  const [value, setValue] = useState(readValue);
  // Mirrors `value` so it can be read in setUrlValue without going through
  // the functional form of setState (see below): the ref update is
  // synchronous, the state one isn't.
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  useEffect(() => {
    const onPopState = () => setValue(readValue());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The side effect (history.pushState/replaceState) lives in the body of
  // this callback, NEVER inside the functional form of setState: in
  // React.StrictMode (main.jsx) a functional updater passed to setState is
  // invoked twice in development to check its purity, which was silently
  // doubling every pushState (one click → two history entries, the
  // browser's Back button broken: it took two Backs to undo a single
  // in-app navigation).
  const setUrlValue = useCallback((next, { replace = false } = {}) => {
    const prev = valueRef.current;
    const resolved = typeof next === "function" ? next(prev) : next;
    if (typeof window !== "undefined" && resolved !== prev) {
      const url = new URL(window.location.href);
      if (resolved === defaultValue || resolved == null) {
        url.searchParams.delete(paramName);
      } else {
        url.searchParams.set(paramName, resolved);
      }
      window.history[replace ? "replaceState" : "pushState"](null, "", url);
    }
    valueRef.current = resolved;
    setValue(resolved);
  }, [paramName, defaultValue]);

  return [value, setUrlValue];
}

/* ============================== ORDERS (staff) ============================== */
// Sums prices stored as Italian-style strings ("12,50") and returns a
// string in the same format — consistent with how prices are already
// stored in the menu (never as a number).
export function parsePriceToCents(price) {
  const n = parseFloat(String(price ?? "0").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
export function formatCentsAsPrice(cents) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

// For chart axis labels (Stats.jsx): raw integer values in cents (e.g.
// 125000) read directly as ticks would be misleading compared to the
// actual euro amount shown in the tooltip — this formats them compactly
// ("€ 1,2 mila") so the axis stays readable even with large amounts,
// without formatCentsAsPrice's decimals (unnecessary on an axis with few
// ticks).
const compactEuroFormatter = new Intl.NumberFormat("it-IT", { notation: "compact", maximumFractionDigits: 1 });
export function formatCentsCompact(cents) {
  return `€ ${compactEuroFormatter.format(cents / 100)}`;
}

// Current service shift (lunch/dinner), determined automatically from the
// time of day — no configuration needed. Threshold fixed at 17:00: before
// that it's lunch, from then on it's dinner. If the restaurant's actual
// hours differ, this is the only constant to change.
const SHIFT_BOUNDARY_HOUR = 17;

export function currentShiftLabel() {
  return new Date().getHours() < SHIFT_BOUNDARY_HOUR ? "Pranzo" : "Cena";
}

// Start of the current shift (today): midnight for lunch, 17:00 for dinner
// — used to figure out which closed orders belong to the current shift (vs.
// previous shifts/days, already in the History).
export function currentShiftStart() {
  const start = new Date();
  if (start.getHours() < SHIFT_BOUNDARY_HOUR) {
    start.setHours(0, 0, 0, 0);
  } else {
    start.setHours(SHIFT_BOUNDARY_HOUR, 0, 0, 0);
  }
  return start;
}

// A table/order's identity wherever it appears in the UI (table list,
// detail, kitchen, history): if a name was given, that's the primary
// identity and the number becomes secondary; otherwise the number stays
// the only identity.
export function tableIdentity(order) {
  if (order.tableName) {
    return { primary: order.tableName, secondary: `Tavolo ${order.tableNumber}` };
  }
  return { primary: `Tavolo ${order.tableNumber}`, secondary: null };
}

/* ============================== LANGUAGES (customer side) ============================== */
export const LANGUAGES = [
  { code: "it", label: "IT" },
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
  { code: "de", label: "DE" },
  { code: "fr", label: "FR" },
];

// Fixed UI text: translated by hand, no API calls needed.
export const UI_STRINGS = {
  it: { onRequest: "Su richiesta", manageMenu: "Area riservata", reviewGoogle: "Lascia una recensione su Google", reviewTripadvisor: "Lascia una recensione su TripAdvisor", linkInstagram: "Seguici su Instagram", linkFacebook: "Seguici su Facebook", linkShop: "Vai al nostro shop online", closeZoom: "Chiudi", searchPlaceholder: "Cerca un piatto…", searchNoResults: "Nessun piatto trovato." },
  en: { onRequest: "On request", manageMenu: "Staff area", reviewGoogle: "Leave a review on Google", reviewTripadvisor: "Leave a review on TripAdvisor", linkInstagram: "Follow us on Instagram", linkFacebook: "Follow us on Facebook", linkShop: "Visit our online shop", closeZoom: "Close", searchPlaceholder: "Search for a dish…", searchNoResults: "No dishes found." },
  es: { onRequest: "Bajo pedido", manageMenu: "Área reservada", reviewGoogle: "Deja una reseña en Google", reviewTripadvisor: "Deja una reseña en TripAdvisor", linkInstagram: "Síguenos en Instagram", linkFacebook: "Síguenos en Facebook", linkShop: "Visita nuestra tienda online", closeZoom: "Cerrar", searchPlaceholder: "Busca un plato…", searchNoResults: "No se han encontrado platos." },
  de: { onRequest: "Auf Anfrage", manageMenu: "Mitarbeiterbereich", reviewGoogle: "Bewertung auf Google hinterlassen", reviewTripadvisor: "Bewertung auf TripAdvisor hinterlassen", linkInstagram: "Folge uns auf Instagram", linkFacebook: "Folge uns auf Facebook", linkShop: "Besuche unseren Online-Shop", closeZoom: "Schließen", searchPlaceholder: "Gericht suchen…", searchNoResults: "Keine Gerichte gefunden." },
  fr: { onRequest: "Sur demande", manageMenu: "Espace réservé", reviewGoogle: "Laisser un avis sur Google", reviewTripadvisor: "Laisser un avis sur TripAdvisor", linkInstagram: "Suivez-nous sur Instagram", linkFacebook: "Suivez-nous sur Facebook", linkShop: "Visitez notre boutique en ligne", closeZoom: "Fermer", searchPlaceholder: "Rechercher un plat…", searchNoResults: "Aucun plat trouvé." },
};

export const TRANSLATION_LANG_KEY = "mdp-lang";

// Translates a single text with MyMemory (a free public API, no key
// required), using a call-lifetime-only cache to avoid calling it twice for
// the same text within the same generation batch.
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
  } catch {
    // No connection or service unreachable: fall back to the Italian text.
  }
  return text;
}

// Translates several texts with limited concurrency, to avoid overloading the free API.
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

// Builds, starting from the source menu (Italian) and a partial translation
// already saved, the list of only the fields still missing for a language
// ("jobs", each with an "apply" function to write the result into the
// draft) plus the draft itself (which already contains, intact, everything
// previously translated/corrected). Used both to generate missing
// translations and to show the admin how many entries are left to
// translate.
function collectMissingTranslations(menu, translation) {
  const existing = translation || {};
  const jobs = [];
  const draft = {
    restaurantName: existing.restaurantName,
    tagline: existing.tagline,
    footerNote: existing.footerNote,
    categories: {},
  };

  // A field that was never translated (currentValue === undefined) either
  // gets a translation job (if there's source text to translate), or is
  // immediately filled with "" (if the source is empty, e.g. an
  // uncompleted description) — it must NEVER stay undefined: Firestore
  // rejects entire documents that contain a nested undefined, so leaving it
  // as such would fail every save after generation.
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

// How many entries are left to translate for a language (0 = fully translated).
export function countMissingTranslations(menu, translation) {
  return collectMissingTranslations(menu, translation).jobs.length;
}

// Generates (via MyMemory) only the missing translations for a language,
// never touching a field already translated/corrected by hand by the admin.
// Must be called explicitly from the Admin panel (never client-side): the
// result is meant to be reviewed by the admin and then saved into
// `menu.translations[lang]`.
export async function generateMissingTranslations(menu, lang, translation) {
  const { draft, jobs } = collectMissingTranslations(menu, translation);
  if (lang === "it" || jobs.length === 0) return draft;
  const cache = {};
  const translated = await translateBatch(jobs.map((j) => j.text), lang, cache);
  jobs.forEach((job, i) => job.apply(translated[i]));
  return draft;
}

// Overlays the saved translation for a language on top of the source
// (Italian) menu, falling back to the Italian text field by field where
// it's missing (an entry not yet translated, or a language with no
// translation generated at all). Pure and synchronous: no network call —
// the customer only chooses which text, already downloaded along with the
// rest of the menu, to display.
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

// User-uploaded logo (Fattoria della Piana), embedded as an image.

/* ============================== GLOBAL STYLE ============================== */
export function GlobalStyle({ t }) {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,600&family=Work+Sans:wght@300;400;500;600&family=Roboto:ital,wght@0,300;0,400;0,500;0,700;1,400&display=swap');
      * { box-sizing: border-box; }
      body { margin: 0; }
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

// The logo is a small, separate image file (public/logo.webp + fallback
// public/logo.jpg), NO LONGER embedded as text in the code: it's
// downloaded once and stays cached in the customer's browser, instead of
// bloating every page load.
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
