/* Runs INSIDE the inspected page (evaluated by the CLI over the DevTools protocol); fully self-contained.
 * Returns plain JSON.
 *
 * Reads the layout side of a design system from computed styles, weighted by how much of the page uses it:
 *   - type scale: font size / weight / line height / tracking, weighted by characters of visible text
 *   - spacing: padding, margin and gap values in px, and the base unit that explains most of them
 *   - radii, shadows, container widths
 *   - transition durations and easings
 * Fonts and colors come from the other probes. This one never reads cross-origin stylesheets, only computed values. */
function probeTokens() {
  var els = document.querySelectorAll("body, body *"), n = Math.min(els.length, 9000);
  var textLen = new WeakMap();
  var tw = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT), t;
  while ((t = tw.nextNode())) {
    var s = t.nodeValue.trim().length;
    if (s && t.parentElement) textLen.set(t.parentElement, (textLen.get(t.parentElement) || 0) + s);
  }

  var type = {}, spacing = {}, radii = {}, shadows = {}, widths = {}, durations = {}, easings = {};
  var totalChars = 0, visible = 0;
  function bump(map, key, by) { map[key] = (map[key] || 0) + (by === undefined ? 1 : by); }
  // Pages declare no-op shadows ("rgba(0, 0, 0, 0) 0px 0px 0px 0px") to animate to; they are not part of the design.
  function realShadow(v) {
    var layers = [], depth = 0, cur = "";
    for (var c = 0; c < v.length; c++) {
      var ch = v[c];
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { layers.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) layers.push(cur.trim());
    var keep = layers.filter(function (l) {
      var alpha0 = /rgba?\([^)]*,\s*0\)/.test(l) || /rgb\([^)]*\/\s*0%?\)/.test(l);
      var flat = !/[1-9]/.test(l.replace(/rgba?\([^)]*\)/g, ""));
      return !alpha0 && !flat;
    });
    return keep.length ? keep.join(", ") : "";
  }
  function px(v) { var f = parseFloat(v); return isFinite(f) && /px$/.test(v) ? Math.round(f * 100) / 100 : null; }

  for (var i = 0; i < n; i++) {
    var el = els[i];
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) continue;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    visible++;
    var cs = getComputedStyle(el);

    var tl = textLen.get(el);
    if (tl) {
      var size = px(cs.fontSize);
      if (size) {
        var key = [Math.round(size * 2) / 2, cs.fontWeight, cs.lineHeight, cs.letterSpacing].join("|");
        var e = type[key] || (type[key] = { size: Math.round(size * 2) / 2, weight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, chars: 0, tags: {} });
        e.chars += tl; totalChars += tl;
        bump(e.tags, el.tagName.toLowerCase());
      }
    }

    // Skip the root and body: their padding is the page frame, not the spacing system.
    if (el !== document.body) {
      ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginBottom", "rowGap", "columnGap"].forEach(function (p) {
        var v = px(cs[p]);
        if (v && v >= 1 && v <= 400) bump(spacing, Math.round(v));
      });
    }

    ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"].forEach(function (p) {
      var v = cs[p];
      if (v && v !== "0px") {
        var f = parseFloat(v);
        // 9999px (pill) and 50% (circle) are the same intent as "fully round"
        bump(radii, (f >= 999 || (/%$/.test(v) && f >= 50)) ? "9999px" : (/%$/.test(v) ? v : Math.round(f) + "px"));
      }
    });

    if (cs.boxShadow && cs.boxShadow !== "none") { var rs = realShadow(cs.boxShadow); if (rs) bump(shadows, rs); }
    var mw = px(cs.maxWidth);
    if (mw && mw >= 480 && mw <= 2000) bump(widths, Math.round(mw));

    if (cs.transitionDuration && cs.transitionDuration !== "0s") {
      cs.transitionDuration.split(",").forEach(function (d) { d = d.trim(); if (d && d !== "0s") bump(durations, d); });
      cs.transitionTimingFunction.split(/,(?![^(]*\))/).forEach(function (f) { bump(easings, f.trim()); });
    }
  }

  function top(map, k, minCount) {
    return Object.keys(map).map(function (x) { return [x, map[x]]; })
      .filter(function (x) { return x[1] >= (minCount || 1); })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, k);
  }

  var scale = Object.keys(type).map(function (k) { return type[k]; })
    .map(function (e) { e.share = totalChars ? Math.round((e.chars / totalChars) * 1000) / 10 : 0; e.tags = top(e.tags, 3).map(function (x) { return x[0]; }); return e; })
    .filter(function (e) { return e.share >= 0.1; })
    .sort(function (a, b) { return b.chars - a.chars; });

  // Which base unit explains the spacing? Try the usual suspects and keep the one with the best share of uses.
  var spacingList = top(spacing, 40, 2).map(function (x) { return { px: Number(x[0]), uses: x[1] }; });
  var spaceTotal = spacingList.reduce(function (a, x) { return a + x.uses; }, 0);
  var base = null, bestShare = 0;
  [8, 4, 6, 5, 10].forEach(function (u) {
    var on = spacingList.filter(function (x) { return x.px % u === 0; }).reduce(function (a, x) { return a + x.uses; }, 0);
    var share = spaceTotal ? on / spaceTotal : 0;
    // the largest unit (8, then 4, ...) that explains at least 70% of uses wins; coverage reports the winner or the best miss
    if (!base && share >= 0.7) { base = u; bestShare = share; }
    else if (!base && share > bestShare) { bestShare = share; }
  });

  // Which family sets headings, body text and code? The computed stack of the first visible h1/h2, p and code element.
  function famOf(sel) {
    var list = document.querySelectorAll(sel);
    for (var q = 0; q < list.length && q < 40; q++) {
      var e = list[q];
      if ((e.textContent || "").trim().length < 3) continue;
      if (e.checkVisibility && !e.checkVisibility({ checkVisibilityCSS: true })) continue;
      return getComputedStyle(e).fontFamily;
    }
    return "";
  }
  var fontRoles = { heading: famOf("h1") || famOf("h2") || famOf("h3"), body: famOf("p") || famOf("li"), code: famOf("pre, code, kbd, samp") };

  return {
    scanned: n, visible: visible, totalChars: totalChars,
    typeScale: scale.slice(0, 40),
    fontRoles: fontRoles,
    spacing: { base: base, coverage: Math.round(bestShare * 100), values: spacingList.slice(0, 14) },
    radii: top(radii, 8).map(function (x) { return { value: x[0], uses: x[1] }; }),
    shadows: top(shadows, 6).map(function (x) { return { value: x[0], uses: x[1] }; }),
    containers: top(widths, 4).map(function (x) { return { px: Number(x[0]), uses: x[1] }; }),
    transitions: {
      durations: top(durations, 5).map(function (x) { return { value: x[0], uses: x[1] }; }),
      easings: top(easings, 5).map(function (x) { return { value: x[0], uses: x[1] }; })
    }
  };
}
if (typeof module !== "undefined" && module.exports) module.exports = { probeTokens: probeTokens };
