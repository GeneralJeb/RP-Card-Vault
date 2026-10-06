/**
 * serve.js's pure helpers, required as a module (it only starts a server when
 * run directly).
 *
 *   node test/relay-pure.test.js
 */

const S = require("../serve.js");
const t = require("./harness");

const CHALLENGE =
  '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>' +
  '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></head>' +
  '<body>Enable JavaScript and cookies to continue</body></html>';

console.log("\naddresses");
{
  t.eq(S.normalizeAiBase("  http://127.0.0.1:11434/v1/  "), "http://127.0.0.1:11434/v1", "whitespace and trailing slash go");
  t.eq(S.normalizeAiBase("https://openrouter.ai/api/v1/chat/completions"), "https://openrouter.ai/api/v1", "a pasted completions URL is cut back to its base");
  t.eq(S.addressHint("https://openrouter.ai"), "OpenRouter's API address is https://openrouter.ai/api/v1.", "a known provider's website gets its API address suggested");
  t.eq(S.addressHint("https://openrouter.ai/api/v1"), "", "and the right address gets no hint");
  t.ok(/\/v1/.test(S.addressHint("http://127.0.0.1:11434")), "an unknown host without /vN is told about /v1");
  t.eq(S.addressHint("http://127.0.0.1:11434/v1"), "", "one with /v1 is left alone");
}

console.log("\nerror messages");
{
  t.ok(S.looksLikeHtml(CHALLENGE, "text/html"), "a Cloudflare page is recognised as HTML");
  const d = S.describeHtmlBody(CHALLENGE, "https://example.com/v1/models");
  t.ok(!/<html|<!DOCTYPE/i.test(d), "and described in words, not pasted raw");
  t.ok(/bot|browser|challenge|Cloudflare/i.test(d), "naming what it is", d);

  const nf = S.upstreamMessage(404, '{"error":{"message":"not found"}}', "application/json", "https://openrouter.ai/models");
  t.ok(/not found/.test(nf) && /api\/v1/.test(nf), "a 404 carries the endpoint's words plus an address hint", nf);

  const leak = S.upstreamMessage(401, '{"error":{"message":"Incorrect API key provided: sk-abcdefghijklmnop1234"}}', "application/json", "x");
  t.ok(leak.indexOf("sk-abcdefghijklmnop1234") < 0, "a key echoed back by the endpoint is scrubbed", leak);
  t.ok(S.scrubSecret("Authorization: Bearer abc.def-123").indexOf("abc.def-123") < 0, "Bearer tokens are scrubbed");
}

console.log("\nreading a reply chunk");
{
  const c = S.readChoice({ model: "m", choices: [{ delta: { content: "Hi" }, finish_reason: null }] });
  t.eq([c.text, c.think, c.model], ["Hi", "", "m"], "a content delta is text");
  const r = S.readChoice({ choices: [{ delta: { reasoning_content: "hmm" } }] });
  t.eq([r.text, r.think], ["", "hmm"], "reasoning_content is thinking, never text");
  const r2 = S.readChoice({ choices: [{ message: { content: "", reasoning: "plan" }, finish_reason: "length" }] });
  t.eq([r2.text, r2.think, r2.finish], ["", "plan", "length"], "so is `reasoning`, and the finish reason is kept");
  const parts = S.readChoice({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] });
  t.eq(parts.text, "ab", "content given as parts is joined");
  t.eq(S.readChoice({ error: { message: "boom" } }).error, "boom", "an in-band error is reported");
}

console.log("\nSSE parsing");
{
  const got = [];
  const p = S.sseParser((d) => got.push(d));
  const ev = (o) => "data: " + JSON.stringify(o) + "\n\n";
  const stream = ev({ choices: [{ delta: { content: "Hel" } }] }) + ev({ choices: [{ delta: { content: "lo" } }] }) +
    ev({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { total_tokens: 9 } }) + "data: [DONE]\n\n";
  // Feed it in awkward pieces: events split mid-line must still parse.
  for (let i = 0; i < stream.length; i += 7) p.feed(stream.slice(i, i + 7));
  p.end();
  t.eq(got.map((g) => g.text).join(""), "Hello", "text split across chunks reassembles");
  t.eq(got[got.length - 1].finish, "stop", "the finish reason arrives");
  t.eq(got[got.length - 1].usage, { total_tokens: 9 }, "and the usage");
  const got2 = [];
  const p2 = S.sseParser((d) => got2.push(d));
  p2.feed(": keep-alive\r\n\r\ndata: not json\r\n\r\n" + ev({ choices: [{ delta: { content: "ok" } }] }).replace(/\n/g, "\r\n"));
  p2.end();
  t.eq(got2.map((g) => g.text), ["ok"], "comments and junk lines are skipped; CRLF works");
}

