/**
 * A forgiving CSS reader. It is not a validator: it turns stylesheet text into a flat list of rules so the CLI can
 * read custom properties, @font-face declarations, breakpoints and literal colors from CSS it fetched or was handed
 * by the browser. Strings, url(...), comments and nested blocks are handled; @keyframes bodies are skipped.
 *
 * Each rule: { selector, at: ["media (min-width: 768px)", ...], decls: [[prop, value], ...] }
 * @font-face is reported as a rule whose selector is "@font-face".
 */

const GROUPING = new Set(["media", "supports", "layer", "container", "document", "scope", "starting-style", "-moz-document"]);

export function parseCss(input) {
  const text = String(input ?? "");
  const rules = [];
  /** Open blocks, innermost last: { kind: "group"|"rule"|"skip", selector, at, decls } */
  const stack = [];
  let buf = "";
  let i = 0;
  const n = text.length;
  const atPath = () => stack.filter((b) => b.kind === "group").map((b) => b.selector);

  const flushDecl = () => {
    const top = stack[stack.length - 1];
    const s = buf.trim();
    buf = "";
    if (!s || !top || top.kind !== "rule") return;
    const colon = s.indexOf(":");
    if (colon < 1) return;
    top.decls.push([s.slice(0, colon).trim(), s.slice(colon + 1).trim().replace(/\s*!important$/i, "")]);
  };

  while (i < n) {
    const ch = text[i];

    // comments
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }

    const top = stack[stack.length - 1];
    if (top && top.kind === "skip") {
      // inside @keyframes and friends: only track braces
      if (ch === "{") top.depth++;
      else if (ch === "}") { if (--top.depth === 0) stack.pop(); }
      else if (ch === '"' || ch === "'") i = skipString(text, i);
      i++;
      continue;
    }

    // strings and url(...) can hold ; { } that mean nothing
    if (ch === '"' || ch === "'") {
      const end = skipString(text, i);
      buf += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if ((ch === "u" || ch === "U") && /^url\(/i.test(text.slice(i, i + 4))) {
      let j = i + 4;
      while (text[j] === " ") j++;
      if (text[j] === '"' || text[j] === "'") {
        const end = skipString(text, j);
        const close = text.indexOf(")", end);
        const stop = close < 0 ? n : close + 1;
        buf += text.slice(i, stop);
        i = stop;
      } else {
        const close = text.indexOf(")", i);
        const stop = close < 0 ? n : close + 1;
        buf += text.slice(i, stop);
        i = stop;
      }
      continue;
    }

    if (ch === ";") {
      const s = buf.trim();
      // "@import url(x);" and "@charset" at top level are statements, not declarations
      buf = "";
      if (top && top.kind === "rule" && s) {
        const colon = s.indexOf(":");
        if (colon > 0) top.decls.push([s.slice(0, colon).trim(), s.slice(colon + 1).trim().replace(/\s*!important$/i, "")]);
      }
      i++;
      continue;
    }

    if (ch === "{") {
      const prelude = buf.trim().replace(/\s+/g, " ");
      buf = "";
      if (prelude.startsWith("@")) {
        const name = (prelude.slice(1).match(/^[a-z-]+/i) || [""])[0].toLowerCase();
        if (GROUPING.has(name)) stack.push({ kind: "group", selector: prelude.slice(1) });
        else if (name === "font-face" || name === "property" || name === "page" || name === "font-palette-values") stack.push({ kind: "rule", selector: "@" + name, decls: [], at: atPath() });
        else stack.push({ kind: "skip", depth: 1 });
      } else {
        stack.push({ kind: "rule", selector: prelude, decls: [], at: atPath() });
      }
      i++;
      continue;
    }

    if (ch === "}") {
      flushDecl();
      const done = stack.pop();
      if (done && done.kind === "rule") rules.push({ selector: done.selector, at: done.at, decls: done.decls });
      i++;
      continue;
    }

    buf += ch;
    i++;
  }
  return rules;
}

function skipString(text, start) {
  const q = text[start];
  let j = start + 1;
  while (j < text.length && text[j] !== q) j += text[j] === "\\" ? 2 : 1;
  return Math.min(j, text.length - 1);
}

/** Selectors that set page-wide variables. Theme variants are reported with a scope so light and dark do not collide. */
const ROOTISH = /(^|,)\s*(:root|html|body|:host)\b/;

export function scopeOf(rule) {
  const sel = rule.selector;
  const at = rule.at.join(" ");
  if (/prefers-color-scheme:\s*dark/.test(at)) return "dark";
  if (/prefers-color-scheme:\s*light/.test(at)) return "light";
  if (/(\.dark\b|\[data-theme=["']?dark|\[data-mode=["']?dark|\[data-color-scheme=["']?dark|\.theme-dark)/i.test(sel)) return "dark";
  if (/(\.light\b|\[data-theme=["']?light|\.theme-light)/i.test(sel)) return "light";
  return null;
}

/** Custom properties declared on the root element or its variants. Later declarations win within a scope. */
export function customProperties(rules) {
  const byScope = new Map();
  for (const r of rules) {
    const themed = scopeOf(r);
    if (!ROOTISH.test(r.selector) && !themed) continue;
    // a themed selector like ".dark .card" is not a token source; require it to be root-ish or a bare theme selector
    if (!ROOTISH.test(r.selector) && /\s/.test(r.selector.replace(/\[[^\]]*\]/g, ""))) continue;
    const scope = themed || "default";
    const m = byScope.get(scope) || new Map();
    for (const [p, v] of r.decls) if (p.startsWith("--")) m.set(p, v);
    byScope.set(scope, m);
  }
  return byScope;
}

/** The families a page declares with @font-face, with their first source url. */
export function fontFaces(rules) {
  const out = new Map();
  for (const r of rules) {
    if (r.selector !== "@font-face") continue;
    const d = Object.fromEntries(r.decls);
    const family = (d["font-family"] || "").replace(/^["']|["']$/g, "").trim();
    if (!family) continue;
    const e = out.get(family) || { family, weights: new Set(), styles: new Set(), src: "" };
    if (d["font-weight"]) e.weights.add(d["font-weight"]);
    if (d["font-style"]) e.styles.add(d["font-style"]);
    const m = (d.src || "").match(/url\(\s*["']?([^"')]+)["']?\s*\)/i);
    if (m && !e.src) e.src = m[1];
    out.set(family, e);
  }
  return [...out.values()].map((e) => ({ family: e.family, weights: [...e.weights], styles: [...e.styles], src: e.src }));
}

/** min-width / max-width pixel breakpoints used in media queries, most common first. */
export function breakpoints(rules) {
  const count = new Map();
  for (const r of rules) {
    for (const a of r.at) {
      if (!/^media/.test(a)) continue;
      for (const m of a.matchAll(/\(\s*(?:min|max)-width:\s*([\d.]+)(px|em|rem)\s*\)/g)) {
        const px = m[2] === "px" ? Number(m[1]) : Number(m[1]) * 16;
        if (px >= 320 && px <= 2560) count.set(Math.round(px), (count.get(Math.round(px)) || 0) + 1);
      }
    }
  }
  // "(min-width: 640px)" and "(max-width: 639px)" are one breakpoint: keep the busier of any pair one pixel apart.
  const list = [...count.entries()].map(([px, uses]) => ({ px, uses })).sort((a, b) => a.px - b.px);
  const dropped = new Set();
  for (const b of list) {
    const prev = list.find((o) => o.px === b.px - 1 && !dropped.has(o));
    if (prev) dropped.add(prev.uses > b.uses ? b : prev);
  }
  return list.filter((b) => !dropped.has(b)).sort((a, b) => b.uses - a.uses || a.px - b.px);
}
