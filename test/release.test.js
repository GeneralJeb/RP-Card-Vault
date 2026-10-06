/**
 * What a release relies on: the bundled libraries, the version numbers, the
 * Node check and the GitHub workflows.
 *
 *   node test/release.test.js
 *
 *   - lib/ holds the exact files the page pins by hash, every one is served
 *     and cached for offline use, and each has a cdnjs fallback with the same
 *     hash
 *   - the page, serve.js, package.json, package-lock.json and the newest
 *     CHANGELOG heading all name the same version
 *   - serve.js refuses Node older than 20 up front, in a message even an old
 *     Node can show
 *   - the workflows run the tests on Windows and release from CHANGELOG.md
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const t = require("./harness");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const page = read("RP_Card_Vault.html");
const serveSrc = read("serve.js");
const sw = read("sw.js");
const relay = require("../serve.js");

console.log("\nthe bundled libraries are the files the page pins");
const localTags = [...page.matchAll(/<script src="lib\/([^"]+)" integrity="(sha512-[^"]+)" data-local="1"><\/script>\n<script>window\.(\w+) \|\| document\.write\('<script src="(https:\/\/cdnjs\.cloudflare\.com\/[^"]+)" integrity="(sha512-[^"]+)" crossorigin="anonymous" referrerpolicy="no-referrer"><\\\/script>'\)<\/script>/g)];
t.eq(localTags.map((m) => m[1]).join(" "), "react.production.min.js react-dom.production.min.js babel.min.js jszip.min.js",
  "React, ReactDOM, Babel and JSZip load from lib/, in that order");
for (const [, file, hash, global, cdn, cdnHash] of localTags) {
  const buf = fs.readFileSync(path.join(ROOT, "lib", file));
  t.eq("sha512-" + crypto.createHash("sha512").update(buf).digest("base64"), hash, "lib/" + file + " matches its pinned hash");
  t.eq(cdnHash, hash, file + ": the cdnjs fallback is pinned to the same hash");
  t.eq(path.basename(cdn), file, file + ": the fallback is the same file");
  t.ok(new RegExp('"/lib/' + file.replace(/\./g, "\\.") + '": "lib/' + file.replace(/\./g, "\\.") + '"').test(serveSrc), "serve.js serves lib/" + file);
  t.ok(sw.indexOf('"/lib/' + file + '"') >= 0, "the service worker keeps lib/" + file + " for offline use");
  t.ok(["React", "ReactDOM", "Babel", "JSZip"].indexOf(global) >= 0, file + ": the fallback checks window." + global);
}
const otherScripts = [...page.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^lib\//.test(s) && !localTags.some((m) => m[4] === s));
t.eq(otherScripts.length, 0, "no other script loads from anywhere but lib/ and those fallbacks", otherScripts);
t.ok(/if \(e\.target\.getAttribute\("data-local"\)\) return;/.test(page), "a missing local library doesn't paint the failure panel (the fallback loads next)");
t.ok(/^lib\/\*\* -text -diff/m.test(read(".gitattributes")), "git never rewrites the libraries' bytes (line endings would break their hashes)");
const licenses = read("lib/LICENSES.md");
for (const [, file] of localTags) t.ok(licenses.indexOf("`" + file + "`") >= 0, "lib/LICENSES.md lists " + file);
t.ok(/MIT License/.test(licenses) && /Permission is hereby granted/.test(licenses), "and carries the MIT license text");

console.log("\nthe fonts ship in lib/fonts too, so Google Fonts is never contacted");
{
  const css = read("lib/fonts/fonts.css");
  const used = [...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]))].sort();
  const files = fs.readdirSync(path.join(ROOT, "lib", "fonts")).filter((f) => /\.woff2$/.test(f)).sort();
  t.eq(used.join(), files.join(), "fonts.css uses exactly the font files in lib/fonts, and they all exist");
  for (const fam of ["Crimson Pro", "JetBrains Mono", "Outfit"]) t.ok(css.indexOf("font-family: '" + fam + "'") >= 0, fam + " is defined");
  for (const f of ["fonts.css"].concat(files)) {
    t.ok(serveSrc.indexOf('"/lib/fonts/' + f + '": "lib/fonts/' + f + '"') >= 0 && sw.indexOf('"/lib/fonts/' + f + '"') >= 0, f + " is served and cached for offline use");
  }
  for (const n of ["CrimsonPro", "JetBrainsMono", "Outfit"]) {
    t.ok(/SIL OPEN FONT LICENSE Version 1\.1/.test(read("lib/fonts/OFL-" + n + ".txt")), n + "'s Open Font License ships with it");
  }
  t.ok(/@import url\('lib\/fonts\/fonts\.css'\);/.test(page), "the page imports the local stylesheet");
  t.ok(!/fonts\.googleapis|fonts\.gstatic/.test(page + serveSrc + sw), "and nothing mentions Google Fonts any more, the content policy included");
  t.ok(/"font-src 'self'"/.test(serveSrc), "fonts may only come from the vault itself");
}

console.log("\none version everywhere");
const version = require("../package.json").version;
t.ok(/^\d+\.\d+\.\d+$/.test(version), "package.json has a version", version);
t.eq((page.match(/const APP_VERSION = "([^"]+)";/) || [])[1], version, "the page's APP_VERSION");
t.eq(relay.VAULT_VERSION, version, "serve.js's VAULT_VERSION");
const lock = require("../package-lock.json");
t.eq(lock.version, version, "package-lock.json");
t.eq(lock.packages[""].version, version, "package-lock.json's root package");
const changelog = read("CHANGELOG.md");
const headings = [...changelog.matchAll(/^## (\S+)$/gm)].map((m) => m[1]);
t.eq(headings[0], version, "the newest CHANGELOG.md heading");
t.eq(new Set(headings).size, headings.length, "no version appears twice in the changelog");
t.ok(/subtitle=\{APP_NAME \+ " v" \+ APP_VERSION/.test(page), "Settings shows the version");
t.ok(/version: APP_VERSION, format: 2/.test(page), "and exported vault data records it");

console.log("\nserve.js needs Node 20 and says so up front");
t.eq(relay.NODE_MIN, 20, "the minimum is Node 20");
for (const [v, old] of [["v18.19.0", true], ["v16.20.2", true], ["v8.9.4", true], ["", true], ["nonsense", true], ["v20.0.0", false], ["v22.11.0", false], ["v24.1.0", false]]) {
  t.eq(relay.nodeTooOld(v), old, (v || "(empty)") + (old ? " is too old" : " is fine"));
}
const head = serveSrc.slice(0, serveSrc.indexOf('const http = require("http");'));
t.ok(/nodeTooOld\(process\.version\)/.test(head), "the check runs before anything else is loaded");
t.ok(!/\b(const|let)\b|=>|`/.test(head.replace(/\/\*[\s\S]*?\*\//g, "")), "and is written in syntax any Node parses (no const, let, arrows or template strings)");
{
  const fake = path.join(require("os").tmpdir(), "vault-fake-node18.js");
  fs.writeFileSync(fake, 'Object.defineProperty(process, "version", { value: "v18.19.0" });');
  const r = spawnSync(process.execPath, ["-r", fake, path.join(ROOT, "serve.js"), "0", "--no-open"], { encoding: "utf8", timeout: 15000 });
  fs.unlinkSync(fake);
  t.eq(r.status, 1, "on Node 18 serve.js stops with an error code");
  t.ok(/needs Node\.js 20 or newer; this is Node v18\.19\.0/.test(r.stderr), "and says which Node it needs", r.stderr);
}

console.log("\nthe GitHub workflows");
const testYml = read(".github/workflows/test.yml");
t.ok(/runs-on: windows-latest/.test(testYml), "tests run on Windows (the launcher tests need cmd, cscript and PowerShell)");
t.ok(/pull_request:\s*\n\s*branches: \[dev, main\]/.test(testYml), "on every pull request into dev or main");
t.ok(/- run: npm ci\s*\n\s*- run: npm test/.test(testYml), "installing from the lockfile, then npm test");
t.eq(Number((testYml.match(/node-version: (\d+)/) || [])[1]), relay.NODE_MIN, "on the oldest Node the vault supports");
t.ok(/contents: read/.test(testYml), "with read-only access");
console.log("\nthe offline copy can't keep an old library");
{
  // sw.js serves lib/ cache-first under unchanging names. Its LIB_HASH must
  // follow the files, so a changed library changes sw.js and is fetched again.
  const files = [...sw.matchAll(/"\/(lib\/[^"]+)"/g)].map((m) => m[1]).sort();
  const h = crypto.createHash("sha256");
  for (const f of files) { h.update(f + "\n"); h.update(fs.readFileSync(path.join(ROOT, f))); }
  const want = h.digest("hex").slice(0, 16);
  const got = (sw.match(/const LIB_HASH = "([0-9a-f]+)"/) || [])[1];
  t.eq(got, want, "sw.js's LIB_HASH matches the " + files.length + " lib/ files it caches (update it to " + want + " when a library changes)");
}

const relYml = read(".github/workflows/release.yml");
t.ok(/push:\s*\n\s*branches: \[main\]/.test(relYml), "releases come only from main");
t.ok(/refs\/tags\/v\$VERSION/.test(relYml) && /already released/.test(relYml), "an already-released version releases nothing");
t.ok(/awk -v v="## \$VERSION"/.test(relYml) && /--notes-file notes\.md/.test(relYml), "the notes are that version's CHANGELOG section");
{
  // The download zip: everything the vault serves, every launcher, and nothing for developers.
  const cp = (relYml.match(/cp -r ([\s\S]*?) "\$DIR"\//) || [])[1] || "";
  const listed = [...cp.replace(/\\\n/g, " ").matchAll(/"([^"]+)"|(\S+)/g)].map((m) => m[1] || m[2]);
  const served = [...new Set(Object.values(relay.STATIC_FILES || {}).map((f) => f.split("/")[0]))];
  const launchers = fs.readdirSync(ROOT).filter((f) => /\.(bat|vbs|ps1)$/i.test(f));
  t.ok(served.length > 5 && served.every((f) => listed.indexOf(f) >= 0), "the release zip has every file the server serves (" + served.join(", ") + ")",
    served.filter((f) => listed.indexOf(f) < 0));
  t.ok(launchers.every((f) => listed.indexOf(f) >= 0) && listed.indexOf("HOW TO RUN.txt") >= 0, "and every launcher, with HOW TO RUN.txt",
    launchers.filter((f) => listed.indexOf(f) < 0));
  t.ok(!listed.some((f) => /^(test|\.github|package(-lock)?\.json|node_modules|docs)$/.test(f)), "but none of the developer files");
  t.ok(/zip -qr "\$DIR\.zip" "\$DIR"/.test(relYml) && /--notes-file notes\.md "\$DIR\.zip"/.test(relYml), "and it's attached to the release");
}
{
  // The awk the workflow runs, done in JS: the section must exist and not run into the next one.
  const lines = changelog.split("\n");
  const at = lines.indexOf("## " + version);
  const next = lines.findIndex((l, i) => i > at && /^## /.test(l));
  const notes = lines.slice(at + 1, next < 0 ? undefined : next).join("\n").trim();
  t.ok(at >= 0 && notes.length > 20, "this version's notes aren't empty", notes.slice(0, 80));
  t.ok(notes.indexOf("## ") < 0, "and stop at the next version");
}

t.done();