console.log("\nwho may use /__vault/");
{
  const own = "127.0.0.1:8790";
  const req = (method, headers) => ({ method, headers: Object.assign({ host: own }, headers) });
  t.eq(S.vaultGuard(req("GET", {})), "", "a GET from the page is allowed");
  t.eq(S.vaultGuard(req("POST", { "x-vault": "1", origin: "http://127.0.0.1:8790" })), "", "a POST with the header from the page's origin is allowed");
  t.ok(S.vaultGuard(req("POST", { origin: "http://127.0.0.1:8790" })), "a POST without X-Vault is refused (a form or no-cors fetch can't add it)");
  t.ok(S.vaultGuard(req("POST", { "x-vault": "1", origin: "https://evil.example" })), "a foreign Origin is refused");
  t.ok(S.vaultGuard({ method: "GET", headers: { host: "evil.example:8790" } }), "a foreign Host is refused (DNS rebinding)");
  t.eq(S.vaultGuard(req("POST", { "x-vault": "1", host: "localhost:8790", origin: "http://localhost:8790" })), "", "localhost works as well as 127.0.0.1");
}

console.log("\nlimits");
{
  t.eq(S.numIn("abc", S.AI_LIMITS.maxTokens), S.AI_LIMITS.maxTokens.def, "junk falls back to the default");
  t.eq(S.numIn(999999, S.AI_LIMITS.maxTokens), S.AI_LIMITS.maxTokens.max, "and big numbers are capped");
  t.ok(S.RELAY_BUILD >= 7, "the relay reports build 7 or later");
}

console.log("\ntool calls");
{
  const piece = S.readChoice({ choices: [{ delta: { tool_calls: [{ index: 1, id: "c1", function: { name: "fs_read", arguments: "{\"pa" } }] } }] });
  t.eq(piece.tools, [{ index: 1, id: "c1", name: "fs_read", args: "{\"pa" }], "a streamed piece keeps its index, id, name and argument chunk");
  const whole = S.readChoice({ choices: [{ message: { content: null, tool_calls: [{ id: "c2", function: { name: "x", arguments: { a: 1 } } }] } }] });
  t.eq(whole.tools, [{ index: 0, id: "c2", name: "x", args: "{\"a\":1}" }], "a whole call with object arguments is turned into JSON text");
  const legacy = S.readChoice({ choices: [{ message: { function_call: { name: "old", arguments: "{}" } } }] });
  t.eq(legacy.tools.map((c) => c.name), ["old"], "the older function_call form is read too");
  t.eq(S.readChoice({ choices: [{ delta: { content: "hi" } }] }).tools, [], "plain text has no calls");

  for (const m of ["registry.ollama.ai/library/tiny does not support tools", "This model doesn't support tool calling",
    "tools is not supported", "tools param requires --jinja flag", "Unsupported parameter: 'tools'",
    "Role 'function' is not supported. Please use a valid role: SYSTEM, SYSTEM_1, USER, ASSISTANT, DEVELOPER, CONTEXT, USER_CONTEXT, MODEL, USER.",
    "role 'tool' is not supported", "Invalid role: tool"]) {
    t.ok(S.saysToolsUnsupported(m), "\"" + m + "\" means no tool support");
  }
  for (const m of ["tool_call_id call_9 not found in history", "Invalid tool: arguments must be JSON", "model not found",
    "Role 'system' is not supported"]) {
    t.ok(!S.saysToolsUnsupported(m), "\"" + m + "\" doesn't");
  }

  t.eq(S.cleanMessages([{ role: "assistant", content: "", tool_calls: [{ id: "a", function: { name: "f", arguments: "{}" } }] }])[0].content, null,
    "an assistant turn that only calls tools is sent with null content");
  let threw = "";
  try { S.cleanMessages([{ role: "robot", content: "x" }]); } catch (e) { threw = e.message; }
  t.ok(/role/.test(threw), "an unknown role is refused", threw);
  t.eq(S.cleanTools([]), null, "an empty tool list means no tools");

  for (const m of ["This model does not support image input.", "Model doesn't support vision", "image_url is not supported for this model",
    "Unsupported content type: image_url", "model is not multimodal"]) {
    t.ok(S.saysImagesUnsupported(m), "\"" + m + "\" means no photos");
  }
  for (const m of ["image too large", "Invalid base64 image data", "model not found"]) t.ok(!S.saysImagesUnsupported(m), "\"" + m + "\" doesn't");
  t.eq(S.RELAY_BUILD >= 8, true, "photos need build 8");
}

console.log("\nwhat the page is told about an error");
{
  t.eq(S.errorText(new Error("That request is too big.")), "That request is too big.", "an error's message, as it is");
  const quiet = console.error;
  console.error = () => {};
  try {
    const odd = { toString() { return "Error: secret at C:\\Users\\Jeb\\serve.js:12:3"; }, stack: "at C:\\Users\\Jeb\\serve.js:12:3" };
    t.ok(!/Users|serve\.js/.test(S.errorText(odd)) && /unexpected error/.test(S.errorText(odd)),
      "one without a message gives a plain sentence, never the error turned into text (which can carry its stack)");
    t.ok(/unexpected error/.test(S.errorText(undefined)) && /unexpected error/.test(S.errorText("a string")), "and so does a thrown non-error");
  } finally { console.error = quiet; }
}

t.done();
