import test from "node:test";
import assert from "node:assert/strict";
import { DEEP_TOOLS, DeepError, deepAnalyse, resolveTool } from "../src/deep.mjs";

const reply = (status, body, headers = {}) => async (url, init) => {
  reply.last = { url, init };
  return { status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: (k) => headers[k.toLowerCase()] ?? null } };
};

test("sends only the tool name and url, with the key in X-API-Key", async () => {
  const f = reply(200, { content: [{ type: "text", text: "# Design system\n..." }] }, { "x-credits-remaining": "29", "x-plan": "free" });
  const r = await deepAnalyse("https://stripe.com/", { apiKey: "enrichr_abc", fetchImpl: f });
  assert.equal(reply.last.url, "https://enrichr.dev/mcp/invoke");
  assert.equal(reply.last.init.method, "POST");
  assert.equal(reply.last.init.headers["x-api-key"], "enrichr_abc");
  assert.deepEqual(JSON.parse(reply.last.init.body), { tool: "extract_design_system", arguments: { url: "https://stripe.com/" } });
  assert.deepEqual(Object.keys(reply.last.init.headers).sort(), ["content-type", "user-agent", "x-api-key"]);
  assert.equal(r.text, "# Design system\n...");
  assert.equal(r.creditsRemaining, 29);
  assert.equal(r.plan, "free");
});

test("every deep analysis maps to a real server tool and a credit cost", () => {
  assert.equal(resolveTool("brief").tool, "rebuild_brief");
  assert.equal(DEEP_TOOLS.brief.credits, 10);
  assert.equal(DEEP_TOOLS.webgl.tool, "reverse_engineer_webgl");
  assert.throws(() => resolveTool("everything"), /Unknown deep analysis/);
});

test("a custom server address is honoured and trailing slashes are tolerated", async () => {
  await deepAnalyse("https://a.com/", { apiKey: "k", baseUrl: "http://localhost:3000//", fetchImpl: reply(200, { content: [{ type: "text", text: "x" }] }) });
  assert.equal(reply.last.url, "http://localhost:3000/mcp/invoke");
  await assert.rejects(deepAnalyse("https://a.com/", { apiKey: "k", baseUrl: "ftp://x" }), /must start with http/);
});

test("no key explains where to get one and never calls the network", async () => {
  let called = false;
  await assert.rejects(deepAnalyse("https://a.com/", { fetchImpl: async () => { called = true; } }), (e) => e instanceof DeepError && /No Enrichr API key/.test(e.message) && /account\.html/.test(e.hint));
  assert.equal(called, false);
});

test("rejected key, spent credits and server errors become readable messages", async () => {
  await assert.rejects(deepAnalyse("https://a.com/", { apiKey: "k", fetchImpl: reply(403, { error: "Invalid API key" }) }), /Invalid API key/);
  await assert.rejects(deepAnalyse("https://a.com/", { apiKey: "k", fetchImpl: reply(401, {}) }), /did not accept that API key/);
  await assert.rejects(deepAnalyse("https://a.com/", { apiKey: "k", fetchImpl: reply(429, { error: "Monthly credit limit reached for the Free plan", plan: "free", usedCredits: 30, monthlyCredits: 30, upgrade: "https://enrichr.dev/pricing" }) }), (e) => /Monthly credit limit/.test(e.message) && /used 30 of 30/.test(e.hint) && /pricing/.test(e.hint));
  await assert.rejects(deepAnalyse("https://a.com/", { apiKey: "k", fetchImpl: reply(500, null) }), /HTTP 500/);
});

test("tool-level failures that arrive in-band are surfaced", async () => {
  await assert.rejects(deepAnalyse("https://a.com/", { apiKey: "k", fetchImpl: reply(200, { tool: "x", error: "Could not load page" }) }), /Could not load page/);
  await assert.rejects(deepAnalyse("https://a.com/", { apiKey: "k", fetchImpl: reply(200, { isError: true, content: [{ type: "text", text: "Blocked by robots" }] }) }), /Blocked by robots/);
});

test("network failure and timeout are distinguished", async () => {
  const down = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); };
  await assert.rejects(deepAnalyse("https://a.com/", { apiKey: "k", fetchImpl: down }), /Could not reach https:\/\/enrichr\.dev \(ECONNREFUSED\)/);
  const slow = async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); };
  await assert.rejects(deepAnalyse("https://a.com/", { apiKey: "k", timeoutMs: 5000, fetchImpl: slow }), /did not answer within 5s/);
});
