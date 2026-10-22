import test from "node:test";
import assert from "node:assert/strict";
import { buildTokens, classifyVar, firstFamily, pickColorRoles } from "../src/tokens.mjs";
import { flatten, textScaleNames } from "../src/format/flat.mjs";
import { toCss, toTailwind } from "../src/format/css.mjs";
import { parseShadow, toDtcg } from "../src/format/dtcg.mjs";
import { toMarkdown } from "../src/format/markdown.mjs";
import { makeStyle, toPretty } from "../src/format/pretty.mjs";
import { render } from "../src/cli.mjs";

/** What the browser probes return for a small dark-on-light site. */
export const RAW = {
  mode: "browser",
  meta: { url: "https://example.test/", title: "Example", status: 200, viewport: "desktop", scheme: "light" },
  css: { sheets: 2, rules: 40 },
  colors: {
    colors: [
      { hex: "#ffffff", sat: 0, light: 1, score: 1.2, text: 0, background: 70, border: 0, graphic: 5 },
      { hex: "#111827", sat: 0.4, light: 0.1, score: 1.0, text: 60, background: 3, border: 0, graphic: 2 },
      { hex: "#3b5bdb", sat: 0.65, light: 0.54, score: 0.4, text: 5, background: 8, border: 0, graphic: 30 },
      { hex: "#e5e7eb", sat: 0.2, light: 0.9, score: 0.3, text: 0, background: 5, border: 80, graphic: 0 },
      { hex: "#6b7280", sat: 0.1, light: 0.5, score: 0.2, text: 20, background: 0, border: 5, graphic: 0 },
    ],
  },
  fonts: { fonts: [
    { name: "Inter", kind: "web", requested: "", stack: "Inter, sans-serif", share: 88, chars: 880, role: "Body text", mainWeight: 400, weights: [400, 600, 700], sizes: [16], italic: false, google: true, files: [] },
    { name: "JetBrains Mono", kind: "web", requested: "", stack: "\"JetBrains Mono\", monospace", share: 12, chars: 120, role: "Code", mainWeight: 400, weights: [400], sizes: [14], italic: false, google: true, files: [] },
  ] },
  tokens: {
    fontRoles: { heading: "Inter, sans-serif", body: "Inter, sans-serif", code: "\"JetBrains Mono\", monospace" },
    typeScale: [
      { size: 16, weight: "400", lineHeight: "24px", letterSpacing: "normal", chars: 600, tags: ["p"], share: 60 },
      { size: 16, weight: "600", lineHeight: "24px", letterSpacing: "normal", chars: 100, tags: ["a"], share: 10 },
      { size: 14, weight: "400", lineHeight: "20px", letterSpacing: "normal", chars: 150, tags: ["code"], share: 15 },
      { size: 20, weight: "500", lineHeight: "28px", letterSpacing: "normal", chars: 90, tags: ["p"], share: 9 },
      { size: 48, weight: "700", lineHeight: "52px", letterSpacing: "-0.02em", chars: 3, tags: ["h1"], share: 0.3 },
      { size: 9, weight: "400", lineHeight: "normal", letterSpacing: "normal", chars: 5, tags: ["span"], share: 0.4 },
    ],
    spacing: { base: 8, coverage: 91, values: [{ px: 8, uses: 50 }, { px: 16, uses: 40 }, { px: 24, uses: 20 }, { px: 5, uses: 4 }] },
    radii: [{ value: "12px", uses: 9 }, { value: "9999px", uses: 4 }, { value: "4px", uses: 3 }],
    shadows: [{ value: "rgba(0, 0, 0, 0.12) 0px 4px 12px 0px", uses: 5 }, { value: "rgba(0, 0, 0, 0.05) 0px 1px 2px 0px", uses: 2 }],
    containers: [{ px: 960, uses: 2 }],
    transitions: { durations: [{ value: "0.2s", uses: 9 }], easings: [{ value: "cubic-bezier(0.22, 1, 0.36, 1)", uses: 9 }, { value: "ease", uses: 3 }] },
  },
  vars: { scopes: { default: { "--brand": "#3b5bdb", "--radius": "var(--r)", "--font-ui": "Inter, sans-serif" }, dark: { "--brand": "#748ffc" } }, resolved: { "--brand": { value: "#3b5bdb", hex: "#3b5bdb" }, "--radius": { value: "12px" }, "--font-ui": { value: "Inter, sans-serif" } } },
  fontFaces: [{ family: "Inter", weights: ["100 900"], src: "/inter.woff2" }],
  breakpoints: [{ px: 768, uses: 4 }, { px: 1024, uses: 2 }],
};

const set = () => buildTokens(structuredClone(RAW), { version: "9.9.9", url: "https://example.test/" });

