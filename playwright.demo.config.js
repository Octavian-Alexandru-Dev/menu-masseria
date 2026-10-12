import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

// Registrazione delle GIF dimostrative del README (non sono test: vedi
// demo/README.md). Stesso emulatore e stesso server Vite della suite E2E
// (globalSetup/globalTeardown/webServer di playwright.config.js), ma ogni
// scena viene registrata in video e poi convertita in GIF da
// scripts/make-demo-gifs.js. Un worker solo: le scene della cassa sono
// stazioni di stampa e si ruberebbero le stampe a vicenda.
const PHONE = { width: 390, height: 844 };
const TILL = { width: 1280, height: 800 };

export default defineConfig({
  testDir: "./demo",
  testMatch: /\.demo\.js$/,
  outputDir: "./demo/.recordings",
  globalSetup: base.globalSetup,
  globalTeardown: base.globalTeardown,
  webServer: base.webServer,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: base.use.baseURL,
    locale: "it-IT",
    timezoneId: "Europe/Rome",
  },
  projects: [
    {
      name: "telefono",
      testMatch: /telefono\.demo\.js$/,
      use: { viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 1, video: { mode: "on", size: PHONE } },
    },
    {
      name: "cassa",
      testMatch: /cassa\.demo\.js$/,
      use: { viewport: TILL, video: { mode: "on", size: TILL } },
    },
  ],
});
