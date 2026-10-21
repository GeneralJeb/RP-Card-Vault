/**
 * Vault archives: the zip writer and reader, WinZip AES-256, and the checks a
 * restore makes on an archive that may have come from anywhere.
 *
 * The AES is checked against FIPS-197 and Node's own AES; encrypted files are
 * opened by a second, independent reading of the WinZip spec built on Node's
 * crypto; and Python's zipfile (when installed) reads the zips as an outsider.
 *
 *   node test/archive.test.js
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadPureRegion } = require("./pure-region");
const t = require("./harness");

const { mod: V } = loadPureRegion([
  "aesExpandKey", "aesEncryptWords", "aesCtrLE", "winzipAesEncrypt", "winzipAesDecrypt",
  "makeZipWriter", "readZipDirectory", "readZipEntry", "safeArchivePath", "archiveFolderNames",
  "readArchiveManifest", "planArchiveRestore", "isArchiveFileName", "archiveFileName", "archiveReadme",
  "crc32", "ARCHIVE_FORMAT", "ARCHIVE_CARDS_DIR", "ARCHIVE_MANIFEST", "ARCHIVE_DATA_FILE",
]);

const hex = (b) => Buffer.from(b).toString("hex");
const fromHex = (h) => new Uint8Array(Buffer.from(h, "hex"));

/** A zip built in memory: { bytes, read, size }. */
async function buildZip(files, opts) {
  const parts = [];
  const zw = V.makeZipWriter(async (b) => { parts.push(Buffer.from(b)); }, opts);
  for (const f of files) await zw.add(f.name, f.data, f.mtime || Date.UTC(2026, 9, 21, 12, 0, 0), f.plain);
  await zw.finish();
  return reader(Buffer.concat(parts));
}
function reader(buf) {
  const bytes = new Uint8Array(buf);
  return { bytes, size: bytes.length, read: async (off, len) => bytes.slice(off, off + len) };
}
async function readAll(z, password) {
  const out = {};
  for (const e of await V.readZipDirectory(z.read, z.size)) out[e.name] = Buffer.from(await V.readZipEntry(z.read, z.size, e, password)).toString("latin1");
  return out;
}
async function failsWith(fn) {
  try { await fn(); return null; } catch (e) { return e; }
}

/** WinZip AE-2, read straight from the spec with Node's crypto: no code shared with the page. */
function nodeWinzipDecrypt(password, raw) {
  const salt = raw.subarray(0, 16), ver = raw.subarray(16, 18), enc = raw.subarray(18, raw.length - 10), tag = raw.subarray(raw.length - 10);
  const keys = crypto.pbkdf2Sync(Buffer.from(password, "utf8"), salt, 1000, 66, "sha1");
  if (!keys.subarray(64).equals(Buffer.from(ver))) throw new Error("verifier");
  const mac = crypto.createHmac("sha1", keys.subarray(32, 64)).update(enc).digest().subarray(0, 10);
  if (!mac.equals(Buffer.from(tag))) throw new Error("hmac");
  const ecb = crypto.createCipheriv("aes-256-ecb", keys.subarray(0, 32), null);
  ecb.setAutoPadding(false);
  const ctr = Buffer.alloc(Math.ceil(enc.length / 16) * 16);
  for (let i = 0; i < ctr.length / 16; i++) ctr.writeUInt32LE(i + 1, i * 16);
  const ks = Buffer.concat([ecb.update(ctr), ecb.final()]);
  const out = Buffer.alloc(enc.length);
  for (let i = 0; i < enc.length; i++) out[i] = enc[i] ^ ks[i];
  return out;
}

