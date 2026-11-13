/**
 * Destinations: sending cards to front ends.
 *
 *   node test/destinations.test.js
 *
 * The settings side (old settings becoming destinations) is tested on its own;
 * the upload side runs a real serve.js against fake front ends that check what
 * the real ones check: SillyTavern's CSRF token, session cookie, optional
 * sign-in, "avatar" field and file_type; Lumiverse's sign-in and bearer token;
 * a generic importer's field name and header token.
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { loadPureRegion } = require("./pure-region");
const t = require("./harness");

const ROOT = path.join(__dirname, "..");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
process.on("exit", () => { for (const c of children) try { c.kill(); } catch (e) {} });

const { mod: V } = loadPureRegion(["migrateDestinations", "sanitizeDestination", "defaultDestinationOf", "DEST_KINDS", "DEFAULT_SETTINGS", "destSendStopsRun",
  "SENT_STATES", "sentPatch", "sentMarkOf", "destinationFolderIndex", "destinationStatus", "editAfterSave", "mergeEditRecords"]);

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

/** The raw multipart body as text (enough to find field names and file contents). */
async function bodyOf(req) { let b = ""; for await (const c of req) b += c.toString("latin1"); return b; }
const fieldNames = (b) => Array.from(b.matchAll(/name="([^"]+)"/g)).map((m) => m[1]);

