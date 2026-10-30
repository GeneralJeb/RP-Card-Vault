/**
 * Card files: what the vault writes back into a card, lifted out of the page.
 *
 *   node test/card-files.test.js
 *
 * Organised around not losing what's in a card: saving or exporting must keep
 * everything the original file had, including what the vault doesn't model.
 */

const { loadPureRegion } = require("./pure-region");
const t = require("./harness");

const { mod: V } = loadPureRegion([
  "parseCardBytes", "normalizeCard", "normalizeLorebook", "denormalizeLorebook",
  "mergeLorebookForSave", "rawCharacterBook", "lorebookDigest", "buildV3Payload", "buildV2Payload", "writeCardIntoPng", "saveCardToFile",
  "makeChunk", "safeFileName", "effectiveLorebook", "cleanLorebook", "cleanLoreEntry", "lorebookPatch", "greetingsPatch", "splitKeyList", "isEdited", "pendingEditCount", "solidPng", "newCardPayload", "placeholderColor", "isPng", "listCardFiles", "backupsToPrune",
  "moveCardTo", "copyIntoRoot", "byteSignature", "sameBytes", "verifiedExactCopies", "makeDupeExcluder", "detectDupes", "planIngest", "unzipEntryLimited", "processCardFile", "scanRoot", "scanImportRoot", "IMPORT_PENDING", "SCAN_HEAD_BYTES", "importRootIdMap", "remapRootSettings", "remapDirKeyed", "absorbRegistration",
  "deleteCardFile", "referenceFolderError", "cardFileLock", "setFolderRolesNow", "agentFolderList",
  "pngIsAnimated", "withAnimated", "readPngChunks",
]);

/* A folder tree held in memory, with names matched regardless of case, as on Windows. */
function memFs(rootName) {
  const node = (name, kind) => ({ name, kind, kids: new Map(), bytes: kind === "file" ? new Uint8Array(0) : null });
  const k = (n) => n.toLowerCase();
  const missing = () => Object.assign(new Error("not found"), { name: "NotFoundError" });
  const fileHandle = (n) => ({
    kind: "file", name: n.name, _n: n,
    async isSameEntry(o) { return !!o && o._n === n; },
    async getFile() { return new File([n.bytes], n.name, { lastModified: 1 }); },
    async createWritable() {
      const parts = [];
      return { async write(b) { parts.push(Buffer.from(await new Blob([b]).arrayBuffer())); }, async close() { n.bytes = new Uint8Array(Buffer.concat(parts)); } };
    },
  });
  const dirHandle = (n) => ({
    kind: "directory", name: n.name, _n: n,
    async queryPermission() { return "granted"; },
    async requestPermission() { return "granted"; },
    async isSameEntry(o) { return !!o && o._n === n; },
    async getDirectoryHandle(name, o) {
      let c = n.kids.get(k(name));
      if (!c) { if (!(o && o.create)) throw missing(); c = node(name, "directory"); n.kids.set(k(name), c); }
      return dirHandle(c);
    },
    async getFileHandle(name, o) {
      let c = n.kids.get(k(name));
      if (!c) { if (!(o && o.create)) throw missing(); c = node(name, "file"); n.kids.set(k(name), c); }
      return fileHandle(c);
    },
    async removeEntry(name) { if (!n.kids.delete(k(name))) throw missing(); },
    async *entries() { for (const c of n.kids.values()) yield [c.name, c.kind === "file" ? fileHandle(c) : dirHandle(c)]; },
  });
  const top = node(rootName, "directory");
  const walk = (path, create) => {
    let n = top;
    const parts = path.split("/");
    for (const p of parts.slice(0, -1)) {
      let c = n.kids.get(k(p));
      if (!c) { if (!create) return null; c = node(p, "directory"); n.kids.set(k(p), c); }
      n = c;
    }
    return { dir: n, name: parts[parts.length - 1] };
  };
  return {
    handle: dirHandle(top),
    put(path, bytes) { const w = walk(path, true); const f = node(w.name, "file"); f.bytes = bytes; w.dir.kids.set(k(w.name), f); },
    get(path) { const w = walk(path, false); const f = w && w.dir.kids.get(k(w.name)); return f && f.kind === "file" ? f.bytes : null; },
    list(path) { const w = walk(path + "/x", false); return w ? Array.from(w.dir.kids.values()).map((c) => c.name) : []; },
  };
}

const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
// The smallest valid PNG: one pixel. Cards are written into copies of it.
const PNG_1PX = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

// A card as a SillyTavern user would have it: lorebook entries with ids,
// per-entry extensions, regex and case flags, and book-level extensions.
const ORIGINAL = {
  spec: "chara_card_v3", spec_version: "3.0",
  data: {
    name: "Ada", description: "A clockmaker.", personality: "", scenario: "", first_mes: "You're late.",
    mes_example: "", creator_notes: "", system_prompt: "", post_history_instructions: "",
    tags: ["victorian"], creator: "someone", character_version: "1", alternate_greetings: [], extensions: {},
    character_book: {
      name: "Workshop lore", scan_depth: 4, token_budget: 512, recursive_scanning: false,
      extensions: { st_world: "keep me" },
      entries: [
        { id: 7, keys: ["engine"], secondary_keys: [], content: "The engine hums.", comment: "Engine", enabled: true,
          insertion_order: 100, constant: false, selective: false, case_sensitive: true, use_regex: false, priority: 3,
          extensions: { depth: 4, probability: 80, role: 1, position: 4 } },
        { id: 9, keys: ["/tea|coffee/"], content: "Always tea.", comment: "Tea", enabled: false,
          insertion_order: 50, use_regex: true, extensions: { depth: 2 } },
      ],
    },
  },
};

