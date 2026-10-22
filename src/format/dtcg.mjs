import { flatten } from "./flat.mjs";

/** "rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, ..." -> DTCG shadow objects. Inset shadows keep their flag. */
export function parseShadow(value) {
  const layers = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { layers.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) layers.push(cur);
  const out = layers.map((l) => {
    const color = (l.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/i) || [""])[0];
    const nums = (l.replace(color, "").match(/-?[\d.]+px|\b0\b/g) || []).map((n) => (n === "0" ? "0px" : n));
    if (!color || nums.length < 2) return null;
    return { color, offsetX: nums[0], offsetY: nums[1], blur: nums[2] || "0px", spread: nums[3] || "0px", ...(/\binset\b/.test(l) ? { inset: true } : {}) };
  });
  return out.every(Boolean) && out.length ? (out.length === 1 ? out[0] : out) : null;
}

/** W3C Design Tokens Community Group format (the $value / $type shape Style Dictionary and Tokens Studio read). */
export function toDtcg(set) {
  const f = flatten(set);
  const group = (items, type, map = (i) => i.value) => Object.fromEntries(items.map((i) => [i.name, { $value: map(i), $type: type }]));
  const out = {
    $description: `Measured from ${set.finalUrl || set.url} by enrichr-cli ${set.version} on ${set.capturedAt.slice(0, 10)}.`,
    color: group(f.colors, "color"),
    fontFamily: group(f.fonts, "fontFamily", (i) => [i.family, ...i.value.split(",").slice(1).map((s) => s.trim())]),
    fontSize: group(f.text, "dimension", (t) => `${t.size}px`),
    spacing: group(f.space, "dimension"),
    borderRadius: group(f.radius, "dimension"),
    shadow: group(f.shadow.filter((x) => parseShadow(x.value)), "shadow", (x) => parseShadow(x.value)),
    duration: group(f.durations, "duration"),
    cubicBezier: group(f.easings.filter((e) => e.value.startsWith("cubic-bezier")), "cubicBezier", (e) => e.value.match(/[\d.]+/g).slice(0, 4).map(Number)),
  };
  for (const k of Object.keys(out)) if (k !== "$description" && !Object.keys(out[k]).length) delete out[k];
  return JSON.stringify(out, null, 2) + "\n";
}
