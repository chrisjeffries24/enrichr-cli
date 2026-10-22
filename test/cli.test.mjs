import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { main } from "../src/cli.mjs";
import { candidatePaths, findBrowser, launchArgs } from "../src/chrome.mjs";
import { startFixture } from "./fixtures.mjs";

const sink = () => { const s = { text: "", isTTY: false, write(t) { s.text += t; } }; return s; };
const run = async (argv, env = {}, extra = {}) => {
  const stdout = sink(); const stderr = sink();
  const code = await main(argv, { stdout, stderr, env, ...extra });
  return { code, out: stdout.text, err: stderr.text };
};

test("--help and --version exit 0 and print something useful", async () => {
  const h = await run(["--help"]);
  assert.equal(h.code, 0);
  assert.match(h.out, /Usage/);
  assert.match(h.out, /enrichr deep/);
  assert.match(h.out, /Nothing is sent anywhere except by "deep"/);
  const v = await run(["--version"]);
  assert.equal(v.code, 0);
  assert.match(v.out, /^\d+\.\d+\.\d+\n$/);
  assert.equal((await run([])).code, 0);
});

test("usage errors exit 2 and say what to do", async () => {
  for (const argv of [["tokens"], ["tokens", "x.com", "--wat"], ["tokens", "file:///etc/passwd"], ["fonts", "x.com", "--format", "css"]]) {
    const r = await run(argv);
    assert.equal(r.code, 2, argv.join(" "));
    assert.match(r.err, /^enrichr: /);
    assert.equal(r.out, "");
  }
  assert.match((await run(["fonts", "x.com", "--format", "css"])).err, /needs the tokens command/);
  assert.match((await run(["motion", "x.com", "--static"])).err, /needs a real browser/);
});

test("doctor reports node, browser and key without printing the key", async () => {
  const r = await run(["doctor"], { ENRICHR_API_KEY: "enrichr_secretvalue", PATH: "" });
  assert.equal(r.code, 0);
  assert.match(r.out, /Node/);
  assert.match(r.out, /ENRICHR_API_KEY is set/);
  assert.ok(!r.out.includes("secretvalue"));
});

test("deep without a key fails with the fix and exit 1", async () => {
  const r = await run(["deep", "stripe.com"], {});
  assert.equal(r.code, 1);
  assert.match(r.err, /No Enrichr API key/);
  assert.match(r.err, /account\.html/);
});

test("deep talks to ENRICHR_URL and prints the tool's text; the key never reaches stdout or stderr", async () => {
  let seen;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      seen = { headers: req.headers, body: JSON.parse(body), url: req.url };
      res.writeHead(200, { "content-type": "application/json", "x-credits-remaining": "28", "x-plan": "free" });
      res.end(JSON.stringify({ content: [{ type: "text", text: "DEEP RESULT" }] }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const r = await run(["deep", "stripe.com", "--tool", "animations"], { ENRICHR_API_KEY: "enrichr_topsecret", ENRICHR_URL: `http://127.0.0.1:${server.address().port}` });
    assert.equal(r.code, 0);
    assert.equal(r.out, "DEEP RESULT\n");
    assert.match(r.err, /28 credits left/);
    assert.ok(!(r.out + r.err).includes("topsecret"));
    assert.equal(seen.url, "/mcp/invoke");
    assert.equal(seen.headers["x-api-key"], "enrichr_topsecret");
    assert.deepEqual(seen.body, { tool: "reverse_engineer_animations", arguments: { url: "https://stripe.com/" } });
  } finally {
    server.close();
  }
});

test("with no browser, tokens falls back to reading CSS and says so", async () => {
  const site = await startFixture();
  try {
    const none = { findBrowser: () => null };
    const r = await run(["tokens", site.url, "--json", "--chrome", "/definitely/not/here"], {}, none);
    assert.equal(r.code, 1, "an explicit browser that does not exist is an error, not a silent fallback");
    assert.match(r.err, /does not exist/);
    const fb = await run(["tokens", site.url, "--json"], {}, none);
    assert.equal(fb.code, 0);
    assert.equal(JSON.parse(fb.out).mode, "static");
    assert.ok(JSON.parse(fb.out).notes.some((n) => /without a browser/.test(n)));
    const m = await run(["motion", site.url], {}, none);
    assert.equal(m.code, 1);
    assert.match(m.err, /No Chrome, Edge, Brave or Chromium found/);
  } finally {
    await site.close();
  }
});

test("--static --format css and --out write real files", async () => {
  const site = await startFixture();
  const dir = mkdtempSync(join(tmpdir(), "enrichr-cli-test-"));
  try {
    const css = await run(["tokens", site.url, "--static", "--format", "css"]);
    assert.equal(css.code, 0);
    assert.match(css.out, /--color-accent: #3b5bdb;|--color-palette-\d: #3b5bdb;/);
    const file = join(dir, "tokens.json");
    const r = await run(["colors", site.url, "--static", "--out", file]);
    assert.equal(r.code, 0);
    assert.equal(r.out, "");
    assert.match(r.err, /Wrote /);
    const json = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(json.mode, "static");
    assert.ok(json.colors.palette.length > 3);
    assert.equal(json.fonts, undefined, "colors command does not include fonts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await site.close();
  }
});

test("browser discovery: explicit and env paths must exist; defaults are per platform", () => {
  assert.equal(findBrowser({ explicit: "/x/chrome", exists: () => false }), null);
  assert.equal(findBrowser({ explicit: "/x/chrome", exists: (p) => p === "/x/chrome" }), "/x/chrome");
  assert.equal(findBrowser({ env: { CHROME_PATH: "/y/c" }, exists: (p) => p === "/y/c" }), "/y/c");
  assert.ok(candidatePaths("win32", { PROGRAMFILES: "C:\\Program Files" }).some((p) => /Google.*chrome\.exe$/.test(p)));
  assert.ok(candidatePaths("darwin", {}).some((p) => p.includes("Google Chrome.app")));
  assert.ok(candidatePaths("linux", { PATH: "/usr/bin" }).some((p) => p.endsWith("google-chrome")));
  assert.equal(findBrowser({ platform: "linux", env: { PATH: "/usr/bin" }, exists: (p) => p.endsWith("/chromium") }), "/usr/bin/chromium");
});

test("launch flags: headless, throwaway profile, no sandbox only for root", () => {
  const a = launchArgs("/tmp/p", { root: false, viewport: { width: 1440, height: 900 } });
  assert.ok(a.includes("--headless=new"));
  assert.ok(a.includes("--user-data-dir=/tmp/p"));
  assert.ok(a.includes("--window-size=1440,900"));
  assert.ok(!a.includes("--no-sandbox"));
  assert.ok(launchArgs("/tmp/p", { root: true }).includes("--no-sandbox"));
  assert.equal(a.at(-1), "about:blank");
});
