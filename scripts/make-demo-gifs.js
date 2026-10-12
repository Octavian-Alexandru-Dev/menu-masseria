// Registra le scene di demo/*.demo.js (playwright.demo.config.js, contro
// l'emulatore locale) e converte ogni video in una GIF in docs/demo/.
// Uso: npm run demo:gifs [-- --project=telefono] [-- -g "cassa: prenotazioni"]
// Richiede Docker (come i test E2E) e ffmpeg nel PATH.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const RECORDINGS = path.join(ROOT, "demo", ".recordings");
const OUT = path.join(ROOT, "docs", "demo");
// Larghezza della GIF: il telefono resta a grandezza naturale, la cassa
// viene ridotta perché resti leggibile nel README senza pesare troppo.
const WIDTH = { telefono: 390, cassa: 960 };
const FPS = 10;

try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  console.error("ffmpeg non trovato nel PATH (macOS: brew install ffmpeg).");
  process.exit(1);
}

fs.rmSync(RECORDINGS, { recursive: true, force: true });
const run = spawnSync("npx", ["playwright", "test", "--config", "playwright.demo.config.js", ...process.argv.slice(2)], { cwd: ROOT, stdio: "inherit" });
if (run.status !== 0) {
  console.error("Registrazione non riuscita: nessuna GIF aggiornata.");
  process.exit(run.status ?? 1);
}

fs.mkdirSync(OUT, { recursive: true });
for (const dir of fs.readdirSync(RECORDINGS)) {
  const metaFile = path.join(RECORDINGS, dir, "gif.json");
  const video = path.join(RECORDINGS, dir, "video.webm");
  if (!fs.existsSync(metaFile) || !fs.existsSync(video)) continue;
  const { name, start } = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  const width = name.startsWith("cassa") ? WIDTH.cassa : WIDTH.telefono;
  const gif = path.join(OUT, `${name}.gif`);
  const filters = `fps=${FPS},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(start), "-i", video, "-vf", filters, "-loop", "0", gif]);
  console.log(`${path.relative(ROOT, gif)}  ${(fs.statSync(gif).size / 1024).toFixed(0)} KB`);
}
