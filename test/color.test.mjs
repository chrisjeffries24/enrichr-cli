import test from "node:test";
import assert from "node:assert/strict";
import { contrast, parseColor, saturation, toHex } from "../src/color.mjs";

test("parses hex in every length", () => {
  assert.deepEqual(parseColor("#fff"), [255, 255, 255, 1]);
  assert.deepEqual(parseColor("#0a0b0c"), [10, 11, 12, 1]);
  assert.deepEqual(parseColor("#ff000080")[3], 0.502);
  assert.equal(parseColor("#12"), null);
  assert.equal(parseColor("#12345"), null);
});

test("parses rgb, rgba, space-separated rgb with slash alpha, and percentages", () => {
  assert.deepEqual(parseColor("rgb(1, 2, 3)"), [1, 2, 3, 1]);
  assert.deepEqual(parseColor("rgba(1,2,3,.5)"), [1, 2, 3, 0.5]);
  assert.deepEqual(parseColor("rgb(1 2 3 / 25%)"), [1, 2, 3, 0.25]);
  assert.deepEqual(parseColor("rgb(100% 0% 0%)"), [255, 0, 0, 1]);
  assert.equal(parseColor("rgb(1, 2)"), null);
});

test("parses hsl", () => {
  assert.equal(toHex(parseColor("hsl(0, 100%, 50%)")), "#ff0000");
  assert.equal(toHex(parseColor("hsl(120deg 100% 25%)")), "#008000");
  assert.equal(toHex(parseColor("hsla(240, 100%, 50%, .5)")), "#0000ff");
});

test("unknown notations return null instead of guessing", () => {
  for (const s of ["oklch(0.7 0.1 200)", "color(display-p3 1 0 0)", "red", "var(--x)", "", null, undefined]) assert.equal(parseColor(s), null, String(s));
});

test("contrast follows WCAG: black on white is 21, same color is 1", () => {
  assert.equal(contrast([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(contrast([10, 10, 10], [10, 10, 10]), 1);
  assert.equal(contrast([119, 119, 119], [255, 255, 255]), 4.5);
});

test("saturation is 0 for greys and high for pure hues", () => {
  assert.equal(saturation([128, 128, 128]), 0);
  assert.equal(saturation([255, 0, 0]), 1);
});