test("classifyVar sorts custom properties by what the value is", () => {
  const cases = [
    ["--c", "#fff", "color"], ["--c", "oklch(0.7 0.1 200)", "color"], ["--e", "cubic-bezier(0,0,1,1)", "easing"], ["--e", "ease-out", "easing"],
    ["--d", "200ms", "duration"], ["--f", '"Inter", sans-serif', "font"], ["--font-body", "Georgia", "font"], ["--s", "0 4px 12px rgba(0,0,0,.1)", "shadow"],
    ["--r", "12px", "size"], ["--w", "clamp(1rem, 2vw, 3rem)", "size"], ["--font-size-lg", "18px", "size"], ["--z", "10", "other"], ["--x", "", "other"],
  ];
  for (const [n, v, want] of cases) assert.equal(classifyVar(n, v), want, `${n}: ${v}`);
});

test("firstFamily handles quotes and commas", () => {
  assert.equal(firstFamily('"Helvetica Neue", Arial'), "Helvetica Neue");
  assert.equal(firstFamily("'A, B', serif"), "A, B");
  assert.equal(firstFamily("Inter, sans-serif"), "Inter");
  assert.equal(firstFamily(""), "");
});

test("color roles come from measured coverage", () => {
  const r = set().colors.roles;
  assert.equal(r.background, "#ffffff");
  assert.equal(r.text, "#111827");
  assert.equal(r.accent, "#3b5bdb");
  assert.equal(r.border, "#e5e7eb");
  assert.equal(r.contrast, 17.7);
  assert.deepEqual(pickColorRoles([]), { background: null, text: null, accent: null, border: null, contrast: null });
});

test("the type scale merges weights per size and keeps heading sizes even when they hold few characters", () => {
  const sizes = set().typeScale.map((t) => t.size);
  assert.ok(sizes.includes(48), "h1 size kept");
  assert.ok(!sizes.includes(9), "tiny low-coverage size dropped");
  assert.equal(sizes.filter((s) => s === 16).length, 1);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b));
  assert.equal(set().typeScale.find((t) => t.size === 16).weight, 400);
});

test("fonts: roles map to rendered fonts; a generic code font is hidden", () => {
  const f = set().fonts;
  assert.equal(f.heading.name, "Inter");
  assert.equal(f.code.name, "JetBrains Mono");
  const raw = structuredClone(RAW);
  raw.tokens.fontRoles.code = "monospace";
  assert.equal(buildTokens(raw).fonts.code, null);
});

test("custom properties are resolved, typed and scoped", () => {
  const cp = set().customProperties;
  assert.equal(cp.count, 3);
  assert.deepEqual(cp.scopes, ["default", "dark"]);
  assert.equal(cp.all.find((p) => p.name === "--radius").value, "12px");
  assert.equal(cp.all.find((p) => p.name === "--brand" && p.scope === "dark").hex, "#748ffc");
  assert.equal(cp.byType.color.length, 2);
});

test("a site with no root variables says so", () => {
  const raw = structuredClone(RAW);
  raw.vars = { scopes: {}, resolved: {} };
  assert.ok(buildTokens(raw).notes.some((n) => /no custom properties/.test(n)));
});

test("an error page is flagged", () => {
  const raw = structuredClone(RAW);
  raw.meta.status = 404;
  assert.ok(buildTokens(raw).notes.some((n) => /HTTP 404/.test(n)));
});

test("textScaleNames anchors base at the ~16px body size and counts outwards", () => {
  const names = textScaleNames(set().typeScale).map((t) => [t.size, t.name]);
  assert.deepEqual(names, [[14, "sm"], [16, "base"], [20, "lg"], [48, "xl"]]);
});

