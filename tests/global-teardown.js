import { execSync } from "node:child_process";

// Vedi global-setup.js per MDP_E2E_EMULATOR=external.
export default function globalTeardown() {
  if (process.env.MDP_E2E_EMULATOR === "external") return;
  execSync("npm run emulators:down", { stdio: "inherit" });
}
