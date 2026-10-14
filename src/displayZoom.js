// Zoom of the whole interface on this device (phones and tablets, where the
// browser has no zoom of its own): chosen from the staff app's "Zoom" page
// (PhoneApp.jsx) and kept in this device's localStorage, so it survives a
// reload or the next session without asking again.
//
// It works like the browser's own zoom on a computer: the viewport meta tag
// gets a narrower (zoom > 1) or wider (zoom < 1) layout width, scaled to fill
// the screen. The browser lays the page out again at that width, so
// everything adapts — media queries (useCompactLayout: at 125% a 10" tablet
// gets the phone layout), fixed bars, 100dvh — instead of a scaled picture
// of the page. A computer's browser ignores the viewport meta tag (it has
// Ctrl/⌘ + and −), and so does the till's Windows client.
export const ZOOM_LEVELS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
export const DEFAULT_ZOOM = 1;

const STORAGE_KEY = "mdp.displayZoom";
const DEFAULT_VIEWPORT = "width=device-width, initial-scale=1.0";

export const zoomLabel = (zoom) => `${Math.round(zoom * 100)}%`;

export function getSavedZoom() {
  try {
    const value = parseFloat(localStorage.getItem(STORAGE_KEY));
    return ZOOM_LEVELS.includes(value) ? value : DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM; // storage unavailable (private browsing…)
  }
}

export function saveZoom(zoom) {
  try {
    if (zoom === DEFAULT_ZOOM) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(zoom));
  } catch { /* storage unavailable: the zoom lasts until the page is closed */ }
}

// Phones and tablets: the devices that honour the viewport meta tag and
// whose browser offers no zoom. On a computer the Zoom page explains to use
// the browser's.
export function zoomSupported() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

// The screen's width in CSS pixels at 100%, in the current orientation
// (iOS always reports screen.width for portrait).
function deviceWidth() {
  const { width, height } = window.screen;
  const type = window.screen.orientation?.type;
  const portrait = type ? type.startsWith("portrait") : window.matchMedia("(orientation: portrait)").matches;
  return portrait ? Math.min(width, height) : Math.max(width, height);
}

let current = DEFAULT_ZOOM;

function viewportContent(zoom) {
  if (zoom === DEFAULT_ZOOM) return DEFAULT_VIEWPORT;
  return `width=${Math.round(deviceWidth() / zoom)}, initial-scale=${zoom}`;
}

function writeViewport() {
  let meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "viewport");
    document.head.appendChild(meta);
  }
  const content = viewportContent(current);
  if (meta.getAttribute("content") !== content) meta.setAttribute("content", content);
}

// Applies a zoom right away (preview), without saving it.
export function applyZoom(zoom) {
  current = ZOOM_LEVELS.includes(zoom) ? zoom : DEFAULT_ZOOM;
  writeViewport();
}

export function currentZoom() {
  return current;
}

// At start-up (main.jsx), before the first render: the saved zoom, and the
// layout width recomputed when the device is rotated.
export function initDisplayZoom() {
  if (typeof document === "undefined") return;
  applyZoom(getSavedZoom());
  const refresh = () => { if (current !== DEFAULT_ZOOM) writeViewport(); };
  window.screen.orientation?.addEventListener?.("change", refresh);
  window.addEventListener("orientationchange", refresh);
}
