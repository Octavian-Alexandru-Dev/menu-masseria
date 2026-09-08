import { execSync } from "node:child_process";

export default function globalTeardown() {
  execSync("npm run emulators:down", { stdio: "inherit" });
}
