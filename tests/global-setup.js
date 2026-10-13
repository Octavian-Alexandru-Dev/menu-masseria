// Avvia gli emulatori Firebase (Docker) e li popola con dati demo prima di
// eseguire la suite Playwright, così i test non toccano mai il progetto
// Firebase reale — vedi docker-compose.emulator.yml e
// scripts/seed-emulator.js.
//
// MDP_E2E_EMULATOR=external: gli emulatori li gestisce chi lancia Playwright
// (scripts/test-e2e-changed.js, che esegue più fasi di fila con un solo
// avvio): qui non si fa nulla.
import { execSync } from "node:child_process";

export default function globalSetup() {
  if (process.env.MDP_E2E_EMULATOR === "external") return;
  execSync("npm run emulators:up", { stdio: "inherit" });
  execSync("npm run seed:emulator", { stdio: "inherit" });
}
