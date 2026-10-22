/**
 * The optional connection to Enrichr. Everything else in this CLI runs on the user's machine and sends nothing anywhere;
 * `enrichr deep` is the one command that talks to a server, and only when the user runs it with their own API key.
 * It sends the URL and the tool name, nothing else, to <ENRICHR_URL>/mcp/invoke.
 */

export const DEEP_TOOLS = {
  design: { tool: "extract_design_system", credits: 1, what: "Design system: colors, type scale, spacing and tokens, captured before page scripts run" },
  animations: { tool: "reverse_engineer_animations", credits: 1, what: "Every GSAP, Framer Motion, CSS and scroll animation, with durations and easings" },
  webgl: { tool: "reverse_engineer_webgl", credits: 1, what: "WebGL contexts, shaders and draw calls" },
  dom: { tool: "reverse_engineer_dom", credits: 1, what: "The rendered DOM structure and computed styles" },
  assets: { tool: "reverse_engineer_assets", credits: 1, what: "Images, fonts, video and other assets the page loaded" },
  brief: { tool: "rebuild_brief", credits: 10, what: "A written brief an AI coding tool can rebuild the page from" },
};

export class DeepError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = "DeepError";
    this.hint = hint;
  }
}

export function resolveTool(name = "design") {
  const t = DEEP_TOOLS[name];
  if (!t) throw new DeepError(`Unknown deep analysis "${name}".`, `Choose one of: ${Object.keys(DEEP_TOOLS).join(", ")}.`);
  return t;
}

/**
 * @param {string} url  page to analyse
 * @param {{ kind?: string, apiKey?: string, baseUrl?: string, timeoutMs?: number, fetchImpl?: typeof fetch }} o
 * @returns {Promise<{ text: string, raw: any, creditsRemaining: number | null, plan: string | null, tool: string }>}
 */
export async function deepAnalyse(url, { kind = "design", apiKey, baseUrl = "https://enrichr.dev", timeoutMs = 180_000, fetchImpl = fetch } = {}) {
  const t = resolveTool(kind);
  if (!apiKey) {
    throw new DeepError("No Enrichr API key.", "Create a free one at https://enrichr.dev/account.html (30 credits a month, no card), then run:\n  export ENRICHR_API_KEY=enrichr_...   (PowerShell: $env:ENRICHR_API_KEY = \"enrichr_...\")");
  }
  if (!/^https?:\/\//i.test(baseUrl)) throw new DeepError(`ENRICHR_URL must start with http:// or https:// (got "${baseUrl}").`);

  let res;
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/mcp/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "user-agent": "enrichr-cli" },
      body: JSON.stringify({ tool: t.tool, arguments: { url } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new DeepError(e.name === "TimeoutError" ? `Enrichr did not answer within ${Math.round(timeoutMs / 1000)}s.` : `Could not reach ${baseUrl} (${e.cause?.code || e.message}).`);
  }

  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }

  if (res.status === 401 || res.status === 403) throw new DeepError(body?.error || "Enrichr did not accept that API key.", "Check ENRICHR_API_KEY at https://enrichr.dev/account.html.");
  if (res.status === 429) throw new DeepError(body?.error || "Credit limit reached.", `Plan: ${body?.plan ?? "?"}, used ${body?.usedCredits ?? "?"} of ${body?.monthlyCredits ?? "?"} credits. Upgrade or buy a pack: ${body?.upgrade || "https://enrichr.dev/pricing"}`);
  if (!res.ok) throw new DeepError(body?.error || `Enrichr answered HTTP ${res.status}.`);
  if (body?.error && !body.content) throw new DeepError(body.error);

  const text = Array.isArray(body?.content) ? body.content.filter((c) => c.type === "text").map((c) => c.text).join("\n") : JSON.stringify(body, null, 2);
  if (body?.isError) throw new DeepError(text.slice(0, 500));
  const remaining = res.headers.get("x-credits-remaining");
  return { text, raw: body, creditsRemaining: remaining === null ? null : Number(remaining), plan: res.headers.get("x-plan"), tool: t.tool };
}