async function main() {
  console.log("\nsaving keeps the lorebook whole");
  {
    const parsed = await V.parseCardBytes(enc(ORIGINAL), "ada.json");
    t.ok(parsed.ok && parsed.data.lorebook.entries.length === 2, "the card parses, with its two lorebook entries");
    const raw = V.rawCharacterBook(parsed.raw);
    t.ok(raw && raw.extensions && raw.extensions.st_world === "keep me", "the original character_book is found in the file");

    // Before the fix: the vault's own copy alone loses fields.
    const lossy = V.buildV3Payload(parsed.data, null).data.character_book;
    t.ok(!("extensions" in lossy.entries[0]) && !("id" in lossy.entries[0]), "without the original, entry ids and extensions would be lost (the old behaviour)");

    const saved = V.buildV3Payload(parsed.data, null, raw).data.character_book;
    const e0 = saved.entries[0], e1 = saved.entries[1];
    t.eq([e0.id, e0.priority, e0.case_sensitive, e0.extensions], [7, 3, true, { depth: 4, probability: 80, role: 1, position: 4 }],
      "with it, every field the vault doesn't model survives: id, priority, case_sensitive, extensions");
    t.ok(e1.use_regex === true && e1.extensions.depth === 2 && e1.enabled === false, "regex flags and disabled state too");
    t.eq([saved.extensions, saved.name, saved.scan_depth], [{ st_world: "keep me" }, "Workshop lore", 4], "and the book's own fields and extensions");

    // Round trip: what was written reads back the same.
    const again = await V.parseCardBytes(enc(V.buildV3Payload(parsed.data, null, raw)), "ada.json");
    t.eq(V.lorebookDigest(again.data.lorebook), V.lorebookDigest(parsed.data.lorebook), "it reads back with the same entries");
  }

  console.log("\nedited lorebooks merge onto the original");
  {
    const parsed = await V.parseCardBytes(enc(ORIGINAL), "ada.json");
    const raw = V.rawCharacterBook(parsed.raw);
    const lb = JSON.parse(JSON.stringify(parsed.data.lorebook));
    lb.entries[0].content = "The engine sings.";
    lb.entries[0].keys = ["engine", "machine"];
    lb.entries.splice(1, 1);                                   // the tea entry removed
    lb.entries.push({ idx: null, keys: ["ada"], secondaryKeys: [], content: "She is Ada.", comment: "Ada",
      enabled: true, constant: false, selective: false, insertionOrder: 10, position: "" });
    const out = V.mergeLorebookForSave(raw, lb);
    t.ok(out.entries[0].content === "The engine sings." && out.entries[0].keys.join() === "engine,machine" &&
      out.entries[0].extensions.probability === 80 && out.entries[0].id === 7, "an edited entry keeps its id and extensions");
    t.ok(out.entries.length === 2 && !out.entries.some((e) => /tea/.test(e.content)), "a removed entry is gone");
    t.ok(out.entries[1].content === "She is Ada." && out.entries[1].id === 10, "a new entry is added, with the next free id");

    // SillyTavern-style spellings stay in step.
    const st = { entries: { 0: { key: ["old"], keysecondary: ["x"], content: "a", order: 5, disable: false, comment: "c" } } };
    const n = V.normalizeLorebook(st);
    n.entries[0].keys = ["new"]; n.entries[0].enabled = false; n.entries[0].insertionOrder = 9;
    const o = V.mergeLorebookForSave(st, n).entries[0];
    t.eq([o.key, o.keys, o.disable, o.order, o.keysecondary], [["new"], ["new"], true, 9, ["x"]],
      "an entry written with key/order/disable keeps those in step with the edit");
    t.eq(V.mergeLorebookForSave(null, n).entries[0].keys, ["new"], "with no original, it falls back to the vault's own copy");
  }

  console.log("\na PNG card, written and read back");
  {
    const png = PNG_1PX;
    const first = V.writeCardIntoPng(png, ORIGINAL, V.buildV2Payload(ORIGINAL));
    const parsed = await V.parseCardBytes(first, "ada.png");
    t.ok(parsed.ok && parsed.data.lorebook.entries.length === 2, "a PNG card with a lorebook parses");
    // Save it as the vault does: from the file's own bytes.
    const v3 = V.buildV3Payload(parsed.data, null, V.rawCharacterBook(parsed.raw));
    const saved = V.writeCardIntoPng(first, v3, V.buildV2Payload(v3));
    const back = await V.parseCardBytes(saved, "ada.png");
    const e0 = V.rawCharacterBook(back.raw).entries[0];
    t.ok(back.ok && e0.id === 7 && e0.extensions.probability === 80 && e0.case_sensitive === true,
      "saved back into the PNG, the entry keeps its id, extensions and flags");
    t.eq(V.lorebookDigest(back.data.lorebook), V.lorebookDigest(parsed.data.lorebook), "and the same entries");

    // Save to card, end to end, into a folder held in memory.
    const fsys = memFs("Scratch");
    fsys.put("ada.png", first);
    const rec = { id: "r:ada.png", rootId: "r", rel: "ada.png", dir: "", file: "ada.png", ext: "png", sig: "s" };
    const edit = { fields: { description: "A clockmaker who hates being late." } };
    const res = await V.saveCardToFile(rec, parsed.data, edit, [{ id: "r", name: "Scratch", handle: fsys.handle }], { backup: false });
    const onDisk = await V.parseCardBytes(fsys.get("ada.png"), "ada.png");
    const d0 = V.rawCharacterBook(onDisk.raw).entries[0];
    t.ok(res && onDisk.data.description === "A clockmaker who hates being late.", "Save to card writes the edit into the file");
    t.ok(d0.id === 7 && d0.extensions.probability === 80 && d0.case_sensitive === true && V.rawCharacterBook(onDisk.raw).extensions.st_world === "keep me",
      "and the lorebook on disk still has every field it had before");
  }

  console.log("\nSave to card keeps the card fields the vault doesn't model");
  {
    const card = JSON.parse(JSON.stringify(ORIGINAL));
    card.data.assets = [{ type: "icon", uri: "ccdefault:", name: "main", ext: "png" }, { type: "emotion", uri: "https://example.com/happy.png", name: "happy", ext: "png" }];
    card.data.creator_notes_multilingual = { fr: "Un horloger." };
    card.data.some_front_end = { keep: true };
    for (const ext of ["png", "json"]) {
      const fsys = memFs("Scratch");
      const bytes = ext === "png" ? V.writeCardIntoPng(PNG_1PX, card, V.buildV2Payload(card)) : enc(card);
      fsys.put("ada." + ext, bytes);
      const parsed = await V.parseCardBytes(bytes, "ada." + ext);
      const rec = { id: "r:ada." + ext, rootId: "r", rel: "ada." + ext, dir: "", file: "ada." + ext, ext, sig: "s" };
      await V.saveCardToFile(rec, parsed.data, { fields: { description: "Edited." } }, [{ id: "r", name: "Scratch", handle: fsys.handle }], { backup: false });
      const d = (await V.parseCardBytes(fsys.get("ada." + ext), "ada." + ext)).raw.data;
      t.ok(d.description === "Edited." && (d.assets || []).length === 2 && d.assets[1].name === "happy"
        && (d.creator_notes_multilingual || {}).fr === "Un horloger." && (d.some_front_end || {}).keep === true,
        "a ." + ext + " card keeps its assets, multilingual creator notes and a front end's own field");
    }
    const v1 = V.buildV3Payload({ name: "Old" }, null, null, { name: "Old", char_persona: "stale", fav: true }).data;
    t.ok(!("char_persona" in v1) && !("fav" in v1), "a v1 card's top level isn't copied into the saved card");
    const alias = V.buildV3Payload({ name: "Ada" }, null, null, { spec: "chara_card_v2", data: { name: "Ada", characterBook: { entries: [] }, char_greeting: "old" } }).data;
    t.ok(!("characterBook" in alias) && !("char_greeting" in alias), "other spellings of fields the vault writes aren't carried over");
    t.ok(!("assets" in V.buildV2Payload({ data: { name: "x", assets: [] } }).data), "and the v2 copy leaves the v3-only assets out");
  }

  console.log("\nSave to card puts the original back when the write lands short");
  {
    const fsys = memFs("Scratch");
    const orig = V.writeCardIntoPng(PNG_1PX, ORIGINAL, V.buildV2Payload(ORIGINAL));
    fsys.put("ada.png", orig);
    // The disk takes only the first half of the first write: the v2 copy still reads as the card.
    const getFileHandle = fsys.handle.getFileHandle.bind(fsys.handle);
    let writes = 0;
    fsys.handle.getFileHandle = async (n, o) => {
      const fh = await getFileHandle(n, o);
      const open = fh.createWritable.bind(fh);
      fh.createWritable = async () => {
        const w = await open();
        if (writes++ === 0) {
          const write = w.write.bind(w);
          w.write = async (b) => { const a = new Uint8Array(await new Blob([b]).arrayBuffer()); return write(a.subarray(0, a.length >> 1)); };
        }
        return w;
      };
      return fh;
    };
    const parsed = await V.parseCardBytes(orig, "ada.png");
    const rec = { id: "r:ada.png", rootId: "r", rel: "ada.png", dir: "", file: "ada.png", ext: "png", sig: "s" };
    let err = "";
    try { await V.saveCardToFile(rec, parsed.data, { fields: { personality: "Punctual." } }, [{ id: "r", name: "Scratch", handle: fsys.handle }], { backup: false }); }
    catch (e) { err = e.message; }
    t.ok(/put back/.test(err), "the save fails (" + (err || "no error") + ")");
    t.ok(Buffer.compare(Buffer.from(fsys.get("ada.png")), Buffer.from(orig)) === 0, "and the file on disk is the original again");

    // And when putting it back fails too, with backups off: there's no backup to point to.
    writes = 0;
    const open2 = fsys.handle.getFileHandle;
    fsys.handle.getFileHandle = async (n, o) => {
      const fh = await open2(n, o);
      const create = fh.createWritable;
      fh.createWritable = async () => { if (writes > 0) throw new Error("disk gone"); return create(); };
      return fh;
    };
    err = "";
    try { await V.saveCardToFile(rec, parsed.data, { fields: { personality: "Punctual." } }, [{ id: "r", name: "Scratch", handle: fsys.handle }], { backup: false }); }
    catch (e) { err = e.message; }
    t.ok(/Restore failed/.test(err) && /backups are off/i.test(err) && !/recover from/.test(err),
      "a failed restore with backups off doesn't send you looking for a backup (" + (err || "no error") + ")");
  }

  console.log("\nReference folders are never written to");
  {
    const card = (name) => { const v3 = V.newCardPayload({ name }); return V.writeCardIntoPng(PNG_1PX, v3, V.buildV2Payload(v3)); };
    const refFs = memFs("Ref"), libFs = memFs("Lib");
    const ref = { id: "ref", name: "Ref", role: "reference", handle: refFs.handle };
    const lib = { id: "lib", name: "Lib", role: "library", handle: libFs.handle };
    refFs.put("Ada.png", card("Ada"));
    libFs.put("Kept/Bram.png", card("Bram"));
    libFs.put("Cora.png", card("Cora"));
    const rec = (root, dir, file) => ({ id: root.id + ":" + (dir ? dir + "/" : "") + file, rootId: root.id, rel: (dir ? dir + "/" : "") + file, dir, file, ext: "png", name: file });
    const ada = rec(ref, "", "Ada.png"), bram = rec(lib, "Kept", "Bram.png"), cora = rec(lib, "", "Cora.png");
    const refused = async (fn) => { try { await fn(); return ""; } catch (e) { return e.message; } };
    V.setFolderRolesNow({});

    t.ok(/Reference folder/.test(await refused(() => V.saveCardToFile(ada, null, null, [ref]))), "Save to card refuses a card in a Reference folder");
    const adaBefore = Buffer.from(refFs.get("Ada.png"));
    const adaBody = (await V.parseCardBytes(refFs.get("Ada.png"), "Ada.png")).data;
    t.ok(/Reference folder/.test(await refused(() => V.saveCardToFile(ada, adaBody, { fields: { description: "Changed." } }, [ref], { backup: false })))
      && Buffer.compare(Buffer.from(refFs.get("Ada.png")), adaBefore) === 0,
      "with backups off too (no backup copy to refuse first), and the file is unchanged");
    t.ok(/Reference folder/.test(await refused(() => V.deleteCardFile(ada, ref))) && !!refFs.get("Ada.png"), "so does deleting it, and the file stays");
    t.ok(/Reference folder/.test(await refused(() => V.moveCardTo(ada, ref, lib, ""))) && !!refFs.get("Ada.png") && !libFs.get("Ada.png"),
      "and moving it out (the trash is a move), with nothing copied");
    t.ok(/Reference folder/.test(await refused(() => V.moveCardTo(cora, lib, ref, ""))) && !!libFs.get("Cora.png") && !refFs.get("Cora.png"),
      "nothing is moved in either");
    t.ok(/Reference folder/.test(await refused(() => V.copyIntoRoot(ref, [], "New.png", new Blob([card("New")]), "s"))) && !refFs.get("New.png"),
      "or copied in");

    // A folder labelled Reference inside a Library counts too; the rest of the Library doesn't.
    V.setFolderRolesNow({ "lib::Kept": "reference" });
    t.ok(/"Lib\/Kept" is a Reference folder/.test(await refused(() => V.deleteCardFile(bram, lib))) && !!libFs.get("Kept/Bram.png"),
      "a subfolder labelled Reference is protected the same way");
    t.ok(/Reference folder/.test(await refused(() => V.moveCardTo(cora, lib, lib, "Kept/Deeper"))), "and so is any folder inside it");
    const ok = await V.moveCardTo(cora, lib, lib, "Other");
    t.ok(!ok.skipped && !!libFs.get("Other/Cora.png"), "while the rest of the Library works as before");
    t.eq([V.cardFileLock(bram, [lib]), V.cardFileLock(ada, [ref]), V.cardFileLock(cora, [lib]),
      V.cardFileLock({ rootId: "imp", dir: "" }, [{ id: "imp", name: "x", mode: "import" }])],
      ["reference", "reference", "", "imported"], "the vault knows up front which cards are locked, and why");
    t.eq(V.referenceFolderError(lib, "Kept", {}), "", "with the folder labels it's given, not only the current ones");
    t.eq(V.agentFolderList([Object.assign({ dirs: ["Kept", "Other"] }, lib), ref]).map((f) => f.path + ":" + f.writable).join(", "),
      "Lib:true, Lib/Kept:false, Lib/Other:true, Ref:false", "the agent is told the same: which folders it can write to");
    V.setFolderRolesNow({});
  }

  console.log("\nanimated (APNG) cards");
  {
    const zlib = require("zlib");
    const be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
    const chunk = (type, data) => Buffer.from(V.makeChunk(type, new Uint8Array(data)));
    const pix = (r, g, b) => zlib.deflateSync(Buffer.from([0, r, g, b, 255]));
    const fctl = (seq) => Buffer.concat([be(seq), be(1), be(1), be(0), be(0), Buffer.from([0, 50, 0, 100, 0, 0])]);
    // A 1x1 picture; with frames > 1 it has a second frame, in blue.
    const apng = (frames) => Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", Buffer.concat([be(1), be(1), Buffer.from([8, 6, 0, 0, 0])])),
    ].concat(frames ? [chunk("acTL", Buffer.concat([be(frames), be(0)])), chunk("fcTL", fctl(0))] : [])
      .concat([chunk("IDAT", pix(255, 0, 0))])
      .concat(frames > 1 ? [chunk("fcTL", fctl(1)), chunk("fdAT", Buffer.concat([be(2), pix(0, 0, 255)]))] : [])
      .concat([chunk("IEND", Buffer.alloc(0))]));
    const asFile = (b, n) => new File([b], n || "x.png");
    const v3 = V.newCardPayload({ name: "Animated Ada", description: "x".repeat(200000) });
    const saved = V.writeCardIntoPng(new Uint8Array(apng(2)), v3, V.buildV2Payload(v3));

    t.ok(await V.pngIsAnimated(asFile(apng(2))), "a PNG with two frames is animated");
    t.ok(!(await V.pngIsAnimated(asFile(apng(0)))), "a plain PNG isn't");
    t.ok(!(await V.pngIsAnimated(asFile(apng(1)))), "nor an APNG of a single frame");
    t.ok(await V.pngIsAnimated(asFile(saved)), "and one is still found when hundreds of KB of card text come before the animation");
    t.ok(!(await V.pngIsAnimated(asFile(apng(2).subarray(0, 40)))) && !(await V.pngIsAnimated(asFile(Buffer.from("not a png at all")))),
      "a cut-off file or one that isn't a PNG is just not animated");

    const types = V.readPngChunks(saved, { stopAtIDAT: false }).chunks.map((c) => c.type);
    t.eq(types.join(" "), "IHDR tEXt tEXt acTL fcTL IDAT fcTL fdAT IEND",
      "Save to card keeps every animation chunk, in order, with the card text before them (as APNG allows)");
    const back = await V.parseCardBytes(saved, "Animated Ada.png");
    t.ok(back.ok && back.data.name === "Animated Ada", "and the card reads back");

    const root = { id: "r", name: "Cards", role: "library" };
    const info = { rel: "Ada.png", dir: "", file: "Ada.png", ext: "png" };
    t.eq((await V.processCardFile(root, info, asFile(saved, "Ada.png"))).rec.animated, true, "the scan marks an animated card");
    t.eq((await V.processCardFile(root, info, asFile(apng(0), "Ada.png"))).rec.animated, false, "and a still one as still");
    const old = { id: "r:Ada.png", ext: "png", name: "Ada" };
    t.eq((await V.withAnimated(old, asFile(saved))).animated, true, "a card indexed before this is checked on the next scan, without being read again");
    t.ok((await V.withAnimated({ ext: "json" }, asFile(saved))).animated === undefined, "a .json card isn't looked at");
  }

  console.log("\nmoving and backing up cards, on a folder tree that ignores case");
  {
    const png = PNG_1PX;
    const card = (name) => { const v3 = V.newCardPayload({ name }); return V.writeCardIntoPng(png, v3, V.buildV2Payload(v3)); };
    const fsys = memFs("Cards");
    const root = { id: "r", name: "Cards", role: "library", handle: fsys.handle };
    fsys.put("Fantasy/Ada.png", card("Ada"));
    const ada = { id: "r:Fantasy/Ada.png", rootId: "r", rel: "Fantasy/Ada.png", dir: "Fantasy", file: "Ada.png", ext: "png", name: "Ada" };

    const same = await V.moveCardTo(ada, root, root, "fantasy");
    t.ok(same.skipped && !!fsys.get("Fantasy/Ada.png"),
      "a move into the same folder spelled another way (\"fantasy\") is skipped, and the card is still there");
    const moved = await V.moveCardTo(ada, root, root, "Other");
    t.ok(!moved.skipped && !fsys.get("Fantasy/Ada.png") && !!fsys.get("Other/Ada.png"), "a real move still moves it");

    // Two different cards with the same file name in different folders.
    fsys.put("A/Bram.png", card("Bram the Smith"));
    fsys.put("B/Bram.png", card("Bram the Sailor"));
    const rec = (dir) => ({ id: "r:" + dir + "/Bram.png", rootId: "r", rel: dir + "/Bram.png", dir, file: "Bram.png", ext: "png", sig: "s" });
    const save = async (dir, text) => {
      const parsed = await V.parseCardBytes(fsys.get(dir + "/Bram.png"), "Bram.png");
      return V.saveCardToFile(rec(dir), parsed.data, { fields: { description: text } }, [root], { keep: 1 });
    };
    const a1 = await save("A", "Smith, first edit");
    await save("B", "Sailor, first edit");
    await save("B", "Sailor, second edit");
    t.ok(/_vault backups\/A\/Bram /.test(a1.backupPath), "a card's backup goes in a copy of its own folder path (" + a1.backupPath + ")");
    t.eq([fsys.list("_vault backups/A").length, fsys.list("_vault backups/B").length], [1, 1],
      "saving one card never removes the backups of another with the same file name");
  }

  console.log("\na move whose copy doesn't land intact leaves the original where it was");
  {
    const v3 = V.newCardPayload({ name: "Dora" });
    const bytes = V.writeCardIntoPng(PNG_1PX, v3, V.buildV2Payload(v3));
    const spoilers = [
      ["lands short", (a) => a.subarray(0, a.length - 1)],
      ["lands changed", (a) => { const c = a.slice(); c[c.length - 1] ^= 1; return c; }],
    ];
    for (const [label, spoil] of spoilers) {
      const src = memFs("Src"), dest = memFs("Dest");
      src.put("Dora.png", bytes);
      // The destination disk spoils whatever is written to it.
      const getFileHandle = dest.handle.getFileHandle.bind(dest.handle);
      dest.handle.getFileHandle = async (n, o) => {
        const fh = await getFileHandle(n, o);
        const open = fh.createWritable.bind(fh);
        fh.createWritable = async () => {
          const w = await open();
          const write = w.write.bind(w);
          w.write = async (b) => write(spoil(new Uint8Array(await new Blob([b]).arrayBuffer())));
          return w;
        };
        return fh;
      };
      const rec = { id: "s:Dora.png", rootId: "s", rel: "Dora.png", dir: "", file: "Dora.png", ext: "png", name: "Dora" };
      let err = "";
      try {
        await V.moveCardTo(rec, { id: "s", name: "Src", role: "library", handle: src.handle }, { id: "d", name: "Dest", role: "library", handle: dest.handle }, "");
      } catch (e) { err = e.message; }
      t.ok(/Copy verification failed/.test(err) && !!src.get("Dora.png") && Buffer.compare(Buffer.from(src.get("Dora.png")), Buffer.from(bytes)) === 0,
        "a copy that " + label + " stops the move, and the original is still there (" + (err || "no error") + ")");
    }
  }

  console.log("\na big card that only looks like the one already there is never lost");
  {
    // Two versions of a big-lorebook JSON card, the same size, differing by one
    // entry's order in the middle of the file: byteSignature samples only the
    // head and tail, so it can't tell them apart.
    const big = (order) => {
      const v3 = V.newCardPayload({ name: "Bram" });
      v3.data.character_book = { entries: [] };
      for (let i = 0; i < 1200; i++) v3.data.character_book.entries.push({ id: i, keys: ["k" + i], content: "Lore entry " + i + " ".repeat(300), insertion_order: i === 850 ? order : 100, enabled: true });
      return new TextEncoder().encode(JSON.stringify(v3));
    };
    const A = big(100), B = big(250);
    const sig = (b) => V.byteSignature(new File([b], "x"));
    t.ok(A.length === B.length && (await sig(A)) === (await sig(B)) && !V.sameBytes(A, B),
      "the two versions share a sampled signature, though their bytes differ");

    const fsys = memFs("Cards");
    const root = { id: "r", name: "Cards", role: "library", handle: fsys.handle };
    fsys.put("Inbox/Bram.json", A);
    fsys.put("Library/Bram.json", B);
    const rec = { id: "r:Inbox/Bram.json", rootId: "r", rel: "Inbox/Bram.json", dir: "Inbox", file: "Bram.json", ext: "json", name: "Bram" };
    const res = await V.moveCardTo(rec, root, root, "Library");
    const lib = fsys.list("Library").map((n) => fsys.get("Library/" + n));
    t.ok(lib.some((b) => V.sameBytes(b, A)) && lib.some((b) => V.sameBytes(b, B)),
      "moving one onto the other's name keeps both versions (it landed as " + res.name + ")", fsys.list("Library"));

    const same = memFs("Copy");
    same.put("Lib/Bram.json", A);
    const out = await V.copyIntoRoot({ id: "c", name: "Copy", handle: same.handle }, ["Lib"], "Bram.json", new Blob([A]), await sig(A));
    t.ok(out.skipped && same.list("Lib").length === 1, "a truly identical file is still recognised, and not copied twice");

    // Every numbered name taken: the last one tried must not be overwritten.
    const full = memFs("Full");
    full.put("D/x.png", new Uint8Array([1]));
    for (let i = 2; i <= 51; i++) full.put("D/x (" + i + ").png", new Uint8Array([i]));
    let fullErr = "";
    try { await V.copyIntoRoot({ id: "f", name: "Full", handle: full.handle }, ["D"], "x.png", new Blob([B]), await sig(B)); }
    catch (e) { fullErr = e.message; }
    t.ok(!!fullErr && Array.from(full.get("D/x (51).png")).join() === "51" && full.list("D").length === 51,
      "with x.png to x (51).png all taken, the copy is refused and none of them is overwritten (" + (fullErr || "no error") + ")");

    // The duplicate finder's clean-up only removes copies proven to be the keeper's bytes.
    const files = { keep: A, twin: A.slice(), other: B };
    const read = async (r) => { if (!files[r.id]) throw new Error("gone"); return files[r.id]; };
    const chk = await V.verifiedExactCopies({ id: "keep" }, [{ id: "twin" }, { id: "other" }, { id: "missing" }], read);
    t.eq([chk.same.map((r) => r.id), chk.differ.map((r) => r.id)], [["twin"], ["other", "missing"]],
      "an exact-group clean-up only takes the real copy; the different version and an unreadable file stay");
    let threw = false;
    try { await V.verifiedExactCopies({ id: "missing" }, [{ id: "twin" }], read); } catch (e) { threw = true; }
    t.ok(threw, "and when the copy being kept can't be read, nothing in the group is taken");
  }

  console.log("\na card in the vault's own trash folder isn't a duplicate");
  {
    // With no trash folder chosen, "Move to trash" makes "_vault trash".
    const ex = V.makeDupeExcluder({ trashKey: "" }, {});
    const live = { id: "r:Ada.png", rootId: "r", dir: "", rel: "Ada.png", sig: "s", ok: true, fp: "f", lfp: "l", hasName: true, size: 9, name: "Ada" };
    const trashed = Object.assign({}, live, { id: "r:_vault trash/Ada.png", dir: "_vault trash", rel: "_vault trash/Ada.png" });
    t.ok(ex(trashed) && ex(Object.assign({}, trashed, { dir: "_Vault Trash/old" })), "it's ignored by the duplicate finder, in any case and below it");
    const d = V.detectDupes([live, trashed], null, ex);
    t.ok(!d.exact.length && d.excludedCount === 1, "so a trashed copy doesn't make the live card a duplicate");
    const plan = V.planIngest([Object.assign({}, live, { id: "i:Ada.png", rootId: "i" })], [trashed], { ingestSkipDupes: true }, {}, ex);
    t.ok(plan[0].status === "new" && plan[0].action === "copy", "and a card you trashed can be added again", plan[0].status);
  }

  console.log("\na .charx can't unpack past the limit, whatever its header says");
  {
    global.JSZip = require("../lib/jszip.min.js");
    const zip = new JSZip();
    zip.file("card.json", JSON.stringify({ spec: "chara_card_v3", data: { name: "Big", description: "x".repeat(5000) } }));
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
    const entry = loaded.file("card.json");
    let refused = "";
    try { await V.unzipEntryLimited(entry, 1000); } catch (e) { refused = e.message; }
    t.ok(/over/.test(refused), "unpacking stops at the limit, counting what actually comes out (" + refused + ")");
    t.ok((await V.unzipEntryLimited(entry, 100000)).length > 5000, "and under it, the whole file comes back");
    const ok = await V.parseCardBytes(await zip.generateAsync({ type: "uint8array" }), "big.charx");
    t.ok(ok.ok && ok.data.name === "Big", "a normal .charx still reads");
  }

  console.log("\nfolder settings follow the folders");
  {
    const now = [{ id: "new1", name: "Cards" }, { id: "new2", name: "Inbox" }];
    const exported = [{ id: "old1", name: "Cards" }, { id: "old2", name: "Gone" }];
    const map = V.importRootIdMap(exported, now);
    t.eq([map.old1 && map.old1.id, map.old2, map.new2 && map.new2.id], ["new1", undefined, "new2"],
      "an export's folders are matched to the ones added here by name");
    const incoming = { privateFolders: ["old1::Secret", "old2::"], trashKey: "old1::_vault trash", autoBackupKey: "off",
      afterSendKey: "old2::Sent", destinations: [{ id: "d", type: "folder", folderKey: "old1::ST" }, { id: "l", type: "lumiverse" }] };
    const current = { privateFolders: ["new2::Mine"], afterSendKey: "new2::Done" };
    const { patch, lostPrivate } = V.remapRootSettings(incoming, current, map);
    t.eq(patch.privateFolders.slice().sort(), ["new1::Secret", "new2::Mine"], "private folders are carried over and added to the ones here, never put in their place");
    t.eq(lostPrivate, 1, "and one that can't be placed is counted, so the vault can say so");
    t.eq([patch.trashKey, patch.autoBackupKey, patch.afterSendKey, patch.destinations[0].folderKey],
      ["new1::_vault trash", "off", "new2::Done", "new1::ST"], "the trash, backups, filing folder and folder destinations follow too; one with no folder keeps the current setting");
    // A registered folder replaced by the one around it: its keys move under the new one.
    const inner = { r1: { id: "outer", prefix: "Library" } };
    t.eq(V.remapRootSettings({ privateFolders: ["r1::Secret"] }, { privateFolders: ["r1::Secret"] }, inner).patch.privateFolders,
      ["r1::Secret", "outer::Library/Secret"], "a private folder inside a replaced registration stays private under the outer folder");
    t.eq(V.remapDirKeyed({ "r1::A": "inbox", "zz::B": "archive" }, inner), { "outer::Library/A": "inbox" }, "folder labels move with it");
    // The same when a registration sitting inside another is dropped ("Fix it", or adding the folder around it).
    const roots = [{ id: "outer", name: "Parent", role: "library" }, { id: "big", name: "Big", role: "archive" }, { id: "other", name: "Inbox" }];
    const moved = V.absorbRegistration(roots, roots[1], "outer", "Big",
      { privateFolders: ["big::", "other::Mine"], trashKey: "big::Old", ingestSourceKeys: ["other::"] }, { "big::Sub": "inbox" }, { "big::Sub": "exclude" });
    t.eq(moved.patch.privateFolders.slice().sort(), ["big::", "other::Mine", "outer::Big"], "a private registration stays private under the folder around it");
    t.eq([moved.patch.trashKey, moved.patch.ingestSourceKeys], ["outer::Big/Old", ["other::"]], "its trash follows, and other folders' settings are left as they are");
    t.eq([moved.folderRoles["outer::Big"], moved.folderRoles["outer::Big/Sub"], moved.dupeMode["outer::Big/Sub"]], ["archive", "inbox", "exclude"],
      "its role becomes the subfolder's label, and its labels and duplicate rules move with it");
    t.eq(V.absorbRegistration(roots, roots[1], "outer", "Big", {}, { "big::": "inbox" }, {}).folderRoles["outer::Big"], "inbox",
      "a label on the registration's own top folder wins over its role");
  }

  console.log("\nlorebook edits in the vault");
  {
    const parsed = await V.parseCardBytes(enc(ORIGINAL), "ada.json");
    const body = parsed.data, raw = V.rawCharacterBook(parsed.raw);
    t.eq(V.effectiveLorebook(body, null), body.lorebook, "with no edit, the lorebook is the file's");
    const edited = V.cleanLorebook(body.lorebook);
    edited.entries[0].content = "The engine sings.";
    edited.entries.push(V.cleanLoreEntry({ comment: "Ada", keys: "ada, lovelace", content: "She is Ada." }));
    const patch = V.lorebookPatch(body, edited);
    t.ok(patch.lorebook && patch.lorebook.entries.length === 3 && patch.lorebook.entries[2].keys.join() === "ada,lovelace" && patch.lorebook.entries[2].idx === null,
      "an edit becomes edit.lorebook, keys split from text, a new entry marked as new");
    t.eq(V.lorebookPatch(body, V.cleanLorebook(body.lorebook)), { lorebook: null }, "a lorebook edited back to the file's is no edit at all");
    const edit = { lorebook: patch.lorebook };
    t.ok(V.isEdited(edit) && V.pendingEditCount(edit) === 1, "it counts as one unsaved change");
    t.eq(V.effectiveLorebook(body, edit).entries[0].content, "The engine sings.", "and the vault shows it");
    const out = V.buildV3Payload(body, edit, raw).data.character_book;
    t.ok(out.entries[0].content === "The engine sings." && out.entries[0].extensions.probability === 80 && out.entries[0].id === 7,
      "saving writes the edit over the original entry, keeping its extensions and id");
    t.ok(out.entries.length === 3 && out.entries[2].content === "She is Ada." && out.entries[2].id === 10, "and adds the new entry with the next id");
    t.eq(out.extensions, { st_world: "keep me" }, "and keeps the book's own extensions");
    t.eq(V.lorebookPatch({ lorebook: null }, V.cleanLorebook({ entries: [{ content: "First." }] })).lorebook.entries[0].content, "First.",
      "a card without a lorebook can be given one");
  }

  console.log("\ngreeting edits in the vault");
  {
    const body = { alternate_greetings: ["Hello.", "Hi."] };
    t.eq(V.greetingsPatch(body, ["Hello.", "Hi there."]), { greetings: ["Hello.", "Hi there."] }, "a changed greeting is an edit");
    t.eq(V.greetingsPatch(body, ["Hello.", "Hi."]), { greetings: null }, "greetings typed back to the file's are no edit at all");

    // Lorebook keys: split at commas, but a regex key with a comma in it is one key.
    t.eq(V.splitKeyList("gull, tern ,, seabird "), ["gull", "tern", "seabird"], "keys are split at commas and trimmed");
    t.eq(V.splitKeyList("/\\b(gulls?|terns?){1,2}\\b/i, seabird"), ["/\\b(gulls?|terns?){1,2}\\b/i", "seabird"], "a regex key keeps its comma");
    t.eq(V.splitKeyList("sea, /a{1,2}/gi,/b[,/]c/ , d"), ["sea", "/a{1,2}/gi", "/b[,/]c/", "d"], "anywhere in the list, with a slash or comma in a [class]");
    t.eq(V.splitKeyList("/a\\/b,c/i"), ["/a\\/b,c/i"], "and with an escaped slash");
    t.eq(V.splitKeyList("/unclosed, x"), ["/unclosed", "x"], "a slash that never closes is plain text");
    t.eq(V.splitKeyList("/a,b/ then, c"), ["/a", "b/ then", "c"], "and so is something that isn't only a regex");
    t.eq(V.splitKeyList(""), [], "an empty box is no keys");
    t.eq(V.greetingsPatch(body, ["Hi.", "Hello."]), { greetings: ["Hi.", "Hello."] }, "a new order is an edit");
    t.eq(V.greetingsPatch({ alternate_greetings: [] }, []), { greetings: null }, "none added to none is no edit");
    t.eq(V.greetingsPatch(body, []), { greetings: [] }, "removing them all is an edit");
  }

  console.log("\nnew cards");
  {
    const zlib = require("zlib");
    const png = V.solidPng(40, 60, [78, 60, 120]);
    // Read it back with Node's own zlib: the encoder's checksums must be right.
    let i = 8, idat = [], ihdr = null;
    while (i < png.length) {
      const n = Buffer.from(png.slice(i, i + 4)).readUInt32BE(0), type = Buffer.from(png.slice(i + 4, i + 8)).toString();
      if (type === "IHDR") ihdr = png.slice(i + 8, i + 8 + n);
      if (type === "IDAT") idat.push(Buffer.from(png.slice(i + 8, i + 8 + n)));
      i += 12 + n;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    t.ok(V.isPng(png) && Buffer.from(ihdr).readUInt32BE(0) === 40 && raw.length === (1 + 40 * 3) * 60 && raw[1] === 78 && raw[3] === 120,
      "the placeholder picture is a real PNG: the right size and colour, readable by a standard decoder");
    const big = V.solidPng(400, 600, [1, 2, 3]);
    t.ok(zlib.inflateSync(Buffer.concat((() => { const out = []; let j = 8; while (j < big.length) { const n = Buffer.from(big.slice(j, j + 4)).readUInt32BE(0);
      if (Buffer.from(big.slice(j + 4, j + 8)).toString() === "IDAT") out.push(Buffer.from(big.slice(j + 8, j + 8 + n))); j += 12 + n; } return out; })())).length === (1 + 400 * 3) * 600,
      "a full-size one (several deflate blocks) too");

    const v3 = V.newCardPayload({ name: "  Ada  ", description: "A clockmaker.", tags: ["victorian", ""] });
    t.ok(v3.spec === "chara_card_v3" && v3.data.name === "Ada" && v3.data.tags.join() === "victorian" && Array.isArray(v3.data.alternate_greetings),
      "a new card has every spec field, the name trimmed and empty tags dropped");
    t.eq(V.newCardPayload({}).data.name, "New card", "a nameless one is called New card");
    const card = await V.parseCardBytes(V.writeCardIntoPng(big, v3, V.buildV2Payload(v3)), "Ada.png");
    t.ok(card.ok && card.data.name === "Ada" && card.data.description === "A clockmaker.", "written into the placeholder picture, it reads back as a card");
    t.ok(V.placeholderColor("Ada").length === 3 && V.placeholderColor("Ada").join() === V.placeholderColor("Ada").join(), "each name always gets the same colour");
  }

  console.log("\nhostile card files");
  {
    const zlib = require("zlib");
    const png = PNG_1PX;
    const withChunk = (type, data) => {
      const iend = png.length - 12;
      return new Uint8Array(Buffer.concat([Buffer.from(png.subarray(0, iend)), Buffer.from(V.makeChunk(type, data)), Buffer.from(png.subarray(iend))]));
    };
    const ztxt = (key, payload) => Buffer.concat([Buffer.from(key + "\0\0", "latin1"), zlib.deflateSync(payload)]);

    // A "decompression bomb": about 80 KB that unpacks to 80 MB.
    const bomb = Buffer.alloc(80 * 1024 * 1024, 0x41);
    let r = await V.parseCardBytes(withChunk("zTXt", ztxt("chara", bomb)), "bomb.png");
    t.ok(!r.ok, "a card chunk that unpacks to over 64 MB is refused, not unpacked", r.err);
    const before = process.memoryUsage().rss;
    r = await V.parseCardBytes(withChunk("zTXt", ztxt("Comment", bomb)), "other.png");
    t.ok(!r.ok && process.memoryUsage().rss - before < 40 * 1024 * 1024, "and a compressed chunk that isn't card data is never unpacked at all");

    // A normal compressed card still reads.
    const card = Buffer.from(Buffer.from(JSON.stringify(ORIGINAL)).toString("base64"), "latin1");
    r = await V.parseCardBytes(withChunk("zTXt", ztxt("chara", card)), "ok.png");
    t.ok(r.ok && r.data.name === "Ada", "a real card in a compressed chunk still reads");

    // Keys that try to reach Object.prototype.
    const evil = JSON.parse('{"spec":"chara_card_v2","data":{"name":"Evil","description":"x","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}},"tags":["a"],"extensions":{"__proto__":{"polluted3":true}}}}');
    r = await V.parseCardBytes(enc(evil), "evil.json");
    t.ok(r.ok && r.data.name === "Evil" && ({}).polluted === undefined && ({}).polluted2 === undefined && ({}).polluted3 === undefined,
      "a card with __proto__ and constructor keys reads, and changes nothing outside itself");
    r = await V.parseCardBytes(withChunk("tEXt", Buffer.from("__proto__\0x", "latin1")), "proto.png");
    t.ok(!r.ok && ({}).x === undefined, "a PNG chunk named __proto__ is just an odd name");

    // Names a card can't safely have on disk.
    t.eq(["CON", "nul", "Com1", "LPT9", "Ada.", "Ada  ", "a/b:c", "  "].map(V.safeFileName),
      ["_CON", "_nul", "_Com1", "_LPT9", "Ada", "Ada", "a_b_c", "card"], "file names never become Windows devices or lose a trailing dot");
  }

  console.log("\nodd card files that should still read");
  {
    // A lorebook with an empty slot (null) in its entries: the card reads, the slot is skipped.
    const holey = { spec: "chara_card_v2", data: { name: "Holey", description: "x",
      character_book: { entries: [null, { keys: ["k"], content: "kept" }, null] } } };
    let r = await V.parseCardBytes(enc(holey), "holey.json");
    t.ok(r.ok && r.data.lorebook.entries.length === 1 && r.data.lorebook.entries[0].content === "kept",
      "a lorebook with null entries still reads, skipping them", r.err);
    t.eq(r.ok && r.data.lorebook.entries[0].idx, 1, "and each entry keeps its place in the file's list, so a save writes over the right one");
    r = await V.parseCardBytes(V.writeCardIntoPng(PNG_1PX, holey, holey), "holey.png");
    t.ok(r.ok && r.data.name === "Holey", "the same in a PNG", r.err);

    // A .charx whose card.json isn't at the top: another file merely ending in card.json isn't it.
    global.JSZip = require("../lib/jszip.min.js");
    const zip = new JSZip();
    zip.file("assets/discard.json", JSON.stringify({ name: "Wrong", description: "not the card" }));
    zip.file("x/card.json", JSON.stringify({ spec: "chara_card_v2", data: { name: "Right", description: "the card" } }));
    r = await V.parseCardBytes(await zip.generateAsync({ type: "uint8array" }), "nested.charx");
    t.eq(r.ok && r.data.name, "Right", "a .charx reads its card.json, not a file like discard.json");
  }

  console.log("\na big card is read in full when only part of it fits the first read");
  {
    // Save to card writes chara (v2) then ccv3 (v3). A card big enough that chara fits
    // in the scan's first read but ccv3 doesn't must still be read as v3, or the
    // v3-only fields vanish from the vault and the next save writes them empty.
    const v3 = V.newCardPayload({ name: "Big", description: "x".repeat(260000), first_mes: "hi" });
    v3.data.group_only_greetings = ["Hello, all of you."];
    v3.data.nickname = "Biggs";
    const png = V.writeCardIntoPng(PNG_1PX, v3, V.buildV2Payload(v3));
    t.ok(png.length > V.SCAN_HEAD_BYTES, "the test card is bigger than the first read (" + png.length + " bytes)");
    const file = new File([png], "Big.png", { lastModified: 1 });
    const out = await V.processCardFile({ id: "r1" }, { rel: "Big.png", dir: "", file: "Big.png", ext: "png" }, file);
    t.eq(out.rec.spec, "v3", "the scan finds the v3 data");
    t.eq([out.body.__val.group_only_greetings, out.body.__val.nickname], [["Hello, all of you."], "Biggs"],
      "and keeps the group-only greetings and nickname");
  }

  console.log("\nbackups made by Save to card are never indexed");
  {
    // A folder tree of fake handles, the shape listCardFiles walks.
    const dir = (name, kids) => ({ kind: "directory", name, values: async function* () { for (const k of kids) yield k; } });
    const file = (name) => ({ kind: "file", name });
    const root = dir("Cards", [
      file("Ada.png"),
      dir("_vault backups", [file("Ada 2026-10-02 1200.png"), file("Bram 2026-10-02 1201.png")]),
      dir("_vault trash", [file("Cora.png")]),
      dir("Fantasy", [file("Dain.json"), dir("_vault backups", [file("Dain old.json")])]),
    ]);
    const acc = [], dirs = [];
    await V.listCardFiles(root, "", acc, null, 0, dirs);
    t.eq(acc.map((x) => x.rel).sort().join(", "), "Ada.png, Fantasy/Dain.json, _vault trash/Cora.png",
      "cards, subfolders and the trash are listed; nothing in a _vault backups folder is");
    t.ok(dirs.every((d) => !/_vault backups/.test(d)), "and the backup folder isn't in the folder tree", dirs);

    const data = dir("Cards", [file("Ada.png"), dir("_vault data", [file("rp-card-vault-data 20261002-120000.json")])]);
    const acc2 = [];
    await V.listCardFiles(data, "", acc2, null, 0, []);
    t.eq(acc2.map((x) => x.rel).join(), "Ada.png", "nor anything in _vault data (vault-data backups are .json, which would look like cards)");
  }

  console.log("\na rescan only drops the cards whose files are really gone");
  {
    const cardJson = (n) => new TextEncoder().encode(JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: { name: n, description: "About " + n, first_mes: "Hi." } }));
    // fail: { open: file name whose getFile() throws, list: folder name whose listing throws after one entry,
    //         extra: one more file at the top, missing: a file listed but "not found" when opened }
    const tree = (fail) => {
      fail = fail || {};
      const file = (name) => ({ kind: "file", name, async getFile() {
        if (fail.open === name) throw new Error("The file is in use");
        if (fail.missing === name) throw Object.assign(new Error("A requested file or directory could not be found at the time an operation was processed."), { name: "NotFoundError" });
        return new File([cardJson(name)], name, { lastModified: 1 });
      } });
      const dir = (name, kids) => ({ kind: "directory", name,
        async queryPermission() { return "granted"; }, async requestPermission() { return "granted"; },
        values: async function* () {
          for (let i = 0; i < kids.length; i++) {
            if (fail.list === name && i === 1) throw Object.assign(new Error("A requested file or directory could not be found"), { name: "NotFoundError" });
            yield kids[i];
          }
        } });
      return dir("Cards", [file("Ada.json"), file("Bram.json"), file("Cora.json"),
        dir("Old", [file("Dain.json"), file("Edda.json")])].concat(fail.extra ? [file(fail.extra)] : []));
    };
    const root = (fail) => ({ id: "r1", name: "Cards", role: "library", handle: tree(fail) });
    const go = { stop: false };
    const first = await V.scanRoot(root(), new Map(), go, () => {});
    const all = first.records.map((r) => r.rel).sort().join(", ");
    t.eq(all, "Ada.json, Bram.json, Cora.json, Old/Dain.json, Old/Edda.json", "a first scan finds every card");
    const known = () => new Map(first.records.map((r) => [r.id, r]));

    // Stop pressed while the first card is being read.
    let looks = 0;
    const stopAfterOne = { get stop() { return looks++ > 0; } };
    const stopped = await V.scanRoot(root(), known(), stopAfterOne, () => {});
    t.eq(stopped.removed, [], "stopping a rescan part-way removes nothing");
    t.eq(stopped.records.map((r) => r.rel).sort().join(", "), all, "and the cards it hadn't reached yet stay indexed");

    const locked = await V.scanRoot(root({ open: "Bram.json" }), known(), go, () => {});
    t.ok(locked.records.some((r) => r.rel === "Bram.json") && !locked.removed.length,
      "a card file that can't be opened just now keeps its record", locked.records.map((r) => r.rel).join());

    // Chrome and Edge list a file whose full path is over Windows' 260 characters, then can't open it.
    const long = "I Was Just Walking Home Through Gotham When Supergirl Landed in Front of Me, Said She Spotted Me From the Sky and Couldn't Focus on Anything Else.json";
    const longScan = await V.scanRoot(root({ extra: long, missing: long }), known(), go, () => {});
    const lr = longScan.records.find((r) => r.rel === long);
    t.ok(lr && !lr.ok && lr.unopened, "a card file that's listed but can't be opened is indexed as unreadable, not left out", lr);
    t.ok(lr && /260-character limit/.test(lr.err) && /file name alone is \d+ characters/.test(lr.err) && /Rename it/.test(lr.err),
      "and says why, and what to do", lr && lr.err);
    t.eq(longScan.unopened.map((r) => r.rel), [long], "the scan reports it, so the vault can say so");
    const fresh = await V.scanRoot(root({ open: "Bram.json", extra: long, missing: long }), new Map(), go, () => {});
    const fb = fresh.records.find((r) => r.rel === "Bram.json");
    t.ok(fb && !fb.ok && /^Couldn't open the file: The file is in use/.test(fb.err), "one never read before that can't be opened says the error as it is", fb && fb.err);
    t.ok(fb && lr && fb.fp !== fresh.records.find((r) => r.rel === long).fp, "two unopened cards aren't taken for duplicates of each other");
    const later = await V.scanRoot(root(), new Map(longScan.records.map((r) => [r.id, r])), go, () => {});
    t.ok(!later.records.some((r) => r.rel === long) && later.removed.includes(lr.id), "once it's renamed, the unreadable entry goes");

    let res, threw = null;
    try { res = await V.scanRoot(root({ list: "Old" }), known(), go, () => {}); } catch (e) { threw = e; }
    t.ok(!threw, "a subfolder that can't be listed doesn't make the scan fail", threw && threw.message);
    t.ok(res && !res.removed.length && res.records.some((r) => r.rel === "Old/Edda.json"),
      "and the cards in it that weren't listed stay indexed", res && JSON.stringify(res.removed));

    threw = null;
    try { res = await V.scanRoot(root({ list: "Cards" }), known(), go, () => {}); } catch (e) { threw = e; }
    t.ok(!threw && res && res.error && !res.removed.length,
      "a folder that can't be listed at all is reported as an error, with nothing removed", threw ? threw.message : res && res.error);

    const file = (n) => ({ rel: n, dir: "", file: n, ext: "json", fileObj: new File([cardJson(n)], n, { lastModified: 2 }) });
    const imp = { id: "imp:cards", name: "cards", mode: "import" };
    looks = 0;
    V.IMPORT_PENDING.set(imp.id, ["Ada.json", "Bram.json", "Cora.json"].map(file));
    const impKnown = new Map((await V.scanImportRoot(imp, new Map(), go, () => {})).records.map((r) => [r.id, r]));
    V.IMPORT_PENDING.set(imp.id, ["Ada.json", "Bram.json", "Cora.json"].map(file));
    const impStopped = await V.scanImportRoot(imp, impKnown, stopAfterOne, () => {});
    t.eq([impStopped.removed, impStopped.records.length], [[], 3], "stopping the scan of an imported folder removes nothing either");
  }

  console.log("\nold backups of a card are pruned, and nothing else");
  {
    const names = [
      "Ada 20261001-090000.png", "Ada 20261002-090000.png", "Ada 20261002-090000 (2).png",
      "Ada 20260901-120000.png", "Ada 20261003-080000.png",
      "Ada 2 20260101-000000.png",            // another card, "Ada 2"
      "Ada 20261001-090000.json",             // another file type
      "Ada notes.txt", "Ada.png", "readme.md", // not backups at all
      "Bram 20250101-000000.png",
    ];
    const gone = V.backupsToPrune(names, "Ada.png", 3);
    t.eq(gone.sort().join(" | "), "Ada 20260901-120000.png | Ada 20261001-090000.png",
      "keeping 3, the two oldest of Ada.png's own backups go (a same-second \" (2)\" counts as newer)");
    t.eq(V.backupsToPrune(names, "Ada.png", 2).sort().join(" | "), "Ada 20260901-120000.png | Ada 20261001-090000.png | Ada 20261002-090000.png",
      "keeping 2, the \" (2)\" is kept over the first copy from that same second");
    t.eq(V.backupsToPrune(["ada 20260101-000000.PNG", "ADA 20260102-000000.png"], "Ada.png", 1).join(), "ada 20260101-000000.PNG",
      "a card renamed only in case still prunes its old backups");
    t.eq(V.backupsToPrune(names, "Ada.png", 0).length, 0, "keep 0 means keep every backup");
    t.eq(V.backupsToPrune(names, "Ada.png", 10).length, 0, "fewer than the limit: nothing goes");
    t.eq(V.backupsToPrune(names, "Ada 2.png", 0).length + V.backupsToPrune(names, "Ada 2.png", 1).length, 0, "\"Ada 2\" has only one");
    t.eq(V.backupsToPrune(["C++ (v2) 20260101-000000.json", "C++ (v2) 20260102-000000.json"], "C++ (v2).json", 1).join(),
      "C++ (v2) 20260101-000000.json", "names with regex characters work");
    t.eq(V.backupsToPrune(names, "Ada.png", 1, "Ada 20260901-120000.png").sort().join(" | "),
      "Ada 20261001-090000.png | Ada 20261002-090000 (2).png | Ada 20261002-090000.png | Ada 20261003-080000.png",
      "the backup named as the newest is kept, whatever its stamp says");
  }

  console.log("\nthe backup a save has just made is never the one pruned");
  {
    // After the clock goes back (the autumn hour change, or a fast clock put
    // right), older backups can carry later stamps than the one just made.
    const fsys = memFs("Cards");
    const root = { id: "r", name: "Cards", handle: fsys.handle };
    const v3 = V.newCardPayload({ name: "Ada" });
    const bytes = V.writeCardIntoPng(PNG_1PX, v3, V.buildV2Payload(v3));
    fsys.put("Ada.png", bytes);
    for (const s of ["20991101-015000", "20991101-015500", "20991101-015800"]) fsys.put("_vault backups/Ada " + s + ".png", new Uint8Array([1]));
    const parsed = await V.parseCardBytes(bytes, "Ada.png");
    const rec = { id: "r:Ada.png", rootId: "r", rel: "Ada.png", dir: "", file: "Ada.png", ext: "png", sig: "s" };
    const res = await V.saveCardToFile(rec, parsed.data, { fields: { description: "Edited." } }, [root], { keep: 3 });
    const made = res.backupPath.split("/").pop();
    const kept = fsys.list("_vault backups");
    t.ok(kept.length === 3 && kept.includes(made) && V.sameBytes(fsys.get("_vault backups/" + made), bytes),
      "keeping 3, the new backup (" + made + ") stays and one of the later-stamped ones goes", kept);
  }

  t.done();
}

main().catch((e) => { console.error("harness error:", e && e.stack || e); process.exit(1); });
