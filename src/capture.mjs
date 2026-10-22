/**
 * Opens a page in the user's own browser and reads it. The browser is started headless with a throwaway profile,
 * driven over the DevTools protocol, and closed when done.
 *
 * What it reads is the same as the Enrichr Chrome extensions read (the probes are copies of theirs), plus the text of
 * every stylesheet the page loaded. DevTools can read cross-origin stylesheets that scripts on the page cannot, which
 * is how the CLI finds a site's own custom property names where the extensions cannot.
 */
import { readFileSync } from "node:fs";
import { Cdp } from "./cdp.mjs";
import { findBrowser, launchBrowser } from "./chrome.mjs";
import { parseCss, customProperties, fontFaces, breakpoints } from "./css.mjs";

const probeSource = (name) => readFileSync(new URL(`./probes/${name}.js`, import.meta.url), "utf8");

export const VIEWPORTS = { desktop: { width: 1440, height: 900, mobile: false }, tablet: { width: 820, height: 1180, mobile: false }, mobile: { width: 390, height: 844, mobile: true } };

const MAX_CSS_BYTES = 6_000_000;
const MAX_SHEET_BYTES = 2_000_000;

export class NoBrowserError extends Error {
  constructor(explicit) {
    super(explicit
      ? `The browser you named does not exist: ${explicit}`
      : "No Chrome, Edge, Brave or Chromium found. Install one, set CHROME_PATH, or use --static to read the page's CSS without a browser.");
    this.name = "NoBrowserError";
  }
}

/**
 * @param {string} url
 * @param {{ probes: string[], executable?: string, chrome?: string, viewport?: string, scheme?: "light"|"dark", timeoutMs?: number, scroll?: boolean, log?: (m: string) => void }} opts
 */
