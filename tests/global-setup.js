// Avvia gli emulatori Firebase (Docker) e li popola con dati demo prima di
// eseguire l'intera suite Playwright, così i test non toccano mai il
// progetto Firebase reale — vedi docker-compose.emulator.yml e
// scripts/seed-emulator.js.
import { execSync } from "node:child_process";

export default function globalSetup() {
  execSync("npm run emulators:up", { stdio: "inherit" });
  execSync("npm run seed:emulator", { stdio: "inherit" });
}
