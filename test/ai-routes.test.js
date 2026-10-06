/**
 * /__vault/ai/* against a real serve.js and a fake model server.
 *
 *   node test/ai-routes.test.js
 *
 * Covers what the relay is for: the key stays in the server and only ever
 * goes to the saved address, other websites can't drive it, and replies are
 * streamed back as NDJSON — including the awkward ones (thinking only, cut
 * off, silent, cancelled).
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const t = require("./harness");

const ROOT = path.join(__dirname, "..");
const KEY = "sk-test-abcdefghijklmnopqrstuvwxyz0123456789";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const children = [];
process.on("exit", () => { for (const c of children) try { c.kill(); } catch (e) {} });

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

/* ── fake endpoints ─────────────────────────────────────────────────────── */

const seen = { auth: [], bodies: [], closedEarly: 0 };
let mode = "sse";          // sse | json | think | html | slow | silent | fail503 | maxc | bad | tools | toolsjson | notools
let fail503 = 0;

const CHALLENGE = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>';

function upstream() {
  return http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    seen.auth.push(req.headers.authorization || "");
    if (body) seen.bodies.push(body);
    const json = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };

    if (mode === "html") { res.writeHead(403, { "Content-Type": "text/html" }); return res.end(CHALLENGE); }
    if (req.headers.authorization !== "Bearer " + KEY) return json(401, { error: { message: "Incorrect API key provided: " + req.headers.authorization } });
    if (req.url === "/v1/models") return json(200, { data: [{ id: "mock-b" }, { id: "mock-a" }] });
    if (req.url !== "/v1/chat/completions") return json(404, { error: { message: "not found" } });

    if (mode === "fail503" && fail503 > 0) { fail503--; return json(503, { error: { message: "overloaded" } }); }
    if (mode === "maxc" && body.max_tokens !== undefined) {
      return json(400, { error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } });
    }
    if (mode === "bad") return json(400, { error: { message: "model not found: " + body.model } });
    if (mode === "notools" && body.tools) return json(400, { error: { message: "registry.ollama.ai/library/tiny:1b does not support tools" } });
    if (mode === "norole" && body.messages.some((m) => m.role === "tool")) return json(400, { error: { message: "Role 'function' is not supported. Please use a valid role: SYSTEM, SYSTEM_1, USER, ASSISTANT, DEVELOPER, CONTEXT, USER_CONTEXT, MODEL, USER." } });
    const hasImage = (body.messages || []).some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));
    if (mode === "noimages" && hasImage) return json(400, { error: { message: "This model does not support image input." } });
    if (mode === "toolsjson") {
      return json(200, { model: body.model, choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [
        { id: "c9", type: "function", function: { name: "fs_list", arguments: { path: "" } } },
      ] } }] });
    }
    if (mode === "tools") {
      // One call's arguments arrive in pieces, the way OpenAI streams them,
      // interleaved with a second call.
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const tc = (o) => ({ choices: [{ delta: { tool_calls: [o] } }] });
      const chunks = [
        { choices: [{ delta: { content: "Let me look." } }] },
        tc({ index: 0, id: "call_a", type: "function", function: { name: "fs_read", arguments: "" } }),
        tc({ index: 0, function: { arguments: "{\"pa" } }),
        tc({ index: 1, id: "call_b", type: "function", function: { name: "grep_cards", arguments: "{\"q\":\"tea\"}" } }),
        tc({ index: 0, function: { arguments: "th\":\"agent.md\"}" } }),
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ];
      for (const c of chunks) { res.write("data: " + JSON.stringify(c) + "\n\n"); await wait(5); }
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    if (mode === "json") return json(200, { model: body.model, choices: [{ message: { content: "whole answer" }, finish_reason: "stop" }], usage: { total_tokens: 5 } });
    if (mode === "silent") { await wait(8000); return json(200, {}); }

    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const pieces = mode === "think"
      ? [{ delta: { reasoning_content: "hmm " } }, { delta: { reasoning_content: "still thinking" } }, { delta: {}, finish_reason: "length" }]
      : [{ delta: { content: "Hel" } }, { delta: { content: "lo" } }, { delta: {}, finish_reason: "stop" }];
    res.on("close", () => { if (!res.writableEnded) seen.closedEarly++; });
    if (mode === "stall") {
      res.write("data: " + JSON.stringify({ choices: [pieces[0]] }) + "\n\n");
      await wait(8000);
      return res.end();
    }
    for (const p of pieces) {
      if (res.destroyed) return;
      res.write("data: " + JSON.stringify({ model: body.model, choices: [p] }) + "\n\n");
      await wait(mode === "slow" ? 400 : 5);
    }
    if (res.destroyed) return;
    res.write("data: " + JSON.stringify({ choices: [], usage: { total_tokens: 12 } }) + "\n\n");
    res.write("data: [DONE]\n\n");
    res.end();
  });
}

