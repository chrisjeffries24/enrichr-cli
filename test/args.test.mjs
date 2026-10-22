import test from "node:test";
import assert from "node:assert/strict";
import { UsageError, normalizeUrl, parseArgs } from "../src/args.mjs";

test("a bare address is shorthand for the tokens command", () => {
  const a = parseArgs(["stripe.com"]);
  assert.equal(a.command, "tokens");
  assert.equal(a.url, "stripe.com");
});

test("command, url and flags in any order", () => {
  const a = parseArgs(["--format", "css", "tokens", "stripe.com", "--viewport=mobile", "--dark", "-q"]);
  assert.equal(a.command, "tokens");
  assert.equal(a.url, "stripe.com");
  assert.equal(a.flags.format, "css");
  assert.equal(a.flags.viewport, "mobile");
  assert.equal(a.flags.dark, true);
  assert.equal(a.flags.quiet, true);
});

test("-j means json, --help and --version win", () => {
  assert.equal(parseArgs(["fonts", "x.com", "-j"]).flags.format, "json");
  assert.equal(parseArgs(["fonts", "--help"]).command, "help");
  assert.equal(parseArgs(["fonts", "--version"]).command, "version");
  assert.equal(parseArgs([]).command, "help");
});

test("usage errors are specific", () => {
  assert.throws(() => parseArgs(["tokens", "x.com", "--wat"]), /Unknown option --wat/);
  assert.throws(() => parseArgs(["tokens", "x.com", "--format"]), /needs a value/);
  assert.throws(() => parseArgs(["tokens", "x.com", "--format", "xml"]), /Unknown format "xml"/);
  assert.throws(() => parseArgs(["tokens", "x.com", "--timeout", "soon"]), /in seconds/);
  assert.throws(() => parseArgs(["tokens", "x.com", "-z"]), /Unknown option -z/);
  assert.ok(new UsageError("x") instanceof Error);
});

test("normalizeUrl adds https, keeps localhost on http, rejects other schemes", () => {
  assert.equal(normalizeUrl("stripe.com"), "https://stripe.com/");
  assert.equal(normalizeUrl("//stripe.com/pricing"), "https://stripe.com/pricing");
  assert.equal(normalizeUrl("localhost:3000/a"), "http://localhost:3000/a");
  assert.equal(normalizeUrl("http://127.0.0.1:8080"), "http://127.0.0.1:8080/");
  assert.equal(normalizeUrl("https://a.com/?x=1#y"), "https://a.com/?x=1#y");
  assert.throws(() => normalizeUrl("file:///etc/passwd"), /Only http and https/);
  assert.throws(() => normalizeUrl("javascript:alert(1)"), /Only http and https/);
  assert.throws(() => normalizeUrl(""), /Give a website address/);
  assert.throws(() => normalizeUrl("http://"), /not a web address/);
});
