import { flatten } from "./flat.mjs";

const header = (set) => `/* Design tokens measured from ${set.finalUrl || set.url} by enrichr-cli ${set.version} (${set.mode}${set.scheme ? `, ${set.scheme} scheme` : ""}).\n   Names are by rank or size, not designer intent. */`;

/** CSS custom properties. With `siteVars`, the site's own variables follow, so you can see its naming. */
export function toCss(set, { siteVars = false } = {}) {
  const f = flatten(set);
  const lines = [];
  const add = (prefix, items) => items.forEach((i) => lines.push(`  --${prefix}-${i.name}: ${i.value};`));
  add("color", f.colors);
  add("font", f.fonts);
  f.text.forEach((t) => {
    lines.push(`  --text-${t.name}: ${t.size}px;`);
    if (t.lineHeight && t.lineHeight !== "normal") lines.push(`  --text-${t.name}--line-height: ${t.lineHeight};`);
  });
  add("space", f.space);
  add("radius", f.radius);
  add("shadow", f.shadow);
  add("duration", f.durations);
  add("ease", f.easings);
  const out = [header(set), ":root {", ...lines, "}"];
  if (siteVars && set.customProperties?.all?.length) {
    for (const scope of set.customProperties.scopes) {
      const props = set.customProperties.all.filter((p) => p.scope === scope);
      if (!props.length) continue;
      const open = scope === "default" ? ":root {" : scope === "dark" ? "@media (prefers-color-scheme: dark) {\n  :root {" : "@media (prefers-color-scheme: light) {\n  :root {";
      const pad = scope === "default" ? "  " : "    ";
      out.push("", `/* ${set.finalUrl || set.url}: its own custom properties (${scope}) */`, open, ...props.map((p) => `${pad}${p.name}: ${p.value};`), scope === "default" ? "}" : "  }\n}");
    }
  }
  return out.join("\n") + "\n";
}

/** Tailwind CSS v4: an @theme block. Names follow Tailwind's own theme variable namespaces. */
export function toTailwind(set) {
  const f = flatten(set);
  const lines = [];
  f.colors.forEach((c) => lines.push(`  --color-${c.name}: ${c.value};`));
  f.fonts.forEach((c) => lines.push(`  --font-${c.name}: ${c.value};`));
  f.text.forEach((t) => {
    lines.push(`  --text-${t.name}: ${t.size / 16}rem;`);
    if (t.lineHeight && t.lineHeight !== "normal") lines.push(`  --text-${t.name}--line-height: ${t.lineHeight};`);
  });
  f.radius.forEach((r) => lines.push(`  --radius-${r.name}: ${r.value};`));
  f.shadow.forEach((s) => lines.push(`  --shadow-${s.name}: ${s.value};`));
  f.easings.forEach((e) => lines.push(`  --ease-${e.name}: ${e.value};`));
  f.breakpoints.forEach((b) => lines.push(`  --breakpoint-${b.name.replace("bp-", "")}: ${b.value};`));
  if (set.spacing?.base) lines.push(`  --spacing: ${set.spacing.base / 16}rem;`);
  return [header(set).replace("*/", "   Tailwind CSS v4: paste into your stylesheet after @import \"tailwindcss\". */"), "@theme {", ...lines, "}"].join("\n") + "\n";
}
