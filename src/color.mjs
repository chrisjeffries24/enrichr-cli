/** Small color helpers. Only sRGB notations are parsed here; the browser normalises everything else for us. */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** @returns {[number, number, number, number] | null} r, g, b in 0-255 and alpha in 0-1 */
export function parseColor(input) {
  const s = String(input ?? "").trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const v = (i) => parseInt(h.slice(i, i + 2), 16);
    return [v(0), v(2), v(4), h.length === 8 ? Math.round((v(6) / 255) * 1000) / 1000 : 1];
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const ch = (x) => (x.endsWith("%") ? (parseFloat(x) / 100) * 255 : parseFloat(x));
    const [r, g, b] = p.slice(0, 3).map(ch);
    const a = p[3] === undefined ? 1 : p[3].endsWith("%") ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
    if ([r, g, b, a].some((x) => Number.isNaN(x))) return null;
    return [clamp(Math.round(r), 0, 255), clamp(Math.round(g), 0, 255), clamp(Math.round(b), 0, 255), clamp(a, 0, 1)];
  }
  m = s.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const h = ((parseFloat(p[0]) % 360) + 360) % 360;
    const sat = parseFloat(p[1]) / 100;
    const l = parseFloat(p[2]) / 100;
    const a = p[3] === undefined ? 1 : p[3].endsWith("%") ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
    if ([h, sat, l, a].some((x) => Number.isNaN(x))) return null;
    const c = (1 - Math.abs(2 * l - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const mm = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + mm) * 255), Math.round((g + mm) * 255), Math.round((b + mm) * 255), clamp(a, 0, 1)];
  }
  return null;
}

export function toHex(rgb) {
  return "#" + rgb.slice(0, 3).map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
}

/** WCAG relative luminance. */
export function luminance([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two colors, 1 to 21, rounded to one decimal. */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10;
}

export function saturation([r, g, b]) {
  const mx = Math.max(r, g, b) / 255;
  const mn = Math.min(r, g, b) / 255;
  const l = (mx + mn) / 2;
  return mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
}

export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
