/**
 * Runs every test in this folder.
 *
 *   node test/run-all.js
 *
 * Two of the four need nothing but Node. The other two do more the moment the
 * optional dev dependencies are present, and say so when they're not:
 *
 *   npm install --no-save jsdom react@18 react-dom@18 fake-indexeddb @babel/standalone@7.23.9
 *
 * The Babel version matters — 7.23.9 is what the page loads from cdnjs, and
 * Babel 8 silently normalises things Babel 7 does not.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const here = __dirname;
const files = fs.readdirSync(here).filter((f) => f.endsWith(".test.js")).sort();

const results = [];
for (const f of files) {
  console.log("\n" + "=".repeat(64));
  console.log("  " + f);
  console.log("=".repeat(64));
  const r = spawnSync(process.execPath, [path.join(here, f)], { stdio: "inherit", cwd: path.join(here, "..") });
  results.push({ f, code: r.status === null ? 1 : r.status });
}

console.log("\n" + "=".repeat(64));
let bad = 0;
for (const r of results) {
  console.log((r.code === 0 ? "  PASS  " : "  FAIL  ") + r.f);
  if (r.code !== 0) bad++;
}
console.log("=".repeat(64));
console.log(bad ? "\n" + bad + " of " + results.length + " suites failed\n" : "\nall " + results.length + " suites passed\n");
process.exit(bad ? 1 : 0);
