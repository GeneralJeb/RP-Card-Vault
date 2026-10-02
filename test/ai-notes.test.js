/**
 * The aiNotes store: caching, and the fingerprint migration.
 *
 *   npm install --no-save fake-indexeddb
 *   node test/ai-notes.test.js
 *
 * The brief's warning is the reason this file exists: the edit overlay is keyed
 * by a *content* fingerprint, so saving a card changes its key and anything
 * else keyed the same way has to be carried across or it silently orphans —
 * rows in the database that nothing will ever read again.
 *
 * These run the real functions out of the page against a fake IndexedDB, which
 * is the only way to catch a migration that half-works.
 */

const { loadPureRegion } = require("./pure-region");
const t = require("./harness");

let fakeIdb = null;
try { fakeIdb = require("fake-indexeddb"); } catch (e) { /* optional */ }

if (!fakeIdb) {
  console.log("\nskipped — install the dev dependency to run this one:");
  console.log("  npm install --no-save fake-indexeddb\n");
  process.exit(0);
}

const { mod: V } = loadPureRegion([
  "dbOpen", "dbGet", "dbPut", "dbDel", "dbAll", "dbClearStore", "dbDeleteByIndex",
  "aiNoteId", "makeAiNote", "migrateAiNotes", "pickAiNote", "dbAllByIndex", "loadAiSettings", "saveAiSettings",
  "STORE_AINOTES", "STORE_KV", "STORE_EDITS", "DB_NAME", "DB_VER",
], { indexedDB: fakeIdb.indexedDB, IDBKeyRange: fakeIdb.IDBKeyRange });

const OLD = "fp-before";
const NEW = "fp-after";

async function notesFor(fp) {
  const all = await V.dbAll(V.STORE_AINOTES);
  return all.filter((n) => n.fingerprint === fp);
}

