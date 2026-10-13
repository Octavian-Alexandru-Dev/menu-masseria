// Smartphone da 6" (Pixel 5: 393×851 CSS px): l'area staff si prova così,
// com'è in mano ai camerieri (PhoneApp.jsx). `test.use(PHONE)` in cima allo spec.
export const PHONE = {
  viewport: { width: 393, height: 851 },
  deviceScaleFactor: 2.75,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
};

// Una sezione della barra in basso dell'app.
export function navTo(page, name) {
  return page.getByRole("navigation", { name: "Sezioni" }).getByRole("button", { name, exact: true }).click();
}

// La schermata a pagina intera aperta in primo piano (SidePanel `sheet`):
// sotto, l'app è inerte, ma Playwright la vede ancora — si cerca qui dentro.
export function sheet(page, name) {
  return name ? page.getByRole("dialog", { name }) : page.getByRole("dialog").last();
}
