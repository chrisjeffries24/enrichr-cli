/**
 * A very small Chrome DevTools Protocol client over the WebSocket that ships with Node 22+.
 * It does only what the CLI needs: send a command, wait for an event, talk to one page session.
 */

export class CdpError extends Error {
  constructor(method, error) {
    super(`${method}: ${error.message || JSON.stringify(error)}`);
    this.name = "CdpError";
    this.code = error.code;
  }
}

export class Cdp {
  /** @param {string} url ws:// address of the browser endpoint */
  static connect(url) {
    return new Promise((resolve, reject) => {
      if (typeof WebSocket === "undefined") {
        reject(new Error("This Node has no global WebSocket. Enrichr needs Node 22 or newer."));
        return;
      }
      const ws = new WebSocket(url);
      const c = new Cdp(ws);
      ws.addEventListener("open", () => resolve(c), { once: true });
      ws.addEventListener("error", () => reject(new Error(`Could not connect to the browser at ${url}`)), { once: true });
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
    ws.addEventListener("message", (ev) => this.#onMessage(ev.data));
    ws.addEventListener("close", () => this.#onClose());
  }

  #onMessage(data) {
    let msg;
    try { msg = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8")); } catch { return; }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new CdpError(p.method, msg.error));
      else p.resolve(msg.result ?? {});
    } else if (msg.method) {
      for (const l of [...this.listeners]) l(msg);
    }
  }

  #onClose() {
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new Error(`The browser closed while "${p.method}" was running.`));
    this.pending.clear();
  }

  /** Send a command. With `sessionId` it goes to that attached page, otherwise to the browser itself. */
  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error("The browser connection is closed."));
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(payload));
    });
  }

  /** Subscribe to every event; returns an unsubscribe function. */
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Resolve with the first event for which `match(msg)` is true, or reject after `ms`. */
  waitFor(match, ms, what = "an event") {
    return new Promise((resolve, reject) => {
      const off = this.on((msg) => {
        if (!match(msg)) return;
        clearTimeout(t);
        off();
        resolve(msg);
      });
      const t = setTimeout(() => { off(); reject(new Error(`Timed out after ${ms}ms waiting for ${what}.`)); }, ms);
    });
  }

  close() {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}