const stolen = [];
function evilServer() {
  return http.createServer((req, res) => {
    stolen.push(req.headers.authorization || "");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"data":[{"id":"x"}]}');
  });
}

/* ── talking to the vault server ────────────────────────────────────────── */

let PORT = 0;
function send(method, p, body, headers, opts) {
  return new Promise((resolve) => {
    const data = Buffer.from(body == null ? "" : typeof body === "string" ? body : JSON.stringify(body));
    const h = Object.assign({ Host: "127.0.0.1:" + PORT, "Content-Length": data.length }, headers);
    const r = http.request({ host: "127.0.0.1", port: PORT, path: p, method, headers: h }, (res) => {
      let txt = "";
      res.on("data", (c) => (txt += c));
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] || "", text: txt }));
      res.on("error", () => resolve({ status: 0, text: txt }));
    });
    r.on("error", () => resolve({ status: 0, text: "" }));
    r.end(data);
    if (opts && opts.abortAfter) setTimeout(() => { r.destroy(); resolve({ status: -1, text: "" }); }, opts.abortAfter);
  });
}
const PAGE = () => ({ "Content-Type": "application/json", "X-Vault": "1", Origin: "http://127.0.0.1:" + PORT });
const post = (p, body) => send("POST", p, body, PAGE());
const json = (r) => { try { return JSON.parse(r.text); } catch (e) { return {}; } };
const events = (r) => r.text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