test("css output has the measured values and valid-looking declarations", () => {
  const css = toCss(set());
  assert.match(css, /--color-background: #ffffff;/);
  assert.match(css, /--color-accent: #3b5bdb;/);
  assert.match(css, /--font-heading: "Inter", sans-serif;/);
  assert.match(css, /--text-base: 16px;/);
  assert.match(css, /--text-base--line-height: 24px;/);
  assert.match(css, /--space-1: 8px;/);
  assert.match(css, /--radius-full: 9999px;/);
  assert.match(css, /--duration-1: 0.2s;/);
  assert.match(css, /--ease-1: cubic-bezier\(0\.22, 1, 0\.36, 1\);/);
  assert.ok(!css.includes("--ease-2"), "plain ease is not a token");
  for (const line of css.split("\n").filter((l) => /^ {2}--/.test(l))) assert.match(line, /^ {2}--[a-z0-9-]+: [^;]+;$/, line);
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
});

test("css --site-vars appends the site's own variables, with the dark theme in a media query", () => {
  const css = toCss(set(), { siteVars: true });
  assert.match(css, /--brand: #3b5bdb;/);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\n {2}:root \{\n {4}--brand: #748ffc;/);
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
});

test("tailwind v4 theme uses Tailwind's variable namespaces", () => {
  const tw = toTailwind(set());
  assert.match(tw, /@theme \{/);
  assert.match(tw, /--color-accent: #3b5bdb;/);
  assert.match(tw, /--text-base: 1rem;/);
  assert.match(tw, /--radius-md: 12px;/);
  assert.match(tw, /--spacing: 0.5rem;/);
  assert.match(tw, /--breakpoint-768: 768px;/);
});

test("dtcg output: every leaf has $value and $type, shadows are objects", () => {
  const json = JSON.parse(toDtcg(set()));
  const leaves = [];
  (function walk(o) { for (const [k, v] of Object.entries(o)) { if (k.startsWith("$") && k !== "$value" && k !== "$type") continue; if (v && typeof v === "object" && "$value" in v) leaves.push(v); else if (v && typeof v === "object") walk(v); } })(json);
  assert.ok(leaves.length > 15);
  for (const l of leaves) assert.ok(l.$type, JSON.stringify(l));
  assert.deepEqual(json.shadow["1"].$value, { color: "rgba(0, 0, 0, 0.05)", offsetX: "0px", offsetY: "1px", blur: "2px", spread: "0px" });
  assert.deepEqual(json.cubicBezier["1"].$value, [0.22, 1, 0.36, 1]);
  assert.deepEqual(json.fontFamily.heading.$value, ["Inter", "sans-serif"]);
});

test("parseShadow handles multiple layers, inset, and refuses what it cannot read", () => {
  assert.equal(parseShadow("rgba(0,0,0,.1) 0px 1px 2px 0px, rgba(0,0,0,.2) 0px 4px 8px 0px").length, 2);
  assert.equal(parseShadow("inset 0 0 0 1px #fff").inset, true);
  assert.equal(parseShadow("var(--x)"), null);
});

test("markdown and pretty reports mention the same headline facts", () => {
  const md = toMarkdown(set(), { sections: ["colors", "fonts", "typeScale", "spacing", "shape"] });
  assert.match(md, /^# Example/);
  assert.match(md, /\| Headings \| Inter \| web \|/);
  assert.match(md, /Base unit 8px/);
  const txt = toPretty(set(), { sections: ["colors", "fonts", "typeScale", "spacing", "shape", "breakpoints", "transitions", "customProperties"], style: makeStyle(false), ms: 2500 });
  assert.match(txt, /example\.test/);
  assert.match(txt, /Headings, body\s+Inter/);
  assert.match(txt, /Base unit 8px \(91%/);
  assert.match(txt, /in 2\.5s/);
  assert.ok(!/\x1b\[/.test(txt), "no escape codes when color is off");
  assert.match(toPretty(set(), { sections: ["colors"], style: makeStyle(true) }), /\x1b\[48;2;255;255;255m/);
});

test("json output is limited to the sections asked for, plus metadata", () => {
  const out = JSON.parse(render(set(), { format: "json", sections: ["fonts", "typeScale"] }));
  assert.ok(out.fonts && out.typeScale && out.schema === 1 && out.version === "9.9.9");
  assert.equal(out.colors, undefined);
  assert.equal(out.customProperties, undefined);
});

test("a pale tint with more coverage does not beat the vivid brand color as accent", () => {
  const pal = [
    { hex: "#ffffff", score: 1, share: { text: 0, background: 90, border: 0, graphic: 0 }, saturation: 0, lightness: 1 },
    { hex: "#111111", score: 1, share: { text: 90, background: 0, border: 0, graphic: 0 }, saturation: 0, lightness: 0.07 },
    { hex: "#c7d2fe", score: 0.5, share: { text: 5, background: 0, border: 0, graphic: 0 }, saturation: 0.95, lightness: 0.89 },
    { hex: "#3b5bdb", score: 0.3, share: { text: 0, background: 5, border: 0, graphic: 0 }, saturation: 0.69, lightness: 0.54 },
  ];
  assert.equal(pickColorRoles(pal).accent, "#3b5bdb");
});

test("font stacks never repeat a generic family", () => {
  assert.equal(flatten({ colors: { roles: {}, palette: [] }, fonts: { body: { name: "sans-serif", kind: "generic", stack: '"Nope", sans-serif' } } }).fonts[0].value, "sans-serif");
  assert.equal(flatten({ colors: { roles: {}, palette: [] }, fonts: { body: { name: "Inter", kind: "web", stack: "Inter, sans-serif" } } }).fonts[0].value, '"Inter", sans-serif');
});

test("flatten never invents values: every css value traces to the token set", () => {
  const f = flatten(set());
  assert.deepEqual(f.colors.slice(0, 4).map((c) => c.name), ["background", "text", "accent", "border"]);
  assert.deepEqual(f.space.map((s) => [s.name, s.onGrid]), [["5px", false], ["1", true], ["2", true], ["3", true]]);
  assert.deepEqual(f.radius.map((r) => r.name), ["sm", "md", "full"]);
});
