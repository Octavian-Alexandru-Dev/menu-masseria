// Pezzi comuni alle scene registrate in GIF (vedi demo/README.md).
import fs from "node:fs";

// Un cerchio che compare dove si tocca/clicca: nel video, senza puntatore,
// non si capirebbe cosa ha fatto partire ogni cambiamento.
export async function showTaps(page) {
  await page.addInitScript(() => {
    globalThis.addEventListener("pointerdown", (e) => {
      const dot = globalThis.document.createElement("div");
      Object.assign(dot.style, {
        position: "fixed", left: `${e.clientX - 22}px`, top: `${e.clientY - 22}px`,
        width: "44px", height: "44px", borderRadius: "50%", pointerEvents: "none", zIndex: 2147483647,
        background: "rgba(255, 170, 0, 0.45)", border: "3px solid rgba(255, 140, 0, 0.9)",
        transition: "transform 450ms ease-out, opacity 450ms ease-out",
      });
      globalThis.document.documentElement.appendChild(dot);
      globalThis.requestAnimationFrame(() => { dot.style.transform = "scale(1.6)"; dot.style.opacity = "0"; });
      globalThis.setTimeout(() => dot.remove(), 600);
    }, true);
  });
}

export const pause = (page, ms = 700) => page.waitForTimeout(ms);

// Tocco con una piccola pausa dopo, per dare il tempo di vedere l'effetto.
export async function tap(locator, after = 600) {
  await locator.click();
  await locator.page().waitForTimeout(after);
}

export async function type(locator, text) {
  await locator.click();
  await locator.fill("");
  await locator.pressSequentially(text, { delay: 70 });
}

// Il video parte quando nasce la pagina, ma login e caricamento non sono
// interessanti: la scena segna l'istante da cui tagliare la GIF.
export function scene(testInfo, name) {
  const t0 = Date.now();
  let start = 0;
  return {
    start() { start = (Date.now() - t0) / 1000; },
    save() {
      fs.writeFileSync(testInfo.outputPath("gif.json"), JSON.stringify({ name, start }));
    },
  };
}
