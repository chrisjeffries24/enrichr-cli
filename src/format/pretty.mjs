/** The terminal report. Colors are used only when stdout is a terminal that supports them and NO_COLOR is unset. */
import { parseColor } from "../color.mjs";

export function makeStyle(enabled) {
  const wrap = (open, close = 0) => (s) => (enabled ? `\x1b[${open}m${s}\x1b[${close === 0 ? 0 : close}m` : String(s));
  return {
    enabled,
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    cyan: wrap(36, 39),
    yellow: wrap(33, 39),
    swatch(hex) {
      const c = parseColor(hex);
      return enabled && c ? `\x1b[48;2;${c[0]};${c[1]};${c[2]}m  \x1b[0m` : "";
    },
  };
}

const bar = (pct, width = 18) => "█".repeat(Math.max(pct > 0 ? 1 : 0, Math.round((Math.min(pct, 100) / 100) * width))).padEnd(width, "·");
const pad = (s, n) => String(s).padEnd(n);
const pct = (n) => `${Math.round(n * 10) / 10}%`;

/**
 * @param {object} set  the token set (see tokens.mjs), plus optional `motion`
 * @param {{ sections: string[], style: ReturnType<typeof makeStyle>, ms?: number, deepHint?: boolean }} o
 */
export function toPretty(set, { sections, style: s, ms, deepHint = true }) {
  const out = [];
  const want = (k) => sections.includes(k);
  const h = (t) => out.push("", s.bold(s.cyan(t)));
  const host = (() => { try { return new URL(set.finalUrl || set.url).host; } catch { return set.url; } })();

  out.push(s.bold(host) + (set.title ? s.dim(`  ${set.title.slice(0, 80)}`) : ""));
  const how = set.mode === "static" ? "Read from the page's CSS (no browser)" : `Read in a real browser (${set.viewport}, ${set.scheme} scheme)`;
  out.push(s.dim(`${how}${ms ? ` in ${(ms / 1000).toFixed(1)}s` : ""}`));

  if (want("colors")) {
    const r = set.colors.roles;
    h("Colors");
    if (!set.colors.palette.length) out.push("  none found");
    for (const c of set.colors.palette.slice(0, 10)) {
      const where = [["text", c.share.text], ["background", c.share.background], ["border", c.share.border], ["graphic", c.share.graphic]].filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${pct(v)} of ${k}`).join(", ");
      out.push(`  ${s.swatch(c.hex)} ${pad(c.hex, 8)} ${s.dim(where || "minor")}`);
    }
    if (r.background) {
      const guess = [["background", r.background], ["text", r.text], ["accent", r.accent], ["border", r.border]].filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join("  ·  ");
      out.push("", s.dim(`  Roles, guessed from coverage: ${guess}${r.contrast ? `  ·  text on background ${r.contrast}:1` : ""}`));
    }
  }

  if (want("fonts")) {
    h("Fonts");
    const f = set.fonts;
    const seen = new Set();
    const same = f.heading?.name && f.heading.name === f.body?.name;
    const rows = [[same ? "Headings, body" : "Headings", f.heading], ...(same ? [] : [["Body", f.body]]), ["Code", f.code]].filter(([, x]) => x?.name);
    for (const [role, x] of rows) {
      seen.add(x.name);
      const kind = { web: "web font", system: "installed on this machine", generic: "system default", declared: "declared in CSS", unknown: "not loaded" }[x.kind] || x.kind;
      const w = x.weights?.length ? `  weights ${x.weights.join(", ")}` : "";
      out.push(`  ${pad(role, 14)} ${s.bold(x.name)}  ${s.dim(`${kind}${x.share ? `, ${pct(x.share)} of text` : ""}${w}`)}`);
    }
    for (const x of f.all.filter((x) => !seen.has(x.name)).slice(0, 4)) out.push(`  ${pad("Also", 14)} ${x.name}  ${s.dim(`${x.kind}${x.share ? `, ${pct(x.share)} of text` : ""}`)}`);
    if (!rows.length && !f.all.length) out.push("  none found");
  }

  if (want("typeScale") && set.typeScale.length) {
    h("Type scale");
    for (const t of set.typeScale) out.push(`  ${pad(t.size + "px", 6)} ${pad(t.weight || "", 4)} ${pad(t.lineHeight && t.lineHeight !== "normal" ? "lh " + t.lineHeight : "", 12)} ${s.dim(bar(t.share))} ${s.dim(pct(t.share))}${t.tags.length ? s.dim("  " + t.tags.join(" ")) : ""}`);
  }

  if (want("spacing") && set.spacing?.values?.length) {
    h("Spacing");
    const sp = set.spacing;
    out.push(`  ${sp.base ? `Base unit ${sp.base}px (${sp.coverage}% of values sit on it)` : `No single base unit (best fit ${sp.coverage}%)`}`);
    out.push("  " + sp.values.slice(0, 10).map((v) => `${v.px}px`).join("  "));
  }
  if (want("shape") && (set.radii.length || set.shadows.length || set.containers.length)) {
    h("Shape");
    if (set.radii.length) out.push(`  Radii       ${set.radii.slice(0, 6).map((r) => r.value).join("  ")}`);
    if (set.shadows.length) out.push(`  Shadows     ${set.shadows.length} distinct; most used: ${set.shadows[0].value.slice(0, 70)}`);
    if (set.containers.length) out.push(`  Max widths  ${set.containers.map((c) => c.px + "px").join("  ")}`);
  }
  if (want("breakpoints") && set.breakpoints.length) out.push("", `${s.bold(s.cyan("Breakpoints"))}  ${set.breakpoints.slice(0, 6).map((b) => `${b.px}px`).join("  ")}`);

  if (want("transitions") && (set.transitions.durations.length || set.transitions.easings.length)) {
    h("Transitions");
    if (set.transitions.durations.length) out.push(`  Durations   ${set.transitions.durations.map((d) => d.value).join("  ")}`);
    if (set.transitions.easings.length) out.push(`  Easings     ${set.transitions.easings.map((d) => d.value).join("  ")}`);
  }

  if (want("customProperties")) {
    const cp = set.customProperties;
    h("Custom properties");
    if (!cp.count) out.push("  none declared on the root element");
    else {
      const counts = Object.entries(cp.byType).map(([k, v]) => `${v.length} ${k}`).join(", ");
      out.push(`  ${cp.count} declared (${counts})${cp.scopes.length > 1 ? `; themes: ${cp.scopes.join(", ")}` : ""}`);
      for (const p of (cp.byType.color || []).filter((x) => x.scope === "default").slice(0, 8)) out.push(`  ${s.swatch(p.hex || "")} ${pad(p.name, 34)} ${s.dim(p.hex || p.value)}`);
      out.push(s.dim("  Use --json for all of them, or --css --site-vars to print them as CSS."));
    }
  }

  if (want("motion") && set.motion) {
    h("Motion");
    const m = set.motion;
    if (!m.libs.length && !m.scriptHints.length) out.push("  No animation library found in the page's globals.");
    for (const l of m.libs) out.push(`  ${pad(l.name, 18)} ${l.version || ""} ${s.dim(l.detail || "")}${l.confidence === "likely" ? s.dim(" (likely)") : ""}`);
    for (const l of m.scriptHints) out.push(`  ${pad(l.name, 18)} ${l.version || ""} ${s.dim(`script loaded from ${l.from || "page"} (no global)`)}`);
    if (m.gsap) out.push(s.dim(`  GSAP is running ${m.gsap.tweens ?? "?"} tweens, ${m.gsap.triggers} scroll triggers, ${m.gsap.pinned} pinned.`));
    if (m.canvases.length) out.push(`  ${m.canvases.length} canvas element${m.canvases.length > 1 ? "s" : ""}${m.canvases.some((c) => c.full) ? " (one covers most of the screen)" : ""}`);
    out.push(s.dim(`  Native: ${m.css.running} CSS animations and ${m.css.transitions} transitions running now, ${m.css.keyframes} keyframes sets${m.css.scrollDriven ? ", scroll-driven timelines" : ""}.`));
  }

  for (const n of set.notes) out.push("", s.yellow("Note: ") + n);
  if (deepHint) {
    out.push("", s.dim("This reads what the page exposes once it has loaded. To see what ran before that (every GSAP tween, shader, the 3D scene), use Enrichr:"));
    out.push(s.dim(`  enrichr deep ${set.url || host}      (needs ENRICHR_API_KEY; the free plan has 30 credits a month)`));
  }
  return out.join("\n") + "\n";
}
