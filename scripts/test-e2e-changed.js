// Esegue solo i test E2E della parte di codice toccata (vedi docs/testing.md).
//
//   npm run test:e2e:changed                    file cambiati rispetto all'ultimo commit (+ non tracciati)
//   npm run test:e2e:changed -- --base main     file cambiati rispetto al punto in cui il branch si è staccato da main
//   npm run test:e2e:changed -- reservations till-sala   proprio queste spec (nome o percorso)
//   npm run test:e2e:changed -- --list          mostra cosa eseguirebbe e perché, senza eseguire
//   npm run test:e2e:changed -- … -- --headed   tutto ciò che segue il secondo "--" va a Playwright
//
// Da quali file a quali spec: tests/spec-map.js. Le spec scelte girano fase
// per fase nell'ordine di tests/stages.js (prima telefono/browser in
// parallelo, poi una alla volta le fasi con una cassa accesa), con un solo
// avvio dell'emulatore per tutte. Se cambia qualcosa di condiviso da tutto
// (o un file che la mappa non conosce) gira la suite completa.
import { execSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { STAGES, stageOf } from "../tests/stages.js";
import { FULL_SUITE, SPECS_BY_FILE, IGNORED, matchPath } from "../tests/spec-map.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ALL_SPECS = readdirSync(path.join(ROOT, "tests")).filter((f) => f.endsWith(".spec.js")).map((f) => f.replace(/\.spec\.js$/, "")).sort();

/* ------------------------------- argomenti ------------------------------- */

const argv = process.argv.slice(2);
const dashdash = argv.indexOf("--");
const own = dashdash >= 0 ? argv.slice(0, dashdash) : argv;
const passthrough = dashdash >= 0 ? argv.slice(dashdash + 1) : [];
const listOnly = own.includes("--list");
const baseIdx = own.indexOf("--base");
const base = baseIdx >= 0 ? own[baseIdx + 1] : null;
const named = own.filter((a, i) => !a.startsWith("--") && own[i - 1] !== "--base");

const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8" }).split("\n").map((l) => l.trim()).filter(Boolean);

/* ------------------------- dai file alle spec ------------------------- */

// Spec che importano (anche indirettamente, helper → helper) un file di tests/.
function specsImporting(testFile) {
  const files = [
    ...readdirSync(path.join(ROOT, "tests")).filter((f) => f.endsWith(".js")).map((f) => `tests/${f}`),
    ...readdirSync(path.join(ROOT, "tests/helpers")).filter((f) => f.endsWith(".js")).map((f) => `tests/helpers/${f}`),
  ];
  const found = new Set();
  const queue = [testFile];
  const seen = new Set(queue);
  while (queue.length) {
    const target = path.basename(queue.shift(), ".js");
    for (const f of files) {
      if (seen.has(f)) continue;
      const src = readFileSync(path.join(ROOT, f), "utf8");
      if (!new RegExp(`from\\s+["'][./]*(helpers/)?${target}(\\.js)?["']`).test(src)) continue;
      seen.add(f);
      if (f.endsWith(".spec.js")) found.add(path.basename(f, ".spec.js"));
      else queue.push(f);
    }
  }
  return [...found];
}

// { full: bool, specs: Set, reasons: [[file, spiegazione]] }
function resolve(files) {
  const specs = new Set();
  const reasons = [];
  let full = false;
  for (const file of files) {
    const spec = file.match(/^tests\/([^/]+)\.spec\.js$/)?.[1];
    if (spec) {
      if (existsSync(path.join(ROOT, file))) { specs.add(spec); reasons.push([file, spec]); } else reasons.push([file, "spec eliminata: nessun test"]);
    } else if (matchPath(file, FULL_SUITE)) {
      full = true; reasons.push([file, "condiviso da tutto → suite completa"]);
    } else if (file.startsWith("tests/") && file.endsWith(".js")) {
      const list = specsImporting(file);
      list.forEach((s) => specs.add(s));
      reasons.push([file, list.length ? `helper usato da: ${list.join(", ")}` : "helper non usato da nessuna spec"]);
    } else if (matchPath(file, Object.keys(SPECS_BY_FILE))) {
      const list = SPECS_BY_FILE[matchPath(file, Object.keys(SPECS_BY_FILE))];
      list.forEach((s) => specs.add(s));
      reasons.push([file, list.join(", ")]);
    } else if (file.endsWith(".md") || matchPath(file, IGNORED)) {
      reasons.push([file, "nessun test"]);
    } else {
      full = true; reasons.push([file, "non in tests/spec-map.js → suite completa (aggiungilo alla mappa)"]);
    }
  }
  return { full, specs, reasons };
}

function changedFiles() {
  const ref = base ? sh(`git merge-base ${base} HEAD`)[0] : "HEAD";
  return [...new Set([...sh(`git diff --name-only ${ref}`), ...sh("git ls-files --others --exclude-standard")])].sort();
}

/* --------------------------------- run --------------------------------- */

function run(cmd, args, env = {}) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
  return res.status ?? 1;
}

