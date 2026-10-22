/**
 * Finds a Chromium-based browser that is already installed (Chrome, Edge, Chromium, Brave) and starts it headless
 * with a throwaway profile. Nothing is downloaded: the CLI has no dependencies and ships no browser.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";

/** Browsers this process started and has not yet closed, so Ctrl-C or a crash cannot leave one running. */
const live = new Set();
process.once("exit", () => { for (const kill of live) kill(); });

/** Where each platform keeps its browsers, best first. Environment variables are expanded from `env`. */
export function candidatePaths(platform = process.platform, env = process.env) {
  if (platform === "win32") {
    const roots = [env["PROGRAMFILES"], env["PROGRAMFILES(X86)"], env["LOCALAPPDATA"]].filter(Boolean);
    const rel = [
      "Google\\Chrome\\Application\\chrome.exe",
      "Microsoft\\Edge\\Application\\msedge.exe",
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "Chromium\\Application\\chrome.exe",
    ];
    return rel.flatMap((r) => roots.map((root) => win32.join(root, r)));
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser"];
  const dirs = (env.PATH || "").split(":").filter(Boolean);
  const fixed = ["/usr/bin", "/usr/local/bin", "/snap/bin", "/opt/google/chrome"];
  return names.flatMap((n) => [...new Set([...dirs, ...fixed])].map((d) => posix.join(d, n)));
}

/** The browser to use, or null. `--chrome` and CHROME_PATH win; both must exist or we say so rather than guess. */
export function findBrowser({ explicit, platform = process.platform, env = process.env, exists = existsSync } = {}) {
  const wanted = explicit || env.CHROME_PATH || env.ENRICHR_CHROME;
  if (wanted) return exists(wanted) ? wanted : null;
  for (const p of candidatePaths(platform, env)) if (exists(p)) return p;
  return null;
}

/** Flags that make a headless run quick, quiet and self-contained. */
export function launchArgs(profileDir, { root = process.getuid?.() === 0, viewport } = {}) {
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--mute-audio",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    "about:blank",
  ];
  if (viewport) args.splice(args.length - 1, 0, `--window-size=${viewport.width},${viewport.height}`);
  if (root) args.splice(args.length - 1, 0, "--no-sandbox");
  return args;
}

/**
 * Start the browser and return its DevTools address. Chrome writes the port it picked to `DevToolsActivePort`
 * in the profile directory, which is more reliable than scraping stderr.
 */
export async function launchBrowser(executable, { viewport, timeoutMs = 20_000 } = {}) {
  const profileDir = mkdtempSync(join(tmpdir(), "enrichr-cli-"));
  const child = spawn(executable, launchArgs(profileDir, { viewport }), { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (d) => { if (stderr.length < 4000) stderr += d; });
  let exited = false;
  child.once("exit", () => { exited = true; });

  // On Windows child.kill() ends only the main process; /T takes its renderer and GPU processes with it, so nothing is left running.
  const kill = () => {
    try {
      if (!exited && process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else if (!exited) child.kill();
    } catch { /* gone */ }
    // Do not let a lingering helper process holding the pipe keep Node alive.
    try { child.stderr.destroy(); child.unref(); } catch { /* closed */ }
  };
  live.add(kill);
  const cleanup = () => {
    live.delete(kill);
    kill();
    // Chrome releases its profile a moment after it exits; a failed removal only leaves a temp folder behind.
    setTimeout(() => { try { rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir */ } }, 300).unref?.();
  };

  const portFile = join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) { cleanup(); throw new Error(`The browser exited before it was ready.${stderr ? "\n" + stderr.trim().split("\n").slice(-3).join("\n") : ""}`); }
    if (existsSync(portFile)) {
      // Chrome may still hold the file open while it writes it (Windows answers EBUSY); try again on the next tick.
      let text = "";
      try { text = readFileSync(portFile, "utf8"); } catch { /* busy or half-written */ }
      const [port, path] = text.trim().split(/\r?\n/);
      if (port && path) return { wsUrl: `ws://127.0.0.1:${port}${path}`, close: cleanup, executable };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  cleanup();
  throw new Error(`The browser did not open its debugging port within ${timeoutMs / 1000}s.`);
}
