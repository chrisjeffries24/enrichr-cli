/* Runs INSIDE the inspected page (via chrome.scripting.executeScript), so it must be fully self-contained:
 * no references to anything outside this function. Returns plain JSON.
 *
 * What it answers: not "what does the CSS ask for" but "what was actually drawn". For every piece of visible
 * text it walks the font-family stack and picks the first family the browser really has: a web font that
 * finished loading (FontFaceSet status "loaded"), or an installed system font (canvas width test), or the
 * generic keyword it falls through to. */
function probeFonts() {
  var GENERIC = { "serif": 1, "sans-serif": 1, "monospace": 1, "cursive": 1, "fantasy": 1, "system-ui": 1, "ui-serif": 1, "ui-sans-serif": 1, "ui-monospace": 1, "ui-rounded": 1, "math": 1, "emoji": 1, "fangsong": 1 };
  // -apple-system and BlinkMacSystemFont only mean something on a Mac. Elsewhere the browser skips them and keeps walking the stack.
  var IS_MAC = /Mac/.test(navigator.platform || navigator.userAgent || "");
  var MAC_ONLY = { "-apple-system": 1, "blinkmacsystemfont": 1 };
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1 };
  var HEADING = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1 };
  var CODE = { CODE: 1, PRE: 1, KBD: 1, SAMP: 1 };

  function clean(s) { return String(s).trim().replace(/^["']|["']$/g, ""); }
  function parseStack(v) {
    var out = [], cur = "", q = null;
    for (var i = 0; i < v.length; i++) {
      var ch = v[i];
      if (q) { cur += ch; if (ch === q) q = null; }
      else if (ch === '"' || ch === "'") { q = ch; cur += ch; }
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map(clean).filter(Boolean);
  }

  // Which families were declared with @font-face / FontFace, and did any face actually load?
  var declared = {};
  try {
    document.fonts.forEach(function (f) {
      var k = clean(f.family).toLowerCase();
      var r = declared[k] || (declared[k] = { n: 0, loaded: 0 });
      r.n++;
      if (f.status === "loaded") r.loaded++;
    });
  } catch (e) { /* FontFaceSet unavailable */ }

  // Is a named family installed on this machine? Compare text width against three generic baselines.
  var ctx = document.createElement("canvas").getContext("2d");
  var SAMPLE = "mmmmmmmmmmlli0Oq@#WwQ";
  var BASE = ["monospace", "sans-serif", "serif"], baseW = {};
  BASE.forEach(function (b) { ctx.font = "72px " + b; baseW[b] = ctx.measureText(SAMPLE).width; });
  var sysCache = {};
  function installed(fam) {
    if (fam in sysCache) return sysCache[fam];
    var yes = BASE.some(function (b) {
      ctx.font = '72px "' + fam.replace(/"/g, "") + '", ' + b;
      return ctx.measureText(SAMPLE).width !== baseW[b];
    });
    return (sysCache[fam] = yes);
  }

  var resolveCache = {};
  function resolve(stackStr) {
    if (stackStr in resolveCache) return resolveCache[stackStr];
    var stack = parseStack(stackStr), res = null;
    for (var i = 0; i < stack.length && !res; i++) {
      var fam = stack[i], low = fam.toLowerCase();
      if (MAC_ONLY[low]) { if (IS_MAC) { res = { name: "system-ui", kind: "generic" }; break; } continue; }
      if (GENERIC[low]) { res = { name: fam, kind: "generic" }; break; }
      var d = declared[low];
      if (d) { if (d.loaded > 0) res = { name: fam, kind: "web" }; continue; }
      if (installed(fam)) res = { name: fam, kind: "system" };
    }
    if (!res) res = { name: "Browser default", kind: "generic" };
    res.requested = stack[0] || "";
    res.stack = stackStr;
    return (resolveCache[stackStr] = res);
  }

  var groups = {}, total = 0, elCache = new WeakMap();
  var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  var node, seen = 0;
  while ((node = walker.nextNode()) && seen < 30000) {
    seen++;
    var text = node.nodeValue.replace(/\s+/g, " ").trim();
    if (!text) continue;
    var el = node.parentElement;
    if (!el || SKIP[el.tagName]) continue;
    var info = elCache.get(el);
    if (info === undefined) {
      info = null;
      var visible = el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true }) : true;
      if (visible) {
        var cs = getComputedStyle(el);
        info = { fam: cs.fontFamily, size: parseFloat(cs.fontSize) || 0, weight: cs.fontWeight, style: cs.fontStyle, lh: cs.lineHeight, ls: cs.letterSpacing };
      }
      elCache.set(el, info);
    }
    if (!info) continue;
    var r = resolve(info.fam), key = r.kind + "|" + r.name.toLowerCase();
    var g = groups[key];
    if (!g) g = groups[key] = { name: r.name, kind: r.kind, requested: r.requested, stack: r.stack, chars: 0, weights: {}, sizes: {}, styles: {}, roles: { heading: 0, code: 0, body: 0 }, sample: "", sampleSize: 0, lh: info.lh, ls: info.ls };
    var n = text.length;
    g.chars += n; total += n;
    g.weights[info.weight] = (g.weights[info.weight] || 0) + n;
    var sz = Math.round(info.size * 10) / 10;
    g.sizes[sz] = (g.sizes[sz] || 0) + n;
    g.styles[info.style] = (g.styles[info.style] || 0) + n;
    var role = HEADING[el.tagName] ? "heading" : (CODE[el.tagName] || el.closest("pre,code")) ? "code" : "body";
    g.roles[role] += n;
    if (n >= 8 && sz >= g.sampleSize && !/^\d/.test(text)) { g.sample = text.slice(0, 70); g.sampleSize = sz; }
  }

  // Font files the page really fetched, and where Google/Adobe fonts are involved.
  var files = [];
  try {
    performance.getEntriesByType("resource").forEach(function (e) {
      if (/\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(e.name) || /fonts\.gstatic\.com|use\.typekit\.net\/af\//i.test(e.name)) files.push(e.name);
    });
  } catch (e) { /* ignore */ }
  var google = {};
  document.querySelectorAll('link[href*="fonts.googleapis.com"]').forEach(function (l) {
    try {
      var u = new URL(l.href);
      var fams = u.searchParams.getAll("family");
      fams.forEach(function (f) { f.split("|").forEach(function (p) { var nm = p.split(":")[0].replace(/\+/g, " ").trim().toLowerCase(); if (nm) google[nm] = 1; }); });
    } catch (e) { /* ignore */ }
  });
  // @font-face src urls from readable stylesheets (cross-origin sheets throw, which is fine)
  var srcByFamily = {};
  function walkRules(rules) {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule.type === 5) {
        var fam = clean(rule.style.getPropertyValue("font-family")).toLowerCase();
        var m = rule.style.getPropertyValue("src").match(/url\(\s*["']?([^"')]+)["']?\s*\)/);
        if (fam && m) { try { (srcByFamily[fam] = srcByFamily[fam] || []).push(new URL(m[1], rule.parentStyleSheet.href || location.href).href); } catch (e) { /* ignore */ } }
      } else if (rule.cssRules && rule.type !== 1) {
        try { walkRules(rule.cssRules); } catch (e) { /* ignore */ }
      }
    }
  }
  for (var s = 0; s < document.styleSheets.length; s++) { try { walkRules(document.styleSheets[s].cssRules); } catch (e) { /* cross-origin */ } }

  function top(map, k) {
    return Object.keys(map).map(function (x) { return [x, map[x]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, k);
  }
  var fonts = Object.keys(groups).map(function (k) {
    var g = groups[k], low = g.name.toLowerCase();
    var role = g.roles.code > g.chars * 0.5 ? "Code" : g.roles.heading > g.chars * 0.5 ? "Headings" : g.roles.body > 0 ? "Body text" : "Headings";
    return {
      name: g.name, kind: g.kind, requested: g.requested.toLowerCase() === low ? "" : g.requested,
      stack: g.stack, share: total ? Math.round((g.chars / total) * 1000) / 10 : 0, chars: g.chars, role: role,
      mainWeight: Number(top(g.weights, 1)[0][0]) || 400,
      weights: top(g.weights, 6).map(function (x) { return Number(x[0]) || x[0]; }).sort(function (a, b) { return a - b; }),
      sizes: top(g.sizes, 4).map(function (x) { return Number(x[0]); }),
      italic: !!g.styles.italic, lineHeight: g.lh, letterSpacing: g.ls, sample: g.sample,
      google: !!google[low], files: (srcByFamily[low] || []).slice(0, 3)
    };
  }).sort(function (a, b) { return b.chars - a.chars; });

  return {
    fonts: fonts, totalChars: total,
    fontFiles: files.filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 12),
    adobe: !!document.querySelector('link[href*="use.typekit.net"], link[href*="fonts.adobe.com"], script[src*="use.typekit.net"]'),
    googleLinked: Object.keys(google).length > 0
  };
}
if (typeof module !== "undefined" && module.exports) module.exports = { probeFonts: probeFonts };