export async function capture(url, opts) {
  const log = opts.log || (() => {});
  const exe = opts.executable || findBrowser({ explicit: opts.chrome });
  if (!exe) throw new NoBrowserError(opts.chrome || process.env.CHROME_PATH);
  const vp = VIEWPORTS[opts.viewport || "desktop"];
  if (!vp) throw new Error(`Unknown viewport "${opts.viewport}". Use desktop, tablet or mobile.`);
  const timeoutMs = opts.timeoutMs ?? 30_000;

  log(`Starting ${exe.split(/[\\/]/).pop()}…`);
  const browser = await launchBrowser(exe, { viewport: vp });
  let cdp;
  // Nothing below can hang the CLI forever: if the whole read overruns, closing the browser makes every pending call fail.
  const overrun = setTimeout(() => browser.close(), timeoutMs + 45_000);
  try {
    cdp = await Cdp.connect(browser.wsUrl);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (m, p) => cdp.send(m, p, sessionId);
    const mine = (msg) => msg.sessionId === sessionId;

    await Promise.all([send("Page.enable"), send("Network.enable"), send("DOM.enable"), send("Runtime.enable")]);
    await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
    // Without this the page follows the operating system, so the same command gives different colors on a dark-mode machine.
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: opts.scheme === "dark" ? "dark" : "light" }, { name: "prefers-reduced-motion", value: "no-preference" }] });
    // Headless Chrome announces itself as "HeadlessChrome", which some sites answer differently.
    const { userAgent } = await cdp.send("Browser.getVersion");
    await send("Network.setUserAgentOverride", { userAgent: userAgent.replace("HeadlessChrome", "Chrome") });

    const sheets = new Map();
    const inflight = new Set();
    let status = 0;
    let lastActivity = Date.now();
    cdp.on((msg) => {
      if (!mine(msg)) return;
      if (msg.method === "CSS.styleSheetAdded") sheets.set(msg.params.header.styleSheetId, msg.params.header);
      else if (msg.method === "Network.requestWillBeSent" && !["WebSocket", "EventSource", "Ping"].includes(msg.params.type)) { inflight.add(msg.params.requestId); lastActivity = Date.now(); }
      else if (msg.method === "Network.loadingFinished" || msg.method === "Network.loadingFailed") { inflight.delete(msg.params.requestId); lastActivity = Date.now(); }
      else if (msg.method === "Network.responseReceived" && msg.params.type === "Document" && !status) status = msg.params.response.status;
    });
    await send("CSS.enable");

    log(`Loading ${url}…`);
    const loaded = cdp.waitFor((m) => mine(m) && m.method === "Page.loadEventFired", timeoutMs, "the page to load");
    loaded.catch(() => {});
    const nav = await send("Page.navigate", { url });
    if (nav.errorText) throw new Error(`Could not load ${url} (${nav.errorText.replace(/^net::/, "")}).`);
    await loaded;

    // Let late requests, lazy images and web fonts settle, but never wait for a page that never goes quiet.
    const settleBy = Date.now() + Math.min(8000, timeoutMs / 2);
    while (Date.now() < settleBy && (inflight.size > 0 || Date.now() - lastActivity < 700)) await new Promise((r) => setTimeout(r, 100));

    if (opts.scroll !== false) {
      await evaluate(send, `(async () => {
        const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        for (let y = 0; y <= Math.min(h, 12000); y += innerHeight * 0.8) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
        scrollTo(0, 0);
        await new Promise(r => setTimeout(r, 250));
      })()`);
    }
    await evaluate(send, `document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true`).catch(() => {});

    const meta = await evaluate(send, `({ url: location.href, title: document.title, lang: document.documentElement.lang || "", generator: (document.querySelector('meta[name=generator]')||{}).content || "", colorScheme: (document.querySelector('meta[name=color-scheme]')||{}).content || "" })`);

    // Stylesheet text, including sheets the page itself is not allowed to read.
    let budget = MAX_CSS_BYTES;
    const cssTexts = [];
    for (const [id, header] of sheets) {
      if (budget <= 0) break;
      try {
        const { text } = await send("CSS.getStyleSheetText", { styleSheetId: id });
        if (text.length > MAX_SHEET_BYTES) continue;
        budget -= text.length;
        cssTexts.push({ url: header.sourceURL || (header.isInline ? "(inline)" : ""), text });
      } catch { /* sheet was removed */ }
    }
    const rules = cssTexts.flatMap((s) => parseCss(s.text));

    const result = { meta: { ...meta, status, viewport: opts.viewport || "desktop", scheme: opts.scheme === "dark" ? "dark" : "light", browser: exe }, css: { sheets: cssTexts.length, rules: rules.length } };
    for (const name of opts.probes) {
      log(`Reading ${name}…`);
      result[name] = await evaluate(send, `(function(){ ${probeSource(name)}\n return ${probeFnName(name)}(); })()`);
    }

    // Custom property names come from the CSS text; their values are resolved by the browser so var() chains are final.
    const scopes = customProperties(rules);
    const names = [...new Set([...scopes.values()].flatMap((m) => [...m.keys()]))];
    let resolved = {};
    if (names.length) {
      resolved = await evaluate(send, `(() => {
        const cs = getComputedStyle(document.documentElement);
        const cx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        cx.canvas.width = cx.canvas.height = 1;
        const COLOR = /^(#[0-9a-f]{3,8}|rgba?\\(|hsla?\\(|hwb\\(|oklch\\(|oklab\\(|lab\\(|lch\\(|color\\()/i;
        const hex = (v) => {
          cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#010203"; cx.fillStyle = v;
          if (cx.fillStyle === "#010203" && !/010203/i.test(v)) return "";
          cx.fillRect(0, 0, 1, 1);
          const d = cx.getImageData(0, 0, 1, 1).data;
          return d[3] < 40 ? "" : "#" + [d[0], d[1], d[2]].map((x) => x.toString(16).padStart(2, "0")).join("");
        };
        const o = {};
        for (const n of ${JSON.stringify(names)}) {
          const v = cs.getPropertyValue(n).trim();
          o[n] = COLOR.test(v) ? { value: v, hex: hex(v) } : { value: v };
        }
        return o;
      })()`);
    }
    result.vars = { scopes: Object.fromEntries([...scopes].map(([k, m]) => [k, Object.fromEntries(m)])), resolved };
    result.fontFaces = fontFaces(rules);
    result.breakpoints = breakpoints(rules);
    return result;
  } finally {
    clearTimeout(overrun);
    cdp?.close();
    browser.close();
  }
}

function probeFnName(name) {
  return { fonts: "probeFonts", colors: "probeColors", motion: "probeMotion", tokens: "probeTokens" }[name];
}

async function evaluate(send, expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`The page rejected a read: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}
