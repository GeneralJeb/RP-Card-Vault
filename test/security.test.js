/**
 * Attacks on a real serve.js, as someone who wants your API key, your cards,
 * or a foothold on your machine would try them.
 *
 *   node test/security.test.js
 *
 * The attackers are:
 *   - a website open in the same browser. It can make your browser send any
 *     simple request to 127.0.0.1 and link you to any address there, but it
 *     can't read the answers or add custom headers without CORS approval.
 *   - a card file, whose text reaches the AI agent, which can write files.
 *   - the model endpoint itself.
 *
 * Requests here are built by hand, with the headers a browser would send in
 * each situation (Origin, Sec-Fetch-Site), since that's all the server sees.
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const t = require("./harness");

const ROOT = path.join(__dirname, "..");
const KEY = "sk-secret-0123456789abcdefghijklmnop";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const children = [];
process.on("exit", () => { for (const c of children) try { c.kill(); } catch (e) {} });

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

/** One raw request. `path` is sent exactly as given, unnormalised. */
function raw(port, method, p, headers, body) {
  return new Promise((resolve) => {
    const h = Object.assign({ Host: "127.0.0.1:" + port }, headers || {});
    if (body != null) h["Content-Length"] = Buffer.byteLength(body);
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: h, setHost: false }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", (e) => resolve({ status: 0, headers: {}, body: String(e.message) }));
    if (body != null) req.write(body);
    req.end();
  });
}

/* An upstream that answers every call with an error that quotes the
   Authorization header back, as some real providers do. */
function echoUpstream() {
  return http.createServer((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Bad key: " + (req.headers.authorization || "") + " raw " + KEY } }));
  });
}

