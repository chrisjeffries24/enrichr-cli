/** Argument parsing with no dependencies. Flags may be `--name value`, `--name=value` or bare booleans. */

const BOOLEAN = new Set(["json", "static", "no-scroll", "dark", "site-vars", "help", "version", "quiet", "no-color", "color", "raw"]);
const SHORT = { h: "help", v: "version", j: "json", q: "quiet", f: "format", o: "out" };
export const COMMANDS = ["tokens", "fonts", "colors", "motion", "inspect", "deep", "doctor", "help"];
export const FORMATS = ["pretty", "json", "css", "tailwind", "dtcg", "markdown"];
const VALUE = new Set(["format", "out", "chrome", "viewport", "timeout", "tool", "url"]);

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { positional.push(...argv.slice(i + 1)); break; }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = (eq < 0 ? a.slice(2) : a.slice(2, eq)).trim();
      if (!name) throw new UsageError("Unexpected \"--\".");
      if (eq >= 0) flags[name] = a.slice(eq + 1);
      else if (VALUE.has(name)) {
        const next = argv[++i];
        if (next === undefined || next.startsWith("--")) throw new UsageError(`--${name} needs a value.`);
        flags[name] = next;
      } else if (BOOLEAN.has(name)) flags[name] = true;
      else throw new UsageError(`Unknown option --${name}. Try: enrichr --help`);
    } else if (a.length > 1 && a.startsWith("-") && !/^-\d/.test(a)) {
      const long = SHORT[a.slice(1)];
      if (!long) throw new UsageError(`Unknown option ${a}. Try: enrichr --help`);
      if (VALUE.has(long)) {
        const next = argv[++i];
        if (next === undefined) throw new UsageError(`${a} needs a value.`);
        flags[long] = next;
      } else flags[long] = true;
    } else positional.push(a);
  }

  let command = positional[0];
  let rest = positional.slice(1);
  // `enrichr stripe.com` is shorthand for `enrichr tokens stripe.com`
  if (command && !COMMANDS.includes(command)) { rest = positional; command = "tokens"; }
  if (flags.help) command = "help";
  if (flags.version) command = "version";

  if (flags.json) flags.format = flags.format || "json";
  if (flags.format && !FORMATS.includes(flags.format)) throw new UsageError(`Unknown format "${flags.format}". Use one of: ${FORMATS.join(", ")}.`);
  if (flags.timeout !== undefined) {
    const n = Number(flags.timeout);
    if (!Number.isFinite(n) || n < 1) throw new UsageError("--timeout is in seconds, for example --timeout 60.");
    flags.timeout = n;
  }
  return { command: command || "help", url: rest[0], rest, flags };
}

/** Accepts stripe.com, //stripe.com, localhost:3000 or a full URL. */
export function normalizeUrl(input) {
  const s = String(input ?? "").trim();
  if (!s) throw new UsageError("Give a website address, for example: enrichr tokens stripe.com");
  // "javascript:x", "mailto:x", "file:x": a scheme with no slashes. "example.com:8080" is a host and port, so digits after the colon are exempt.
  const bare = s.match(/^([a-z][a-z0-9+.-]*):(?![\d/])/i);
  if (bare && !/^https?$/i.test(bare[1])) throw new UsageError(`Only http and https addresses are supported (got ${bare[1].toLowerCase()}).`);
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : /^(localhost|127\.|\[::1\])/i.test(s) ? `http://${s}` : `https://${s.replace(/^\/\//, "")}`;
  let u;
  try { u = new URL(withScheme); } catch { throw new UsageError(`"${s}" is not a web address.`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UsageError(`Only http and https addresses are supported (got ${u.protocol.replace(":", "")}).`);
  if (!u.hostname) throw new UsageError(`"${s}" is not a web address.`);
  return u.href;
}
