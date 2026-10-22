import test from "node:test";
import assert from "node:assert/strict";
import { breakpoints, customProperties, fontFaces, parseCss } from "../src/css.mjs";

test("parses plain rules and strips comments and !important", () => {
  const rules = parseCss(`/* hi { */ a, b { color: red !important; margin: 0 }`);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].selector, "a, b");
  assert.deepEqual(rules[0].decls, [["color", "red"], ["margin", "0"]]);
});

test("braces and semicolons inside strings and url() do not split declarations", () => {
  const rules = parseCss(`.x { content: "a;b}c"; background: url("data:image/svg+xml;utf8,<svg>{}</svg>") ; color: blue }`);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].decls.length, 3);
  assert.equal(rules[0].decls[0][1], '"a;b}c"');
  assert.match(rules[0].decls[1][1], /^url\("data:image\/svg\+xml;utf8,<svg>\{\}<\/svg>"\)$/);
  assert.deepEqual(rules[0].decls[2], ["color", "blue"]);
});

test("unquoted url() with a semicolon is kept whole", () => {
  const rules = parseCss(`.x{background:url(data:image/png;base64,AAAA) no-repeat;color:red}`);
  assert.equal(rules[0].decls.length, 2);
  assert.match(rules[0].decls[0][1], /base64,AAAA\) no-repeat/);
});

test("rules inside @media remember the query; @keyframes are skipped", () => {
  const rules = parseCss(`
    @keyframes spin { from { transform: rotate(0) } to { transform: rotate(1turn) } }
    @media (min-width: 768px) { .a { color: red } @supports (display:grid) { .b { color: blue } } }
    .c { color: green }`);
  assert.deepEqual(rules.map((r) => r.selector), [".a", ".b", ".c"]);
  assert.deepEqual(rules[0].at, ["media (min-width: 768px)"]);
  assert.equal(rules[1].at.length, 2);
  assert.deepEqual(rules[2].at, []);
});

test("nested CSS rules are read as their own rules", () => {
  const rules = parseCss(`.card { color: red; &:hover { color: blue } }`);
  assert.equal(rules.length, 2);
  assert.ok(rules.some((r) => r.selector === "&:hover"));
  assert.deepEqual(rules.find((r) => r.selector === ".card").decls, [["color", "red"]]);
});

test("garbage in does not throw or hang", () => {
  for (const bad of ["", "}}}}", "{{{{", "a{", "a{b:", '"unterminated', "/* open", "@media{", "url(", "a{b:url(\"x}"]) {
    assert.doesNotThrow(() => parseCss(bad), bad);
  }
});

test("customProperties finds root variables, keeps themes apart, ignores component scopes", () => {
  const rules = parseCss(`
    :root { --bg: #fff; --fg: #111 }
    html { --radius: 8px }
    .card { --local: 1 }
    .dark { --bg: #000 }
    [data-theme="dark"] { --fg: #eee }
    @media (prefers-color-scheme: dark) { :root { --bg: #010101 } }
    .dark .card { --nope: 1 }`);
  const s = customProperties(rules);
  assert.deepEqual([...s.get("default").keys()].sort(), ["--bg", "--fg", "--radius"]);
  assert.equal(s.get("default").get("--bg"), "#fff");
  assert.equal(s.get("dark").get("--bg"), "#010101");
  assert.equal(s.get("dark").get("--fg"), "#eee");
  assert.ok(![...s.get("dark").keys()].includes("--nope"));
  assert.ok(![...s.get("default").keys()].includes("--local"));
});

test("fontFaces lists families with their first source", () => {
  const faces = fontFaces(parseCss(`
    @font-face { font-family: "Inter"; src: url(/f/inter.woff2) format("woff2"), url(/f/inter.woff); font-weight: 100 900 }
    @font-face { font-family: Inter; src: url(/f/inter-italic.woff2); font-style: italic }`));
  assert.equal(faces.length, 1);
  assert.equal(faces[0].family, "Inter");
  assert.equal(faces[0].src, "/f/inter.woff2");
  assert.deepEqual(faces[0].styles, ["italic"]);
});

test("breakpoints count px and rem media queries and merge min/max pairs", () => {
  const bp = breakpoints(parseCss(`
    @media (min-width: 640px) { a { color: red } }
    @media (min-width: 640px) { b { color: red } }
    @media (max-width: 639px) { c { color: red } }
    @media (min-width: 48em) { d { color: red } }
    @media (min-width: 100px) { e { color: red } }`));
  assert.deepEqual(bp.map((b) => b.px), [640, 768]);
  assert.equal(bp[0].uses, 2);
  // 600/601 with more uses on the max side: one survives, the busier
  const pair = breakpoints(parseCss(`@media (max-width: 600px) { a { color: red } } @media (max-width: 600px) { b { color: red } } @media (min-width: 601px) { c { color: red } }`));
  assert.deepEqual(pair.map((b) => b.px), [600]);
});
