import { readFileSync, writeFileSync } from "node:fs";
import { COMMANDS, FORMATS, UsageError, normalizeUrl, parseArgs } from "./args.mjs";
import { capture, NoBrowserError } from "./capture.mjs";
import { findBrowser } from "./chrome.mjs";
import { DEEP_TOOLS, DeepError, deepAnalyse } from "./deep.mjs";
import { toCss, toTailwind } from "./format/css.mjs";
import { toDtcg } from "./format/dtcg.mjs";
import { toMarkdown } from "./format/markdown.mjs";
import { makeStyle, toPretty } from "./format/pretty.mjs";
import { captureStatic } from "./static.mjs";
import { buildTokens } from "./tokens.mjs";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

/** What each command reads in the page, and which parts of the result it shows. */
const PLAN = {
  tokens: { probes: ["fonts", "colors", "tokens"], sections: ["colors", "fonts", "typeScale", "spacing", "shape", "breakpoints", "transitions", "customProperties"] },
  fonts: { probes: ["fonts", "tokens"], sections: ["fonts", "typeScale"] },
  colors: { probes: ["colors"], sections: ["colors", "customProperties"] },
  motion: { probes: ["motion", "tokens"], sections: ["motion", "transitions"], browserOnly: true },
  inspect: { probes: ["fonts", "colors", "tokens", "motion"], sections: ["colors", "fonts", "typeScale", "spacing", "shape", "breakpoints", "transitions", "customProperties", "motion"], browserOnly: true },
};
const KEYS = {
  colors: ["colors"], fonts: ["fonts"], typeScale: ["typeScale"], spacing: ["spacing"], shape: ["radii", "shadows", "containers"],
  breakpoints: ["breakpoints"], transitions: ["transitions"], customProperties: ["customProperties"], motion: ["motion"],
};
const META = ["schema", "tool", "version", "url", "finalUrl", "title", "capturedAt", "mode", "viewport", "scheme", "notes", "sources"];

export const HELP = `enrichr ${VERSION}: read the design of any website from your terminal

Usage
  enrichr <command> <url> [options]
  enrichr <url>                       same as: enrichr tokens <url>

Commands
  tokens   colors, fonts, type scale, spacing, radii, shadows, breakpoints and the site's own CSS variables
  fonts    the fonts the page really draws, with roles, weights and share of text
  colors   the palette ranked by how much of the page each color covers, plus named color variables
  motion   animation and 3D libraries the page exposes (GSAP, Three.js, Lenis, Lottie, ...)
  inspect  everything above in one pass
  deep     send the page to Enrichr for a deeper analysis (needs ENRICHR_API_KEY)
  doctor   check that this machine can run the CLI

Options
  -f, --format <name>   pretty (default in a terminal), json, css, tailwind, dtcg, markdown
  -j, --json            same as --format json
  -o, --out <file>      write the result to a file instead of the terminal
      --static          read the page's CSS without a browser (faster, less exact)
      --viewport <name> desktop (default), tablet or mobile
      --dark            read the page as a visitor with a dark color scheme
      --site-vars       with --format css, also print the site's own custom properties
      --chrome <path>   browser to use (default: Chrome, Edge, Brave or Chromium found on this machine)
      --timeout <s>     give up on loading after this many seconds (default 30)
      --no-scroll       do not scroll the page to trigger lazy-loaded content
      --no-color        plain output
  -q, --quiet           no progress messages
  -h, --help            show this help
  -v, --version         show the version

Deep analyses:  enrichr deep <url> --tool <name>
${Object.entries(DEEP_TOOLS).map(([k, t]) => `  ${k.padEnd(11)} ${String(t.credits).padStart(2)} credit${t.credits > 1 ? "s" : " "}  ${t.what}`).join("\n")}

Environment
  CHROME_PATH       browser to use
  ENRICHR_API_KEY   your Enrichr key (https://enrichr.dev/account.html), used only by "deep"
  ENRICHR_URL       Enrichr server for "deep" (default https://enrichr.dev)
  NO_COLOR          disable colors

Nothing is sent anywhere except by "deep", and only the page address. Source and license: https://github.com/chrisjeffries24/enrichr-cli
`;

/**
 * @param {string[]} argv
 * @param {{ stdout?: {write(s: string): any, isTTY?: boolean}, stderr?: {write(s: string): any, isTTY?: boolean}, env?: Record<string, string | undefined> }} io
 * @returns {Promise<number>} the process exit code
 */
