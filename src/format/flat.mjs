/**
 * Gives every measured value a short, predictable name, once, so the CSS, Tailwind and design-token outputs agree.
 * Names describe rank or size, never a guess at the designer's intent (the site's own names are in customProperties).
 */

const ABOVE = ["lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl"];
const BELOW = ["sm", "xs", "2xs", "3xs", "4xs", "5xs"];

export function textScaleNames(typeScale) {
  if (!typeScale?.length) return [];
  // "base" is the size that carries the most body text near 16px, else the size nearest 16
  const near = typeScale.filter((t) => t.size >= 14 && t.size <= 18);
  const base = (near.length ? near : typeScale).reduce((best, t) => {
    const score = near.length ? t.share : -Math.abs(t.size - 16);
    const bestScore = near.length ? best.share : -Math.abs(best.size - 16);
    return score > bestScore ? t : best;
  });
  const idx = typeScale.indexOf(base);
  return typeScale.map((t, i) => {
    const d = i - idx;
    const name = d === 0 ? "base" : d > 0 ? ABOVE[d - 1] ?? `step-${d}` : BELOW[-d - 1] ?? `step-${d}`;
    return { name, ...t };
  });
}

export function radiusNames(radii) {
  const items = (radii || []).map((r) => ({ value: r.value, n: r.value === "9999px" ? Infinity : parseFloat(r.value) }));
  const finite = items.filter((r) => Number.isFinite(r.n)).sort((a, b) => a.n - b.n);
  const labels = ["sm", "md", "lg", "xl", "2xl", "3xl"];
  const out = finite.slice(0, labels.length).map((r, i) => ({ name: labels[i], value: r.value }));
  if (items.some((r) => r.n === Infinity)) out.push({ name: "full", value: "9999px" });
  return out;
}

/** Shadows ordered by blur (the third length), softest first. */
export function shadowNames(shadows) {
  const blur = (v) => (v.match(/-?[\d.]+px/g) || [])[2] ? parseFloat((v.match(/-?[\d.]+px/g) || [])[2]) : 0;
  return [...(shadows || [])].sort((a, b) => blur(a.value) - blur(b.value)).slice(0, 5).map((s, i) => ({ name: String(i + 1), value: s.value }));
}

export function spaceNames(spacing) {
  if (!spacing?.values?.length) return [];
  const base = spacing.base;
  const picks = spacing.values.filter((v) => v.uses >= 3).sort((a, b) => a.px - b.px).slice(0, 12);
  return picks.map((v) => ({ name: base && v.px % base === 0 ? String(v.px / base) : `${v.px}px`, value: `${v.px}px`, onGrid: !base || v.px % base === 0 }))
    .filter((v, i, a) => a.findIndex((x) => x.name === v.name) === i);
}

/** Everything a token file needs, as plain groups. */
export function flatten(set) {
  const roles = set.colors?.roles || {};
  const colors = [];
  const used = new Set();
  for (const k of ["background", "text", "accent", "border"]) {
    if (roles[k]) { colors.push({ name: k, value: roles[k] }); used.add(roles[k]); }
  }
  let n = 0;
  for (const c of set.colors?.palette || []) {
    if (used.has(c.hex) || n >= 10) continue;
    colors.push({ name: `palette-${++n}`, value: c.hex });
  }
  const fonts = [];
  for (const k of ["heading", "body", "code"]) {
    const f = set.fonts?.[k];
    if (f?.name) fonts.push({ name: k, value: fontStack(f), family: f.name, kind: f.kind });
  }
  return {
    colors,
    fonts,
    text: textScaleNames(set.typeScale),
    space: spaceNames(set.spacing),
    radius: radiusNames(set.radii),
    shadow: shadowNames(set.shadows),
    durations: (set.transitions?.durations || []).slice(0, 3).map((d, i) => ({ name: String(i + 1), value: d.value })),
    easings: (set.transitions?.easings || []).filter((e) => e.value !== "ease" && e.value !== "linear").slice(0, 3).map((e, i) => ({ name: String(i + 1), value: e.value })),
    breakpoints: (set.breakpoints || []).slice(0, 4).sort((a, b) => a.px - b.px).map((b) => ({ name: `bp-${b.px}`, value: `${b.px}px` })),
  };
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "cursive", "fantasy"]);

/** The family quoted, plus the fallback its own stack used if there was one. */
export function fontStack(f) {
  const quote = (n) => (GENERIC.has(n.toLowerCase()) ? n : `"${n.replace(/"/g, "")}"`);
  const fallback = f.stack ? f.stack.split(",").map((s) => s.trim()).filter((s) => GENERIC.has(s.replace(/^["']|["']$/g, "").toLowerCase())).slice(0, 1) : [];
  const parts = [quote(f.name), ...(fallback.length ? fallback : f.kind === "generic" ? [] : ["system-ui", "sans-serif"])];
  return parts.filter((p, i) => parts.indexOf(p) === i).join(", ");
}
