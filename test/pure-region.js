/**
 * Lifts the framework-free part of RP_Card_Vault.html out of the page so Node
 * can require it. Shared by the test suites; not a suite itself.
 *
 * Everything above the /*__PURE_JS_END__*​/ sentinel is plain JS with no React
 * and no JSX, which is the whole point of the sentinel: pure logic stays
 * testable without a browser. Put new pure logic above it.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const HTML = path.join(__dirname, "..", "RP_Card_Vault.html");
const SENTINEL = "/*__PURE_JS_END__*/";

/**
 * @param {string[]} names  top-level declarations to re-export. A typo shows up
 *                          as `undefined` in the tests rather than an error.
 * @param {object}  [opts]  { indexedDB, IDBKeyRange } to inject a fake database.
 */
function loadPureRegion(names, opts) {
  opts = opts || {};
  const src = fs.readFileSync(HTML, "utf8");

  const openTag = src.indexOf('<script type="text/babel"');
  if (openTag < 0) throw new Error('could not find the <script type="text/babel"> tag');
  const bodyStart = src.indexOf(">", openTag) + 1;

  const end = src.indexOf(SENTINEL, bodyStart);
  if (end < 0) throw new Error("could not find the " + SENTINEL + " sentinel");

  let region = src.slice(bodyStart, end);

  // The region's first line destructures React hooks, and a few constants are
  // evaluated at load time from browser globals (browser sniffing, the file://
  // check). Node has none of those, so stub the shape they read.
  const stubs = [
    "var React = {};",
    "var navigator = { userAgent: 'node', storage: undefined };",
    "var location = { protocol: 'http:', href: 'http://127.0.0.1:8788/RP_Card_Vault.html', origin: 'http://127.0.0.1:8788' };",
    "var document = { createElement: function () { return {}; }, getElementById: function () { return null; } };",
    "var window = { chrome: undefined, navigator: navigator, location: location, isSecureContext: true };",
    opts.indexedDB ? "var indexedDB = module.__idb;" : "var indexedDB = undefined;",
    opts.IDBKeyRange ? "var IDBKeyRange = module.__range;" : "",
    "",
  ].join("\n");

  region = stubs + region + "\nmodule.exports = { " + names.join(", ") + " };\n";

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-pure-"));
  const tmp = path.join(tmpDir, "pure.js");
  fs.writeFileSync(tmp, region, "utf8");

  // Seed the injected globals on the module object before it evaluates.
  const Module = require("module");
  const m = new Module(tmp, null);
  m.__idb = opts.indexedDB;
  m.__range = opts.IDBKeyRange;
  m.filename = tmp;
  m.paths = Module._nodeModulePaths(path.dirname(tmp));
  m._compile(fs.readFileSync(tmp, "utf8"), tmp);

  // Clean up the temp file and directory now that the module is compiled.
  try { fs.unlinkSync(tmp); } catch (e) {}
  try { fs.rmdirSync(tmpDir); } catch (e) {}

  return { mod: m.exports, source: region };
}

module.exports = { loadPureRegion, HTML, SENTINEL };
