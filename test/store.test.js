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

const { indexedDB, IDBKeyRange, IDBDatabase } = require("fake-indexeddb");
const { loadPureRegion } = require("./pure-region");
const t = require("./harness");

// The skipped value is logged as a warning on purpose; keep the output readable.
console.warn = () => {};

const { mod: V } = loadPureRegion([
  "dbPutMany", "dbPut", "dbDel", "dbGet", "dbKeys", "STORE_BODIES", "STORE_EDITS", "vaultEditsChannel", "agentPinnedLine",
  "chromiumMajor", "handleCrashVersion", "browserUpdatePage", "osKindOf", "startScriptFor", "unopenedFileMessage",
  "orphanCardIds", "dbDelCardsOfRoot", "dbAll", "STORE_CARDS", "STORE_THUMBS",
  "vaultDataFileName", "vaultDataFilesToPrune", "autoBackupDue", "autoBackupTarget", "dirKey", "startupSort",
  "vaultDataBackupNames", "vaultDataBackupDate", "vaultDataWeight", "backupOutweighs",
  "editsFollowingCards", "changedFingerprints", "mergeEditRecords", "editHolds",
  "probeReads", "keepStorage",
  "cleanFilters", "sameFilters", "sanitizeSavedViews", "savedViewsWith", "viewFiltersFor", "suggestViewName", "SAVED_VIEWS_MAX", "DEFAULT_SETTINGS",
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

  console.log("\nthe vault's saved data: kept by the browser, and really readable");
  {
    const nav = (persisted, grant) => { const calls = []; return { calls, storage: { persisted: async () => { calls.push("persisted"); return persisted; }, persist: async () => { calls.push("persist"); return grant; } } }; };
    const kept = nav(true, false);
    t.eq([await V.keepStorage(kept), kept.calls], ["kept", ["persisted"]], "a browser already keeping the data isn't asked again");
    const yes = nav(false, true);
    t.eq([await V.keepStorage(yes), yes.calls], ["kept", ["persisted", "persist"]], "one that isn't is asked, and may agree");
    t.eq(await V.keepStorage(nav(false, false)), "may-clear", "or may not promise: then the vault says so");
    t.eq([await V.keepStorage({}), await V.keepStorage(null), await V.keepStorage({ storage: {} })], ["unknown", "unknown", "unknown"], "a browser with no way to ask is no error");
    t.eq(await V.keepStorage({ storage: { persist: async () => { throw new Error("blocked"); } } }), "unknown", "nor is one that refuses to be asked");

    t.eq(await V.probeReads(), { ok: true, msg: "" }, "a database that reads is fine to open");
    // The same database, with reads from the settings store failing as a damaged one's do.
    const realTx = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode) {
      const tx = realTx.call(this, stores, mode);
      const realStore = tx.objectStore.bind(tx);
      tx.objectStore = (name) => { const os = realStore(name); if (name === "kv") os.get = () => { throw new DOMException("Internal error reading the backing store", "UnknownError"); }; return os; };
      return tx;
    };
    try {
      const bad = await V.probeReads();
      t.ok(!bad.ok && /Internal error reading the backing store/.test(bad.msg), "one that opens but can't be read is caught, with the browser's reason", bad);
      t.eq(await V.dbGet("kv", "settings"), undefined, "(the ordinary reader would have answered \"nothing saved\", which is how a vault opens looking empty)");
    } finally { IDBDatabase.prototype.transaction = realTx; }
    t.eq((await V.probeReads()).ok, true, "and it's fine again once reads work");
  }

  console.log("\nsaved views: the sidebar as you had it, by name");
  {
    const now = { q: "sea", deep: false, sort: "tokensDesc", tagsInc: ["fantasy"], tagsExc: [], tagMode: "or", dirs: ["r1::Inbox", "gone::Old"], specs: ["v3"], flags: { favorite: true, hasLore: false }, flagKeys: ["keeper"], tokenMin: 100, tokenMax: 0 };
    const c = V.cleanFilters(now);
    t.eq([c.q, c.sort, c.tagMode, c.flags, c.tokenMin, c.dirs.length], ["sea", "tokensDesc", "or", { favorite: true }, 100, 2], "a view keeps the search, sort, tags, flags, folders and limits; a flag that's off isn't kept");
    t.eq(V.cleanFilters({ sort: "nonsense", tagsInc: "x", flags: null, tokenMin: -5, extra: 1 }), V.cleanFilters(null), "anything that isn't a filter comes out as no filter at all");
    t.ok(V.sameFilters(now, Object.assign({}, now, { flags: { hasLore: false, favorite: true } })) && !V.sameFilters(now, Object.assign({}, now, { sort: "name" })),
      "two filter states are the same view when they pick the same things, whatever order they were picked in");

    let views = V.savedViewsWith([], "  Sea  cards ", now, "v1");
    t.eq([views.length, views[0].id, views[0].name], [1, "v1", "Sea cards"], "a view is saved under its name, tidied");
    views = V.savedViewsWith(views, "Long ones", { sort: "tokensDesc" }, "v2");
    views = V.savedViewsWith(views, "sea CARDS", { q: "harbour" }, "v3");
    t.eq([views.map((v) => v.id + ":" + v.name), views[0].filters.q], [["v1:sea CARDS", "v2:Long ones"], "harbour"], "saving under a name already used (in any case) replaces that view, where it was");
    t.eq(V.savedViewsWith(views, "   ", now, "v4").length, 2, "a view with no name isn't saved");
    t.eq(V.viewFiltersFor(V.savedViewsWith([], "x", now, "v9")[0], [{ id: "r1" }]).dirs, ["r1::Inbox"], "a folder that isn't linked any more is left out when the view is shown");
    t.eq(V.sanitizeSavedViews([{ id: "a", name: "A", filters: now }, { id: "a", name: "Twice" }, { name: "No id" }, null, "x", { id: "b", name: "" }]).map((v) => v.name), ["A"],
      "views from a backup are checked: no name, no id, or an id twice, and it's dropped");
    t.eq(V.sanitizeSavedViews(Array.from({ length: 60 }, (_, i) => ({ id: "v" + i, name: "View " + i }))).length, V.SAVED_VIEWS_MAX, "and there's a limit to how many are kept");
    t.eq([V.suggestViewName(now), V.suggestViewName({})], ["\"sea\" + fantasy + favorite + Inbox", "My view"], "a name is offered from what the view filters by");
    t.eq(V.DEFAULT_SETTINGS.savedViews, [], "a new vault has none");
  }

  console.log("\na card edited somewhere else keeps its notes, favourite and flags");
  {
    const rec = (id, fp, ok) => ({ id, fp, ok: ok !== false });
    const before = new Map([["r:a.png", rec("r:a.png", "old")], ["r:b.png", rec("r:b.png", "same")], ["r:c.png", rec("r:c.png", "nofp:x", false)]]);
    t.eq(V.changedFingerprints(before, [rec("r:a.png", "new"), rec("r:b.png", "same"), rec("r:c.png", "c2"), rec("r:d.png", "d")]), [{ from: "old", to: "new" }],
      "a scan notes the files it knew whose card changed: not unchanged ones, new ones or ones it couldn't read before");

    const mine = { fingerprint: "old", fields: { scenario: "Edited here." }, tags: null, vaultTags: ["keeper"], flags: [{ key: "review", note: "check", at: 1 }], notes: "Good one.", rating: 4, favorite: true, updatedAt: 1 };
    const edits = new Map([["old", mine]]);
    const moved = V.editsFollowingCards([{ from: "old", to: "new" }], (fp) => edits.get(fp), () => false, 99);
    t.eq([moved.puts.length, moved.puts[0].fingerprint, moved.puts[0].notes, moved.puts[0].favorite, moved.puts[0].rating, moved.puts[0].vaultTags.join(), moved.puts[0].flags.length, moved.puts[0].fields.scenario],
      [1, "new", "Good one.", true, 4, "keeper", 1, "Edited here."], "the record goes to the card's new fingerprint whole: notes, favourite, rating, tags, flags and unsaved changes");
    t.eq([moved.dels, moved.moved], [["old"], [["old", "new"]]], "and leaves the old one, which is no card's any more");

    const shared = V.editsFollowingCards([{ from: "old", to: "new" }], (fp) => edits.get(fp), (fp) => fp === "old", 99);
    t.eq([shared.puts.length, shared.dels.length, shared.moved.length], [1, 0, 0], "when a copy of the card wasn't edited, it keeps the record too");

    const both = new Map([["old", mine], ["new", { fingerprint: "new", fields: { scenario: "Edited there." }, vaultTags: ["Keeper", "sea"], flags: [], notes: "Already here.", rating: 0, favorite: false }]]);
    const merged = V.editsFollowingCards([{ from: "old", to: "new" }], (fp) => both.get(fp), () => false, 99).puts[0];
    t.eq([merged.notes, merged.vaultTags.join(), merged.rating, merged.favorite, merged.flags.length, merged.fields.scenario],
      ["Already here.\n\nGood one.", "Keeper,sea", 4, true, 1, "Edited there."],
      "when the card it now matches has a record of its own, the two are joined and nothing is lost");

    t.eq(V.editsFollowingCards([{ from: "none", to: "new" }, { from: "old", to: "old" }, { from: "blank", to: "new" }], (fp) => (fp === "blank" ? { fingerprint: "blank", fields: {}, flags: [], vaultTags: [], notes: " " } : edits.get(fp)), () => false, 99).puts.length, 0,
      "a card with nothing on it, or one that didn't change, moves nothing");
    const two = V.editsFollowingCards([{ from: "old", to: "n1" }, { from: "old", to: "n2" }], (fp) => edits.get(fp), () => false, 99);
    t.eq([two.puts.map((e) => e.fingerprint).join(), two.dels.join(), two.moved.length], ["n1,n2", "old", 1], "two copies edited two ways each keep the record");
    t.ok(V.editHolds({ favorite: true }) && V.editHolds({ notes: "x" }) && V.editHolds({ fields: { a: "b" } }) && V.editHolds({ sent: { d1: { at: 1 } } }) && !V.editHolds({ fields: {}, notes: "", flags: [] }) && !V.editHolds(null),
      "a record counts as holding something for a note, a favourite, an unsaved change or a sent mark");
  }

  console.log("\nthe system the browser runs on, and the launcher to name there");
  {
    const cases = [
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36", "windows", "Start RP Card Vault.bat"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36", "mac", "Start RP Card Vault.command"],
      ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36", "linux", "start.sh"],
      ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36", "linux", "start.sh"],
      ["", "windows", "Start RP Card Vault.bat"],
      ["something unheard of", "windows", "Start RP Card Vault.bat"],
    ];
    for (const [ua, os, script] of cases) {
      t.eq([V.osKindOf(ua), V.startScriptFor(V.osKindOf(ua))], [os, script], (ua.match(/\(([^;)]+)/) || [0, ua || "(no user agent)"])[1] + ": " + os + ", started with " + script);
    }
    const gone = Object.assign(new Error("not found"), { name: "NotFoundError" });
    t.ok(/260-character limit/.test(V.unopenedFileMessage("a.png", gone, "windows")), "a listed file that can't be opened: on Windows, most likely the 260-character limit");
    for (const os of ["mac", "linux"]) {
      const m = V.unopenedFileMessage("a.png", gone, os);
      t.ok(!/Windows|260/.test(m) && /moved or removed/.test(m) && /Rescan/.test(m), "on " + os + ", where there's no such limit: moved or removed, rescan", m);
    }
    t.ok(/Couldn't open the file: denied/.test(V.unopenedFileMessage("a.png", new Error("denied"), "mac")), "any other failure says what it was, on every system");
  }

  console.log("\nindex records left without a folder");
  {
    const roots = [{ id: "r1" }, { id: "imp:old-cards" }];
    const cards = [{ id: "r1:a.png", rootId: "r1" }, { id: "gone:a.png", rootId: "gone" }, { id: "imp:old-cards:b.png", rootId: "imp:old-cards" }, { id: "gone:c.png", rootId: "gone" }];
    t.eq(V.orphanCardIds(cards, roots), ["gone:a.png", "gone:c.png"], "records whose folder isn't registered are found; imported folders count as registered");
    t.eq(V.orphanCardIds(cards, []), cards.map((c) => c.id), "with no folders at all, every record is left over");

    // Removing a folder deletes its records from the database itself, including
    // ones saved after the screen last showed them.
    const recs = [{ id: "A:1.png", rootId: "A" }, { id: "A:sub/2.png", rootId: "A" }, { id: "B:1.png", rootId: "B" }];
    await V.dbPutMany(V.STORE_CARDS, recs);
    await V.dbPutMany(V.STORE_BODIES, recs.map((r) => ({ __key: r.id, __val: { text: r.id } })));
    const n = await V.dbDelCardsOfRoot("A");
    const left = (await V.dbAll(V.STORE_CARDS)).map((r) => r.id).filter((id) => /^[AB]:/.test(id)).sort();
    t.eq([n, left], [2, ["B:1.png"]], "a folder's records are deleted by folder, and only that folder's");
    t.eq(await V.dbGet(V.STORE_BODIES, "A:1.png"), undefined, "their cached text goes too");
    t.ok(!!(await V.dbGet(V.STORE_BODIES, "B:1.png")), "while the other folder's stays");
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
    t.eq(V.vaultDataBackupNames(names.concat(["notes.txt"])), V.vaultDataFilesToPrune(names, 1).length ? [V.vaultDataBackupNames(names)[0]].concat(V.vaultDataFilesToPrune(names, 1)) : V.vaultDataBackupNames(names),
      "the backups in a folder are listed newest first: the one kept, then those a prune would take");
    t.ok(V.vaultDataBackupNames(names).every((n) => /^rp-card-vault-data \d{8}-\d{6}\.json$/.test(n)) && V.vaultDataBackupNames(names)[0] > V.vaultDataBackupNames(names)[1], "and nothing else in the folder is one");
    t.eq(V.vaultDataBackupDate("rp-card-vault-data 20261107-090503.json"), "2026-11-07 09:05", "a backup's name says when it was made");

    // A cleared browser starts the vault again empty. Its backups mustn't push the real ones out.
    t.eq(V.vaultDataWeight({ edits: new Array(300), agentChats: new Array(4) }), 304, "a backup's weight is its card records and chats");
    t.eq([V.vaultDataWeight(null), V.vaultDataWeight({}), V.vaultDataWeight({ edits: "x" })], [0, 0, 0], "and nothing, for something that isn't a backup");
    t.ok(V.backupOutweighs(300, 0) && V.backupOutweighs(300, 3) && V.backupOutweighs(3000, 1900), "a backup holding far more than the vault does now is kept, and offered back");
    t.ok(!V.backupOutweighs(300, 300) && !V.backupOutweighs(300, 290) && !V.backupOutweighs(310, 300) && !V.backupOutweighs(15, 0),
      "one about the size of the vault, or of a few records, is an ordinary old backup");

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
