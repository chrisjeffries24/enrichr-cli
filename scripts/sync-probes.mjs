// Copies the three in-page probes from the Enrichr Chrome extensions into src/probes/, so the CLI measures exactly what
// the extensions measure. Run from the Enrichr monorepo; in a standalone checkout of the CLI there is nothing to sync from.
// tests/cli-probes.test.ts in the monorepo fails if the copies drift.
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const map = { fonts: "font-finder", colors: "color-palette", motion: "motion-detector" };

if (!existsSync(here("../../extensions"))) {
  console.log("No ../extensions folder here (standalone checkout): the probes in src/probes are already the source of truth.");
  process.exit(0);
}
for (const [name, ext] of Object.entries(map)) {
  copyFileSync(here(`../../extensions/${ext}/probe.js`), here(`../src/probes/${name}.js`));
  console.log(`src/probes/${name}.js <- extensions/${ext}/probe.js`);
}
