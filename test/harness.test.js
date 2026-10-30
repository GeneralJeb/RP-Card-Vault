/**
 * The test harness and the pure-region loader themselves. A suite that stops
 * part way must fail, not pass with its later checks never run.
 *
 *   node test/harness.test.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const t = require("./harness");
const { loadPureRegion } = require("./pure-region");

const HARNESS = path.join(__dirname, "harness.js");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vault-harness-"));

/** Run a little suite that uses the real harness; its exit code and output. */
function runSuite(body) {
  const f = path.join(scratch, "s" + Math.random().toString(36).slice(2) + ".test.js");
  fs.writeFileSync(f, "const t = require(" + JSON.stringify(HARNESS) + ");\n" + body, "utf8");
  const r = spawnSync(process.execPath, [f], { encoding: "utf8", timeout: 30000 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

console.log("\nhow a suite ends");
{
  let r = runSuite("t.ok(true, 'one'); t.done();");
  t.eq(r.code, 0, "a suite whose checks pass and that reaches done() passes");
  r = runSuite("t.ok(false, 'one'); t.done();");
  t.eq(r.code, 1, "a failed check fails it");
  r = runSuite(
    "async function main() {\n" +
    "  t.ok(true, 'first');\n" +
    "  await new Promise(() => {});\n" +
    "  t.ok(false, 'never reached');\n" +
    "  t.done();\n" +
    "}\n" +
    "main().catch((e) => { console.error(e); process.exit(1); });\n");
  t.eq(r.code, 1, "a suite left waiting on a promise that never settles fails, rather than passing with its later checks unrun");
  t.ok(/before it finished/.test(r.out), "and says why", r.out.trim().split("\n").pop());
  r = runSuite("t.ok(true, 'one');");
  t.eq(r.code, 1, "so does one that runs off its end without done()");
  r = runSuite("t.skip('everything', 'not installed'); t.done();");
  t.eq(r.code, 0, "a suite that skips everything and says so still passes");
}

console.log("\nthe pure-region loader");
{
  const before = fs.readdirSync(os.tmpdir()).filter((n) => /^vault-pure-/.test(n)).length;
  let err = null;
  try { loadPureRegion(["reEscape", "noSuchFunction"]); } catch (e) { err = e; }
  t.ok(err && /noSuchFunction is not defined/.test(err.message), "a misspelt name throws, naming it", err && err.message);
  const after = fs.readdirSync(os.tmpdir()).filter((n) => /^vault-pure-/.test(n)).length;
  t.eq(after, before, "and leaves no copy of the page's code in the temp folder");
  t.eq(typeof loadPureRegion(["reEscape"]).mod.reEscape, "function", "a right one loads");
}

try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* busy on Windows: left in temp */ }
t.done();
