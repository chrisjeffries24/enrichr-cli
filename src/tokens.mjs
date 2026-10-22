/**
 * Turns what a capture (browser or static) found into one stable token set. Every formatter reads this shape.
 * `schema` changes only when a field is removed or changes meaning.
 */
import { contrast, distance, parseColor, toHex } from "./color.mjs";

export const SCHEMA = 1;

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong"]);

/** First family named in a CSS font-family stack, without quotes. */
export function firstFamily(stack) {
  const m = String(stack || "").match(/^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/);
  return m ? (m[1] || m[2] || m[3] || "").trim() : "";
}

/** A color plus at least two lengths, outside any gradient or url: "0 4px 12px rgba(0,0,0,.1)". */
function looksLikeShadow(v) {
  if (/gradient|url\(/i.test(v)) return false;
  const hasColor = /(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(|#[0-9a-f]{3,8}\b/i.test(v);
  if (!hasColor) return false;
  const rest = v.replace(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)/gi, " ").replace(/#[0-9a-f]{3,8}\b/gi, " ");
  return (rest.match(/(?:^|[\s,])-?[\d.]+(?:px|rem|em)?(?=[\s,]|$)/g) || []).length >= 2;
}

export function classifyVar(name, value) {
  const v = String(value ?? "").trim();
  if (!v) return "other";
  if (parseColor(v) || /^(oklch|oklab|lab|lch|hwb|color)\(/i.test(v)) return "color";
  if (/\b(cubic-bezier|steps)\(|^(ease|ease-in|ease-out|ease-in-out|linear)$/i.test(v)) return "easing";
  if (/^-?[\d.]+m?s$/.test(v)) return "duration";
  if (/font|family/i.test(name) && !/size|weight|height|style/i.test(name)) return "font";
  if (/^(?:["'][^"']+["']|(?:-apple-system|system-ui|ui-[a-z-]+|sans-serif|serif|monospace)\b)/i.test(v) && /,|["']/.test(v)) return "font";
  if (/shadow/i.test(name) || looksLikeShadow(v)) return "shadow";
  if (/^-?[\d.]+(px|rem|em|%|vw|vh|ch|cqw|svh|dvh)$/.test(v) || /^(calc|clamp|min|max)\(/.test(v)) return "size";
  return "other";
}

export function buildTokens(raw, { version = "0.0.0", url } = {}) {
  const notes = [];
  const mode = raw.mode || "browser";
  const palette = (raw.colors?.colors || []).map((c) => ({
    hex: c.hex,
    score: c.score,
    share: { text: c.text, background: c.background, border: c.border, graphic: c.graphic },
    saturation: c.sat,
    lightness: c.light,
  }));
  const roles = pickColorRoles(palette);

  const fonts = buildFonts(raw);
  const customProperties = buildCustomProperties(raw);

  // Type scale: group the probe's (size, weight, line height) rows by size and keep the dominant style of each size.
  const bySize = new Map();
  for (const r of raw.tokens?.typeScale || []) {
    const e = bySize.get(r.size) || { size: r.size, share: 0, best: r, tags: new Set() };
    e.share += r.share;
    if (r.chars > e.best.chars) e.best = r;
    r.tags.forEach((t) => e.tags.add(t));
    bySize.set(r.size, e);
  }
  const typeScale = [...bySize.values()]
    // Keep what carries the page, plus every size a heading uses: headings are few characters but they are the scale.
    .filter((e) => e.share >= 1 || [...e.tags].some((t) => /^h[1-4]$/.test(t)))
    .sort((a, b) => (headingRank(b) - headingRank(a)) || (b.share - a.share))
    .slice(0, 12)
    .sort((a, b) => a.size - b.size)
    .map((e) => ({
      size: e.size,
      weight: Number(e.best.weight) || e.best.weight,
      lineHeight: e.best.lineHeight,
      letterSpacing: e.best.letterSpacing,
      share: Math.round(e.share * 10) / 10,
      tags: [...e.tags].slice(0, 4),
    }));

  if (mode === "static") notes.push("Read from the page's CSS without a browser: values are as written, not as rendered. Colors and fonts are ranked by how often they are declared, not by how much of the page they cover.");
  if (mode === "browser" && !customProperties.count) notes.push("This site declares no custom properties on the root element, so there are no named tokens to list. The values above are measured from what renders.");
  if (raw.meta?.status && raw.meta.status >= 400) notes.push(`The page answered HTTP ${raw.meta.status}; these tokens describe that response, which may be an error or login page.`);

  const sheetCount = raw.css?.sheets;
  return {
    schema: SCHEMA,
    tool: "enrichr-cli",
    version,
    url: url || raw.meta?.url || "",
    finalUrl: raw.meta?.url || "",
    title: raw.meta?.title || "",
    capturedAt: new Date().toISOString(),
    mode,
    viewport: raw.meta?.viewport || null,
    scheme: raw.meta?.scheme || null,
    notes,
    colors: { roles, palette: palette.slice(0, 16) },
    fonts,
    typeScale,
    spacing: raw.tokens?.spacing || null,
    radii: raw.tokens?.radii || [],
    shadows: raw.tokens?.shadows || [],
    containers: raw.tokens?.containers || [],
    breakpoints: (raw.breakpoints || []).slice(0, 8),
    transitions: raw.tokens?.transitions || { durations: [], easings: [] },
    customProperties,
    sources: { stylesheets: sheetCount ?? null, rules: raw.css?.rules ?? null },
  };
}

const headingRank = (e) => ([...e.tags].some((t) => /^h[1-4]$/.test(t)) ? 1 : 0);

/** Background, text, accent and border, picked by measured coverage. These are guesses and are labelled as such. */
export function pickColorRoles(palette) {
  if (!palette.length) return { background: null, text: null, accent: null, border: null, contrast: null };
  const by = (k) => [...palette].sort((a, b) => b.share[k] - a.share[k]);
  const bg = by("background")[0].share.background > 0 ? by("background")[0] : palette[0];
  const text = by("text").find((c) => c.hex !== bg.hex && c.share.text > 0) || null;
  const bgRgb = parseColor(bg.hex);
  const textRgb = text && parseColor(text.hex);
  const accent = [...palette]
    .map((c) => ({ ...c, chroma: c.saturation * (1 - Math.abs(2 * c.lightness - 1)) }))
    .filter((c) => c.hex !== bg.hex && c.hex !== text?.hex && c.chroma >= 0.25)
    .filter((c) => !bgRgb || distance(parseColor(c.hex), bgRgb) > 60)
    // vivid beats pale: a pale tint covering more text than the real brand color should not win
    .sort((a, b) => b.score * b.chroma - a.score * a.chroma)[0] || null;
  const border = by("border").find((c) => c.share.border > 0 && c.hex !== bg.hex) || null;
  return {
    background: bg.hex,
    text: text?.hex || null,
    accent: accent?.hex || null,
    border: border?.hex || null,
    contrast: bgRgb && textRgb ? contrast(bgRgb, textRgb) : null,
  };
}

function buildFonts(raw) {
  const rendered = (raw.fonts?.fonts || []).map((f) => ({
    name: f.name, kind: f.kind, share: f.share, weights: f.weights, mainWeight: f.mainWeight, italic: f.italic,
    stack: f.stack, google: !!f.google, files: f.files || [], role: f.role,
  }));
  const roles = raw.tokens?.fontRoles || {};
  const find = (stack) => {
    const fam = firstFamily(stack).toLowerCase();
    if (!fam) return null;
    // The probe groups text by the font that was actually drawn and remembers the stack that led there, so match on the
    // whole stack first: a web font that failed to load then correctly shows as the fallback that took its place.
    const hit = rendered.find((f) => f.stack === stack) || rendered.find((f) => f.name.toLowerCase() === fam);
    if (hit) return hit;
    return { name: firstFamily(stack), kind: GENERIC.has(fam) ? "generic" : "unknown", stack, share: 0, weights: [], files: [], google: false };
  };
  const body = find(roles.body) || rendered[0] || null;
  // Reading CSS alone, a heading with no font-family rule of its own inherits the body font.
  const heading = find(roles.heading) || (raw.mode === "static" ? body : null);
  const code = find(roles.code);
  return {
    heading,
    body,
    code: code && code.kind !== "generic" && code.name !== body?.name ? code : null,
    all: rendered,
    declared: (raw.fontFaces || []).map((f) => ({ family: f.family, weights: f.weights, src: f.src })),
  };
}

function buildCustomProperties(raw) {
  const scopes = raw.vars?.scopes || {};
  const resolved = raw.vars?.resolved || {};
  const all = [];
  const names = new Set();
  for (const [scope, props] of Object.entries(scopes)) {
    for (const [name, rawValue] of Object.entries(props)) {
      const r = scope === "default" ? resolved[name] : null;
      const value = (r && r.value) || rawValue;
      const colorHex = (r && r.hex) || (parseColor(value) ? toHex(parseColor(value)) : "");
      const type = classifyVar(name, value);
      all.push({ name, value, scope, type, ...(type === "color" && colorHex ? { hex: colorHex } : {}) });
      names.add(name);
    }
  }
  const byType = {};
  for (const p of all) (byType[p.type] ||= []).push(p);
  return { count: names.size, scopes: Object.keys(scopes), byType, all };
}
