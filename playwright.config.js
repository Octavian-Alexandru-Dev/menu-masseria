import { defineConfig, devices } from "@playwright/test";

// L'intera suite gira contro gli emulatori Firebase locali (Docker), mai
// contro il progetto reale: globalSetup li avvia e li popola con dati demo
// (tests/global-setup.js), globalTeardown li spegne (tests/global-teardown.js),
// e il server Vite qui sotto viene avviato con VITE_USE_FIREBASE_EMULATOR=true
// così l'app si collega all'emulatore invece che a ".env".
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.js",
  globalTeardown: "./tests/global-teardown.js",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  timeout: 15_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
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