export async function main(argv, io = {}) {
  const out = io.stdout || process.stdout;
  const err = io.stderr || process.stderr;
  const env = io.env || process.env;
  try {
    const { command, url, flags } = parseArgs(argv);
    if (command === "version") { out.write(VERSION + "\n"); return 0; }
    if (command === "help") { out.write(HELP); return 0; }

    const color = !flags["no-color"] && !env.NO_COLOR && (flags.color || (out.isTTY && env.TERM !== "dumb"));
    const style = makeStyle(!!color);
    const log = flags.quiet || !err.isTTY ? () => {} : (m) => err.write(style.dim(m) + "\n");

    if (command === "doctor") return doctor(out, env, style);
    if (command === "deep") return await runDeep({ url, flags, env, out, err, log, style });

    if (!COMMANDS.includes(command)) throw new UsageError(`Unknown command "${command}". Try: enrichr --help`);
    const plan = PLAN[command];
    const target = normalizeUrl(url);
    const format = flags.format || (flags.out ? "json" : "pretty");
    if (["css", "tailwind", "dtcg"].includes(format) && !["tokens", "inspect"].includes(command)) {
      throw new UsageError(`--format ${format} writes a design token file, so it needs the tokens command: enrichr tokens ${url ?? "<url>"} --format ${format}`);
    }

    const t0 = Date.now();
    let raw;
    const wantStatic = !!flags.static;
    if (wantStatic && plan.browserOnly) throw new UsageError(`${command} needs a real browser to see scripts run. Remove --static.`);
    const exe = wantStatic ? null : (io.findBrowser || findBrowser)({ explicit: flags.chrome, env });
    if (!wantStatic && !exe) {
      if (plan.browserOnly || flags.chrome) throw new NoBrowserError(flags.chrome || env.CHROME_PATH);
      log("No Chrome, Edge or Chromium found, so reading the page's CSS instead (as --static does).");
      raw = await captureStatic(target, { timeoutMs: (flags.timeout ?? 20) * 1000, log });
    } else if (wantStatic) {
      raw = await captureStatic(target, { timeoutMs: (flags.timeout ?? 20) * 1000, log });
    } else {
      raw = await capture(target, { probes: plan.probes, executable: exe, viewport: flags.viewport, scheme: flags.dark ? "dark" : "light", timeoutMs: (flags.timeout ?? 30) * 1000, scroll: !flags["no-scroll"], log });
    }
    const set = buildTokens(raw, { version: VERSION, url: target });
    if (raw.motion) set.motion = raw.motion;
    const ms = Date.now() - t0;

    const text = render(set, { format, sections: plan.sections, style: format === "pretty" ? style : makeStyle(false), ms, siteVars: !!flags["site-vars"], deepHint: !flags.out });
    if (flags.out) {
      writeFileSync(flags.out, text);
      err.write(`Wrote ${flags.out}\n`);
    } else out.write(text);
    return 0;
  } catch (e) {
    return fail(e, err);
  }
}

export function render(set, { format, sections, style, ms, siteVars, deepHint }) {
  switch (format) {
    case "json": {
      const keys = new Set(sections.flatMap((s) => KEYS[s] ?? []));
      const slim = Object.fromEntries(Object.entries(set).filter(([k]) => META.includes(k) || keys.has(k)));
      return JSON.stringify(slim, null, 2) + "\n";
    }
    case "css": return toCss(set, { siteVars });
    case "tailwind": return toTailwind(set);
    case "dtcg": return toDtcg(set);
    case "markdown": return toMarkdown(set, { sections });
    default: return toPretty(set, { sections, style, ms, deepHint });
  }
}

async function runDeep({ url, flags, env, out, err, log, style }) {
  const target = normalizeUrl(url);
  const kind = flags.tool || "design";
  const t = DEEP_TOOLS[kind];
  if (!t) throw new DeepError(`Unknown deep analysis "${kind}".`, `Choose one of: ${Object.keys(DEEP_TOOLS).join(", ")}.`);
  log(`Sending ${target} to Enrichr (${t.tool}, ${t.credits} credit${t.credits > 1 ? "s" : ""})…`);
  const r = await deepAnalyse(target, { kind, apiKey: env.ENRICHR_API_KEY, baseUrl: env.ENRICHR_URL || "https://enrichr.dev", timeoutMs: (flags.timeout ?? 180) * 1000 });
  const text = flags.format === "json" ? JSON.stringify(r.raw, null, 2) + "\n" : r.text.endsWith("\n") ? r.text : r.text + "\n";
  if (flags.out) { writeFileSync(flags.out, text); err.write(`Wrote ${flags.out}\n`); } else out.write(text);
  if (r.creditsRemaining !== null) err.write(style.dim(`${r.creditsRemaining} credits left this month${r.plan ? ` (${r.plan} plan)` : ""}.`) + "\n");
  return 0;
}

function doctor(out, env, style) {
  const lines = [];
  const major = Number(process.versions.node.split(".")[0]);
  lines.push(`${major >= 22 ? "ok " : "FAIL"} Node ${process.versions.node}${major >= 22 ? "" : " (needs 22 or newer)"}`);
  const b = findBrowser({ env });
  lines.push(b ? `ok  Browser: ${b}` : "warn No Chrome, Edge, Brave or Chromium found. tokens, fonts and colors will read CSS only; motion and inspect need a browser. Set CHROME_PATH to use another.");
  lines.push(env.ENRICHR_API_KEY ? "ok  ENRICHR_API_KEY is set (used only by \"deep\")" : "info ENRICHR_API_KEY is not set. Only \"deep\" needs it.");
  lines.push(`info Enrichr server: ${env.ENRICHR_URL || "https://enrichr.dev"}`);
  out.write(lines.join("\n") + "\n");
  void style;
  return major >= 22 ? 0 : 1;
}

function fail(e, err) {
  if (e instanceof UsageError) { err.write(`enrichr: ${e.message}\n`); return 2; }
  if (e instanceof DeepError) { err.write(`enrichr: ${e.message}\n${e.hint ? e.hint + "\n" : ""}`); return 1; }
  if (e instanceof NoBrowserError) { err.write(`enrichr: ${e.message}\n`); return 1; }
  err.write(`enrichr: ${e?.message || e}\n`);
  if (process.env.ENRICHR_DEBUG) err.write(String(e?.stack || "") + "\n");
  return 1;
}

export { FORMATS };
