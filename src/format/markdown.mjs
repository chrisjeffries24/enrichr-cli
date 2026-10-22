/** A report you can paste into an issue, a PR or a design doc. */
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (head, rows) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");

export function toMarkdown(set, { sections }) {
  const want = (k) => sections.includes(k);
  const out = [`# ${set.title || set.finalUrl || set.url}`, "", `Source: ${set.finalUrl || set.url}  `, `Measured ${set.capturedAt.slice(0, 10)} by enrichr-cli ${set.version} (${set.mode === "static" ? "read from CSS, no browser" : `real browser, ${set.viewport}, ${set.scheme} scheme`}).`];

  if (want("colors") && set.colors.palette.length) {
    const r = set.colors.roles;
    out.push("", "## Colors", "", table(["Color", "Text", "Background", "Border"], set.colors.palette.slice(0, 12).map((c) => [`\`${c.hex}\``, `${c.share.text}%`, `${c.share.background}%`, `${c.share.border}%`])));
    if (r.background) out.push("", `Guessed roles: background \`${r.background}\`${r.text ? `, text \`${r.text}\`` : ""}${r.accent ? `, accent \`${r.accent}\`` : ""}${r.border ? `, border \`${r.border}\`` : ""}${r.contrast ? `. Text on background contrast is ${r.contrast}:1.` : "."}`);
  }
  if (want("fonts")) {
    const f = set.fonts;
    const rows = [["Headings", f.heading], ["Body", f.body], ["Code", f.code]].filter(([, x]) => x?.name).map(([role, x]) => [role, x.name, x.kind, x.share ? `${x.share}%` : "", (x.weights || []).join(", ")]);
    if (rows.length) out.push("", "## Fonts", "", table(["Role", "Family", "Kind", "Share of text", "Weights"], rows));
  }
  if (want("typeScale") && set.typeScale.length) out.push("", "## Type scale", "", table(["Size", "Weight", "Line height", "Share of text"], set.typeScale.map((t) => [`${t.size}px`, t.weight, t.lineHeight, `${t.share}%`])));
  if (want("spacing") && set.spacing?.values?.length) out.push("", "## Spacing", "", `${set.spacing.base ? `Base unit ${set.spacing.base}px, ${set.spacing.coverage}% of values on it.` : "No single base unit."} Values: ${set.spacing.values.slice(0, 12).map((v) => `${v.px}px`).join(", ")}.`);
  if (want("shape")) {
    if (set.radii.length) out.push("", `**Radii:** ${set.radii.map((r) => r.value).join(", ")}`);
    if (set.shadows.length) out.push("", "**Shadows:**", "", ...set.shadows.map((x) => `- \`${x.value}\``));
  }
  if (want("breakpoints") && set.breakpoints.length) out.push("", `**Breakpoints:** ${set.breakpoints.map((b) => b.px + "px").join(", ")}`);
  if (want("customProperties") && set.customProperties.count) out.push("", "## Custom properties", "", `${set.customProperties.count} declared (${Object.entries(set.customProperties.byType).map(([k, v]) => `${v.length} ${k}`).join(", ")}).`);
  if (want("motion") && set.motion?.libs?.length) out.push("", "## Motion", "", ...set.motion.libs.map((l) => `- ${l.name}${l.version ? " " + l.version : ""}${l.detail ? ` (${l.detail})` : ""}`));
  for (const n of set.notes) out.push("", `> ${n}`);
  return out.join("\n") + "\n";
}