async function main() {
  const up = upstream();
  await new Promise((r) => up.listen(0, "127.0.0.1", r));
  const UP = "http://127.0.0.1:" + up.address().port + "/v1";
  const evil = evilServer();
  await new Promise((r) => evil.listen(0, "127.0.0.1", r));
  const EVIL = "http://127.0.0.1:" + evil.address().port + "/v1";

  PORT = await freePort();
  // A scratch workspace, so the tests never touch the real agent-workspace/.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vault-ws-test-"));
  const WS = path.join(scratch, "agent-workspace");
  process.on("exit", () => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {} });
  const srv = spawn(process.execPath, ["serve.js", String(PORT), "--no-open"],
    { cwd: ROOT, stdio: "ignore", env: Object.assign({}, process.env, { VAULT_WORKSPACE: WS }) });
  children.push(srv);
  for (let i = 0; i < 50; i++) { await wait(100); if ((await send("GET", "/__vault/status")).status === 200) break; }

  console.log("\nconfiguration");
  {
    let r = await post("/__vault/ai/config", { baseUrl: UP + "/chat/completions", model: "mock-a", apiKey: KEY });
    t.eq(r.status, 200, "the page can save an endpoint and key");
    const d = json(r);
    t.eq([d.baseUrl, d.model, d.hasKey, d.configured], [UP, "mock-a", true, true], "the address is normalised and the key reported as held");
    t.ok(r.text.indexOf(KEY) < 0, "the key itself is never sent back");
    r = await send("GET", "/__vault/ai/config");
    t.ok(r.text.indexOf(KEY) < 0 && json(r).hasKey === true, "nor by a GET");
    t.ok(json(r).build >= 6, "the relay reports its build");
    r = await post("/__vault/ai/config", { baseUrl: "ftp://nope" });
    t.eq(r.status, 400, "a non-http address is refused");
    await post("/__vault/ai/config", { baseUrl: UP, model: "mock-a", apiKey: KEY });
  }

  console.log("\nother websites can't use it");
  {
    const attempts = [
      ["a text/plain POST from another site", "/__vault/ai/test", { "Content-Type": "text/plain", Origin: "https://evil.example" }],
      ["the same with no Origin header", "/__vault/ai/test", { "Content-Type": "text/plain" }],
      ["repointing the address from another site", "/__vault/ai/config", { "Content-Type": "text/plain", Origin: "https://evil.example" }],
      ["DNS rebinding (right header, wrong Host)", "/__vault/ai/config", Object.assign(PAGE(), { Host: "evil.example:" + PORT, Origin: "http://evil.example:" + PORT })],
      ["a chat request with no X-Vault header", "/__vault/ai/chat", { "Content-Type": "application/json" }],
      ["a shutdown request with no X-Vault header", "/__vault/shutdown", {}],
    ];
    for (const [label, p, headers] of attempts) {
      const r = await send("POST", p, { baseUrl: EVIL, messages: [{ role: "user", content: "x" }] }, headers);
      t.eq(r.status, 403, label + " → 403");
    }
    t.eq(json(await send("GET", "/__vault/ai/config")).baseUrl, UP, "the saved address is unchanged");
    t.eq((await send("GET", "/__vault/status")).status, 200, "and the server is still running");
  }

  console.log("\nthe key only goes where it was saved for");
  {
    seen.auth.length = 0;
    let r = await post("/__vault/ai/test", { baseUrl: EVIL });
    t.eq(json(r).ok, true, "test uses the saved address, whatever the request says");
    t.eq(stolen.length, 0, "so a request-supplied address never sees the key");
    t.eq(seen.auth[0], "Bearer " + KEY, "and the real endpoint gets it as a Bearer token");
    r = await post("/__vault/ai/config", { baseUrl: EVIL });
    t.eq(json(r).hasKey, false, "saving a different host forgets the key");
    await post("/__vault/ai/test", {});
    t.eq(stolen.filter(Boolean).length, 0, "and the other host never receives it");
    await post("/__vault/ai/config", { baseUrl: UP, model: "mock-a", apiKey: KEY });
    r = await post("/__vault/ai/config", { apiKey: "" });
    t.eq(json(r).hasKey, false, "apiKey \"\" forgets the key");
    await post("/__vault/ai/config", { apiKey: KEY });
  }

  console.log("\nTest connection");
  {
    mode = "sse";
    let d = json(await post("/__vault/ai/test", {}));
    t.eq([d.ok, d.via, d.models], [true, "models", ["mock-a", "mock-b"]], "lists the endpoint's models");
    mode = "html";
    let r = await post("/__vault/ai/test", {});
    t.ok(r.status >= 400 && !/<html|DOCTYPE/i.test(json(r).error || ""), "a bot-check page is described, not pasted", json(r).error);
    mode = "sse";
    await post("/__vault/ai/config", { apiKey: "sk-wrong-key-0000000000000" });
    r = await post("/__vault/ai/test", {});
    t.eq(r.status, 401, "a wrong key is a 401");
    t.ok(r.text.indexOf("sk-wrong-key-0000000000000") < 0, "and the key the endpoint echoed back is scrubbed", json(r).error);
    await post("/__vault/ai/config", { apiKey: KEY });
  }

  const chat = (extra, opts) => send("POST", "/__vault/ai/chat",
    Object.assign({ messages: [{ role: "system", content: "s" }, { role: "user", content: "hi" }] }, extra || {}), PAGE(), opts);

  console.log("\nchat streams NDJSON");
  {
    mode = "sse";
    seen.bodies.length = 0;
    let r = await chat({ temperature: 0.2, maxTokens: 999999 });
    t.ok(/ndjson/.test(r.type), "the reply is NDJSON");
    let ev = events(r);
    t.eq(ev.filter((e) => e.t === "text").map((e) => e.v).join(""), "Hello", "text arrives as it streams");
    const done = ev[ev.length - 1];
    t.eq([done.t, done.finish, done.textChars], ["done", "stop", 5], "and ends with a done event");
    t.eq(done.usage, { total_tokens: 12 }, "carrying the usage");
    const sent = seen.bodies[seen.bodies.length - 1];
    t.eq([sent.model, sent.stream, sent.temperature, sent.max_tokens], ["mock-a", true, 0.2, 32768], "the saved model, streaming, and clamped settings are sent upstream");

    mode = "json";
    ev = events(await chat());
    t.eq([ev[0].t, ev[0].v, ev[1].t], ["text", "whole answer", "done"], "a server that ignores stream:true still works");

    mode = "think";
    ev = events(await chat());
    const d2 = ev[ev.length - 1];
    t.ok(ev.some((e) => e.t === "think") && !ev.some((e) => e.t === "text"), "reasoning arrives as think events, never as text");
    t.eq([d2.textChars, d2.finish], [0, "length"], "so the page can see the model ran out mid-thought");

    mode = "fail503"; fail503 = 1;
    ev = events(await chat());
    t.eq(ev.filter((e) => e.t === "text").map((e) => e.v).join(""), "Hello", "a 503 is retried once");
    mode = "maxc";
    ev = events(await chat());
    t.eq(ev.filter((e) => e.t === "text").map((e) => e.v).join(""), "Hello", "max_tokens is renamed when the model asks for max_completion_tokens");
    mode = "bad";
    r = await chat();
    t.eq([r.status, /model not found/.test(json(r).error)], [400, true], "an endpoint error before streaming is a plain JSON error");
    r = await send("POST", "/__vault/ai/chat", { messages: [{ role: "user" }] }, PAGE());
    t.eq(r.status, 400, "malformed messages are refused");
  }

  console.log("\ncancelling and silence");
  {
    mode = "slow";
    seen.closedEarly = 0;
    await chat({}, { abortAfter: 500 });
    await wait(900);
    t.eq(seen.closedEarly, 1, "closing the page's request cancels the upstream one");

    mode = "silent";
    let r = await chat({ timeoutMs: 5000 });
    t.ok(r.status >= 400 && /5s/.test(json(r).error || ""), "an endpoint that never answers is dropped after the timeout", r.text.slice(0, 200));
    mode = "stall";
    r = await chat({ timeoutMs: 5000 });
    const ev = events(r);
    t.ok(ev[0].t === "text" && ev[ev.length - 1].t === "error" && /quiet/.test(ev[ev.length - 1].message),
      "one that goes quiet mid-reply ends with an error event, not a silent cut", r.text.slice(0, 200));
  }

  console.log("\ntool calls");
  {
    const TOOLS = [{ type: "function", function: { name: "fs_read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } } }];
    mode = "tools";
    seen.bodies.length = 0;
    let ev = events(await chat({ tools: TOOLS }));
    const sent = seen.bodies[seen.bodies.length - 1];
    t.eq([sent.tools.length, sent.tools[0].function.name, sent.tool_choice], [1, "fs_read", "auto"], "the tools go upstream, with tool_choice auto");
    const calls = ev.filter((e) => e.t === "tool");
    t.eq(calls.map((c) => [c.id, c.name, c.args]),
      [["call_a", "fs_read", "{\"path\":\"agent.md\"}"], ["call_b", "grep_cards", "{\"q\":\"tea\"}"]],
      "calls streamed in pieces arrive whole, in order");
    const done = ev[ev.length - 1];
    t.eq([done.t, done.tools, done.finish], ["done", 2, "tool_calls"], "done counts them");
    t.ok(ev.findIndex((e) => e.t === "tool") > ev.findIndex((e) => e.t === "text"), "any text before the calls is still streamed");

    mode = "toolsjson";
    ev = events(await chat({ tools: TOOLS }));
    t.eq(ev.filter((e) => e.t === "tool").map((c) => [c.id, c.name, c.args]), [["c9", "fs_list", "{\"path\":\"\"}"]],
      "a whole-message reply's calls work too, with object arguments turned into JSON");

    mode = "sse";
    seen.bodies.length = 0;
    const history = [
      { role: "system", content: "s" }, { role: "user", content: "read it" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_a", type: "function", function: { name: "fs_read", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_a", name: "fs_read", content: "file text", extra: "dropped" },
    ];
    let r = await send("POST", "/__vault/ai/chat", { messages: history, tools: TOOLS }, PAGE());
    t.eq(r.status, 200, "a history with a tool call and its result is accepted");
    const fwd = seen.bodies[seen.bodies.length - 1].messages;
    t.eq([fwd[2].content, fwd[2].tool_calls[0].id, fwd[3].tool_call_id, "extra" in fwd[3]], [null, "call_a", "call_a", false],
      "and forwarded with only the fields an endpoint expects");
    r = await send("POST", "/__vault/ai/chat", { messages: [{ role: "tool", content: "x" }] }, PAGE());
    t.eq(r.status, 400, "a tool result that doesn't say which call it answers is refused");
    r = await send("POST", "/__vault/ai/chat", { messages: [{ role: "user", content: "x" }], tools: [{ type: "function" }] }, PAGE());
    t.eq(r.status, 400, "so is a tool with no name");

    mode = "notools";
    r = await chat({ tools: TOOLS });
    t.eq([r.status, json(r).code], [400, "tools_unsupported"], "a model without tool calling is reported as such, so the page can fall back to text");
    mode = "norole";
    r = await send("POST", "/__vault/ai/chat", { messages: history, tools: TOOLS }, PAGE());
    t.eq([r.status, json(r).code], [400, "tools_unsupported"], "so is an endpoint that takes tools but refuses the tool result (\"Role 'function' is not supported\")");
    mode = "bad";
    r = await chat({ tools: TOOLS });
    t.ok(json(r).code === undefined, "while an ordinary error isn't mistaken for that");
    mode = "sse";
  }

  console.log("\nphotos in chat messages");
  {
    const PNG = "data:image/png;base64," + Buffer.alloc(3 * 1024 * 1024, 7).toString("base64");   // ~4 MB of base64
    const withPhoto = (url) => ({ messages: [{ role: "system", content: "s" },
      { role: "user", content: [{ type: "text", text: "What's in this?" }, { type: "image_url", image_url: { url } }] }] });
    mode = "sse";
    seen.bodies.length = 0;
    let r = await send("POST", "/__vault/ai/chat", withPhoto(PNG), PAGE());
    t.eq(r.status, 200, "a message with a photo is accepted, even over the old 4 MB limit");
    const parts = seen.bodies[seen.bodies.length - 1].messages[1].content;
    t.eq([parts[0].type, parts[1].type, parts[1].image_url.url.length], ["text", "image_url", PNG.length], "and forwarded as text and image parts, whole");
    r = await send("POST", "/__vault/ai/chat", withPhoto("https://evil.example/tracker.png"), PAGE());
    t.eq(r.status, 400, "an image that isn't inline data is refused, so the relay never fetches links");
    r = await send("POST", "/__vault/ai/chat", { messages: [{ role: "system", content: [{ type: "text", text: "x" }] }] }, PAGE());
    t.eq(r.status, 400, "only your own messages may carry parts");
    mode = "noimages";
    r = await send("POST", "/__vault/ai/chat", withPhoto("data:image/png;base64,iVBORw0KGgo="), PAGE());
    t.eq([r.status, json(r).code], [400, "images_unsupported"], "a model that can't see photos is reported as such");
    r = await chat();
    t.eq(r.status, 200, "while text-only messages to it still work");
    mode = "sse";
  }

  console.log("\nthe agent workspace");
  {
    const ws = (route, body) => post("/__vault/ws/" + route, body);
    let r = await ws("list", {});
    t.eq(r.status, 200, "listing works");
    t.ok(json(r).entries.some((e) => e.path === "agent.md"), "and the first use created agent.md");
    t.ok(fs.existsSync(path.join(WS, "agent.md")), "in the workspace folder given to the server");

    r = await ws("read", { path: "agent.md" });
    const md = json(r);
    t.ok(/agent\.md/.test(md.text) && /^[0-9a-f]{16}$/.test(md.ver), "reading returns the text and a version");
    t.ok(/tools\/custom\//.test(md.text) && !/listed in tools\/index\.md/.test(md.text) && /reference\//.test(md.text) && /\n## Agent notes\n/.test(md.text) && !/\[list_cards\]/.test(md.text),
      "the starter agent.md mentions tools/custom/ and reference/ (tools/ is only a copy), and keeps the agent's notes to their own section");

    r = await ws("write", { path: "notes/ideas.md", text: "one", ver: null });
    t.eq([r.status, json(r).created], [200, true], "a new file is created, folders and all");
    const v1 = json(r).ver;
    r = await ws("write", { path: "notes/ideas.md", text: "again", ver: null });
    t.eq(r.status, 409, "create-only refuses a file that exists");
    r = await ws("write", { path: "notes/ideas.md", text: "two", ver: v1 });
    t.eq([r.status, fs.readFileSync(path.join(WS, "notes", "ideas.md"), "utf8")], [200, "two"], "a write with the current version lands");

    fs.writeFileSync(path.join(WS, "notes", "ideas.md"), "edited in Notepad");
    r = await ws("write", { path: "notes/ideas.md", text: "three", ver: json(r).ver });
    t.eq(r.status, 409, "a write against a version that changed on disk is refused");
    t.eq(fs.readFileSync(path.join(WS, "notes", "ideas.md"), "utf8"), "edited in Notepad", "so your edit survives");

    const cur = json(await ws("read", { path: "notes/ideas.md" })).ver;
    r = await ws("move", { from: "notes/ideas.md", to: "archive/ideas.md", ver: cur });
    t.eq([r.status, fs.existsSync(path.join(WS, "archive", "ideas.md"))], [200, true], "moving works");
    r = await ws("delete", { path: "archive/ideas.md", ver: "0000000000000000" });
    t.eq(r.status, 409, "deleting needs the current version too");
    r = await ws("delete", { path: "archive/ideas.md", ver: cur });
    t.eq([r.status, fs.existsSync(path.join(WS, "archive", "ideas.md"))], [200, false], "and then deletes");
    r = await ws("mkdir", { path: "drafts/old" });
    t.ok(r.status === 200 && fs.statSync(path.join(WS, "drafts", "old")).isDirectory(), "folders can be made");

    const outside = path.join(scratch, "secret.txt");
    fs.writeFileSync(outside, "outside");
    for (const [label, p] of [["..", "../secret.txt"], ["a nested ..", "notes/../../secret.txt"],
      ["an absolute path", outside], ["a drive letter", "C:/Windows/win.ini"], ["a leading slash", "/etc/passwd"]]) {
      r = await ws("read", { path: p });
      t.ok(r.status === 400 && !/outside/.test(r.text), "a path with " + label + " is refused");
    }
    let linked = false;
    try { fs.symlinkSync(scratch, path.join(WS, "link"), "junction"); linked = true; } catch (e) { /* no link support here */ }
    if (linked) {
      r = await ws("read", { path: "link/secret.txt" });
      t.ok(r.status === 400 && !/outside/.test(r.text), "a link that leads outside the workspace is refused");
    }

    r = await ws("write", { path: "big.txt", text: "x".repeat(1024 * 1024 + 1), ver: null });
    t.eq(r.status, 413, "a file over 1 MB is refused");
    fs.writeFileSync(path.join(WS, "pic.bin"), Buffer.from([137, 80, 78, 71, 0, 0, 1]));
    r = await ws("read", { path: "pic.bin" });
    t.eq(r.status, 400, "a binary file isn't opened as text");
    r = await ws("read", { path: "nope.md" });
    t.eq(r.status, 404, "a missing file is a 404");

    r = await send("POST", "/__vault/ws/write", { path: "evil.md", text: "x", ver: null }, { "Content-Type": "application/json" });
    t.eq([r.status, fs.existsSync(path.join(WS, "evil.md"))], [403, false], "without X-Vault nothing is written");
    r = await send("POST", "/__vault/ws/read", { path: "agent.md" }, Object.assign(PAGE(), { Origin: "https://evil.example" }));
    t.eq(r.status, 403, "and another site can't read the workspace");
  }

  srv.kill(); up.close(); evil.close();
  t.done();
}

main().catch((e) => { console.error("harness error:", e); process.exit(1); });