async function main() {
  console.log("\nthe schema carries the aiNotes store");
  {
    t.eq(V.DB_VER, 3, "the database version is 3");
    const db = await V.dbOpen();
    t.ok(db.objectStoreNames.contains(V.STORE_AINOTES), "aiNotes exists",
      Array.from(db.objectStoreNames).join(", "));
    const tx = db.transaction(V.STORE_AINOTES, "readonly");
    const idx = tx.objectStore(V.STORE_AINOTES).indexNames;
    t.ok(Array.from(idx).indexOf("fingerprint") >= 0, "with an index on fingerprint",
      Array.from(idx).join(", "));
    for (const s of ["kv", "roots", "cards", "thumbs", "bodies", "edits", "oplog"]) {
      t.ok(db.objectStoreNames.contains(s), "the pre-existing '" + s + "' store is untouched");
    }
  }

  console.log("\nnotes round-trip through the store");
  {
    await V.dbPut(V.STORE_AINOTES, V.makeAiNote(OLD, "summarise", "m1", "h", "a summary"));
    await V.dbPut(V.STORE_AINOTES, V.makeAiNote(OLD, "critique", "m1", "h", "a critique"));
    await V.dbPut(V.STORE_AINOTES, V.makeAiNote(OLD, "summarise", "m2", "h", "another model's summary"));
    const got = await V.dbGet(V.STORE_AINOTES, V.aiNoteId(OLD, "summarise", "m1", "h"));
    t.eq(got.text, "a summary", "a note reads back");
    t.eq((await notesFor(OLD)).length, 3, "three notes for this card");
    const other = await V.dbGet(V.STORE_AINOTES, V.aiNoteId(OLD, "summarise", "m2", "h"));
    t.eq(other.text, "another model's summary", "a second model is a separate row, not an overwrite");
  }

  console.log("\nthe fingerprint migration carries them across");
  {
    const moved = await V.migrateAiNotes(OLD, NEW);
    t.eq(moved, 3, "all three were migrated");
    t.eq((await notesFor(OLD)).length, 0, "nothing is left under the old fingerprint");
    t.eq((await notesFor(NEW)).length, 3, "and all three are under the new one");

    const carried = await V.dbGet(V.STORE_AINOTES, V.aiNoteId(NEW, "summarise", "m1", "h"));
    t.ok(!!carried, "the note is reachable at its new key");
    t.eq(carried.text, "a summary", "its answer survived");
    t.eq(carried.kind, "summarise", "its kind survived");
    t.eq(carried.model, "m1", "its model survived");
    t.eq(carried.fingerprint, NEW, "its fingerprint was rewritten");
    t.eq(carried.hash, "h", "its request hash was kept");
    // Saving writes exactly what the overlay showed, so the request after the
    // save is the same request — the answer is still about the current text.
    const rows = await V.dbAllByIndex(V.STORE_AINOTES, "fingerprint", NEW);
    t.eq(V.pickAiNote(rows, "summarise", "m1", "", "h").current, true, "so an answer that was current is still current");

    const gone = await V.dbGet(V.STORE_AINOTES, V.aiNoteId(OLD, "summarise", "m1", "h"));
    t.ok(!gone, "the old row is deleted, not just copied — no orphans");
  }

  console.log("\nthe migration is safe to call in the cases that actually happen");
  {
    t.eq(await V.migrateAiNotes(NEW, NEW), 0, "an unchanged fingerprint is a no-op");
    t.eq(await V.migrateAiNotes("", NEW), 0, "a missing old fingerprint is a no-op");
    t.eq(await V.migrateAiNotes(NEW, ""), 0, "a missing new fingerprint is a no-op");
    t.eq(await V.migrateAiNotes(undefined, undefined), 0, "undefined is a no-op");
    t.eq(await V.migrateAiNotes("fp-nothing-here", "fp-elsewhere"), 0, "a card with no notes migrates nothing");
    t.eq((await notesFor(NEW)).length, 3, "and none of that disturbed the real rows");
  }

  console.log("\nmigrating onto a fingerprint that already has notes");
  {
    await V.dbPut(V.STORE_AINOTES, V.makeAiNote("fp-src", "summarise", "m1", "h", "from the source card"));
    const n = await V.migrateAiNotes("fp-src", NEW);
    t.eq(n, 1, "the row migrated");
    const winner = await V.dbGet(V.STORE_AINOTES, V.aiNoteId(NEW, "summarise", "m1", "h"));
    t.eq(winner.text, "from the source card", "it overwrote the colliding row rather than throwing");
    t.eq((await notesFor(NEW)).length, 3, "and didn't duplicate the key");
  }

  console.log("\nclearing one card's answers leaves the rest alone");
  {
    await V.dbPut(V.STORE_AINOTES, V.makeAiNote("fp-keep", "summarise", "m1", "h", "keep me"));
    const keys = await V.dbDeleteByIndex(V.STORE_AINOTES, "fingerprint", NEW);
    t.eq(keys.length, 3, "the three notes for that card were deleted");
    t.eq((await notesFor(NEW)).length, 0, "they're gone");
    t.eq((await notesFor("fp-keep")).length, 1, "the other card's note is untouched");
  }

  console.log("\naiSettings persist without ever holding a key");
  {
    await V.saveAiSettings({ baseUrl: "http://127.0.0.1:11434/v1/", model: " llama3 ", apiKey: "sk-nope", temperature: 99 });
    const raw = await V.dbGet(V.STORE_KV, "aiSettings");
    t.ok(!("apiKey" in raw), "the stored record has no apiKey", JSON.stringify(Object.keys(raw)));
    t.ok(JSON.stringify(raw).indexOf("sk-nope") < 0, "and no trace of the secret");
    t.eq(raw.baseUrl, "http://127.0.0.1:11434/v1", "the endpoint was normalized on the way in");
    t.eq(raw.model, "llama3", "the model was trimmed");
    t.eq(raw.temperature, 2, "an out-of-range value was clamped");
    const back = await V.loadAiSettings();
    t.eq(back.model, "llama3", "it loads back");
    t.eq(back.writeMode, "propose", "with the default write mode filled in");
  }

  t.done();
}

main().catch((e) => { console.error("\nharness error: " + ((e && e.stack) || e)); process.exit(1); });
