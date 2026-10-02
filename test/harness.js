/**
 * Shared test harness for the RP Card Vault test suite.
 *
 * Every suite in this folder used to carry its own copy of ok/eq/skip and
 * the summary block. This module is the single source so the reporting
 * format can't accidentally diverge.
 *
 *   const t = require("./harness");
 *   t.ok(true, "it works");
 *   t.eq(1, 1, "math holds");
 *   t.skip("something", "not installed");
 *   t.done();                 // prints summary, exits 0 or 1
 *
 * The regex-sweeping helper lives here too — it's used by both
 * vault-sanity.test.js and ai-pure.test.js, and must stay in sync.
 */

let pass = 0;
const failures = [];

function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  ✓ " + label); return true; }
  failures.push(label + (extra ? "  → " + extra : ""));
  console.log("  ✗ " + label + (extra ? "  → " + extra : ""));
  return false;
}

function eq(actual, expected, label) {
  const a = typeof actual === "object" ? JSON.stringify(actual) : actual;
  const b = typeof expected === "object" ? JSON.stringify(expected) : expected;
  return ok(a === b, label, "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
}

function skip(label, why) {
  console.log("  – " + label + " (skipped: " + why + ")");
}

function done() {
  console.log("\n" + "-".repeat(60));
  if (failures.length) {
    console.log(pass + " passed, " + failures.length + " FAILED:");
    for (const f of failures) console.log("  ✗ " + f);
    process.exit(1);
  }
  console.log("all " + pass + " checks passed");
  process.exit(0);
}

/**
 * Sweep a source string for regex literals and check that every one compiles.
 * Returns { count, broken } where broken is an array of descriptions.
 *
 * The regex that finds regex literals is itself non-trivial — it looks for a
 * slash preceded by something that can only start a regex (not a division),
 * then captures the body and flags. It's here once so a fix applies everywhere.
 */
const REGEX_FINDER = /(?:^|[=(,:!&|?{};[+\-*%\s])\/(?![*\/])((?:\\.|\[(?:\\.|[^\]\\])*\]|[^\/\\\n])+)\/([gimsuy]*)/g;

function sweepRegexLiterals(source) {
  let count = 0;
  const broken = [];
  let m;
  // Reset lastIndex in case the caller reuses the module across calls.
  REGEX_FINDER.lastIndex = 0;
  while ((m = REGEX_FINDER.exec(source))) {
    count++;
    try { new RegExp(m[1], m[2]); } catch (e) { broken.push(m[0].trim() + " — " + e.message); }
  }
  return { count, broken };
}

/**
 * Sweep a source string for literal control characters (NUL, BEL, etc.)
 * that have no business in source code. Returns an array of descriptions.
 */
function sweepControlChars(source) {
  const bad = [];
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) {
      const line = source.slice(0, i).split("\n").length;
      bad.push("U+" + c.toString(16).padStart(4, "0") + " on line " + line);
    }
  }
  return bad;
}

module.exports = { ok, eq, skip, done, sweepRegexLiterals, sweepControlChars, REGEX_FINDER };