async function main() {
  const port = await freePort();
  const upPort = await freePort();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sec-ws-"));
  const up = echoUpstream();
  await new Promise((r) => up.listen(upPort, "127.0.0.1", r));
  const child = spawn(process.execPath, [path.join(ROOT, "serve.js"), String(port), "--no-open"],
    { cwd: ROOT, env: Object.assign({}, process.env, { VAULT_WORKSPACE: ws }), stdio: "ignore" });
  children.push(child);
  for (let i = 0; i < 50; i++) { if ((await raw(port, "GET", "/__vault/status")).status === 200) break; await wait(100); }

  const page = { "X-Vault": "1", Origin: "http://127.0.0.1:" + port, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" };
  const post = (p, obj, extra) => raw(port, "POST", p, Object.assign({}, page, extra || {}), JSON.stringify(obj || {}));

  console.log("\na website links you to a crafted address on the vault (reflected script)");
  {
    const r = await raw(port, "GET", "/%3Cscript%3Ealert(document.domain)%3C/script%3E", { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate" });
    t.ok(r.body.indexOf("<script>") < 0, "a script in the address never comes back as markup", r.body.slice(0, 120));
    t.ok(!/text\/html/i.test(r.headers["content-type"] || ""), "the not-found answer isn't a web page at all", r.headers["content-type"]);
    const r2 = await raw(port, "GET", "/x%22%3E%3Cimg%20src=x%20onerror=alert(1)%3E", {});
    t.ok(r2.body.indexOf("<img") < 0, "nor an image tag with a handler");
  }

  console.log("\nonly the app's own files are served");
  {
    fs.writeFileSync(path.join(ws, "evil.html"), "<script>steal()</script>");
    const own = ["/", "/RP_Card_Vault.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/sw.js", "/RP_Card_Vault.ico"];
    for (const p of own) t.eq((await raw(port, "GET", p)).status, 200, "serves " + p);
    for (const f of ["react.production.min.js", "react-dom.production.min.js", "babel.min.js", "jszip.min.js"]) {
      const r = await raw(port, "GET", "/lib/" + f);
      t.ok(r.status === 200 && /^text\/javascript/.test(r.headers["content-type"] || ""), "serves the bundled /lib/" + f + " as a script", r.status);
    }
    for (const p of ["/lib/LICENSES.md", "/lib/", "/lib/../serve.js", "/lib/evil.js"]) t.eq((await raw(port, "GET", p)).status, 404, "but nothing else under lib/: " + p);
    {
      const css = await raw(port, "GET", "/lib/fonts/fonts.css");
      const font = await raw(port, "GET", "/lib/fonts/Outfit-normal-latin.woff2");
      t.ok(css.status === 200 && /^text\/css/.test(css.headers["content-type"] || ""), "serves the fonts' stylesheet as CSS");
      t.ok(font.status === 200 && font.headers["content-type"] === "font/woff2", "and a font as a font");
      for (const p of ["/lib/fonts/OFL-Outfit.txt", "/lib/fonts/", "/lib/fonts/other.woff2"]) t.eq((await raw(port, "GET", p)).status, 404, "but nothing else in lib/fonts: " + p);
    }
    const secret = [
      "/agent-workspace/agent.md", "/serve.js", "/package.json", "/.git/config", "/.git/HEAD",
      "/node_modules/jsdom/package.json", "/test/security.test.js", "/vault.local", "/dev-notes/HANDOFF.md",
      "/README.md", "/Start%20RP%20Card%20Vault.bat", "/.gitignore",
    ];
    for (const p of secret) t.eq((await raw(port, "GET", p)).status, 404, "doesn't serve " + p);
    for (const p of ["/..%2fserve.js", "/%2e%2e/%2e%2e/Windows/win.ini", "/..\\serve.js", "/RP_Card_Vault.html/../serve.js", "/%5c..%5cserve.js", "/RP_Card_Vault.html%00.png"]) {
      const r = await raw(port, "GET", p);
      t.ok(r.status === 404 || r.status === 400 || r.status === 403, "path tricks get nothing: " + p, r.status);
    }
  }

  console.log("\nevery answer carries headers that stop framing, sniffing and embedding");
  {
    for (const p of ["/RP_Card_Vault.html", "/__vault/status", "/nope"]) {
      const h = (await raw(port, "GET", p, { "Sec-Fetch-Site": "same-origin" })).headers;
      t.eq(h["x-content-type-options"], "nosniff", p + ": nosniff");
      t.eq(h["x-frame-options"], "DENY", p + ": can't be framed (clickjacking)");
      t.eq(h["cross-origin-resource-policy"], "same-origin", p + ": other sites can't embed it as an image or script");
    }
    const csp = (await raw(port, "GET", "/RP_Card_Vault.html")).headers["content-security-policy"] || "";
    t.ok(/frame-ancestors 'none'/.test(csp), "the page has a Content-Security-Policy that forbids framing", csp);
    t.ok(/connect-src 'self'/.test(csp) && /img-src 'self' blob: data:/.test(csp), "and keeps its own requests and images on this address, so leaked data can't be sent off by a fetch or an image", csp);
    t.ok(/object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp) && /form-action 'none'/.test(csp), "no plugins, no base-tag tricks, no form posts");
  }

  console.log("\nanother website can't drive the relays");
  {
    const cases = [
      ["no X-Vault (a form post)", { Origin: "http://evil.example", "Content-Type": "text/plain" }],
      ["a foreign Origin", Object.assign({}, page, { Origin: "http://evil.example" })],
      ["Sec-Fetch-Site: cross-site", Object.assign({}, page, { "Sec-Fetch-Site": "cross-site" })],
      ["Sec-Fetch-Site: same-site (another port on 127.0.0.1)", Object.assign({}, page, { "Sec-Fetch-Site": "same-site", Origin: undefined })],
      ["a rebound Host (DNS rebinding)", Object.assign({}, page, { Host: "evil.example:" + port })],
    ];
    for (const [label, h] of cases) {
      const hh = Object.assign({}, h); for (const k of Object.keys(hh)) if (hh[k] === undefined) delete hh[k];
      const r = await raw(port, "POST", "/__vault/ai/config", hh, JSON.stringify({ baseUrl: "http://192.168.1.1/v1" }));
      t.eq(r.status, 403, label + " is refused");
    }
    // A <script src> or <img> from another site sends a GET with no Origin.
    const g = await raw(port, "GET", "/__vault/ai/config", { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "script" });
    t.eq(g.status, 403, "a cross-site GET (a <script src> or <img>) is refused too");
    const sd = await raw(port, "POST", "/__vault/shutdown", { "Content-Type": "text/plain", "Sec-Fetch-Site": "cross-site" }, "");
    t.eq(sd.status, 403, "and so is shutting the server down");
    t.eq((await raw(port, "GET", "/__vault/status")).status, 200, "while the launcher's own probe (no browser headers) still works");
    const cfg = JSON.parse((await raw(port, "GET", "/__vault/ai/config", { "Sec-Fetch-Site": "same-origin" })).body);
    t.ok(!cfg.baseUrl, "none of the refused attempts changed the endpoint", cfg.baseUrl);
  }

  console.log("\nthe API key never comes back out");
  {
    let r = await post("/__vault/ai/config", { baseUrl: "http://127.0.0.1:" + upPort + "/v1", model: "m", apiKey: KEY });
    t.ok(r.status === 200 && r.body.indexOf(KEY) < 0 && JSON.parse(r.body).hasKey === true, "saving it answers hasKey, not the key");
    for (const p of ["/__vault/status", "/__vault/ai/config"]) {
      r = await raw(port, "GET", p, { "Sec-Fetch-Site": "same-origin" });
      t.ok(r.body.indexOf(KEY) < 0 && r.body.indexOf(KEY.slice(3, 15)) < 0, p + " doesn't contain it");
    }
    r = await post("/__vault/ai/test", {});
    t.ok(r.body.indexOf(KEY) < 0 && r.body.indexOf(KEY.slice(3, 15)) < 0, "an endpoint that quotes the key back in an error gets it scrubbed (test)", r.body.slice(0, 160));
    r = await post("/__vault/ai/chat", { messages: [{ role: "user", content: "hi" }] });
    t.ok(r.body.indexOf(KEY) < 0 && r.body.indexOf(KEY.slice(3, 15)) < 0, "and in a chat error", r.body.slice(0, 160));
    r = await post("/__vault/ai/config", { baseUrl: "http://192.168.1.1/v1" });
    t.ok(JSON.parse(r.body).hasKey === false, "pointing the relay at another host forgets the key, so it can't be sent there");
  }

  console.log("\nLocal models only is enforced by the server");
  {
    let r = await post("/__vault/ai/config", { localOnly: true });
    t.ok(r.status === 200 && JSON.parse(r.body).localOnly === true, "the switch reaches the server");
    r = await post("/__vault/ai/config", { baseUrl: "https://api.example.com/v1" });
    t.ok(r.status === 400 && /Local models only is on/.test(r.body), "a remote address is refused while it's on");
    r = await post("/__vault/ai/config", { baseUrl: "http://127.0.0.1:" + upPort + "/v1", model: "m" });
    t.eq(r.status, 200, "an address on this computer is fine");
    await post("/__vault/ai/config", { localOnly: false });
    await post("/__vault/ai/config", { baseUrl: "http://192.168.1.250:9/v1", model: "m" });
    await post("/__vault/ai/config", { localOnly: true });
    r = await post("/__vault/ai/chat", { messages: [{ role: "user", content: "hi" }] });
    t.ok(r.status === 400 && /Local models only is on/.test(r.body), "and a remote address saved before it was turned on isn't used");
    await post("/__vault/ai/config", { localOnly: false, baseUrl: "" });
  }

  console.log("\nthe agent's workspace can't be used to plant files");
  {
    const write = (p, text) => post("/__vault/ws/write", { path: p, text: text || "x", ver: null });
    const bad = [
      "run.bat", "run.cmd", "x.vbs", "x.ps1", "x.exe", "page.html", "page.htm", "x.svg", "x.js", "x.hta", "x.lnk", "x.url",
      "notes/evil.HTML", "agent.md:hidden", "CON", "nul.txt", "COM1.md", "notes/LPT1", "trailing.", "x.bat.", "dir /x.md",
      "../escape.md", "/abs.md", "C:/x.md", "\\\\?\\C:\\x.md", "a/../../x.md",
    ];
    for (const p of bad) {
      const r = await write(p);
      t.ok(r.status >= 400, "refused: " + JSON.stringify(p), r.status + " " + r.body.slice(0, 80));
    }
    const leaked = fs.readdirSync(ws).filter((n) => /\.(bat|cmd|vbs|ps1|exe|html?|svg|js|hta|lnk|url)$/i.test(n));
    t.eq(leaked.filter((n) => n !== "evil.html"), [], "none of them landed in the workspace");
    for (const p of ["notes/ideas.md", "list.txt", "data.json", "table.csv", "README"]) {
      const r = await write(p, "fine");
      t.eq(r.status, 200, "text files are still fine: " + p);
    }
    let r = await post("/__vault/ws/move", { from: "list.txt", to: "list.bat", ver: null });
    const ver = JSON.parse((await post("/__vault/ws/read", { path: "list.txt" })).body).ver;
    r = await post("/__vault/ws/move", { from: "list.txt", to: "list.bat", ver });
    t.ok(r.status >= 400 && !fs.existsSync(path.join(ws, "list.bat")), "and a text file can't be renamed into a program");
  }

  console.log("\nbig or endless requests don't take the server down");
  {
    const big = "x".repeat(6 * 1024 * 1024);
    let r = await raw(port, "POST", "/__vault/ws/write", page, JSON.stringify({ path: "big.md", text: big, ver: null }));
    t.eq(r.status, 413, "a 6 MB workspace write is refused, with a clear answer");
    r = await raw(port, "POST", "/__vault/ai/config", page, "{" + "\"a\":1,".repeat(20000) + "\"b\":2}");
    t.eq(r.status, 413, "an oversized config body is refused the same way");
    const many = await Promise.all(Array.from({ length: 60 }, () => raw(port, "GET", "/__vault/status")));
    t.ok(many.every((x) => x.status === 200), "60 requests at once are all answered");
    t.eq((await raw(port, "GET", "/__vault/status")).status, 200, "and the server is still up");
  }

  console.log("\nthe server only listens on this machine");
  {
    const addrs = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a.address);
    if (!addrs.length) t.skip("another interface", "this machine has no non-loopback IPv4 address");
    for (const a of addrs.slice(0, 2)) {
      const r = await new Promise((resolve) => {
        const req = http.get({ host: a, port, path: "/__vault/status", timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode); });
        req.on("error", () => resolve(0));
        req.on("timeout", () => { req.destroy(); resolve(0); });
      });
      t.eq(r, 0, "nothing answers on " + a + " (your network address)");
    }
  }

  child.kill();
  up.close();
  fs.rmSync(ws, { recursive: true, force: true });
  t.done();
}

main().catch((e) => { console.error("harness error:", e && e.stack || e); process.exit(1); });
