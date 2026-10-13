// Printable menu (PDF via the browser's print dialog): builds what
// PrintMenu.jsx shows from the menu and the options chosen in
// MenuSettings.jsx ("Stampa del menù"), and opens it in a new tab.
import { applyTranslation } from "./shared";

export const PRINT_STORAGE_KEY = "mdp-print-payload";

export const DEFAULT_PRINT_OPTIONS = {
  lang: "it",
  images: false,
  prices: true,
  tags: true,
  subtitles: true,
  footer: true, // footer note + social contacts
  date: false,
  // By default a category can continue on the next page; on, a category
  // that doesn't fit moves to the next page as a whole.
  avoidCategorySplit: false,
  columns: 1,
  paperSize: "A4",
  excludedCategoryIds: [],
};

// Only what customers see (visible categories and dishes, never off-menu
// ones), in the chosen language. Returns null when nothing is left to print.
export function buildPrintPayload(menu, options) {
  const o = { ...DEFAULT_PRINT_OPTIONS, ...options };
  const translated = o.lang === "it" ? menu : applyTranslation(menu, menu.translations?.[o.lang]);
  const excluded = new Set(o.excludedCategoryIds);
  const categories = translated.categories
    .filter((c) => c.visible !== false && !excluded.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      subtitle: o.subtitles ? c.subtitle : "",
      items: c.items
        .filter((it) => it.visible !== false && !it.staffOnly)
        .map((it) => ({
          id: it.id,
          name: it.name,
          price: o.prices ? it.price : "",
          tag: o.tags ? (it.tag || "") : "",
          description: it.description || "",
          image: o.images ? (it.image || "") : "",
        })),
    }))
    .filter((c) => c.items.length > 0);
  if (categories.length === 0) return null;
  return {
    restaurantName: translated.restaurantName,
    tagline: translated.tagline,
    location: menu.location,
    footerNote: o.footer ? translated.footerNote : "",
    theme: menu.theme,
    lang: o.lang,
    socialLinks: o.footer ? menu.socialLinks : null,
    includeImages: o.images,
    avoidCategorySplit: o.avoidCategorySplit,
    columns: o.columns,
    paperSize: o.paperSize,
    generatedDate: o.date ? new Date().toLocaleDateString(o.lang === "it" ? "it-IT" : o.lang) : "",
    categories,
  };
}

// The menu travels via sessionStorage, copied by the browser into a tab
// opened by script from the same origin: no extra Firestore read.
// Throws a readable error.
export function openPrintPreview(payload) {
  try {
    sessionStorage.setItem(PRINT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    throw new Error("Impossibile preparare l'anteprima di stampa (memoria del browser piena).");
  }
  window.open(window.location.pathname + "?print=1", "_blank");
}
