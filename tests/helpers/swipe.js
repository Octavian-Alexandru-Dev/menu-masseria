// Swipe verso sinistra su una riga (SwipeAction in src/TillUi.jsx), con il
// mouse: gli eventi pointer sono gli stessi del dito. `fraction`: quanta
// larghezza della riga percorrere (oltre metà circa = azione subito, poco =
// azione solo scoperta, da toccare).
export async function swipeLeft(page, locator, fraction) {
  await locator.scrollIntoViewIfNeeded();
  let box = await locator.boundingBox();
  // Come farebbe una persona: se il punto da cui parte il dito è coperto (dal
  // pulsante fluttuante in basso), prima scorre la pagina fino in fondo, dove
  // lo spazio lasciato sotto l'elenco tiene le righe sopra il pulsante.
  const reachable = (b) => locator.evaluate((el, [x, y]) => el.contains(globalThis.document.elementFromPoint(x, y)), [b.x + b.width - 16, b.y + b.height / 2]);
  if (!(await reachable(box))) {
    await page.evaluate(() => globalThis.scrollTo(0, globalThis.document.documentElement.scrollHeight));
    box = await locator.boundingBox();
  }
  const y = box.y + box.height / 2;
  const from = box.x + box.width - 16;
  await page.mouse.move(from, y);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) await page.mouse.move(from - (box.width * fraction * i) / steps, y);
  await page.mouse.up();
}
