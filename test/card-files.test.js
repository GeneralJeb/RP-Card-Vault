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
  "makeChunk", "safeFileName", "effectiveLorebook", "cleanLorebook", "cleanLoreEntry", "lorebookPatch", "isEdited", "pendingEditCount", "solidPng", "newCardPayload", "placeholderColor", "isPng", "listCardFiles", "backupsToPrune",
]);

const enc = (o) => new TextEncoder().encode(JSON.stringify(o));

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
    const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
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
    const files = { "ada.png": first };
    const fileHandle = (name) => ({
      async getFile() { const b = files[name]; return { size: b.length, lastModified: 1, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; },
      async createWritable() {
        const parts = [];
        return { async write(blob) { parts.push(new Uint8Array(await blob.arrayBuffer())); },
          async close() { files[name] = Buffer.concat(parts.map((p) => Buffer.from(p))); } };
      },
    });
    const dir = {
      async queryPermission() { return "granted"; },
      async getDirectoryHandle() { throw new Error("no subfolders here"); },
      async getFileHandle(name) { if (!files[name]) throw new Error("missing"); return fileHandle(name); },
    };
    const rec = { id: "r:ada.png", rootId: "r", rel: "ada.png", dir: "", file: "ada.png", ext: "png", sig: "s" };
    const edit = { fields: { description: "A clockmaker who hates being late." } };
    const res = await V.saveCardToFile(rec, parsed.data, edit, [{ id: "r", name: "Scratch", handle: dir }], { backup: false });
    const onDisk = await V.parseCardBytes(new Uint8Array(files["ada.png"]), "ada.png");
    const d0 = V.rawCharacterBook(onDisk.raw).entries[0];
    t.ok(res && onDisk.data.description === "A clockmaker who hates being late.", "Save to card writes the edit into the file");
    t.ok(d0.id === 7 && d0.extensions.probability === 80 && d0.case_sensitive === true && V.rawCharacterBook(onDisk.raw).extensions.st_world === "keep me",
      "and the lorebook on disk still has every field it had before");
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
    const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
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
    t.eq(V.backupsToPrune(names, "Ada.png", 0).length, 0, "keep 0 means keep every backup");
    t.eq(V.backupsToPrune(names, "Ada.png", 10).length, 0, "fewer than the limit: nothing goes");
    t.eq(V.backupsToPrune(names, "Ada 2.png", 0).length + V.backupsToPrune(names, "Ada 2.png", 1).length, 0, "\"Ada 2\" has only one");
    t.eq(V.backupsToPrune(["C++ (v2) 20260101-000000.json", "C++ (v2) 20260102-000000.json"], "C++ (v2).json", 1).join(),
      "C++ (v2) 20260101-000000.json", "names with regex characters work");
  }

  t.done();
}

main().catch((e) => { console.error("harness error:", e && e.stack || e); process.exit(1); });
