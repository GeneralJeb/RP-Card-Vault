/**
 * Whole-file sanity checks for RP_Card_Vault.html.
 *
 *   node test/vault-sanity.test.js
 *
 * These are the cheap checks that have each caught a real bug in this app:
 *
 *  1. Literal control characters in the source. A raw NUL inside a regex
 *     character class once produced a completely blank page — Babel 7 emits it
 *     verbatim and V8 rejects the regex, which kills the entire script.
 *  2. Regex literals that don't compile, for the same reason.
 *  3. The load-bearing bits of the build setup: data-presets="react" (without
 *     it Babel down-levels to ES5 and every async function dies for want of a
 *     regeneratorRuntime that isn't shipped), the fail-loud guard, and the
 *     pure-JS sentinel.
 *  4. That no code path writes an API key into the vault's database.
 *
 * The Babel compile at the end is skipped unless @babel/standalone is
 * installed, and it must be the pinned 7.23.9 — Babel 8 silently normalises
 * things Babel 7 does not, so a newer version can pass while the shipped
 * CDN build fails:
 *
 *   npm install --no-save @babel/standalone@7.23.9
 */

const fs = require("fs");
const path = require("path");
const t = require("./harness");

const HTML = path.join(__dirname, "..", "RP_Card_Vault.html");
const PINNED_BABEL = "7.23.9";

const src = fs.readFileSync(HTML, "utf8");
const openTag = src.indexOf('<script type="text/babel"');
const scriptStart = src.indexOf(">", openTag) + 1;
const scriptEnd = src.indexOf("</script>", scriptStart);
const script = src.slice(scriptStart, scriptEnd);

console.log("\nthe build setup is intact");
t.ok(openTag >= 0, "the babel script tag is present");
t.ok(/data-presets="react"/.test(src.slice(openTag, scriptStart)),
  'data-presets="react" is still on the script tag');
t.ok(src.indexOf("/*__PURE_JS_END__*/") > 0, "the pure-JS sentinel is present");
t.ok(/data-mounted/.test(src), "the fail-loud startup guard is still wired up");
t.ok(script.length > 200000, "the script region is the whole app", String(script.length));

console.log("\nno literal control characters anywhere in the file");
{
  const bad = t.sweepControlChars(src);
  t.ok(bad.length === 0, "clean sweep", bad.slice(0, 6).join(", "));
}

console.log("\nevery regex literal compiles");
{
  const { count, broken } = t.sweepRegexLiterals(script);
  t.ok(count > 50, "the sweep found regex literals to check", "found " + count);
  t.ok(broken.length === 0, "all " + count + " compile", broken.slice(0, 4).join(" | "));
}

