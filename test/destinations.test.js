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

const { mod: V } = loadPureRegion(["migrateDestinations", "sanitizeDestination", "defaultDestinationOf", "DEST_KINDS", "DEFAULT_SETTINGS"]);

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
      got.push({ fields: fieldNames(b), type, hasCard: b.indexOf("CARD-BYTES") >= 0, user: sess.user });
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
    { cwd: ROOT, env: Object.assign({}, process.env, { VAULT_WORKSPACE: ws }), stdio: "ignore" });
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
    r = await send("st", "x.txt", Buffer.from("hi"));
    t.ok(r.status === 400 && /can't import \.txt/.test(r.body.error), "files it can't import are refused here");

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
    await call("POST", "/__vault/dest/disconnect", { id: "st" });
    r = await send("st", "Ada.png", card());
    t.eq(r.status, 401, "after Disconnect, sending is refused");
    r = await call("POST", "/__vault/dest/connect", { id: "dead", type: "sillytavern", baseUrl: "http://127.0.0.1:1" });
    t.ok(r.status === 400 && /Couldn't reach http:\/\/127\.0\.0\.1:1/.test(r.body.error), "a front end that isn't running gives a sentence", r.body.error);
    r = await call("POST", "/__vault/dest/connect", { id: "x", type: "ftp", baseUrl: "http://a" });
    t.ok(r.status === 400 && /Unknown destination type/.test(r.body.error), "unknown kinds are refused");
  }

  child.kill();
  for (const f of [st, stAcc, lv, gen]) f.server.close();
  fs.rmSync(ws, { recursive: true, force: true });
  t.done();
}

main().catch((e) => { console.error("harness error:", e && e.stack || e); process.exit(1); });
