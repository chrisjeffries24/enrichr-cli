import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const FONT = readFileSync(new URL("./fixtures/fixture-display.woff2", import.meta.url));

/** A tiny site with known, hand-chosen design values. Both the static and the browser tests assert against it. */
export const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fixture Co</title>
<link rel="stylesheet" href="/site.css">
<style>
  :root { --brand: #3b5bdb; --surface: #fafafa; --radius-card: 12px; --ease-out: cubic-bezier(0.22, 1, 0.36, 1); --font-ui: "Fixture UI", sans-serif; --shadow-card: 0 4px 12px rgba(0,0,0,.12); }
  @media (prefers-color-scheme: dark) { :root { --surface: #101114; } }
</style></head>
<body>
  <header><h1>Fixture Co builds fixtures</h1><p class="lead">A page whose design values are known in advance, so a test can check them.</p></header>
  <main>
    <section class="card"><h2>Cards have a radius</h2><p>Body copy sits at sixteen pixels with a generous line height so the type scale has a base to find.</p><a class="btn" href="#">Primary action</a></section>
    <div class="ghost">Ghost</div><section class="card"><h2>Another card</h2><p>More body copy, more body copy, more body copy, more body copy, more body copy.</p><pre><code>const a = 1;</code></pre></section>
  </main>
</body></html>`;

export const CSS = `
/* tokens live in :root above; this sheet uses them */
* { box-sizing: border-box; }
body { margin: 0; font-family: "Not Installed Anywhere", sans-serif; font-size: 16px; line-height: 1.5; color: #1a1a1a; background: var(--surface); }
header { padding: 64px 32px; background: #101828; }
h1, h2 { font-family: "Fixture UI", sans-serif; }
h1 { font-size: 48px; line-height: 1.1; color: #ffffff; margin: 0 0 16px; font-weight: 700; }
.lead { font-size: 20px; color: #c7d2fe; margin: 0; }
main { max-width: 960px; margin: 0 auto; padding: 32px; display: grid; gap: 24px; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: var(--radius-card); padding: 24px; box-shadow: var(--shadow-card); transition: transform 200ms var(--ease-out); }
.ghost { box-shadow: 0 0 0 0 rgba(0,0,0,0), 0 0 0 0 transparent; }
.card h2 { font-size: 24px; margin: 0 0 8px; }
.card p { margin: 0 0 16px; }
.btn { display: inline-block; padding: 8px 16px; border-radius: 9999px; background: var(--brand); color: #fff; text-decoration: none; }
pre, code { font-family: "Fixture Mono", ui-monospace, monospace; font-size: 14px; }
@media (min-width: 768px) { main { grid-template-columns: 1fr 1fr; } }
@media (min-width: 1024px) { main { padding: 64px; } }
@font-face { font-family: "Fixture UI"; src: url(/fixture.woff2) format("woff2"); font-weight: 400; }
`;

/** Start the fixture site on a random port. */
export function startFixture() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === "/site.css") { res.writeHead(200, { "content-type": "text/css" }); res.end(CSS); }
      else if (req.url === "/fixture.woff2") { res.writeHead(200, { "content-type": "font/woff2" }); res.end(FONT); }
      else if (req.url === "/missing") { res.writeHead(404, { "content-type": "text/html" }); res.end("<!doctype html><title>Not found</title><p>Nope</p>"); }
      else { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); }
    });
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) }));
  });
}
