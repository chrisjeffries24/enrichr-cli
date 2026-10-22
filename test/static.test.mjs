import test from "node:test";
import assert from "node:assert/strict";
import { captureStatic, findStyles, resolveVars } from "../src/static.mjs";
import { buildTokens } from "../src/tokens.mjs";
import { startFixture } from "./fixtures.mjs";

test("findStyles reads link and style tags in any attribute order", () => {
  const html = `<link href="/a.css" rel="stylesheet"><link rel='stylesheet' media=print href=b.css><link rel="icon" href="/x.ico"><link rel="preload" as="style" href="/c.css"><style media="all">a{color:red}</style>`;
  const { links, inline } = findStyles(html, "https://x.com/dir/");
  assert.deepEqual(links, ["https://x.com/a.css", "https://x.com/dir/b.css"]);
  assert.deepEqual(inline, ["a{color:red}"]);
});

test("resolveVars follows chains and fallbacks and leaves unknowns alone", () => {
  const m = new Map([["--a", "var(--b)"], ["--b", "#123456"]]);
  assert.equal(resolveVars("var(--a)", m), "#123456");
  assert.equal(resolveVars("var(--missing, 8px)", m), "8px");
  assert.equal(resolveVars("var(--missing)", m), "var(--missing)");
  assert.equal(resolveVars("calc(var(--b) + 1px)", m), "calc(#123456 + 1px)");
  const loop = new Map([["--x", "var(--y)"], ["--y", "var(--x)"]]);
  assert.doesNotThrow(() => resolveVars("var(--x)", loop));
});

test("static capture of the fixture site finds its fonts, colors, variables and radii", async () => {
  const site = await startFixture();
  try {
    const raw = await captureStatic(site.url, { timeoutMs: 5000 });
    const set = buildTokens(raw, { version: "test", url: site.url });
    assert.equal(set.mode, "static");
    assert.equal(set.title, "Fixture Co");
    assert.equal(set.fonts.body.name, "Not Installed Anywhere");
    assert.equal(set.fonts.heading.name, "Fixture UI");
    const hexes = set.colors.palette.map((c) => c.hex);
    for (const h of ["#3b5bdb", "#101828", "#ffffff"]) assert.ok(hexes.includes(h), `${h} in ${hexes}`);
    const cp = set.customProperties.all.filter((p) => p.scope === "default");
    assert.equal(cp.find((p) => p.name === "--brand").hex, "#3b5bdb");
    assert.equal(cp.find((p) => p.name === "--radius-card").type, "size");
    assert.equal(cp.find((p) => p.name === "--ease-out").type, "easing");
    assert.equal(cp.find((p) => p.name === "--font-ui").type, "font");
    assert.equal(cp.find((p) => p.name === "--shadow-card").type, "shadow");
    assert.deepEqual(set.customProperties.scopes.sort(), ["dark", "default"]);
    assert.ok(set.radii.some((r) => r.value === "9999px"));
    assert.deepEqual(set.breakpoints.map((b) => b.px).sort((a, b) => a - b), [768, 1024]);
    assert.ok(set.typeScale.some((t) => t.size === 48), "48px heading size");
    assert.ok(set.notes.some((n) => /without a browser/.test(n)), "says it did not use a browser");
  } finally {
    await site.close();
  }
});

test("an unreachable address gives a readable error", async () => {
  await assert.rejects(captureStatic("http://127.0.0.1:1/", { timeoutMs: 2000 }), /Could not fetch http:\/\/127\.0\.0\.1:1\//);
});
