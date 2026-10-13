import { defineConfig, devices } from "@playwright/test";
import { APP_PORT, APP_URL } from "./tests/helpers/appUrl.js";
import { STAGES } from "./tests/stages.js";

// L'intera suite gira contro gli emulatori Firebase locali (Docker), mai
// contro il progetto reale: globalSetup li avvia e li popola con dati demo
// (tests/global-setup.js), globalTeardown li spegne (tests/global-teardown.js),
// e l'app qui sotto viene costruita con VITE_USE_FIREBASE_EMULATOR=true così
// si collega all'emulatore invece che a ".env".
//
// Determinismo (vedi docs/testing.md): build di produzione invece del server
// di sviluppo (che compila ogni modulo al primo accesso, lento e variabile
// con più worker insieme), movimento ridotto (niente animazioni né
// scorrimenti "smooth" a metà quando si misura o si clicca), tempi larghi.
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.js",
  globalTeardown: "./tests/global-teardown.js",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: APP_URL,
    contextOptions: { reducedMotion: "reduce" },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // Una fase dopo l'altra (tests/stages.js): prima le spec del telefono e
  // del browser, in parallelo; poi, in sequenza, quelle con una cassa
  // (stazione di stampa) accesa.
  projects: STAGES.map((stage, i) => ({
    name: stage.name,
    use: { ...devices["Desktop Chrome"] },
    ...(stage.spec ? { testMatch: stage.spec } : { testIgnore: STAGES.filter((s) => s.spec).map((s) => s.spec) }),
    ...(i > 0 ? { dependencies: [STAGES[i - 1].name] } : {}),
  })),
  webServer: {
    command: `npx vite build --outDir .e2e-dist --emptyOutDir --logLevel warn && npx vite preview --outDir .e2e-dist --port ${APP_PORT} --strictPort`,
    url: APP_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_USE_FIREBASE_EMULATOR: "true",
      VITE_FIREBASE_API_KEY: "demo-key",
      VITE_FIREBASE_PROJECT_ID: "demo-masseria-test",
      // Azzerate esplicitamente: senza questo, Vite le leggerebbe comunque
      // dal vero ".env" dello sviluppatore (queste due non vengono
      // sovrascritte sopra come le VITE_FIREBASE_*), facendo sì che il
      // pulsante "Carica foto" di Admin.jsx tenti un upload reale verso
      // Cloudinary durante i test invece di fallire in modo deterministico
      // con "Upload immagini non configurato" (cloudinary.js).
      VITE_CLOUDINARY_CLOUD_NAME: "",
      VITE_CLOUDINARY_UPLOAD_PRESET: "",
    },
  },
});
