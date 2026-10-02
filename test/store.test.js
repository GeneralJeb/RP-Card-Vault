/**
 * The vault's database layer, against a real (in-memory) IndexedDB.
 *
 *   node test/store.test.js
 *
 * Two things found by stress testing:
 *   - one value the database can't store used to cost every other value
 *     written in the same batch (a scan writes thousands of card texts at once)
 *   - two windows of the vault each kept their own copy of your edits, so one
 *     could undo what the other had just saved
 */

const { indexedDB, IDBKeyRange } = require("fake-indexeddb");
const { loadPureRegion } = require("./pure-region");
const t = require("./harness");

// The skipped value is logged as a warning on purpose; keep the output readable.
console.warn = () => {};

const { mod: V } = loadPureRegion([
  "dbPutMany", "dbPut", "dbDel", "dbGet", "dbKeys", "STORE_BODIES", "STORE_EDITS", "vaultEditsChannel", "agentPinnedLine",
  "chromiumMajor", "handleCrashVersion", "browserUpdatePage",
  "vaultDataFileName", "vaultDataFilesToPrune", "autoBackupDue", "autoBackupTarget", "dirKey", "startupSort",
], { indexedDB, IDBKeyRange });

async function main() {
  console.log("\none value the database can't store doesn't cost the others");
  {
    const items = [];
    for (let i = 0; i < 50; i++) items.push({ __key: "card-" + i, __val: { name: "Card " + i, description: "text " + i } });
    // A function can't be stored: put() refuses it on the spot, like a card
    // nested too deeply for the browser's copier.
    items.splice(10, 0, { __key: "bad", __val: { name: "Bad", hook: function () {} } });
    const ok = await V.dbPutMany(V.STORE_BODIES, items);
    const keys = await V.dbKeys(V.STORE_BODIES);
    t.ok(ok === false, "dbPutMany says something was left out");
    t.eq(keys.length, 50, "and every other card's text is stored, before and after the bad one");
    t.ok(keys.indexOf("bad") < 0 && keys.indexOf("card-49") >= 0, "the bad one is the only one missing");
    t.eq((await V.dbGet(V.STORE_BODIES, "card-49")).description, "text 49", "and what was stored reads back");
    t.ok(await V.dbPutMany(V.STORE_BODIES, [{ __key: "card-50", __val: { name: "Fine" } }]) === true, "a clean batch reports success");
  }

  console.log("\nevery saved edit is announced to the vault's other windows");
  {
    const other = new BroadcastChannel("rpCardVault-edits");
    const got = [];
    other.onmessage = (e) => got.push(e.data);
    await V.dbPut(V.STORE_EDITS, { fingerprint: "fp1", notes: "From window A" });
    await V.dbPutMany(V.STORE_EDITS, [{ fingerprint: "fp2", favorite: true }]);
    await V.dbDel(V.STORE_EDITS, "fp1");
    await V.dbPut(V.STORE_BODIES, { name: "not an edit" }, "x");
    await new Promise((r) => setTimeout(r, 100));
    other.close();
    const ch = V.vaultEditsChannel();
    if (ch) ch.close();
    t.eq(got.length, 3, "a put, a batch and a delete of edits are each announced; other stores aren't");
    t.eq(got[0].put[0].notes, "From window A", "with the whole saved edit, so the other window can take it in");
    t.eq(got[1].put[0].fingerprint, "fp2", "batches too");
    t.eq(got[2].deleted, ["fp1"], "and deletions by fingerprint");
  }

  console.log("\na pinned card that has left the vault");
  {
    const line = V.agentPinnedLine(null, "Ada");
    t.ok(/Ada, is no longer in the vault/.test(line) && /ask which card they mean/.test(line),
      "the agent is told the pinned card is gone, rather than nothing");
    t.eq(V.agentPinnedLine(null, ""), "", "with nothing pinned, nothing is said");
  }

  console.log("\nbrowsers whose saved data closes them once a folder is remembered (Chromium 153)");
  {
    const ua = (v, extra) => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + v + ".0.0.0 Safari/537.36" + (extra || "");
    t.eq(V.chromiumMajor(ua(153)), 153, "Chrome's version is read from its user agent");
    t.eq(V.chromiumMajor(ua(153, " Edg/153.0.3405.12")), 153, "Edge's engine version too (Edge 153 is Chromium 153)");
    t.eq(V.chromiumMajor("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36"), 153,
      "a headless (automated) browser's too");
    t.eq(V.chromiumMajor("Mozilla/5.0 (Windows NT 10.0; rv:140.0) Gecko/20100101 Firefox/140.0"), 0, "Firefox has no Chromium version");
    t.eq(V.handleCrashVersion(ua(153)), 153, "153 crashes");
    t.eq(V.handleCrashVersion(ua(153, " Edg/153.0.3405.12")), 153, "in Edge as well");
    for (const v of [151, 152, 154, 160]) t.eq(V.handleCrashVersion(ua(v)), 0, v + " is fine");
    t.eq(V.handleCrashVersion(""), 0, "an empty user agent is fine");
    t.eq(V.browserUpdatePage("Edge"), "edge://settings/help", "Edge users are sent to Edge's update page");
    t.eq(V.browserUpdatePage("Chrome"), "chrome://settings/help", "Chrome users to Chrome's");
  }

  console.log("\nthe sort the grid opens with");
  {
    t.eq(V.startupSort({}), "name", "by default, Name (A–Z)");
    t.eq(V.startupSort({ startSort: "mtimeDesc" }), "mtimeDesc", "or the one chosen in Settings");
    t.eq(V.startupSort({ startSort: "random" }), "random", "Random is allowed: a fresh shuffle each time");
    t.eq(V.startupSort({ startSort: "last", lastSort: "tokensDesc" }), "tokensDesc", "or the last one used");
    t.eq(V.startupSort({ startSort: "last" }), "name", "with none used yet, Name");
    t.eq(V.startupSort({ startSort: "nonsense" }), "name", "and anything unknown, Name");
  }

  console.log("\nautomatic backups of vault data");
  {
    const day = 86400000, now = Date.UTC(2026, 9, 2, 12);
    t.ok(V.autoBackupDue(0, 1, now), "never backed up: due");
    t.ok(!V.autoBackupDue(now - 3 * 3600000, 1, now), "backed up 3 hours ago, daily: not due");
    t.ok(V.autoBackupDue(now - day, 1, now), "a day ago: due");
    t.ok(!V.autoBackupDue(now - 2 * day, 3, now) && V.autoBackupDue(now - 3 * day, 3, now), "every 3 days: due on the third");

    t.eq(V.vaultDataFileName("20261002-120000"), "rp-card-vault-data 20261002-120000.json", "the file name carries the date and time");
    const names = ["rp-card-vault-data 20261001-120000.json", "rp-card-vault-data 20261002-120000.json", "rp-card-vault-data 20260930-120000.json",
      "rp-card-vault-data.json", "my notes.json", "rp-card-vault-data 20260101-000000.json.bak"];
    t.eq(V.vaultDataFilesToPrune(names, 2).join(), "rp-card-vault-data 20260930-120000.json", "keeping 2, the oldest backup goes");
    t.eq(V.vaultDataFilesToPrune(names, 7).length, 0, "and below the limit nothing does; other files never");

    const h = {};
    const roots = [{ id: "imp", name: "Imported", mode: "import" }, { id: "r1", name: "Cards", handle: h }, { id: "r2", name: "Archive", handle: h }];
    t.eq(V.autoBackupTarget({ autoBackupKey: "auto" }, roots).label, "Cards/_vault data", "by default, the first folder that can be written to");
    t.eq(V.autoBackupTarget({}, roots).label, "Cards/_vault data", "settings from before this existed mean the same");
    t.eq(V.autoBackupTarget({ autoBackupKey: V.dirKey("r2", "Old/Saves") }, roots).label, "Archive/Old/Saves/_vault data", "or the folder you chose");
    t.eq(V.autoBackupTarget({ autoBackupKey: V.dirKey("gone", "") }, roots).label, "Cards/_vault data", "a chosen folder that's gone falls back, so backups don't quietly stop");
    t.eq(V.autoBackupTarget({ autoBackupKey: "off" }, roots), null, "off is off");
    t.eq(V.autoBackupTarget({ autoBackupKey: "auto" }, [roots[0]]), null, "with only a read-only import, there's nowhere to write");

  }

  t.done();
}

main().catch((e) => { console.error("harness error:", e && e.stack || e); process.exit(1); });
