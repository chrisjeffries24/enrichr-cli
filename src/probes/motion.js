/* Runs INSIDE the inspected page in the MAIN world (so it can read window.gsap, THREE and friends); fully
 * self-contained. Returns plain JSON.
 *
 * Honest limit, and the reason Enrichr exists: this reads what the page still exposes AFTER it loaded.
 * A library bundled without a global is invisible here. Enrichr injects its detector before the page's own
 * scripts run, so it also sees those and records every tween that played. The popup says so when it finds nothing. */
function probeMotion() {
  function safe(fn, dflt) { try { var v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } }
  var W = window, libs = [];
  function lib(name, version, detail, confidence) { libs.push({ name: name, version: version || "", detail: detail || "", confidence: confidence || "sure" }); }
  var html = document.documentElement;

  // GSAP and its plugins
  var gsap = W.gsap;
  var gsapStats = null;
  if (gsap && gsap.version) {
    var plugins = ["ScrollTrigger", "ScrollSmoother", "SplitText", "Flip", "Draggable", "MotionPathPlugin", "MorphSVGPlugin", "DrawSVGPlugin", "Observer", "ScrollToPlugin", "TextPlugin", "CustomEase", "InertiaPlugin", "Physics2DPlugin", "GSDevTools"]
      .filter(function (p) { return !!W[p] || safe(function () { return !!gsap[p]; }, false); });
    var tl = safe(function () { return gsap.globalTimeline.getChildren(true, true, true).length; }, null);
    var st = W.ScrollTrigger || gsap.ScrollTrigger;
    var stAll = st && safe(function () { return st.getAll(); }, null);
    gsapStats = { tweens: tl, triggers: stAll ? stAll.length : 0, pinned: stAll ? stAll.filter(function (s) { return s.pin; }).length : 0, plugins: plugins };
    var others = plugins.filter(function (p) { return p !== "ScrollTrigger" && p !== "ScrollSmoother"; });
    lib("GSAP", gsap.version, others.length ? "Plugins: " + others.join(", ") : "");
    var stLib = W.ScrollTrigger || gsap.ScrollTrigger;
    if (stLib) lib("ScrollTrigger", stLib.version || "", "scroll-linked animation");
    if (W.ScrollSmoother || gsap.ScrollSmoother) lib("ScrollSmoother", (W.ScrollSmoother && W.ScrollSmoother.version) || "", "GSAP smooth scrolling");
  }

  // 3D and canvas engines
  var three = W.THREE ? W.THREE.REVISION : W.__THREE__;
  if (three) lib("Three.js", "r" + String(three).replace(/^r/, ""));
  if (W.PIXI && W.PIXI.VERSION) lib("PixiJS", W.PIXI.VERSION);
  if (W.BABYLON && W.BABYLON.Engine) lib("Babylon.js", safe(function () { return W.BABYLON.Engine.Version; }, ""));
  if (W.p5 && W.p5.prototype) lib("p5.js", "");

  // Smooth scroll
  if (html.classList.contains("lenis") || W.lenis || W.Lenis) lib("Lenis", safe(function () { return W.Lenis && W.Lenis.version; }, ""), "smooth scrolling");
  if (html.classList.contains("has-scroll-smooth") || W.LocomotiveScroll || document.querySelector("[data-scroll-container]")) lib("Locomotive Scroll", "", "smooth scrolling");

  // Other animation libraries
  if (W.anime && (W.anime.version || W.anime.timeline)) lib("Anime.js", safe(function () { return W.anime.version; }, ""));
  var lot = W.lottie || W.bodymovin;
  if (lot || document.querySelector("lottie-player, dotlottie-player, dotlottie-wc")) lib("Lottie", safe(function () { return lot && lot.version; }, ""));
  if (W.AOS || document.querySelector("[data-aos]")) lib("AOS", "", "animate on scroll");
  if (W.ScrollMagic) lib("ScrollMagic", safe(function () { return W.ScrollMagic.version; }, ""));
  if (W.barba) lib("Barba.js", "", "page transitions");
  if (W.Swiper || document.querySelector(".swiper-wrapper")) lib("Swiper", "", "sliders");
  if (W.Webflow || html.hasAttribute("data-wf-page")) lib("Webflow Interactions", "", "no-code animation");
  if (document.querySelector("[data-framer-name], [data-framer-component-type]") || W.__framer_importFromPackage || document.getElementById("__framer-badge-container")) lib("Framer", "", "site builder with Framer Motion runtime");
  else if (document.querySelector("[data-projection-id]")) lib("Framer Motion", "", "React animation library", "likely");

  // Libraries loaded from a CDN or script tag by name, even when no global survived.
  var named = {}, hints = [
    ["GSAP", /gsap(?:\.min)?\.js|\/gsap\/|gsap@/i], ["ScrollTrigger", /scrolltrigger/i], ["Three.js", /three(?:\.min|\.module)?\.js|\/three@|three\/build/i],
    ["Lenis", /lenis/i], ["Locomotive Scroll", /locomotive/i], ["Lottie", /lottie|bodymovin/i], ["Anime.js", /anime(?:\.min)?\.js/i], ["Barba.js", /barba/i], ["Splitting", /splitting/i]
  ];
  var srcs = [];
  document.querySelectorAll("script[src]").forEach(function (s) { srcs.push(s.src); });
  safe(function () { performance.getEntriesByType("resource").forEach(function (e) { if (e.initiatorType === "script" || e.initiatorType === "other") srcs.push(e.name); }); }, null);
  srcs.forEach(function (u) {
    hints.forEach(function (hh) {
      if (hh[1].test(u) && !named[hh[0]]) {
        var v = (u.match(/(?:gsap|three|lenis|lottie|anime)[@\/-](\d+\.\d+(?:\.\d+)?)/i) || [])[1] || "";
        named[hh[0]] = { name: hh[0], version: v, from: (function () { try { return new URL(u).hostname; } catch (e) { return ""; } })() };
      }
    });
  });
  var scriptHints = Object.keys(named).map(function (k) { return named[k]; }).filter(function (x) {
    return !libs.some(function (l) { return l.name.toLowerCase().indexOf(x.name.toLowerCase().split(".")[0]) === 0; });
  });

  // Canvases (WebGL or 2D; we deliberately do not call getContext, which could create a context on an unused canvas)
  var canvases = [].slice.call(document.querySelectorAll("canvas")).map(function (c) {
    var r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), full: r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.6 };
  }).filter(function (c) { return c.w >= 80 && c.h >= 80; });

  // Native motion running right now
  var anims = safe(function () { return document.getAnimations(); }, []);
  var cssNames = {}, css = 0, trans = 0, waapi = 0;
  anims.forEach(function (a) {
    if (typeof CSSAnimation !== "undefined" && a instanceof CSSAnimation) { css++; cssNames[a.animationName] = 1; }
    else if (typeof CSSTransition !== "undefined" && a instanceof CSSTransition) trans++;
    else waapi++;
  });
  var keyframes = {}, scrollTimeline = false;
  function walk(rules) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.type === 7) keyframes[r.name] = 1;
      else if (r.type === 1 && r.style && (r.style.getPropertyValue("animation-timeline") || r.style.getPropertyValue("view-timeline-name") || r.style.getPropertyValue("scroll-timeline-name"))) scrollTimeline = true;
      if (r.cssRules && r.type !== 1) safe(function () { walk(r.cssRules); }, null);
    }
  }
  var blocked = 0;
  for (var si = 0; si < document.styleSheets.length; si++) { try { walk(document.styleSheets[si].cssRules); } catch (e) { blocked++; } }

  return {
    libs: libs, scriptHints: scriptHints, gsap: gsapStats, canvases: canvases,
    css: { running: css, transitions: trans, waapi: waapi, names: Object.keys(cssNames).slice(0, 6), keyframes: Object.keys(keyframes).length, scrollDriven: scrollTimeline },
    sheetsBlocked: blocked, scripts: srcs.length
  };
}
if (typeof module !== "undefined" && module.exports) module.exports = { probeMotion: probeMotion };