let plan;
if (named.length) {
  const specs = new Set();
  for (const n of named) {
    const name = path.basename(n).replace(/\.spec\.js$/, "");
    if (!ALL_SPECS.includes(name)) { console.error(`Spec sconosciuta: ${n}\nDisponibili: ${ALL_SPECS.join(", ")}`); process.exit(2); }
    specs.add(name);
  }
  plan = { full: false, specs, reasons: [...specs].map((s) => [`(richiesta) ${s}`, s]) };
} else {
  const files = changedFiles();
  plan = resolve(files);
  console.log(`\nFile cambiati rispetto a ${base ? `${base} (merge-base)` : "HEAD"}: ${files.length}`);
}
for (const [file, why] of plan.reasons) console.log(`  ${file}  →  ${why}`);

if (plan.full) {
  console.log("\n▶ Suite completa (npm run test:e2e).\n");
  if (listOnly) process.exit(0);
  process.exit(run("npx", ["playwright", "test", ...passthrough]));
}

const byStage = STAGES.map((stage) => ({
  stage: stage.name,
  files: [...plan.specs].filter((s) => stageOf(`tests/${s}.spec.js`) === stage.name).sort().map((s) => `tests/${s}.spec.js`),
})).filter((s) => s.files.length > 0);

if (byStage.length === 0) {
  console.log("\nNessun test da eseguire per questi cambiamenti.\n");
  process.exit(0);
}
console.log("\n▶ Da eseguire, in quest'ordine:");
for (const { stage, files } of byStage) console.log(`  [${stage}] ${files.map((f) => path.basename(f)).join(", ")}`);
console.log("");
if (listOnly) process.exit(0);

// Un solo avvio dell'emulatore per tutte le fasi (global-setup.js lo salta).
const failed = [];
const down = () => { try { execSync("npm run emulators:down", { cwd: ROOT, stdio: "inherit" }); } catch { /* già spento */ } };
process.on("SIGINT", () => { down(); process.exit(130); });
try {
  execSync("npm run emulators:up", { cwd: ROOT, stdio: "inherit" });
  execSync("npm run seed:emulator", { cwd: ROOT, stdio: "inherit" });
  for (const { stage, files } of byStage) {
    console.log(`\n━━ Fase ${stage} ━━`);
    const status = run("npx", ["playwright", "test", `--project=${stage}`, "--no-deps", ...files, ...passthrough], { MDP_E2E_EMULATOR: "external" });
    if (status !== 0) failed.push(stage);
  }
} finally {
  down();
}
console.log(failed.length ? `\n✘ Test falliti nelle fasi: ${failed.join(", ")}` : `\n✓ Tutti i test eseguiti sono passati (${byStage.map((s) => s.files.length).reduce((a, b) => a + b, 0)} spec).`);
console.log("  Prima di consegnare: npm run test:e2e (suite completa).\n");
process.exit(failed.length ? 1 : 0);
