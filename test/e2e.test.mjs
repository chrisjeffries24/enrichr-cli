// Drives the real CLI against a real browser and a fixture site whose design values are known. Skipped when no
// Chrome, Edge, Brave or Chromium is installed. (GitHub's ubuntu runners have Chrome.)
import test from "node:test";
import assert from "node:assert/strict";
import { main } from "../src/cli.mjs";
import { findBrowser } from "../src/chrome.mjs";
import { startFixture } from "./fixtures.mjs";

const browser = findBrowser();
const opts = { skip: browser ? false : "no Chrome, Edge, Brave or Chromium on this machine", timeout: 90_000 };

const sink = () => { const s = { text: "", isTTY: false, write(t) { s.text += t; } }; return s; };
async function run(argv) {
  const stdout = sink(); const stderr = sink();
  const code = await main(argv, { stdout, stderr, env: process.env });
  return { code, out: stdout.text, err: stderr.text };
}

let site;
test.before(async () => { if (browser) site = await startFixture(); });
test.after(async () => { await site?.close(); });

test("tokens: reads the fixture's real design values in a real browser", opts, async () => {
  const r = await run(["tokens", site.url, "--json", "--no-color"]);
  assert.equal(r.code, 0, r.err);
  const t = JSON.parse(r.out);
  assert.equal(t.mode, "browser");
  assert.equal(t.title, "Fixture Co");
  assert.equal(t.scheme, "light");

  // fonts: the web font that loaded, the generic fallback that body text drew, and no invented code font
  assert.equal(t.fonts.heading.name, "Fixture UI");
  assert.equal(t.fonts.heading.kind, "web");
  assert.equal(t.fonts.body.kind, "generic");
  assert.equal(t.colors.roles.accent, "#3b5bdb");
  assert.equal(t.colors.roles.background, "#fafafa");
  assert.equal(t.fonts.code, null);

  // colors measured from the rendered page
  const hexes = t.colors.palette.map((c) => c.hex);
  for (const h of ["#3b5bdb", "#101828", "#1a1a1a", "#fafafa"]) assert.ok(hexes.includes(h), `${h} in ${hexes}`);

  // type scale includes the heading sizes
  const sizes = t.typeScale.map((s) => s.size);
  for (const s of [16, 24, 48]) assert.ok(sizes.includes(s), `${s}px in ${sizes}`);
  assert.equal(t.typeScale.find((s) => s.size === 48).weight, 700);

  assert.equal(t.spacing.base, 8);
  assert.ok(t.radii.some((x) => x.value === "12px") && t.radii.some((x) => x.value === "9999px"));
  assert.deepEqual(t.shadows.map((x) => x.value), ["rgba(0, 0, 0, 0.12) 0px 4px 12px 0px"], "the do-nothing shadow is not reported");
  assert.ok(t.containers.some((c) => c.px === 960));
  assert.deepEqual(t.breakpoints.map((b) => b.px).sort((a, b) => a - b), [768, 1024]);
  assert.ok(t.transitions.durations.some((d) => d.value === "0.2s"));
  assert.ok(t.transitions.easings.some((d) => /cubic-bezier\(0\.22, 1, 0\.36, 1\)/.test(d.value)));

  // the site's own variables, resolved, with the dark theme kept apart
  const brand = t.customProperties.all.find((p) => p.name === "--brand");
  assert.equal(brand.hex, "#3b5bdb");
  assert.deepEqual(t.customProperties.scopes.sort(), ["dark", "default"]);
  assert.equal(t.customProperties.all.find((p) => p.name === "--surface" && p.scope === "default").value, "#fafafa");
  assert.equal(t.customProperties.all.find((p) => p.name === "--surface" && p.scope === "dark").value, "#101114");
});

test("--dark reads the page as a dark-scheme visitor; light is the default regardless of the machine", opts, async () => {
  const d = await run(["colors", site.url, "--json", "--dark"]);
  const l = await run(["colors", site.url, "--json"]);
  assert.equal(d.code, 0, d.err);
  assert.equal(l.code, 0, l.err);
  const dark = JSON.parse(d.out);
  const light = JSON.parse(l.out);
  assert.equal(dark.scheme, "dark");
  assert.equal(light.scheme, "light");
  assert.ok(dark.colors.palette.some((c) => c.hex === "#101114"), "dark surface in dark palette");
  assert.ok(!light.colors.palette.some((c) => c.hex === "#101114"));
  assert.ok(light.colors.palette.some((c) => c.hex === "#fafafa"));
});

test("css and dtcg files come out of a real run", opts, async () => {
  const css = await run(["tokens", site.url, "--format", "css", "--site-vars"]);
  assert.equal(css.code, 0, css.err);
  assert.match(css.out, /--color-accent: #3b5bdb;/);
  assert.match(css.out, /--font-heading: "Fixture UI", sans-serif;/);
  assert.match(css.out, /--font-body: sans-serif;/);
  assert.match(css.out, /--radius-full: 9999px;/);
  assert.match(css.out, /--brand: #3b5bdb;/);
  const dtcg = JSON.parse((await run(["tokens", site.url, "--format", "dtcg"])).out);
  assert.equal(dtcg.color.accent.$value, "#3b5bdb");
  assert.deepEqual(dtcg.fontFamily.heading.$value[0], "Fixture UI");
});

test("motion finds no animation library on a page that has none, and counts its transitions", opts, async () => {
  const r = await run(["motion", site.url, "--json"]);
  assert.equal(r.code, 0, r.err);
  const m = JSON.parse(r.out);
  assert.deepEqual(m.motion.libs, []);
  assert.equal(m.motion.canvases.length, 0);
});

test("viewport option reaches the page", opts, async () => {
  const t = JSON.parse((await run(["fonts", site.url, "--json", "--viewport", "mobile"])).out);
  assert.equal(t.viewport, "mobile");
});

test("a 404 page is flagged, and an unreachable address fails cleanly", opts, async () => {
  const gone = JSON.parse((await run(["fonts", site.url + "missing", "--json"])).out);
  assert.ok(gone.notes.some((n) => /HTTP 404/.test(n)));
  const bad = await run(["fonts", "http://127.0.0.1:1/", "--json", "--timeout", "10"]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /Could not load http:\/\/127\.0\.0\.1:1\//);
});

test("pretty output in a real run names the fixture's fonts and colors", opts, async () => {
  const r = await run(["tokens", site.url, "--no-color"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Fixture UI/);
  assert.match(r.out, /#3b5bdb/);
  assert.match(r.out, /Base unit 8px/);
  assert.match(r.out, /enrichr deep/);
  assert.ok(!/\x1b\[/.test(r.out));
});