/* A SillyTavern: cookie session, CSRF token per session, optional accounts. */
function fakeSillyTavern(opts) {
  const sessions = new Map();   // sid → { token, user }
  const got = [];
  let n = 0;
  const server = http.createServer(async (req, res) => {
    const sid = ((req.headers.cookie || "").match(/st-session=([^;]+)/) || [])[1];
    let sess = sid && sessions.get(sid);
    const json = (code, o, cookie) => {
      const h = { "Content-Type": "application/json" };
      if (cookie) h["Set-Cookie"] = ["st-session=" + cookie + "; Path=/; HttpOnly", "st-session.sig=x" + cookie + "; Path=/"];
      res.writeHead(code, h); res.end(JSON.stringify(o));
    };
    if (req.url === "/csrf-token") {
      let newSid = null;
      if (!sess) { newSid = "s" + (++n); sess = { token: "", user: "" }; sessions.set(newSid, sess); }
      sess.token = "tok" + (++n);
      return json(200, { token: sess.token }, newSid);
    }
    if (!sess || req.headers["x-csrf-token"] !== sess.token) return json(403, { error: "Invalid CSRF token" });
    if (req.url === "/api/users/login") {
      const b = JSON.parse(await bodyOf(req));
      if (b.handle !== "ann" || b.password !== "pw") return json(403, { error: "Incorrect credentials" });
      sess.user = b.handle;
      return json(200, { handle: b.handle });
    }
    if (opts.accounts && !sess.user) return json(401, { error: "Not signed in" });
    if (req.url === "/api/characters/import" && req.method === "POST") {
      const b = await bodyOf(req);
      const type = (b.match(/name="file_type"\r\n\r\n([^\r]+)/) || [])[1];
      const fname = Buffer.from((b.match(/filename="([^"]*)"/) || [, ""])[1], "latin1").toString("utf8");
      got.push({ fields: fieldNames(b), type, hasCard: b.indexOf("CARD-BYTES") >= 0, user: sess.user, fname });
      if (b.indexOf("BROKEN") >= 0) return json(200, { error: true });
      return json(200, { file_name: "imported_" + got.length });
    }
    return json(404, { error: "nope" });
  });
  return { server, got };
}

/* A Lumiverse: sign in for a bearer token, then import. */
function fakeLumiverse() {
  const got = [];
  const server = http.createServer(async (req, res) => {
    const json = (code, o, extra) => { res.writeHead(code, Object.assign({ "Content-Type": "application/json" }, extra || {})); res.end(JSON.stringify(o)); };
    if (req.url === "/api/auth/sign-in/username") {
      const b = JSON.parse(await bodyOf(req));
      if (b.username !== "ann" || b.password !== "pw") return json(401, { message: "Invalid username or password" });
      return json(200, { token: "lv-token" }, { "set-auth-token": "lv-token" });
    }
    if (req.url === "/api/v1/characters/import") {
      if (req.headers.authorization !== "Bearer lv-token") return json(401, { error: "Unauthorized" });
      const b = await bodyOf(req);
      got.push({ fields: fieldNames(b), hasCard: b.indexOf("CARD-BYTES") >= 0 });
      return json(200, { character: { id: "c1", name: "Ada" } });
    }
    return json(404, {});
  });
  return { server, got };
}

/* Any importer: a field name and a header token. */
function fakeGeneric() {
  const got = [];
  const server = http.createServer(async (req, res) => {
    if (req.headers["x-api-key"] !== "secret") { res.writeHead(401); return res.end("no key"); }
    const b = await bodyOf(req);
    got.push({ path: req.url, fields: fieldNames(b), hasCard: b.indexOf("CARD-BYTES") >= 0 });
    res.writeHead(201, { "Content-Type": "application/json" }); res.end("{}");
  });
  return { server, got };
}

async function main() {
  console.log("\nold settings become destinations");
  {
    let s = V.migrateDestinations(Object.assign({}, V.DEFAULT_SETTINGS, { frontendKey: "r1::characters" }));
    t.ok(s.destinations.length === 1 && s.destinations[0].type === "folder" && s.destinations[0].folderKey === "r1::characters",
      "a front-end folder becomes a folder destination");
    t.eq(s.defaultDestination, s.destinations[0].id, "and is the default");
    t.ok(!("frontendKey" in s) && !("frontendMode" in s), "the old keys are gone");
    s = V.migrateDestinations({ frontendKey: "r1::c", frontendMode: "api", frontendApiUrl: "http://127.0.0.1:7860", frontendApiUser: "ann" });
    t.eq(s.destinations.map((d) => d.type), ["folder", "lumiverse"], "with Lumiverse in use, both become destinations");
    t.ok(s.destinations[1].username === "ann" && s.defaultDestination === s.destinations[1].id, "Lumiverse keeps its username and stays the one in use");
    t.eq(V.migrateDestinations(Object.assign({}, V.DEFAULT_SETTINGS)).destinations, [], "a new vault has none");
    const kept = V.migrateDestinations({ destinations: [{ id: "a", type: "sillytavern", name: "ST", baseUrl: "http://127.0.0.1:8000", folderKey: "x", field: "y" }], defaultDestination: "gone" });
    t.ok(kept.destinations[0].folderKey === "" && kept.destinations[0].field === "", "each destination keeps only its kind's fields");
    t.eq(kept.defaultDestination, "a", "a default that no longer exists falls back to the first");
    t.eq(V.defaultDestinationOf(kept).id, "a", "and that's what Send uses");
    t.eq(V.sanitizeDestination({ type: "nonsense" }).type, "folder", "an unknown kind is a folder");
    t.ok(["folder", "sillytavern", "lumiverse", "http"].every((k) => V.DEST_KINDS[k]), "four kinds: folder, SillyTavern, Lumiverse, any HTTP importer");
  }

  const port = await freePort();
  const st = fakeSillyTavern({}), stAcc = fakeSillyTavern({ accounts: true }), lv = fakeLumiverse(), gen = fakeGeneric();
  const ports = {};
  for (const [k, f] of Object.entries({ st, stAcc, lv, gen })) { ports[k] = await freePort(); await new Promise((r) => f.server.listen(ports[k], "127.0.0.1", r)); }
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "vault-dest-ws-"));
  const child = spawn(process.execPath, [path.join(ROOT, "serve.js"), String(port), "--no-open"],
    { cwd: ROOT, env: Object.assign({}, process.env, { VAULT_WORKSPACE: ws, VAULT_DEST_TIMEOUT_MS: "1500" }), stdio: "ignore" });
  children.push(child);
  const call = (method, p, body, ctype) => new Promise((resolve) => {
    const h = { Host: "127.0.0.1:" + port, "X-Vault": "1", "Sec-Fetch-Site": "same-origin" };
    const data = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    if (data) { h["Content-Type"] = ctype || "application/json"; h["Content-Length"] = data.length; }
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: h }, (res) => {
      let out = ""; res.on("data", (c) => (out += c)); res.on("end", () => { let j = null; try { j = JSON.parse(out); } catch (e) {} resolve({ status: res.statusCode, body: j || out }); });
    });
    req.on("error", (e) => resolve({ status: 0, body: e.message }));
    if (data) req.write(data);
    req.end();
  });
  for (let i = 0; i < 50; i++) { if ((await call("GET", "/__vault/status")).status === 200) break; await wait(100); }
  const card = (txt) => Buffer.from("\x89PNG fake " + (txt || "CARD-BYTES"), "latin1");
  const send = (id, name, bytes) => call("POST", "/__vault/dest/send?id=" + id + "&name=" + encodeURIComponent(name), bytes, "application/octet-stream");

  console.log("\nwhere a card stands with a front end, from what the vault knows itself");
  {
    const rec = (id, dir, sig, fp, lfp) => ({ id: "r:" + id, rootId: "r", dir, rel: (dir ? dir + "/" : "") + id, sig, fp, lfp, ok: true, hasName: true });
    const upload = { id: "d1", type: "lumiverse", name: "Lumiverse" };
    const ada = rec("ada.png", "", "sig-1", "fp-ada", "lfp-ada");

    t.eq(V.destinationStatus(ada, null, upload, null).state, "none", "a card never uploaded: not sent");
    const sent = V.sentPatch(null, "d1", "sig-1", 1000);
    t.eq([sent.sent.d1.at, sent.sent.d1.sigs], [1000, ["sig-1"]], "an upload leaves a mark on the card's record: when, and which file");
    t.eq(V.destinationStatus(ada, sent, upload, null), { state: "sent", at: 1000 }, "that file reads as sent");

    // The question that started this: a copy of the card, reworked. It shares the record (same name,
    // description and first message), but it isn't the file the front end was given.
    const rework = rec("ada rework.png", "", "sig-2", "fp-ada", "lfp-ada");
    t.eq(V.destinationStatus(rework, sent, upload, null).state, "changed", "a reworked copy that shares the card's record doesn't pass for the one that was sent");
    const reworkedMore = rec("ada new.png", "", "sig-3", "fp-other", "lfp-ada");
    t.eq(V.destinationStatus(reworkedMore, null, upload, null).state, "none", "and one reworked into a card of its own (a new description, say) has never been sent");
    const both = V.sentPatch(sent, "d1", "sig-2", 2000);
    t.eq([V.destinationStatus(ada, both, upload, null).state, V.destinationStatus(rework, both, upload, null).state, both.sent.d1.sigs], ["sent", "sent", ["sig-2", "sig-1"]],
      "once the rework is sent too, both read as sent: the mark keeps each file that went");
    t.eq(V.destinationStatus(rec("ada.png", "", "sig-9", "fp-ada", "lfp-ada"), both, upload, null).state, "changed", "a card saved since (its file is a new one) reads as changed since it was sent");
    t.eq(V.destinationStatus(ada, both, { id: "d2", type: "sillytavern" }, null).state, "none", "a mark is one destination's: another has its own");
    let many = null;
    for (let i = 0; i < 12; i++) many = V.sentPatch(many, "d1", "s" + i, i);
    t.eq([many.sent.d1.sigs.length, many.sent.d1.sigs[0]], [8, "s11"], "the mark keeps the latest few files, newest first");

    // A save keeps the mark, and so does a record joined to another.
    const saved = V.editAfterSave(Object.assign({ fields: { description: "x" } }, sent), Object.assign({ fields: { description: "x" } }, sent), "fp-new");
    t.eq(saved.sent, sent.sent, "Save to card carries the mark to the card's new record");
    t.eq(V.mergeEditRecords({ sent: { d2: { at: 5, sigs: ["z"] } } }, sent, "fp", 9).sent, { d1: sent.sent.d1, d2: { at: 5, sigs: ["z"] } }, "two records joined keep both their marks");

    // A folder destination is a linked folder: the index says what's in it, mark or no mark.
    const folder = { id: "d3", type: "folder", name: "SillyTavern folder", folderKey: "r::Frontend" };
    const inFrontend = [rec("ada.png", "Frontend", "sig-1", "fp-ada", "lfp-ada"), rec("old bram.png", "Frontend", "sig-b0", "fp-bram-old", "lfp-bram"), rec("x.png", "Elsewhere", "sig-c", "fp-c", "lfp-c")];
    const idx = V.destinationFolderIndex(inFrontend, "r", "Frontend");
    t.eq(V.destinationStatus(ada, null, folder, idx).state, "there", "a card whose very file is in the folder: in the front end");
    t.eq(V.destinationStatus(rework, null, folder, idx).state, "differs", "the reworked copy: a different version is there");
    t.eq(V.destinationStatus(rec("bram.png", "", "sig-b1", "fp-bram-new", "lfp-bram"), null, folder, idx).state, "differs", "a card with the same name and creator but new text: a different version is there");
    t.eq(V.destinationStatus(rec("x.png", "", "sig-c", "fp-c", "lfp-c"), null, folder, idx).state, "none", "a card that's only in some other folder: not sent");
    t.eq(V.destinationStatus(inFrontend[0], null, folder, idx).state, "home", "the file in the folder itself: the front end's own copy");
    t.eq(V.destinationStatus(rec("cora.png", "", "sig-d", "fp-d", "lfp-d"), V.sentPatch(null, "d3", "sig-d", 7), folder, idx), { state: "gone", at: 7 }, "one that was sent there and isn't any more (removed in the front end): sent before, not there now");
    t.eq(V.destinationStatus(ada, sent, folder, null).state, "none", "with the destination's folder no longer linked, only its own mark counts");
    t.ok(Object.keys(V.SENT_STATES).every((k) => V.SENT_STATES[k].label && V.SENT_STATES[k].color), "every state has its words and its colour");
  }

  console.log("\nSillyTavern");
  {
    let r = await call("POST", "/__vault/dest/connect", { id: "st", type: "sillytavern", baseUrl: "http://127.0.0.1:" + ports.st });
    t.ok(r.status === 200 && r.body.connected, "connecting takes a CSRF token and session, no sign-in needed", JSON.stringify(r.body));
    r = await send("st", "Ada.png", card());
    t.ok(r.status === 200 && r.body.ok && r.body.name === "imported_1", "a card uploads, as its own Import button does", JSON.stringify(r.body));
    t.ok(st.got[0].fields.indexOf("avatar") >= 0 && st.got[0].type === "png" && st.got[0].hasCard, "in the avatar field, with file_type png and the card's bytes");
    r = await send("st", "Bob.json", Buffer.from("{\"CARD-BYTES\":1}"));
    t.eq(st.got[1].type, "json", "a .json card goes as json");
    r = await send("st", "Broken.png", card("BROKEN"));
    t.ok(r.status === 400 && /couldn't import/.test(r.body.error), "SillyTavern's 200 {error:true} is reported as a failure");
    t.ok(!V.destSendStopsRun(r.status, r.body.error), "and the cards after it are still sent");
    // The refusal names the file: a name with "sign" in it ("Assignment") once stopped the whole run.
    r = await send("st", "Assignment Desk.png", card("BROKEN"));
    t.ok(r.status === 400 && !V.destSendStopsRun(r.status, r.body.error), "even when the card's name has \"sign\" in it", JSON.stringify(r.body));
    r = await send("st", "x.txt", Buffer.from("hi"));
    t.ok(r.status === 400 && /can't import \.txt/.test(r.body.error), "files it can't import are refused here");
    r = await send("st", "Long ".repeat(45) + "name.json", Buffer.from("{\"CARD-BYTES\":1}"));
    t.ok(r.status === 200 && st.got[st.got.length - 1].type === "json", "a .json card with a very long file name still goes as json", JSON.stringify(r.body));
    // Shortened on whole characters: an emoji cut in half would arrive as "�".
    r = await send("st", "a".repeat(195) + "\u{1F600}".repeat(5) + ".png", card());
    const fname = st.got[st.got.length - 1].fname;
    t.ok(r.status === 200 && /\.png$/.test(fname) && fname.indexOf("�") < 0 && fname.length <= 200,
      "a long name with an emoji where it's cut is shortened without breaking the emoji", JSON.stringify(fname.slice(190)));

    r = await call("POST", "/__vault/dest/connect", { id: "acc", type: "sillytavern", baseUrl: "http://127.0.0.1:" + ports.stAcc, username: "ann", password: "wrong" });
    t.ok(r.status === 401 && /Sign-in failed/.test(r.body.error), "with accounts on, a wrong password is refused");
    r = await call("POST", "/__vault/dest/connect", { id: "acc", type: "sillytavern", baseUrl: "http://127.0.0.1:" + ports.stAcc, username: "ann", password: "pw" });
    t.ok(r.status === 200 && r.body.user === "ann", "and the right one signs in");
    r = await send("acc", "Ada.png", card());
    t.ok(r.status === 200 && stAcc.got[0].user === "ann", "uploads then go to that user");
  }

  console.log("\nLumiverse");
  {
    let r = await call("POST", "/__vault/dest/connect", { id: "lv", type: "lumiverse", baseUrl: "http://127.0.0.1:" + ports.lv, username: "ann", password: "nope" });
    t.ok(r.status >= 400 && /Sign-in failed/.test(r.body.error), "a wrong password is refused");
    r = await call("POST", "/__vault/dest/connect", { id: "lv", type: "lumiverse", baseUrl: "http://127.0.0.1:" + ports.lv, username: "ann", password: "pw" });
    t.ok(r.status === 200 && r.body.user === "ann", "signing in works");
    r = await send("lv", "Ada.png", card());
    t.ok(r.status === 200 && r.body.name === "Ada" && lv.got[0].fields[0] === "file" && lv.got[0].hasCard, "a card uploads with the bearer token");
  }

  console.log("\nany HTTP importer");
  {
    let r = await call("POST", "/__vault/dest/connect", { id: "gen", type: "http", baseUrl: "http://127.0.0.1:" + ports.gen + "/api/import", field: "card", header: "X-Api-Key", token: "secret" });
    t.eq(r.status, 200, "set up with a field name and a header token");
    r = await send("gen", "Ada.png", card());
    t.ok(r.status === 200 && gen.got[0].path === "/api/import" && gen.got[0].fields[0] === "card" && gen.got[0].hasCard, "the card goes to that address, in that field");
    r = await call("POST", "/__vault/dest/connect", { id: "gen2", type: "http", baseUrl: "http://127.0.0.1:" + ports.gen + "/api/import", header: "Bad Header!", token: "x" });
    t.ok(r.status === 400, "a header name with odd characters is refused");
  }

  console.log("\nthe relay itself");
  {
    let r = await call("GET", "/__vault/dest/list");
    t.eq(r.body.destinations.map((d) => d.id).sort(), ["acc", "gen", "lv", "st"], "the list shows what's connected");
    t.ok(JSON.stringify(r.body).indexOf("pw") < 0 && JSON.stringify(r.body).indexOf("secret") < 0 && JSON.stringify(r.body).indexOf("lv-token") < 0,
      "and never a password, token or cookie");
    r = await send("nobody", "Ada.png", card());
    t.ok(r.status === 401 && /Not connected/.test(r.body.error), "sending to an unconnected destination is refused");
    t.ok(V.destSendStopsRun(r.status, r.body.error), "which stops the rest of the run");
    await call("POST", "/__vault/dest/disconnect", { id: "st" });
    r = await send("st", "Ada.png", card());
    t.eq(r.status, 401, "after Disconnect, sending is refused");
    r = await call("POST", "/__vault/dest/connect", { id: "dead", type: "sillytavern", baseUrl: "http://127.0.0.1:1" });
    t.ok(r.status === 400 && /Couldn't reach http:\/\/127\.0\.0\.1:1/.test(r.body.error), "a front end that isn't running gives a sentence", r.body.error);
    await call("POST", "/__vault/dest/connect", { id: "deadhttp", type: "http", baseUrl: "http://127.0.0.1:1/import" });
    r = await send("deadhttp", "Ada.png", card());
    t.ok(r.status === 400 && /^Couldn't reach /.test(r.body.error) && V.destSendStopsRun(r.status, r.body.error),
      "a front end that stopped running stops the rest of the run too", r.body.error);
    // One that takes the connection and never answers.
    const hang = http.createServer(() => { /* never answers */ });
    await new Promise((res) => hang.listen(0, "127.0.0.1", res));
    const t0 = Date.now();
    r = await call("POST", "/__vault/dest/connect", { id: "hang", type: "lumiverse", baseUrl: "http://127.0.0.1:" + hang.address().port, username: "a", password: "b" });
    t.ok(r.status === 400 && /didn't answer within/.test(r.body.error) && Date.now() - t0 < 10000,
      "a front end that never answers gives up after the deadline, with a sentence", r.body.error);
    hang.closeAllConnections(); hang.close();
    // One that sends the request on to another server: the token header and
    // the sign-in must not follow it there.
    const caught = [];
    const other = http.createServer(async (req, res) => { caught.push(req.headers["x-api-key"] || await bodyOf(req)); res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"token":"t"}'); });
    await new Promise((res) => other.listen(0, "127.0.0.1", res));
    const OTHER = "http://127.0.0.1:" + other.address().port;
    const away = http.createServer((req, res) => { req.resume(); res.writeHead(307, { Location: OTHER + req.url }); res.end(); });
    await new Promise((res) => away.listen(0, "127.0.0.1", res));
    const AWAY = "http://127.0.0.1:" + away.address().port;
    r = await call("POST", "/__vault/dest/connect", { id: "away", type: "http", baseUrl: AWAY + "/api/import", header: "X-Api-Key", token: "secret" });
    r = await send("away", "Ada.png", card());
    t.ok(r.status === 400 && r.body.error.indexOf(OTHER) >= 0, "an importer that redirects to another server is refused, naming it", JSON.stringify(r.body));
    r = await call("POST", "/__vault/dest/connect", { id: "away2", type: "lumiverse", baseUrl: AWAY, username: "ann", password: "pw" });
    t.ok(r.status === 400 && r.body.error.indexOf(OTHER) >= 0, "so is a sign-in", JSON.stringify(r.body));
    t.eq(caught, [], "and that server never sees the token or the password");
    const same = http.createServer((req, res) => {
      if (req.url === "/old") { req.resume(); res.writeHead(308, { Location: "/api/import" }); return res.end(); }
      gen.server.emit("request", req, res);
    });
    await new Promise((res) => same.listen(0, "127.0.0.1", res));
    r = await call("POST", "/__vault/dest/connect", { id: "same", type: "http", baseUrl: "http://127.0.0.1:" + same.address().port + "/old", header: "X-Api-Key", token: "secret" });
    const before = gen.got.length;
    r = await send("same", "Ada.png", card());
    t.ok(r.status === 200 && gen.got.length === before + 1 && gen.got[before].path === "/api/import" && gen.got[before].hasCard,
      "while a redirect on the same server is still followed", JSON.stringify(r.body));
    for (const s of [other, away, same]) { s.closeAllConnections(); s.close(); }
    // Front ends that quote what they were sent back in their refusal: the
    // token or password must not reach the page (or the problem log) that way.
    const echo = http.createServer(async (req, res) => {
      const b = await bodyOf(req);
      const pw = (b.match(/"password":"([^"]*)"/) || [])[1] || "";
      res.writeHead(req.url === "/api/auth/sign-in/username" && pw === "right-pass" ? 200 : 403, { "Content-Type": "application/json", "set-auth-token": "lv-session-77" });
      res.end(JSON.stringify(req.url === "/api/auth/sign-in/username"
        ? (pw === "right-pass" ? { token: "lv-session-77" } : { message: "wrong password " + pw })
        : { error: "refused key " + (req.headers["x-api-key"] || String(req.headers.authorization || "").replace(/^Bearer /, "")) }));
    });
    await new Promise((res) => echo.listen(0, "127.0.0.1", res));
    const ECHO = "http://127.0.0.1:" + echo.address().port;
    await call("POST", "/__vault/dest/connect", { id: "echo", type: "http", baseUrl: ECHO + "/api/import", header: "X-Api-Key", token: "tok-SECRET-9876" });
    r = await send("echo", "Ada.png", card());
    t.ok(r.status === 401 && /refused key \[hidden\]/.test(r.body.error) && r.body.error.indexOf("SECRET") < 0,
      "an importer that quotes the token back doesn't show it", JSON.stringify(r.body));
    r = await call("POST", "/__vault/dest/connect", { id: "echo2", type: "lumiverse", baseUrl: ECHO, username: "ann", password: "hunter2-pass" });
    t.ok(r.status === 401 && /wrong password \[hidden\]/.test(r.body.error) && r.body.error.indexOf("hunter2") < 0,
      "a sign-in that quotes the password back doesn't show it", JSON.stringify(r.body));
    await call("POST", "/__vault/dest/connect", { id: "echo3", type: "lumiverse", baseUrl: ECHO, username: "ann", password: "right-pass" });
    r = await send("echo3", "Ada.png", card());
    t.ok(r.status === 401 && r.body.error.indexOf("lv-session-77") < 0, "nor a session token", JSON.stringify(r.body));
    echo.closeAllConnections(); echo.close();
    r = await call("POST", "/__vault/dest/connect", { id: "x", type: "ftp", baseUrl: "http://a" });
    t.ok(r.status === 400 && /Unknown destination type/.test(r.body.error), "unknown kinds are refused");
  }

  child.kill();
  for (const f of [st, stAcc, lv, gen]) f.server.close();
  fs.rmSync(ws, { recursive: true, force: true });
  t.done();
}

main().catch((e) => { console.error("harness error:", e && e.stack || e); process.exit(1); });
