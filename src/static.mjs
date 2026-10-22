/**
 * Reads a page's CSS without a browser: fetch the HTML, fetch its stylesheets, parse them. Fast and dependency-free,
 * and good enough for CI or a machine with no Chrome. It sees what the CSS says, not what rendered, so it cannot
 * tell which colors cover the page or whether a font loaded. Output says so.
 */
import { parseCss, customProperties, fontFaces, breakpoints } from "./css.mjs";
import { parseColor, saturation, toHex } from "./color.mjs";
import { firstFamily } from "./tokens.mjs";

const MAX_SHEETS = 15;
const MAX_BYTES = 3_000_000;

async function get(url, { timeoutMs, userAgent }) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": userAgent, accept: "text/html,text/css,*/*;q=0.8" } });
  const text = await res.text();
  return { res, text: text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text };
}

/** Pull stylesheet links and inline <style> blocks out of HTML with a pattern, not a parser: enough for <link> and <style>. */
export function findStyles(html, baseUrl) {
  const links = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) continue;
    const href = (tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || []).slice(1).find(Boolean);
    if (!href) continue;
    try { links.push(new URL(href.replace(/&amp;/g, "&"), baseUrl).href); } catch { /* bad href */ }
  }
  const inline = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  return { links: [...new Set(links)], inline };
}

/** Resolve var(--x) and var(--x, fallback) against a flat map, a few levels deep. */
export function resolveVars(value, map, depth = 0) {
  if (depth > 6 || !value.includes("var(")) return value;
  return resolveVars(value.replace(/var\(\s*(--[^,)\s]+)\s*(?:,\s*([^)]*))?\)/g, (all, name, fb) => (map.has(name) ? map.get(name) : fb !== undefined ? fb.trim() : all)), map, depth + 1);
}

const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;