function findPython() {
  for (const cmd of ["python3", "python", "py"]) {
    const r = spawnSync(cmd, ["-c", "import zipfile,sys; print(sys.version_info[0])"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim() === "3") return cmd;
  }
  return null;
}

(async () => {
  console.log("\nAES block cipher");
  {
    const words = (b) => [0, 4, 8, 12].map((i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0);
    const block = (key, pt) => {
      const out = [0, 0, 0, 0];
      V.aesEncryptWords(V.aesExpandKey(fromHex(key)), ...words(fromHex(pt)), out);
      return out.map((w) => (w >>> 0).toString(16).padStart(8, "0")).join("");
    };
    // FIPS-197 appendix C.
    t.eq(block("000102030405060708090a0b0c0d0e0f", "00112233445566778899aabbccddeeff"), "69c4e0d86a7b0430d8cdb78070b4c55a", "AES-128 matches FIPS-197");
    t.eq(block("000102030405060708090a0b0c0d0e0f1011121314151617", "00112233445566778899aabbccddeeff"), "dda97ca4864cdfe06eaf70a0ec0d7191", "AES-192 matches FIPS-197");
    t.eq(block("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "00112233445566778899aabbccddeeff"), "8ea2b7ca516745bfeafc49904b496089", "AES-256 matches FIPS-197");
  }

  console.log("\nWinZip's counter mode against Node's AES");
  for (const n of [0, 1, 15, 16, 17, 1000, 70000]) {
    const key = crypto.randomBytes(32), data = crypto.randomBytes(n);
    const ecb = crypto.createCipheriv("aes-256-ecb", key, null); ecb.setAutoPadding(false);
    const ctr = Buffer.alloc(Math.ceil(n / 16) * 16);
    for (let i = 0; i < ctr.length / 16; i++) ctr.writeUInt32LE(i + 1, i * 16);
    const ks = Buffer.concat([ecb.update(ctr), ecb.final()]);
    const want = Buffer.alloc(n);
    for (let i = 0; i < n; i++) want[i] = data[i] ^ ks[i];
    t.eq(hex(V.aesCtrLE(V.aesExpandKey(new Uint8Array(key)), new Uint8Array(data))), want.toString("hex"), n + " bytes: the same as Node's AES-256 with a little-endian counter from 1");
  }

  console.log("\nWinZip AES-256 (AE-2)");
  {
    const data = new TextEncoder().encode("A clockmaker who repairs time itself. ".repeat(20));
    const enc = await V.winzipAesEncrypt("correct horse", data);
    t.eq(enc.length, 16 + 2 + data.length + 10, "salt, password check, data, then a 10-byte HMAC");
    t.eq(nodeWinzipDecrypt("correct horse", Buffer.from(enc)).toString(), Buffer.from(data).toString(), "an independent reading of the spec, on Node's crypto, opens it");
    t.eq(Buffer.from(await V.winzipAesDecrypt("correct horse", enc)).toString(), Buffer.from(data).toString(), "and so does the vault");
    const enc2 = await V.winzipAesEncrypt("correct horse", data);
    t.ok(hex(enc.subarray(0, 16)) !== hex(enc2.subarray(0, 16)), "every file gets a new salt, so no two share a keystream");
    t.eq((await failsWith(() => V.winzipAesDecrypt("wrong horse", enc))).kind, "password", "a wrong password is refused");
    const bent = enc.slice(); bent[40] ^= 1;
    t.eq((await failsWith(() => V.winzipAesDecrypt("correct horse", bent))).kind, "password", "one changed byte fails the HMAC");
    t.eq(hex(V.aesCtrLE(V.aesExpandKey(new Uint8Array(32)), new Uint8Array(0))), "", "an empty file encrypts to nothing");
    const uni = await V.winzipAesEncrypt("pässwörd ✓", data);
    t.eq(nodeWinzipDecrypt("pässwörd ✓", Buffer.from(uni)).length, data.length, "a password with accents and symbols is taken as UTF-8, as 7-Zip does");
  }

  const card = new Uint8Array(Buffer.from("\x89PNG\r\n\x1a\n" + "tEXtchara\0" + Buffer.from(JSON.stringify({ name: "Ada", description: "x".repeat(4000) })).toString("base64")));
  const noise = new Uint8Array(crypto.randomBytes(5000));
  const files = [
    { name: "README.txt", data: new TextEncoder().encode("hello"), plain: true },
    { name: "cards/Cards/Ada Clockmaker.png", data: card },
    { name: "cards/Cards/sub/Bram — the light ✓.png", data: noise },
    { name: "cards/Cards/empty.png", data: new Uint8Array(0) },
  ];

  console.log("\nthe zip writer and reader");
  {
    const z = await buildZip(files);
    const got = await readAll(z);
    t.eq(Object.keys(got).join("|"), files.map((f) => f.name).join("|"), "every file is listed, with its UTF-8 name");
    t.ok(files.every((f) => got[f.name] === Buffer.from(f.data).toString("latin1")), "and reads back byte for byte");
    const dir = await V.readZipDirectory(z.read, z.size);
    t.eq(dir[1].method, 8, "card text is deflated");
    t.eq(dir[2].method, 0, "data that wouldn't shrink is stored as it is");
    t.ok(dir[1].csize < card.length / 2, "a text-heavy card shrinks (" + card.length + " → " + dir[1].csize + " bytes)");
    const bent = Buffer.from(z.bytes); bent[dir[2].offset + 30 + Buffer.byteLength(dir[2].name) + 7] ^= 1;
    t.eq((await failsWith(() => V.readZipEntry(reader(bent).read, bent.length, dir[2], ""))).kind, "damaged", "a changed byte fails the checksum");
    const z64 = await buildZip(files, { zip64: true });
    t.ok(Object.values(await readAll(z64)).length === files.length, "zip64 records are read back too");
  }

  console.log("\nencrypted archives");
  {
    const z = await buildZip(files, { password: "s3cret" });
    const dir = await V.readZipDirectory(z.read, z.size);
    t.ok(dir[0].flags % 2 === 0 && dir.slice(1).every((e) => e.flags & 1 && e.method === 99 && e.aes && e.aes.strength === 3 && e.aes.version === 2),
      "everything but the README is AES-256 (AE-2)");
    t.ok(Buffer.from(z.bytes).indexOf("x".repeat(64)) < 0 && Buffer.from(z.bytes).indexOf(Buffer.from(noise.subarray(0, 32))) < 0, "no card content is readable in the file");
    const got = await readAll(z, "s3cret");
    t.ok(files.every((f) => got[f.name] === Buffer.from(f.data).toString("latin1")), "the right password reads everything back");
    t.eq((await failsWith(() => readAll(z, "nope"))).kind, "password", "the wrong one is refused");
    t.eq((await failsWith(() => readAll(z, ""))).kind, "password", "and none at all asks for it");
    t.eq(Buffer.from(await V.readZipEntry(z.read, z.size, dir[0], "")).toString(), "hello", "the README opens without the password");
    // Pull one encrypted file out by hand and open it with the independent decryptor.
    const e = dir[1], lv = Buffer.from(z.bytes.slice(e.offset, e.offset + 30));
    const start = e.offset + 30 + lv.readUInt16LE(26) + lv.readUInt16LE(28);
    const raw = nodeWinzipDecrypt("s3cret", Buffer.from(z.bytes.slice(start, start + e.csize)));
    t.eq(require("zlib").inflateRawSync(raw).toString("latin1"), Buffer.from(card).toString("latin1"), "what's stored is standard: AES over raw deflate, as WinZip and 7-Zip expect");
  }

  console.log("\nanother program reads them");
  const py = findPython();
  if (!py) t.ok(true, "Python isn't installed: skipped");
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-archive-"));
    const check = (label, z, script) => {
      const f = path.join(dir, label + ".zip");
      fs.writeFileSync(f, z.bytes);
      const r = spawnSync(py, ["-c", script, f], { encoding: "utf8", env: Object.assign({}, process.env, { PYTHONIOENCODING: "utf-8" }) });
      return (r.stdout || "").trim() + (r.status ? " ERR " + r.stderr.trim().split("\n").pop() : "");
    };
    const list = "import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nprint(z.testzip() or 'ok', len(z.namelist()), sum(len(z.read(n)) for n in z.namelist()))";
    const total = files.reduce((n, f) => n + f.data.length, 0);
    t.eq(check("plain", await buildZip(files), list), "ok 4 " + total, "Python's zipfile opens a plain archive, every checksum good");
    t.eq(check("zip64", await buildZip(files, { zip64: true }), list), "ok 4 " + total, "and one with zip64 records");
    const names = "import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nprint('|'.join(n for n in z.namelist()), z.read('README.txt').decode())";
    t.eq(check("enc", await buildZip(files, { password: "s3cret" }), names), files.map((f) => f.name).join("|") + " hello",
      "an encrypted one lists its files, and its README reads without the password");
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp */ }
  }

  console.log("\nan archive from anywhere");
  {
    for (const bad of ["../evil.png", "cards/../../evil.png", "/abs.png", "C:/x.png", "cards\\Cards\\x.png", "cards/Cards/CON.png", "cards/Cards/nul",
      "cards/Cards/dot.", "cards/Cards/space ", "cards//x.png", "cards/./x.png", "a\u0000b", ""]) {
      t.eq(V.safeArchivePath(bad), null, "refused: " + JSON.stringify(bad));
    }
    t.eq(V.safeArchivePath("cards/Cards/sub/Ada (1).png").join("|"), "cards|Cards|sub|Ada (1).png", "an ordinary path is fine");
    t.eq(V.safeArchivePath("cards/Cards/Console.png").length, 3, "a name that only starts like a device is fine");

    const manifest = V.readArchiveManifest({ format: V.ARCHIVE_FORMAT, roots: [
      { id: "r1", name: "Cards", folder: "Cards", role: "library" },
      { id: "r2", name: "Dup", folder: "cards" },
      { id: "r3", name: "Evil", folder: "../up", role: "library" },
      { id: "r4", name: "Odd role", folder: "Inbox", role: "__proto__" },
    ] });
    t.eq(manifest.roots.map((r) => r.folder).join(), "Cards,Inbox", "the manifest's folders are checked: no repeats (by case), no paths");
    t.eq(manifest.roots[1].role, "library", "and an unknown role becomes Library");
    t.eq(V.readArchiveManifest({ format: 99, roots: [] }), null, "a manifest from a newer format isn't guessed at");
    t.eq(V.readArchiveManifest(null), null, "nor a missing one");

    const plan = V.planArchiveRestore([
      { name: "README.txt", size: 1 }, { name: "manifest.json", size: 1 }, { name: "vault-data.json", size: 1 },
      { name: "cards/Cards/", size: 0 },
      { name: "cards/Cards/Ada.png", size: 10 },
      { name: "cards/cards/ADA.PNG", size: 10 },
      { name: "cards/Cards/sub/Bram.png", size: 5 },
      { name: "cards/Elsewhere/x.png", size: 5 },
      { name: "cards/Cards/../../x.png", size: 5 },
      { name: "loose.png", size: 5 },
    ], manifest);
    t.eq(plan.files.map((f) => f.root.folder + ":" + f.dirs.join("/") + ":" + f.file).join(), "Cards::Ada.png,Cards:sub:Bram.png", "only files in a listed folder are restored, each once");
    t.eq(plan.refused.join(), "cards/cards/ADA.PNG,cards/Elsewhere/x.png,cards/Cards/../../x.png,loose.png", "and the rest are named, not written");
    t.eq(plan.bytes, 15, "with their total size");

    // A small file that claims a small size but unpacks to 10 MB.
    const bomb = await buildZip([{ name: "cards/Cards/bomb.png", data: new Uint8Array(10 * 1048576) }]);
    const be = (await V.readZipDirectory(bomb.read, bomb.size))[0];
    be.size = 100;
    t.eq((await failsWith(() => V.readZipEntry(bomb.read, bomb.size, be, ""))).kind, "damaged", "a file that unpacks past its stated size is stopped");
    const cut = reader(Buffer.from(bomb.bytes.slice(0, bomb.size - 30)));
    t.eq((await failsWith(() => V.readZipDirectory(cut.read, cut.size))).kind, "damaged", "a cut-off archive is refused");
    t.eq((await failsWith(() => V.readZipDirectory(reader(Buffer.from("not a zip at all, sorry")).read, 24))).kind, "damaged", "and so is something that isn't a zip");
    const crypt = await buildZip([{ name: "a.png", data: new Uint8Array(100) }]);
    const ce = (await V.readZipDirectory(crypt.read, crypt.size))[0];
    ce.flags |= 1;   // ZipCrypto: no AES field
    t.eq((await failsWith(() => V.readZipEntry(crypt.read, crypt.size, ce, "pw"))).kind, "unsupported", "the old, weak zip encryption isn't opened");
  }

  console.log("\nnames");
  {
    const n = V.archiveFolderNames([{ id: "a", name: "Cards" }, { id: "b", name: "cards" }, { id: "c", name: "CON" }, { id: "d", name: "x/y" }]);
    t.eq([n.a, n.b, n.c, n.d].join("|"), "Cards|cards (2)|_CON|x_y", "each folder gets a name of its own that's safe on Windows");
    t.ok(V.isArchiveFileName(V.archiveFileName("20261021-120000")) && V.isArchiveFileName("rp-card-vault-archive 20261021-120000 (1).zip"),
      "an archive the vault made is known, even renamed by the browser");
    t.ok(!V.isArchiveFileName("Ada.png") && !V.isArchiveFileName("rp-card-vault-data 20261021-120000.json"), "nothing else is");
    t.ok(/Restore from archive/.test(V.archiveReadme(Date.now(), true)) && /7-Zip/.test(V.archiveReadme(Date.now(), true)), "the README says how to restore and what opens it");
  }

  t.done();
})().catch((e) => { console.error(e); process.exit(1); });