console.log("\nthe API key never reaches the vault's database");
{
  t.ok(/function sanitizeAiSettings/.test(script), "sanitizeAiSettings exists");
  t.ok(/delete s\.apiKey;\s*delete s\.key;\s*delete s\.token;/.test(script),
    "it strips apiKey / key / token");
  t.ok(/async function saveAiSettings\(s\) \{\s*return dbPut\(STORE_KV, sanitizeAiSettings\(s\)/.test(script),
    "saveAiSettings only ever persists a sanitized record");
  const shapeStart = script.indexOf("const DEFAULT_AI_SETTINGS");
  const shape = shapeStart < 0 ? "" : script.slice(shapeStart, script.indexOf("\n};", shapeStart));
  t.ok(shape.length > 100 && shape.indexOf("apiKey") < 0 && shape.indexOf("key:") < 0,
    "the default settings shape has no key field", shape.slice(0, 80));

  const dbPutsWithKey = (script.match(/dbPut\([^)]*apiKey/g) || []);
  t.ok(dbPutsWithKey.length === 0, "no dbPut call carries an apiKey", dbPutsWithKey.join(", "));

  // Saved folders hold folder handles, and reading one back closes the whole
  // browser on Chromium 153. Only startup may read them (the 153 notice comes
  // first there); anything else checks with dbHas, which reads no value.
  const rootReads = (script.match(/\b(?:dbGet|dbAll|dbAllByIndex)\(STORE_ROOTS\b/g) || []).length;
  t.ok(rootReads === 1 && /dbAll\(STORE_ROOTS\), dbAll\(STORE_CARDS\)/.test(script),
    "saved folders are read back only once, at startup", rootReads + " reads");

  // Browser storage is readable by anything on the page and never cleared by
  // the vault's own reset paths, so nothing may go there but the theme: a list
  // of colours, written in one place, under its own key.
  const storageUse = (script.match(/\b(?:local|session)Storage\s*(?:\.|\[)[^;]*/g) || []);
  const allowed = ['localStorage.setItem("rpCardVault-theme", JSON.stringify(theme))', 'localStorage.removeItem("rpCardVault-theme")'];
  t.ok(storageUse.length === 2 && storageUse.every((u) => allowed.indexOf(u) >= 0),
    "no localStorage/sessionStorage access except remembering the theme (and Reset forgetting it)", storageUse.join(" | "));
  t.ok(/function applyTheme\(theme\)/.test(script) && /applyTheme\(themeVars\(settings,/.test(script),
    "and what's remembered is only ever themeVars(): colours, never settings or keys");
}

console.log("\nanything keyed by fingerprint moves when the fingerprint moves");
{
  const fnBody = (name) => { const at = script.slice(script.indexOf("const " + name + " = useCallback")); return at.slice(0, at.indexOf("\n  }, [")); };
  const writer = fnBody("writeCardEdits");
  t.ok(writer.indexOf("migrateAiNotes(rec.fp, newFp)") >= 0,
    "writing a card's edits migrates aiNotes to the new fingerprint");
  t.ok(writer.indexOf("dbDel(STORE_EDITS, rec.fp)") >= 0,
    "and still migrates the edit record itself");
  t.ok(fnBody("saveToCard").indexOf("writeCardEdits(") >= 0 && fnBody("saveManyToCard").indexOf("writeCardEdits(") >= 0,
    "Save to card, one card or many, both go through it");

  const reset = script.slice(script.indexOf("const hardReset = useCallback"));
  const stores = ["STORE_KV", "STORE_ROOTS", "STORE_CARDS", "STORE_THUMBS",
    "STORE_EDITS", "STORE_OPLOG", "STORE_BODIES", "STORE_AINOTES", "STORE_AGENT"];
  const line = reset.slice(0, reset.indexOf("window.location.reload"));
  for (const s of stores) t.ok(line.indexOf(s) >= 0, "hardReset clears " + s);

  const declared = (script.match(/^const STORE_[A-Z]+\s*=\s*"([a-zA-Z]+)"/gm) || [])
    .map((m) => m.match(/"([a-zA-Z]+)"/)[1]);
  const upgrade = script.slice(script.indexOf("req.onupgradeneeded"), script.indexOf("req.onsuccess"));
  t.ok(declared.length >= 8, "found the store declarations", declared.join(", "));
  const creates = (upgrade.match(/createObjectStore\(/g) || []).length;
  t.eq(creates, declared.length, "every declared store is created on upgrade");
  const guards = (upgrade.match(/objectStoreNames\.contains\(/g) || []).length;
  t.eq(guards, declared.length,
    "and each behind a contains() check, so a version bump can't fail on an existing vault");
}

console.log("\nthe page and serve.js agree on the local-server routes");
{
  const serve = fs.readFileSync(path.join(__dirname, "..", "serve.js"), "utf8");
  // Every AI route the page calls must exist in serve.js. The behaviour of
  // those routes is tested in ai-routes.test.js against the real server.
  const called = {};
  script.replace(/\/__vault\/ai\/([a-z]+)/g, (m, r) => { called[r] = true; return m; });
  const routes = Object.keys(called);
  t.ok(routes.length >= 3, "the page calls the AI relay (" + routes.join(", ") + ")");
  for (const r of routes) t.ok(serve.indexOf('route === "' + r + '"') >= 0, "serve.js handles /__vault/ai/" + r);
  // The same for the agent's workspace routes, which serve.js handles in handleWs.
  const wsCalled = {};
  script.replace(/\/__vault\/ws\/([a-z]+)/g, (m, r) => { wsCalled[r] = true; return m; });
  const wsRoutes = Object.keys(wsCalled);
  const handleWs = serve.slice(serve.indexOf("async function handleWs"));
  t.ok(wsRoutes.length >= 6, "the page calls the workspace routes (" + wsRoutes.join(", ") + ")");
  for (const r of wsRoutes) t.ok(handleWs.indexOf('route === "' + r + '"') >= 0, "serve.js handles /__vault/ws/" + r);
  // serve.js refuses non-GET requests without X-Vault; vaultFetch adds it.
  t.ok(!/[^A-Za-z]fetch\(\s*["'`]\/__vault\//.test(script), "every /__vault/ request goes through vaultFetch()");
}

console.log("\nBabel " + PINNED_BABEL + " compiles the script region");
{
  let babel = null, version = "";
  try {
    babel = require("@babel/standalone");
    version = babel.version || "";
  } catch (e) { /* not installed */ }

  if (!babel) {
    t.skip("compile", "npm install --no-save @babel/standalone@" + PINNED_BABEL);
  } else if (version !== PINNED_BABEL) {
    t.skip("compile", "found Babel " + version + ", this app pins " + PINNED_BABEL);
  } else {
    let out = null, err = "";
    try {
      out = babel.transform(script, { presets: ["react"], filename: "vault.jsx" }).code;
    } catch (e) { err = e.message; }
    t.ok(!!out, "transforms without error", err.split("\n")[0]);
    if (out) {
      t.ok(out.indexOf("regeneratorRuntime") < 0, "no regeneratorRuntime in the output");
      t.ok(/async /.test(out), "async functions survived as async");
      let parsed = true, perr = "";
      try { new Function(out); } catch (e) { parsed = false; perr = e.message; }
      t.ok(parsed, "the compiled output parses in V8", perr);
    }
  }
}

t.done();