export async function captureStatic(url, { timeoutMs = 20_000, userAgent = "enrichr-cli (+https://enrichr.dev)", log = () => {} } = {}) {
  log(`Fetching ${url}…`);
  let page;
  try { page = await get(url, { timeoutMs, userAgent }); }
  catch (e) { throw new Error(`Could not fetch ${url} (${e.name === "TimeoutError" ? "timed out" : e.cause?.code || e.message}).`); }
  const finalUrl = page.res.url || url;
  const { links, inline } = findStyles(page.text, finalUrl);

  const texts = [...inline];
  let fetched = 0;
  for (const href of links.slice(0, MAX_SHEETS)) {
    try {
      log(`Fetching ${href.length > 70 ? href.slice(0, 67) + "…" : href}`);
      const { res, text } = await get(href, { timeoutMs, userAgent });
      if (res.ok) { texts.push(text); fetched++; }
    } catch { /* a stylesheet that will not load is not fatal */ }
  }
  const rules = texts.flatMap(parseCss);

  // Custom properties, resolved against the default scope where they chain.
  const scopes = customProperties(rules);
  const flat = new Map(scopes.get("default") || []);
  const resolved = {};
  for (const [name, v] of flat) {
    const value = resolveVars(v, flat).trim();
    const c = parseColor(value);
    resolved[name] = c ? { value, hex: toHex(c) } : { value };
  }

  // Count literal declarations. Colors are bucketed by what the property colors.
  const colorCount = new Map();
  const fam = new Map();
  const sizes = new Map();
  const radii = new Map();
  const shadows = new Map();
  const roles = {};
  for (const r of rules) {
    if (r.selector.startsWith("@")) continue;
    const sel = r.selector.toLowerCase();
    for (const [prop, rawValue] of r.decls) {
      const value = resolveVars(rawValue, flat);
      const p = prop.toLowerCase();
      if (p === "font-family") {
        const f = firstFamily(value);
        if (f && !f.startsWith("var(")) fam.set(f, (fam.get(f) || 0) + 1);
        if (/(^|[\s,>])h1\b/.test(sel) || /(^|[\s,>])h2\b/.test(sel)) roles.heading ||= value;
        else if (/(^|,)\s*(body|html)\b/.test(sel)) roles.body ||= value;
        else if (/(^|[\s,>])(pre|code|kbd|samp)\b/.test(sel)) roles.code ||= value;
      }
      if (p === "font-size") {
        const m = value.match(/^([\d.]+)(px|rem|em)$/);
        if (m) {
          const px = Math.round(Number(m[1]) * (m[2] === "px" ? 1 : 16) * 2) / 2;
          if (px >= 8 && px <= 120) sizes.set(px, (sizes.get(px) || 0) + 1);
        }
      }
      if (p === "border-radius" || /^border-(top|bottom)-(left|right)-radius$/.test(p)) {
        const m = value.trim().match(/^([\d.]+)(px|rem)$/);
        if (m) { const px = Math.round(Number(m[1]) * (m[2] === "px" ? 1 : 16)) + "px"; radii.set(px, (radii.get(px) || 0) + 1); }
        else if (/^(9999px|50%|999px|100%)$/.test(value.trim())) radii.set("9999px", (radii.get("9999px") || 0) + 1);
      }
      if (p === "box-shadow" && value !== "none" && !value.includes("var(")) shadows.set(value.trim(), (shadows.get(value.trim()) || 0) + 1);

      const bucket = p === "color" ? "text" : /^background/.test(p) ? "background" : /^(border|outline)/.test(p) ? "border" : /^(fill|stroke)$/.test(p) ? "graphic" : null;
      if (!bucket) continue;
      for (const lit of value.match(COLOR_LITERAL) || []) {
        const c = parseColor(lit);
        if (!c || c[3] < 0.15) continue;
        const key = toHex(c);
        const e = colorCount.get(key) || { rgb: c, n: { text: 0, background: 0, border: 0, graphic: 0 } };
        e.n[bucket]++;
        colorCount.set(key, e);
      }
    }
  }

  const tot = { text: 0, background: 0, border: 0, graphic: 0 };
  for (const e of colorCount.values()) for (const k in tot) tot[k] += e.n[k];
  const pct = (n, k) => (tot[k] ? Math.round((n / tot[k]) * 1000) / 10 : 0);
  const colors = [...colorCount.entries()].map(([hex, e]) => {
    const sat = saturation(e.rgb);
    const score = ["text", "background", "border", "graphic"].reduce((a, k) => a + (tot[k] ? e.n[k] / tot[k] : 0), 0);
    return { hex, rgb: e.rgb.slice(0, 3), sat: Math.round(sat * 100) / 100, light: Math.round(((Math.max(...e.rgb.slice(0, 3)) + Math.min(...e.rgb.slice(0, 3))) / 510) * 100) / 100, score: Math.round(score * 1000) / 1000, text: pct(e.n.text, "text"), background: pct(e.n.background, "background"), border: pct(e.n.border, "border"), graphic: pct(e.n.graphic, "graphic") };
  }).sort((a, b) => b.score - a.score).slice(0, 30);

  const famTotal = [...fam.values()].reduce((a, b) => a + b, 0);
  const fonts = [...fam.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({
    name, kind: "declared", requested: "", stack: "", share: famTotal ? Math.round((n / famTotal) * 1000) / 10 : 0, chars: n, role: "", mainWeight: 400, weights: [], sizes: [], italic: false, google: false, files: [],
  }));

  const sizeTotal = [...sizes.values()].reduce((a, b) => a + b, 0);
  const typeScale = [...sizes.entries()].map(([size, n]) => ({ size, weight: "", lineHeight: "", letterSpacing: "", chars: n, tags: [], share: sizeTotal ? Math.round((n / sizeTotal) * 1000) / 10 : 0 }));
  const top = (m, k) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([value, uses]) => ({ value, uses }));

  const title = (page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.replace(/\s+/g, " ").trim() || "";
  return {
    mode: "static",
    meta: { url: finalUrl, title, status: page.res.status, viewport: null, scheme: null },
    css: { sheets: fetched + inline.length, rules: rules.length },
    colors: { colors },
    fonts: { fonts, totalChars: famTotal },
    tokens: { typeScale, fontRoles: roles, spacing: null, radii: top(radii, 8), shadows: top(shadows, 6), containers: [], transitions: { durations: [], easings: [] } },
    vars: { scopes: Object.fromEntries([...scopes].map(([k, m]) => [k, Object.fromEntries(m)])), resolved },
    fontFaces: fontFaces(rules),
    breakpoints: breakpoints(rules),
  };
}
