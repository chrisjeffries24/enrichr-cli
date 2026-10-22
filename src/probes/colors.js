/* Runs INSIDE the inspected page; fully self-contained. Returns plain JSON.
 *
 * Every visible element contributes its computed colors, weighted by how much of the page they cover:
 * text color by characters, backgrounds by area, borders by length x width, SVG fills by area, gradient
 * stops by area. Modern syntaxes (oklch, lab, color(display-p3 ...), hsl) are normalised through a canvas.
 * Near-identical colors are merged, then named CSS custom properties are read from :root rules so the
 * popup can show the site's own token names when its stylesheets are readable. */
function probeColors() {
  var cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  var cx = cv.getContext("2d", { willReadFrequently: true });
  var parseCache = {};

  function parse(str) {
    if (!str || str === "transparent" || str === "none" || str === "currentcolor") return null;
    if (str in parseCache) return parseCache[str];
    var out = null, m = str.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
      if (p.length >= 3 && p.every(function (x) { return !isNaN(x); })) out = [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    } else if (/^(#|hsl|hwb|lab|lch|oklab|oklch|color\()/i.test(str) || /^[a-z]+$/i.test(str)) {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = "#010203";
      cx.fillStyle = str;
      if (cx.fillStyle !== "#010203") {
        cx.fillRect(0, 0, 1, 1);
        var d = cx.getImageData(0, 0, 1, 1).data;
        out = [d[0], d[1], d[2], d[3] / 255];
      }
    }
    return (parseCache[str] = out);
  }
  function hex(c) { return "#" + c.slice(0, 3).map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? "0" : "") + v.toString(16); }).join(""); }

  var acc = {}; // "r,g,b" -> { rgb, w: {text, background, border, graphic} }
  var totals = { text: 0, background: 0, border: 0, graphic: 0 };
  function add(c, cat, w) {
    if (!c || c[3] < 0.15 || !(w > 0)) return;
    w *= c[3];
    var k = Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]);
    var e = acc[k] || (acc[k] = { rgb: [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])], w: { text: 0, background: 0, border: 0, graphic: 0 } });
    e.w[cat] += w;
    totals[cat] += w;
  }

  var els = document.querySelectorAll("body, body *"), n = Math.min(els.length, 9000);
  var textLen = new WeakMap();
  var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), t;
  while ((t = tw.nextNode())) { var s = t.nodeValue.trim().length; if (s && t.parentElement) textLen.set(t.parentElement, (textLen.get(t.parentElement) || 0) + s); }

  for (var i = 0; i < n; i++) {
    var el = els[i];
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) continue;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    var cs = getComputedStyle(el), area = Math.min(r.width * r.height, 4e6);

    var tl = textLen.get(el);
    if (tl) add(parse(cs.color), "text", tl * 40);

    add(parse(cs.backgroundColor), "background", area);
    var bi = cs.backgroundImage;
    if (bi && bi !== "none" && bi.indexOf("gradient") >= 0) {
      var stops = bi.match(/rgba?\([^)]+\)/g) || [];
      stops.forEach(function (sv) { add(parse(sv), "background", area / stops.length * 0.7); });
    }
    ["Top", "Right", "Bottom", "Left"].forEach(function (side) {
      var bw = parseFloat(cs["border" + side + "Width"]);
      if (bw > 0 && cs["border" + side + "Style"] !== "none") add(parse(cs["border" + side + "Color"]), "border", bw * (side === "Top" || side === "Bottom" ? r.width : r.height));
    });
    if (el instanceof SVGElement && el.tagName !== "svg") {
      add(parse(cs.fill), "graphic", area);
      var sw = parseFloat(cs.strokeWidth);
      if (sw > 0) add(parse(cs.stroke), "graphic", sw * (r.width + r.height));
    }
  }

  // Merge near-duplicates into the heavier color.
  function weight(e) {
    return ["text", "background", "border", "graphic"].reduce(function (a, c) { return a + (totals[c] ? e.w[c] / totals[c] : 0); }, 0);
  }
  var list = Object.keys(acc).map(function (k) { var e = acc[k]; e.score = weight(e); return e; }).sort(function (a, b) { return b.score - a.score; });
  var merged = [];
  list.forEach(function (e) {
    for (var j = 0; j < merged.length; j++) {
      var m2 = merged[j], dr = m2.rgb[0] - e.rgb[0], dg = m2.rgb[1] - e.rgb[1], db = m2.rgb[2] - e.rgb[2];
      if (dr * dr + dg * dg + db * db < 100) { // distance < 10
        for (var c in e.w) m2.w[c] += e.w[c];
        m2.score += e.score;
        return;
      }
    }
    merged.push({ rgb: e.rgb.slice(), w: { text: e.w.text, background: e.w.background, border: e.w.border, graphic: e.w.graphic }, score: e.score });
  });
  merged.sort(function (a, b) { return b.score - a.score; });

  var colors = merged.slice(0, 30).map(function (e) {
    var r2 = e.rgb[0] / 255, g2 = e.rgb[1] / 255, b2 = e.rgb[2] / 255;
    var mx = Math.max(r2, g2, b2), mn = Math.min(r2, g2, b2), l = (mx + mn) / 2, sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
    function share(c) { return totals[c] ? Math.round((e.w[c] / totals[c]) * 1000) / 10 : 0; }
    return { hex: hex(e.rgb), rgb: e.rgb, sat: Math.round(sat * 100) / 100, light: Math.round(l * 100) / 100, score: Math.round(e.score * 1000) / 1000, text: share("text"), background: share("background"), border: share("border"), graphic: share("graphic") };
  });

  // Named tokens: custom properties declared on :root / html in readable stylesheets.
  var tokens = [], seenTok = {};
  function walk(rules) {
    for (var i2 = 0; i2 < rules.length && tokens.length < 80; i2++) {
      var rule = rules[i2];
      if (rule.type === 1 && /^(:root|html|:host)\b/.test(rule.selectorText || "")) {
        for (var p = 0; p < rule.style.length; p++) {
          var name = rule.style[p];
          if (name.slice(0, 2) !== "--" || seenTok[name]) continue;
          var v = rule.style.getPropertyValue(name).trim();
          if (v.indexOf("var(") >= 0) continue;
          var c = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/i.test(v) ? parse(v) : null;
          if (c && c[3] > 0) { seenTok[name] = 1; tokens.push({ name: name, value: v.length > 40 ? v.slice(0, 40) + "…" : v, hex: hex(c) }); }
        }
      } else if (rule.cssRules && rule.type !== 1 && rule.type !== 4) {
        try { walk(rule.cssRules); } catch (e) { /* ignore */ }
      }
    }
  }
  // Custom properties set inline on <html> (themes and design-system runtimes often do this).
  var inl = document.documentElement.style;
  for (var ip = 0; ip < inl.length; ip++) {
    var iname = inl[ip];
    if (iname.slice(0, 2) !== "--" || seenTok[iname]) continue;
    var iv = inl.getPropertyValue(iname).trim(), ic = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/i.test(iv) ? parse(iv) : null;
    if (ic && ic[3] > 0) { seenTok[iname] = 1; tokens.push({ name: iname, value: iv.length > 40 ? iv.slice(0, 40) + "…" : iv, hex: hex(ic) }); }
  }
  var readable = 0, blocked = 0;
  for (var si = 0; si < document.styleSheets.length; si++) {
    try { walk(document.styleSheets[si].cssRules); readable++; } catch (e) { blocked++; }
  }

  return { colors: colors, tokens: tokens, sheets: { readable: readable, blocked: blocked }, scanned: n };
}
if (typeof module !== "undefined" && module.exports) module.exports = { probeColors: probeColors };
