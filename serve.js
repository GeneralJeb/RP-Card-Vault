/**
 * Minimal static server for RP Card Vault.
 *
 * ---------------------------------------------------------------------------
 * DO NOT DOUBLE-CLICK THIS FILE ON WINDOWS.
 *
 * Windows associates .js with Windows Script Host, not Node. WSH tries to read
 * this as JScript — an ES3 dialect with no `const`, no arrow functions and no
 * async — and fails on the first line of real code with:
 *
 *     Windows Script Host
 *     Error:  Syntax error
 *     Code:   800A03EA
 *     Source: Microsoft JScript compilation error
 *
 * Nothing is wrong with the file; the wrong program opened it. Run one of these
 * instead:
 *
 *     Start RP Card Vault.bat     console window, shows what the server prints
 *     RP Card Vault.vbs           no console window - what the shortcuts use
 *     node serve.js 8790          from a terminal in this folder
 * ---------------------------------------------------------------------------
 *
 * Chrome refuses the File System Access API and IndexedDB to pages opened as
 * file://, so the vault has to come from an http:// origin. This serves the
 * app's own files (nothing else in its folder). Pure Node core modules — no
 * npm install.
 *
 *   node serve.js            → http://127.0.0.1:8790/RP_Card_Vault.html
 *   node serve.js 9000       → same, on port 9000
 *
 * Keep using the SAME port every time: the vault's tags, notes and folder
 * permissions are stored per-origin, so switching ports looks like a fresh vault.
 *
 * Beyond static files it exposes two relays, both of which keep their secrets
 * in this process's memory and never on disk:
 *   /__vault/dest/*                destinations: send cards to a front end's import API
 *   /__vault/ai/*                  OpenAI-compatible AI endpoint relay
 */

/* Node 20 or newer: the destinations and the AI relay use its built-in fetch,
   FormData and File. On older Node the server would start and then fail on
   the first upload with a confusing error, so it says so up front. Kept to
   syntax any Node can parse, so the message shows even on a very old one. */
var NODE_MIN = 20;
function nodeTooOld(version) {
  var major = Number(String(version || "").replace(/^v/, "").split(".")[0]);
  return !(major >= NODE_MIN);
}
if (require.main === module && nodeTooOld(process.version)) {
  console.error("");
  console.error("  RP Card Vault needs Node.js " + NODE_MIN + " or newer; this is Node " + process.version + ".");
  console.error("  Get the current LTS from https://nodejs.org (or put a portable node.exe in a");
  console.error("  folder named node next to serve.js).");
  console.error("");
  process.exit(1);
}

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

/**
 * Bump RELAY_BUILD whenever this file changes in a way the page can notice.
 *
 * The page carries the build it expects and complains if the relay answering it
 * is older. That matters because the launcher can leave a *hidden* node running:
 * you edit this file, reload the page, and every request is still served by the
 * copy from twenty minutes ago — with no way to tell from the browser. Asking
 * "which serve.js is actually answering?" should not require guesswork.
 */
const RELAY_BUILD = 10;            // 7: tool calls and the /__vault/ws/* workspace; 8: photos in chat messages; 9: Local models only, OpenRouter no-training; 10: destinations (/__vault/dest/*)
const VAULT_VERSION = "1.2.1";      // the release; the page and package.json carry the same
const STARTED_AT = Date.now();   // so "is this the one I just started?" is answerable

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 8790;
const HOST = "127.0.0.1";
const MAIN = "RP_Card_Vault.html";

/* Content types for the files in STATIC_FILES, the only ones served. */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let over = false;
    req.on("data", (c) => {
      if (over) return;   // drain the rest, so the refusal can still be sent
      total += c.length;
      if (total > (limit || 64 * 1024 * 1024)) {
        over = true;
        chunks.length = 0;
        const e = new Error("That request is too big.");
        e.status = 413;
        reject(e);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

/* ══════════════════════════════════════════════════════════════════════
   Destinations: sending cards to a front end — /__vault/dest/*

   Folder destinations (SillyTavern's characters folder, say) are written by
   the page itself. The ones here are front ends with an import API, which
   the browser can't call directly (another port is another origin, and the
   session wouldn't ride along), so the page posts here and this process
   forwards the card:

     lumiverse    signs in (BetterAuth), then /api/v1/characters/import
     sillytavern  takes a CSRF token and session (and signs in when it has
                  user accounts), then /api/characters/import: the same call
                  its own Import button makes
     http         any import endpoint: a multipart POST of the file, with an
                  optional header (an API token, say)

   Sign-ins and tokens live in memory only, per destination, for as long as
   this window is open. Passwords are never written anywhere.

     POST dest/connect     { id, type, baseUrl, username?, password?, field?, header?, token? }
     POST dest/send?id=&name=   the card file's bytes
     POST dest/disconnect  { id }
     GET  dest/list        [{ id, type, baseUrl, user, connected }]
   ══════════════════════════════════════════════════════════════════════ */

const destinations = new Map();   // id → { type, baseUrl, user, ... what it needs to send }

const DEST_TYPES = ["lumiverse", "sillytavern", "http"];

function normalizeBase(u) {
  return String(u || "").trim().replace(/\/+$/, "");
}

/** Every Set-Cookie of a response, as "name=value" pairs. */
function cookiesOf(r) {
  const list = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie()
    : String(r.headers.get("set-cookie") || "").split(/,(?=\s*[^;,=\s]+=)/);
  return list.map((c) => String(c).split(";")[0].trim()).filter((c) => c.indexOf("=") > 0);
}

/** Merge cookie pairs, later ones replacing earlier ones of the same name. */
function mergeCookies(a, b) {
  const m = new Map();
  for (const c of (a || []).concat(b || [])) m.set(c.slice(0, c.indexOf("=")), c);
  return Array.from(m.values());
}

async function readUpstream(r) {
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { text, data };
}

function upstreamError(prefix, r, u) {
  const msg = (u.data && (u.data.error || u.data.message)) || u.text.slice(0, 200) || ("HTTP " + r.status);
  const e = new Error(prefix + (typeof msg === "string" ? msg : JSON.stringify(msg)));
  e.status = r.status === 401 || r.status === 403 ? 401 : 400;
  return e;
}

function fileFor(name, buf) {
  const type = /\.json$/i.test(name) ? "application/json"
    : /\.charx$/i.test(name) ? "application/zip" : "image/png";
  return new File([buf], name, { type });
}

/* ── Lumiverse ── */

async function lumiverseConnect(d, body) {
  const r = await fetch(d.baseUrl + "/api/auth/sign-in/username", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: body.username, password: body.password }),
  });
  const u = await readUpstream(r);
  if (!r.ok) throw upstreamError("Sign-in failed: ", r, u);
  // BetterAuth's bearer plugin returns the session token in this header;
  // fall back to the JSON body, and finally to the session cookie.
  let token = r.headers.get("set-auth-token") || (u.data && (u.data.token || (u.data.session && u.data.session.token))) || "";
  if (!token) {
    const c = cookiesOf(r).filter((x) => /session/i.test(x.split("=")[0]))[0];
    if (c) token = "cookie:" + c;
  }
  if (!token) throw userError("Signed in, but no session token came back — is this a Lumiverse server?");
  d.token = token;
  d.user = String(body.username || "");
}

async function lumiverseSend(d, name, buf) {
  const fd = new FormData();
  fd.append("file", fileFor(name, buf), name);
  const headers = d.token.startsWith("cookie:") ? { Cookie: d.token.slice(7) } : { Authorization: "Bearer " + d.token };
  const r = await fetch(d.baseUrl + "/api/v1/characters/import", { method: "POST", headers, body: fd });
  const u = await readUpstream(r);
  if (!r.ok) throw upstreamError("", r, u);
  const ch = u.data && u.data.character;
  return { name: (ch && ch.name) || name };
}

/* ── SillyTavern ── */

async function sillyTavernCsrf(d) {
  const r = await fetch(d.baseUrl + "/csrf-token", { headers: d.cookies.length ? { Cookie: d.cookies.join("; ") } : {} });
  const u = await readUpstream(r);
  if (!r.ok || !u.data || !u.data.token) {
    throw upstreamError("SillyTavern didn't give a session" + (r.status === 403 ? " (is this computer allowed in its whitelist?)" : "") + ": ", r, u);
  }
  d.cookies = mergeCookies(d.cookies, cookiesOf(r));
  d.csrf = u.data.token;
}

async function sillyTavernConnect(d, body) {
  d.cookies = [];
  await sillyTavernCsrf(d);
  // With user accounts on, SillyTavern needs a sign-in; without, a handle is
  // simply not needed.
  if (String(body.username || "").trim()) {
    const r = await fetch(d.baseUrl + "/api/users/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": d.csrf, Cookie: d.cookies.join("; ") },
      body: JSON.stringify({ handle: String(body.username).trim(), password: String(body.password || "") }),
    });
    const u = await readUpstream(r);
    if (!r.ok) throw upstreamError("Sign-in failed: ", r, u);
    d.cookies = mergeCookies(d.cookies, cookiesOf(r));
    d.user = String(body.username).trim();
    await sillyTavernCsrf(d);   // a fresh token for the signed-in session
  }
}

async function sillyTavernSend(d, name, buf) {
  const ext = (String(name).match(/\.([a-z0-9]+)$/i) || [, "png"])[1].toLowerCase();
  const fileType = ext === "apng" ? "png" : ext;
  if (["png", "json", "charx"].indexOf(fileType) < 0) throw userError("SillyTavern can't import ." + ext + " files.");
  const send = async () => {
    const fd = new FormData();
    fd.append("avatar", fileFor(name, buf), name);
    fd.append("file_type", fileType);
    return fetch(d.baseUrl + "/api/characters/import", {
      method: "POST", headers: { "X-CSRF-Token": d.csrf, Cookie: d.cookies.join("; ") }, body: fd,
    });
  };
  let r = await send();
  // A session that expired gets one fresh token and one more try.
  if (r.status === 403) { await sillyTavernCsrf(d); r = await send(); }
  const u = await readUpstream(r);
  if (!r.ok) throw upstreamError("", r, u);
  // SillyTavern answers 200 { error: true } when it can't read the card.
  if (u.data && u.data.error) throw userError("SillyTavern couldn't import " + name + " (see its console for why).");
  return { name: (u.data && u.data.file_name) || name };
}

/* ── any HTTP import endpoint ── */

async function httpConnect(d, body) {
  d.field = String(body.field || "file").trim() || "file";
  d.header = String(body.header || "").trim();
  d.token = String(body.token || "");
  if (d.header && !/^[A-Za-z0-9-]+$/.test(d.header)) throw userError("The header name can only have letters, digits and dashes.");
}

async function httpSend(d, name, buf) {
  const fd = new FormData();
  fd.append(d.field, fileFor(name, buf), name);
  const headers = d.header ? { [d.header]: d.token } : {};
  const r = await fetch(d.baseUrl, { method: "POST", headers, body: fd });
  const u = await readUpstream(r);
  if (!r.ok) throw upstreamError("", r, u);
  return { name };
}

const DEST_IMPL = {
  lumiverse: { connect: lumiverseConnect, send: lumiverseSend },
  sillytavern: { connect: sillyTavernConnect, send: sillyTavernSend },
  http: { connect: httpConnect, send: httpSend },
};

function destPublic(id, d) {
  return { id, type: d.type, baseUrl: d.baseUrl, user: d.user || "", connected: true, at: d.at };
}

async function destConnect(body) {
  const id = String(body.id || "").trim();
  const type = String(body.type || "");
  if (!id || id.length > 80) throw userError("Give the destination an id.");
  if (DEST_TYPES.indexOf(type) < 0) throw userError("Unknown destination type " + JSON.stringify(type) + ".");
  const baseUrl = normalizeBase(body.baseUrl);
  if (!/^https?:\/\/[^/]+/i.test(baseUrl)) throw userError("The address must start with http:// or https://");
  const d = { type, baseUrl, user: "", at: Date.now() };
  await DEST_IMPL[type].connect(d, body);
  destinations.set(id, d);
  return destPublic(id, d);
}

async function destSend(id, name, buf) {
  const d = destinations.get(id);
  if (!d) throw userError("Not connected to that destination. Connect it in Settings → Destinations first.", 401);
  return Object.assign({ ok: true }, await DEST_IMPL[d.type].send(d, name, buf));
}

/* ══════════════════════════════════════════════════════════════════════
   AI relay — /__vault/ai/*

   The page never talks to a model itself. This process holds the connection
   (address, model, API key) in memory only and forwards to that one address.
   Local model servers send no CORS headers, so a page couldn't call them
   directly anyway.

     GET  ai/config   saved address and model; whether a key is held
     POST ai/config   { baseUrl?, model?, apiKey? }   apiKey "" forgets it
     POST ai/test     checks the saved connection; takes no parameters
     POST ai/chat     { messages, maxTokens?, temperature?, timeoutMs? }
                      replies with NDJSON, one event per line:
                        {t:"text",v}  {t:"think",v}  {t:"done",...}  {t:"error",message}

   The key is only ever sent to the saved address. No route takes an address
   from a request and pairs it with the saved key, and saving an address on a
   different host forgets the key.
   ══════════════════════════════════════════════════════════════════════ */

const AI_LIMITS = {
  temperature: { min: 0, max: 2, def: 0.7 },
  maxTokens:   { min: 16, max: 32768, def: 1024 },
  timeoutMs:   { min: 5000, max: 600000, def: 90000 },
};

/*
 * localOnly: only addresses on this computer may be used, checked here as
 * well as in the page. noTrain: OpenRouter is asked to route only to
 * providers that don't log or train on prompts (its data_collection: deny).
 */
const ai = { baseUrl: "", model: "", key: "", localOnly: false, noTrain: true };

/** True for an address on this computer itself: localhost, 127.x, ::1. */
function isLoopbackUrl(u) {
  let h = "";
  try { h = new URL(u).hostname.toLowerCase().replace(/^\[|\]$/g, ""); } catch (e) { return false; }
  return h === "localhost" || /\.localhost$/.test(h) || /^127\./.test(h) || h === "::1";
}

/** Refuse a remote address while Local models only is on. */
function checkLocalOnly(base) {
  if (ai.localOnly && base && !isLoopbackUrl(base)) {
    throw userError("Local models only is on, and " + originOf(base) + " isn't on this computer. Turn it off in the ✦ AI panel to use a remote service.");
  }
}

function isOpenRouter(base) {
  try { return /(^|\.)openrouter\.ai$/i.test(new URL(base).hostname); } catch (e) { return false; }
}

const AI_UA = "RP-Card-Vault/2 (local relay)";

function numIn(v, spec) {
  const n = Number(v);
  if (!isFinite(n)) return spec.def;
  return Math.min(spec.max, Math.max(spec.min, n));
}

function userError(message, status) {
  const e = new Error(message);
  e.status = status || 400;
  return e;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Trim what people paste: whitespace, trailing slashes, a full /chat/completions URL. */
function normalizeAiBase(u) {
  let s = String(u || "").trim().replace(/\s+/g, "").replace(/\/+$/, "");
  const i = s.toLowerCase().indexOf("/chat/completions");
  if (i > 0) s = s.slice(0, i);
  return s.replace(/\/+$/, "");
}

function originOf(u) {
  try { return new URL(u).origin; } catch (e) { return ""; }
}

/* Where well-known providers keep their API. Used only to word an error —
   nothing is ever sent to these addresses unless you save one yourself. */
const API_BASE_HINTS = [
  { host: /(^|\.)openrouter\.ai$/i, base: "https://openrouter.ai/api/v1",    label: "OpenRouter" },
  { host: /(^|\.)groq\.com$/i,      base: "https://api.groq.com/openai/v1",  label: "Groq" },
  { host: /(^|\.)openai\.com$/i,    base: "https://api.openai.com/v1",       label: "OpenAI" },
  { host: /(^|\.)together\.xyz$/i,  base: "https://api.together.xyz/v1",     label: "Together AI" },
  { host: /(^|\.)mistral\.ai$/i,    base: "https://api.mistral.ai/v1",       label: "Mistral" },
  { host: /(^|\.)deepseek\.com$/i,  base: "https://api.deepseek.com/v1",     label: "DeepSeek" },
  { host: /(^|\.)anthropic\.com$/i, base: "https://api.anthropic.com/v1",    label: "Anthropic" },
  { host: /(^|\.)x\.ai$/i,          base: "https://api.x.ai/v1",             label: "xAI" },
];

/** A sentence suggesting the right address, or "" if there's nothing to suggest. */
function addressHint(base) {
  let u;
  try { u = new URL(base); } catch (e) { return ""; }
  const clean = normalizeAiBase(base);
  for (const h of API_BASE_HINTS) {
    if (h.host.test(u.hostname)) return clean === h.base ? "" : h.label + "'s API address is " + h.base + ".";
  }
  if (!/\/v\d+$/i.test(u.pathname)) {
    return "Most servers expect the address to end in /v1 — for example " + u.origin + "/v1.";
  }
  return "";
}

/** What the page may know. Never the key. */
function aiPublic() {
  return {
    available: true, build: RELAY_BUILD, version: VAULT_VERSION,
    configured: !!(ai.baseUrl && ai.model),
    baseUrl: ai.baseUrl, model: ai.model, hasKey: !!ai.key,
    localOnly: ai.localOnly, noTrain: ai.noTrain,
  };
}

/** Never let a key echo back through an error string. */
function scrubSecret(text) {
  let s = String(text == null ? "" : text);
  if (ai.key && ai.key.length >= 6) s = s.split(ai.key).join("[key]");
  return s
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[key]")
    .replace(/(sk-[A-Za-z0-9]{2})[A-Za-z0-9._-]{6,}/g, "$1[key]");
}

function upstreamHeaders(accept) {
  const h = {
    "Content-Type": "application/json",
    "Accept": accept || "application/json",
    // Node's default "User-Agent: node" is enough to draw a bot check.
    "User-Agent": AI_UA,
  };
  if (ai.key) h.Authorization = "Bearer " + ai.key;
  let host = "";
  try { host = new URL(ai.baseUrl).hostname; } catch (e) { /* no address yet */ }
  if (/(^|\.)openrouter\.ai$/i.test(host)) {
    // OpenRouter's documented client identification. Carries nothing about you.
    h["HTTP-Referer"] = "http://127.0.0.1/";
    h["X-Title"] = "RP Card Vault";
  }
  return h;
}

function looksLikeHtml(text, contentType) {
  if (/text\/html/i.test(String(contentType || ""))) return true;
  const head = String(text == null ? "" : text).slice(0, 500).trim().toLowerCase();
  return head.indexOf("<!doctype html") === 0 || head.indexOf("<html") === 0 ||
    (head.indexOf("<head") >= 0 && head.indexOf("<title") >= 0);
}

/** One sentence in place of a web page that arrived where JSON was expected. */
function describeHtmlBody(text, url) {
  const t = String(text == null ? "" : text);
  const m = t.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = m ? ' ("' + m[1].replace(/\s+/g, " ").trim().slice(0, 80) + '")' : "";
  const challenge = /just a moment|cf[-_]browser[-_]verification|challenge-platform|cf-chl|enable javascript and cookies|attention required/i.test(t);
  const base = String(url || "").replace(/\/(models|chat\/completions)$/, "");
  const hint = addressHint(base);
  return url + " answered with " + (challenge ? "a Cloudflare browser check" : "a web page") + title +
    ", not an API response. " +
    (hint || (challenge
      ? "If the address is right, this endpoint refuses non-browser traffic."
      : "The address should be the API's base — the part before /chat/completions."));
}

/** The most useful sentence from an error response. */
function upstreamMessage(status, text, contentType, url) {
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  const msg = data && ((data.error && (data.error.message || data.error)) ||
    data.message || data.detail || data.error_message);
  let out;
  if (typeof msg === "string" && msg.trim()) out = msg.trim();
  else if (looksLikeHtml(text, contentType)) return scrubSecret(describeHtmlBody(text, url));
  else out = String(text == null ? "" : text).trim().slice(0, 300) || ("HTTP " + status);
  if (status === 404) {
    const hint = addressHint(String(url || "").replace(/\/(models|chat\/completions)$/, ""));
    if (hint) out += " " + hint;
  }
  return scrubSecret(out);
}

function contentText(c) {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((p) => (typeof p === "string" ? p : (p && (p.text || p.content)) || "")).join("");
  }
  return "";
}

/**
 * Normalise one response object or stream chunk. Providers differ on where
 * the answer lives (content as a string or a list of parts, legacy
 * choice.text) and on where a reasoning model puts its thinking
 * (reasoning_content, reasoning). Thinking is kept separate from the answer.
 *
 * Tool calls come back as `tools`: pieces keyed by `index`. A streamed call
 * arrives as several pieces (id and name first, then the arguments in
 * chunks), and aiChat joins them; a whole message has each call complete.
 */
function readChoice(d) {
  const out = { text: "", think: "", finish: "", usage: null, model: "", error: "", tools: [] };
  if (!d || typeof d !== "object") return out;
  if (d.error) {
    out.error = typeof d.error === "string" ? d.error : (d.error.message || JSON.stringify(d.error));
    return out;
  }
  const c = (Array.isArray(d.choices) && d.choices[0]) || null;
  if (c) {
    const m = c.delta || c.message || {};
    out.text = contentText(m.content) || (typeof c.text === "string" ? c.text : "");
    out.think = typeof m.reasoning_content === "string" ? m.reasoning_content
      : typeof m.reasoning === "string" ? m.reasoning : "";
    out.finish = c.finish_reason || "";
    const calls = Array.isArray(m.tool_calls) ? m.tool_calls
      : (m.function_call ? [{ index: 0, function: m.function_call }] : []);
    out.tools = calls.filter((tc) => tc && typeof tc === "object").map((tc, i) => {
      const f = tc.function || {};
      const args = f.arguments == null ? "" : typeof f.arguments === "string" ? f.arguments : JSON.stringify(f.arguments);
      return { index: typeof tc.index === "number" ? tc.index : i, id: tc.id || "", name: f.name || "", args };
    });
  }
  if (d.usage) out.usage = d.usage;
  if (d.model) out.model = d.model;
  return out;
}

/** Incremental server-sent-events reader. Calls onChunk with readChoice() output. */
function sseParser(onChunk) {
  let buf = "";
  const line = (raw) => {
    const l = raw.replace(/\r$/, "");
    if (l.indexOf("data:") !== 0) return;
    const data = l.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let d;
    try { d = JSON.parse(data); } catch (e) { return; }
    onChunk(readChoice(d));
  };
  return {
    feed(s) {
      buf += s;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
    },
    end() { if (buf) line(buf); buf = ""; },
  };
}

async function readJson(req, limit) {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString("utf8")); }
  catch (e) { throw userError("Request body isn't valid JSON."); }
}

/** fetch with a deadline, turning network failures into sentences. */
async function upstreamFetch(url, opts, timeoutMs, ac) {
  const ctl = ac || new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctl.signal }));
  } catch (e) {
    if (ctl.signal.aborted) throw userError(url + " didn't answer within " + Math.round(timeoutMs / 1000) + "s.");
    const code = e && e.cause && e.cause.code ? " (" + e.cause.code + ")" : "";
    throw userError("Couldn't reach " + url + code + ". Is the server running?");
  } finally {
    clearTimeout(timer);
  }
}

/** Check the SAVED connection. Takes nothing from the request. */
async function aiTest() {
  if (!ai.baseUrl) throw userError("Save an endpoint address first.");
  checkLocalOnly(ai.baseUrl);
  const url = ai.baseUrl + "/models";
  const r = await upstreamFetch(url, { method: "GET", headers: upstreamHeaders() }, 20000);
  const text = await r.text();
  const ctype = r.headers.get("content-type");
  if (looksLikeHtml(text, ctype)) throw userError(describeHtmlBody(text, url));
  if (r.status === 401 || r.status === 403) throw userError(upstreamMessage(r.status, text, ctype, url), 401);
  if (r.ok) {
    let ids = [];
    try {
      const d = JSON.parse(text);
      const list = (d && (d.data || d.models || d)) || [];
      if (Array.isArray(list)) {
        ids = list.map((m) => (typeof m === "string" ? m : (m && (m.id || m.name)) || "")).filter(Boolean).sort();
      }
    } catch (e) { /* reachable, list unreadable */ }
    return { ok: true, models: ids, via: "models" };
  }
  // Some servers have no model list. If a model is saved, try the call the
  // vault actually makes, with a one-token budget.
  if (ai.model && (r.status === 404 || r.status === 405)) {
    const chatUrl = ai.baseUrl + "/chat/completions";
    const c = await upstreamFetch(chatUrl, {
      method: "POST", headers: upstreamHeaders(),
      body: JSON.stringify({ model: ai.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
    }, 30000);
    const ct = await c.text();
    const cty = c.headers.get("content-type");
    if (looksLikeHtml(ct, cty)) throw userError(describeHtmlBody(ct, chatUrl));
    if (c.ok) return { ok: true, models: [ai.model], via: "chat" };
    throw userError(upstreamMessage(c.status, ct, cty, chatUrl), c.status === 401 || c.status === 403 ? 401 : 400);
  }
  throw userError(upstreamMessage(r.status, text, ctype, url));
}

const AI_ROLES = ["system", "user", "assistant", "tool"];

/**
 * Check the messages and keep only the fields an OpenAI-compatible endpoint
 * expects. Plain turns need text. An assistant turn that called tools may
 * have no text, and a tool result must name the call it answers.
 */
function cleanMessages(list) {
  if (!Array.isArray(list) || !list.length) throw userError("Each message needs a role and text content.");
  return list.map((m) => {
    if (!m || AI_ROLES.indexOf(m.role) < 0) throw userError("Each message needs a role of system, user, assistant or tool.");
    const out = { role: m.role };
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      out.content = typeof m.content === "string" && m.content ? m.content : null;
      out.tool_calls = m.tool_calls.map((tc) => {
        const f = tc && tc.function;
        if (!tc || !tc.id || !f || typeof f.name !== "string" || !f.name) throw userError("A tool call needs an id and a function name.");
        const args = typeof f.arguments === "string" ? f.arguments : JSON.stringify(f.arguments || {});
        return { id: String(tc.id), type: "function", function: { name: f.name, arguments: args } };
      });
      return out;
    }
    // Your own messages may carry photos: OpenAI content parts, text and images.
    if (m.role === "user" && Array.isArray(m.content)) {
      out.content = m.content.map(cleanPart);
      if (!out.content.length) throw userError("A message needs some content.");
      return out;
    }
    if (typeof m.content !== "string") throw userError("Each message needs a role and text content.");
    out.content = m.content;
    if (m.role === "tool") {
      if (!m.tool_call_id) throw userError("A tool result needs the tool_call_id of the call it answers.");
      out.tool_call_id = String(m.tool_call_id);
      if (typeof m.name === "string" && m.name) out.name = m.name;
    }
    return out;
  });
}

/** One content part: text, or an image as a data: URL (the page sends photos inline, never a link). */
function cleanPart(p) {
  if (p && p.type === "text" && typeof p.text === "string") return { type: "text", text: p.text };
  const url = p && p.type === "image_url" && p.image_url && p.image_url.url;
  if (typeof url === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url)) {
    return { type: "image_url", image_url: { url } };
  }
  throw userError("A message part must be text or an image (as a data: URL).");
}

/** Does this error say the model can't take images? Narrow, like saysToolsUnsupported. */
function saysImagesUnsupported(msg) {
  return /(does not|doesn't|do not|don't|not|cannot|can't) (support|accept|handle|process)( the)? (images?|image (input|content)|vision|multimodal|multi-modal)|\b(images?|image input|vision|image_url)( content)? (are|is) not supported|unsupported (content )?(type|part)s?:? *['"`]?image|image input is not enabled|model is not multimodal/i
    .test(String(msg || ""));
}

/** Tool definitions in the OpenAI function format, or null for none. */
function cleanTools(list) {
  if (list === undefined || list === null) return null;
  if (!Array.isArray(list)) throw userError("tools must be a list.");
  if (!list.length) return null;
  return list.map((t) => {
    const f = t && t.function;
    if (!t || t.type !== "function" || !f || typeof f.name !== "string" || !f.name) {
      throw userError("Each tool needs type \"function\" and a function name.");
    }
    const o = { type: "function", function: { name: f.name } };
    if (typeof f.description === "string") o.function.description = f.description;
    if (f.parameters && typeof f.parameters === "object") o.function.parameters = f.parameters;
    return o;
  });
}

/**
 * Does this error say the endpoint or model can't do tool calling? Worded
 * narrowly on purpose: an error about one bad tool call in the history must
 * not be mistaken for "no tool support at all".
 */
function saysToolsUnsupported(msg) {
  return /(does not|doesn't|do not|don't|not) support(s|ed)?( the)? (tools|tool[ _-]?(calling|use|calls)|function[ _-]?call(ing|s)?)|\btools? (are|is) not supported|unsupported (parameter|field|argument)s?:? *['"`]?(tools|tool_choice)|--jinja/i
    .test(String(msg || ""));
}

/**
 * Forward a chat request to the saved address and stream the reply back as
 * NDJSON events. Cancelling on the page cancels upstream too, so a stopped
 * request stops costing money.
 *
 * With `tools`, the model may answer with tool calls. They are sent to the
 * page as {t:"tool", id, name, args} just before `done`, each one whole.
 */
async function aiChat(req, res, body) {
  if (!ai.baseUrl || !ai.model) throw userError("No AI endpoint is set up — open the ✦ AI panel.");
  checkLocalOnly(ai.baseUrl);
  const messages = cleanMessages(body.messages);
  const tools = cleanTools(body.tools);
  const timeoutMs = numIn(body.timeoutMs, AI_LIMITS.timeoutMs);
  const payload = {
    model: ai.model,
    messages,
    temperature: numIn(body.temperature, AI_LIMITS.temperature),
    max_tokens: Math.round(numIn(body.maxTokens, AI_LIMITS.maxTokens)),
    stream: true,
  };
  if (tools) { payload.tools = tools; payload.tool_choice = "auto"; }
  if (ai.noTrain && isOpenRouter(ai.baseUrl)) payload.provider = { data_collection: "deny" };
  const url = ai.baseUrl + "/chat/completions";

  const ac = new AbortController();
  let pageGone = false;
  res.on("close", () => { if (!res.writableEnded) { pageGone = true; ac.abort(); } });

  let r = null;
  let lastMsg = "";
  let renamed = false, retried = false;
  for (;;) {
    r = await upstreamFetch(url, {
      method: "POST", headers: upstreamHeaders("text/event-stream, application/json"),
      body: JSON.stringify(payload),
    }, timeoutMs, ac);
    if (r.ok) break;
    const text = await r.text();
    lastMsg = upstreamMessage(r.status, text, r.headers.get("content-type"), url);
    // The page tells you plainly and keeps your message.
    const hasImages = messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));
    if (hasImages && r.status >= 400 && r.status < 600 && saysImagesUnsupported(lastMsg)) {
      const e = userError("This model can't look at photos: " + lastMsg);
      e.vaultCode = "images_unsupported";
      throw e;
    }
    // The page answers this by switching the chat to its text fallback.
    if (tools && r.status >= 400 && r.status < 600 && saysToolsUnsupported(lastMsg)) {
      const e = userError("This model or endpoint doesn't do tool calling: " + lastMsg);
      e.vaultCode = "tools_unsupported";
      throw e;
    }
    // Newer OpenAI models refuse max_tokens and name the replacement.
    if (r.status === 400 && !renamed && /max_completion_tokens/.test(lastMsg)) {
      renamed = true;
      payload.max_completion_tokens = payload.max_tokens;
      delete payload.max_tokens;
      continue;
    }
    // One retry for a busy or briefly broken server.
    if (!retried && [408, 429, 500, 502, 503, 504].indexOf(r.status) >= 0) {
      retried = true;
      await sleep(800);
      continue;
    }
    throw userError(lastMsg, r.status === 401 || r.status === 403 ? 401 : 400);
  }

  const ctype = r.headers.get("content-type") || "";
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  const emit = (o) => { if (!pageGone) res.write(JSON.stringify(o) + "\n"); };
  const st = { finish: "", usage: null, model: payload.model, textChars: 0, thinkChars: 0 };
  const calls = [];   // tool calls, joined from their streamed pieces
  const onChunk = (d) => {
    if (d.error) throw userError(d.error);
    if (d.text) { st.textChars += d.text.length; emit({ t: "text", v: d.text }); }
    if (d.think) { st.thinkChars += d.think.length; emit({ t: "think", v: d.think }); }
    for (const p of d.tools || []) {
      let c = calls.find((x) => x.index === p.index);
      if (!c) { c = { index: p.index, id: "", name: "", args: "" }; calls.push(c); }
      if (p.id && !c.id) c.id = p.id;
      if (p.name && !c.name) c.name = p.name;
      if (p.args) c.args += p.args;
    }
    if (d.finish) st.finish = d.finish;
    if (d.usage) st.usage = d.usage;
    if (d.model) st.model = d.model;
  };

  // Reasoning models can take minutes, but a streaming one sends something
  // steadily. Time out on silence, not on total duration.
  let idle = null;
  const arm = () => { clearTimeout(idle); idle = setTimeout(() => ac.abort(), timeoutMs); };
  try {
    arm();
    if (/text\/event-stream/i.test(ctype)) {
      const parser = sseParser(onChunk);
      const dec = new TextDecoder();
      for await (const chunk of r.body) { arm(); parser.feed(dec.decode(chunk, { stream: true })); }
      parser.end();
    } else {
      // Some servers ignore stream:true and answer in one piece.
      const text = await r.text();
      if (looksLikeHtml(text, ctype)) throw userError(describeHtmlBody(text, url));
      if (/^\s*data:/.test(text)) {
        const parser = sseParser(onChunk);
        parser.feed(text); parser.end();
      } else {
        let d;
        try { d = JSON.parse(text); }
        catch (e) { throw userError("The endpoint sent back something that isn't JSON: " + text.trim().slice(0, 200)); }
        onChunk(readChoice(d));
      }
    }
    clearTimeout(idle);
    const whole = calls.filter((c) => c.name).sort((a, b) => a.index - b.index);
    whole.forEach((c, i) => emit({ t: "tool", id: c.id || "call_" + (i + 1), name: c.name, args: c.args }));
    emit({ t: "done", finish: st.finish, usage: st.usage, model: st.model, textChars: st.textChars, thinkChars: st.thinkChars, tools: whole.length });
  } catch (e) {
    clearTimeout(idle);
    if (!pageGone) {
      const message = ac.signal.aborted
        ? "The endpoint went quiet for " + Math.round(timeoutMs / 1000) + "s, so the request was dropped."
        : (e && e.message) || String(e);
      emit({ t: "error", message: scrubSecret(message) });
    }
  } finally {
    if (!pageGone) res.end();
  }
}

async function handleAi(req, res, route) {
  if (route === "config" && req.method === "GET") return sendJson(res, 200, aiPublic());
  if (route === "config" && req.method === "POST") {
    const body = await readJson(req, 64 * 1024);
    const before = originOf(ai.baseUrl);
    if (typeof body.localOnly === "boolean") ai.localOnly = body.localOnly;
    if (typeof body.noTrain === "boolean") ai.noTrain = body.noTrain;
    if (body.baseUrl !== undefined) {
      const b = normalizeAiBase(body.baseUrl);
      if (b && !/^https?:\/\/[^/]+/i.test(b)) throw userError("The address must start with http:// or https://");
      checkLocalOnly(b);
      ai.baseUrl = b;
    }
    if (body.model !== undefined) ai.model = String(body.model || "").trim();
    if (body.apiKey !== undefined) ai.key = String(body.apiKey || "").trim();
    else if (ai.key && originOf(ai.baseUrl) !== before) ai.key = "";   // a key belongs to one host
    return sendJson(res, 200, aiPublic());
  }
  if (route === "test" && req.method === "POST") {
    return sendJson(res, 200, Object.assign(await aiTest(), { config: aiPublic() }));
  }
  if (route === "chat" && req.method === "POST") {
    // Photos travel inline as base64, so a chat can be much bigger than text alone.
    return aiChat(req, res, await readJson(req, 48 * 1024 * 1024));
  }
  return sendJson(res, 404, { error: "Unknown AI route." });
}

/* ══════════════════════════════════════════════════════════════════════
   Agent workspace: /__vault/ws/*

   A plain folder next to this file, agent-workspace/, that the agent chat
   keeps its notes in. It is the only copy: you can edit agent.md or anything
   else in it with any editor, and the vault reads it fresh each time.

   - Every path is resolved inside the folder. Absolute paths, drive letters,
     ".." and links that lead outside are refused.
   - Every read returns `ver`, a hash of the file's content. Changing a file
     needs the `ver` it was read at, so if you edited it since, the change is
     refused (409) and has to be made against what's there now. `ver: null`
     means "create; it must not exist yet".
   - Text files only, up to WS_MAX_BYTES each.
   ══════════════════════════════════════════════════════════════════════ */

// VAULT_WORKSPACE lets the tests use a scratch folder instead of the real one.
const WS_ROOT = path.resolve(process.env.VAULT_WORKSPACE || path.join(ROOT, "agent-workspace"));
const WS_MAX_BYTES = 1024 * 1024;
const WS_MAX_ENTRIES = 5000;
// The agent.md a new workspace starts with. Everything above "## Agent notes"
// is the user's; the agent only adds below it. The page fills tools/ itself.
const WS_STARTER = [
  "# agent.md",
  "",
  "Read by the agent at the start of every new chat, and again whenever a chat condenses.",
  "Everything above \"## Agent notes\" is the user's: don't edit it. Add your own notes only under that heading.",
  "",
  "## What this is",
  "",
  "RP Card Vault is a library of roleplay character cards: folders, tags, search, and edits kept in the vault",
  "until the user saves them to a card file. When the user asks you to play out a scene or voice a card's",
  "character, do it: read the card first and take the voice and facts from what it says, never speak or act",
  "for the user, and remember a scene never changes the card. Chatting and playing along with the user, in",
  "your own voice, is welcome too.",
  "",
  "## Tools",
  "",
  "Every tool's description comes with each request; tools/ holds a copy for the user. Procedures written down",
  "for you are in tools/custom/: read one when the user names it.",
  "",
  "## Reference notes",
  "",
  "Keep notes about a card in reference/, one file per card, named after the card (reference/Ada Lovelace.md).",
  "Put the card's id on the first line, since two cards can share a name.",
  "",
  "## Working rules",
  "",
  "- Read before you touch. Read a file, card or field before changing anything about it. Copy text to find from",
  "  what you just read, never retype it: names, quotes and non-Latin text fail silently when retyped.",
  "- A change is only real if a tool made it. Describing a change in chat without the tool call means it wasn't done.",
  "- Change the smallest span that does the job, and leave everything outside it exactly as it was.",
  "- Search before you assert. Never claim a card mentions or omits something from memory: look, then quote the line.",
  "- Never fabricate facts about cards. An empty field is empty. Don't invent backstory, tags or improvements nobody asked for.",
  "- Recommend from the library: search for the traits described and name real cards, one line on why each fits.",
  "- Names are not identities. Two cards can share a name; go by what the search returns, and ask when it's ambiguous.",
  "- Confirm before anything destructive or wide: deleting, or changes that touch many files or cards.",
  "- Report after the calls return. Say failures plainly, then fix them; never report success for a call that failed.",
  "- Thoughts versus orders. \"What do you think\" gets analysis and no changes until approved; \"fix\" or \"remove\" means act.",
  "- For a task with several steps, name the plan in a line first, then carry it out.",
  "- Notes stand alone: anything you write must make sense to a stranger with no context.",
  "",
  "## Replies",
  "",
  "Keep work replies functional: no JSON or tool names, and quote card text when it helps. Refer to cards by",
  "name; ids belong in tool calls and notes. After tool work, summarise what changed, then stop. If something",
  "can't be done here, say so and offer the closest thing that can. Chat, banter and scenes don't need to be",
  "functional: answer in your own voice, or the character's when you're playing one.",
  "",
  "## Agent notes",
  "",
  "",
].join("\n");

const winFs = process.platform === "win32";
const samePath = (a, b) => (winFs ? a.toLowerCase() === b.toLowerCase() : a === b);
const insidePath = (child, parent) => samePath(child, parent) ||
  (winFs ? child.toLowerCase() : child).indexOf((winFs ? parent.toLowerCase() : parent) + path.sep) === 0;

function wsEnsure() {
  fs.mkdirSync(WS_ROOT, { recursive: true });
  const md = path.join(WS_ROOT, "agent.md");
  if (!fs.existsSync(md)) fs.writeFileSync(md, WS_STARTER, "utf8");
}

/** A workspace path → { full, rel }, or a refusal. */
function wsResolve(p, allowRoot) {
  const s = String(p == null ? "" : p).replace(/\\/g, "/").trim();
  if (s.indexOf("\0") >= 0) throw userError("That path isn't allowed.");
  if (/^[a-z]:/i.test(s) || s.charAt(0) === "/") {
    throw userError("Workspace paths are relative, like agent.md or notes/ideas.md.");
  }
  const parts = s.split("/").filter((x) => x && x !== ".");
  if (parts.indexOf("..") >= 0) throw userError("Paths can't leave the workspace (no \"..\").");
  for (const part of parts) {
    // A colon names a hidden NTFS data stream (agent.md:x); CON, NUL, COM1 and
    // the like are devices on Windows, whatever their extension; a trailing dot
    // or space is silently dropped by Windows, so "a.bat." would be a.bat.
    if (/[:*?"<>|]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i.test(part)) {
      throw userError("\"" + part + "\" isn't allowed as a name in the workspace.");
    }
  }
  if (!parts.length && !allowRoot) throw userError("Give a file path, like agent.md.");
  const full = path.join.apply(path, [WS_ROOT].concat(parts));
  if (!insidePath(full, WS_ROOT)) throw userError("Paths can't leave the workspace.");
  // A link inside the folder could still point outside it. Check where the
  // nearest part that exists really lives.
  let probe = full;
  while (!fs.existsSync(probe) && !samePath(probe, WS_ROOT)) probe = path.dirname(probe);
  if (!insidePath(fs.realpathSync(probe), fs.realpathSync(WS_ROOT))) throw userError("Paths can't leave the workspace.");
  return { full, rel: parts.join("/") };
}

/*
 * What can be written: text, by extension (or none). The workspace is for
 * notes, and a card's text reaches the agent, so a card could try to talk it
 * into writing a .bat, a shortcut or a web page for you to open. Those types
 * simply can't be created or renamed into here.
 */
const WS_TEXT_EXT = ["md", "markdown", "txt", "text", "json", "jsonl", "csv", "tsv", "yaml", "yml", "toml", "ini", "log"];

function wsWritable(f) {
  const ext = path.extname(f.rel).slice(1).toLowerCase();
  if (ext && WS_TEXT_EXT.indexOf(ext) < 0) {
    throw userError("The workspace holds text files only (" + WS_TEXT_EXT.map((x) => "." + x).join(", ") + "), so " + f.rel + " can't be written.");
  }
  return f;
}

const wsVer = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);

/** The file's current state, or null if there's no file there. */
function wsStat(full) {
  let st;
  try { st = fs.statSync(full); } catch (e) { return null; }
  if (st.isDirectory()) return { dir: true, mtime: st.mtimeMs };
  // Too big to open here anyway: don't read it just to hash it.
  if (st.size > WS_MAX_BYTES) return { dir: false, big: true, ver: "big-" + st.size + "-" + st.mtimeMs, size: st.size, mtime: st.mtimeMs };
  const buf = fs.readFileSync(full);
  return { dir: false, buf, ver: wsVer(buf), size: st.size, mtime: st.mtimeMs };
}

function wsNeedVer(st, ver, rel) {
  if (!st) {
    if (typeof ver === "string") throw userError(rel + " was deleted since it was read.", 409);
    return;
  }
  if (st.dir) throw userError(rel + " is a folder.");
  if (typeof ver !== "string") throw userError(rel + " already exists. Read it first, then change it.", 409);
  if (ver !== st.ver) throw userError(rel + " changed since it was read (someone edited it). Read it again first.", 409);
}

function wsText(buf, rel) {
  if (buf.subarray(0, 8192).indexOf(0) >= 0) throw userError(rel + " isn't a text file.");
  return buf.toString("utf8");
}

/** Write through a temporary file, so a crash can't leave half a file behind. */
function wsWriteFile(full, text) {
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const tmp = full + ".tmp-" + crypto.randomBytes(4).toString("hex");
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, full);
}

function wsList(dirFull) {
  const out = [];
  const walk = (full, rel) => {
    for (const d of fs.readdirSync(full, { withFileTypes: true })) {
      if (out.length >= WS_MAX_ENTRIES) return;
      const r = rel ? rel + "/" + d.name : d.name;
      const f = path.join(full, d.name);
      if (d.isDirectory()) { out.push({ path: r, dir: true }); walk(f, r); }
      else if (d.isFile()) {
        const st = fs.statSync(f);
        out.push({ path: r, dir: false, size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  walk(dirFull.full, dirFull.rel);
  return out;
}

async function handleWs(req, res, route) {
  if (req.method !== "POST") return sendJson(res, 404, { error: "Unknown workspace route." });
  const body = await readJson(req, 4 * 1024 * 1024);
  wsEnsure();
  if (route === "list") {
    const d = wsResolve(body.path, true);
    const st = wsStat(d.full);
    if (!st) throw userError("There's no folder " + (d.rel || ".") + " in the workspace.", 404);
    if (!st.dir) throw userError(d.rel + " is a file, not a folder.");
    const entries = wsList(d);
    return sendJson(res, 200, { path: d.rel, entries, truncated: entries.length >= WS_MAX_ENTRIES });
  }
  if (route === "read") {
    const f = wsResolve(body.path);
    const st = wsStat(f.full);
    if (!st) throw userError("There's no file " + f.rel + " in the workspace.", 404);
    if (st.dir) throw userError(f.rel + " is a folder. List it instead.");
    if (st.size > WS_MAX_BYTES) throw userError(f.rel + " is over " + (WS_MAX_BYTES >> 20) + " MB, too big to open here.", 413);
    return sendJson(res, 200, { path: f.rel, text: wsText(st.buf, f.rel), ver: st.ver, size: st.size, mtime: st.mtime });
  }
  if (route === "write") {
    const f = wsWritable(wsResolve(body.path));
    if (typeof body.text !== "string") throw userError("Give the file's text.");
    if (Buffer.byteLength(body.text, "utf8") > WS_MAX_BYTES) throw userError("That's over " + (WS_MAX_BYTES >> 20) + " MB, too big for a workspace file.", 413);
    const st = wsStat(f.full);
    wsNeedVer(st, body.ver, f.rel);
    wsWriteFile(f.full, body.text);
    const now = wsStat(f.full);
    return sendJson(res, 200, { path: f.rel, ver: now.ver, size: now.size, mtime: now.mtime, created: !st });
  }
  if (route === "delete") {
    const f = wsResolve(body.path);
    const st = wsStat(f.full);
    if (!st) throw userError("There's no " + f.rel + " in the workspace.", 404);
    if (st.dir) {
      if (fs.readdirSync(f.full).length) throw userError(f.rel + " isn't empty. Delete what's in it first.");
      fs.rmdirSync(f.full);
    } else {
      wsNeedVer(st, body.ver, f.rel);
      fs.unlinkSync(f.full);
    }
    return sendJson(res, 200, { path: f.rel, deleted: true });
  }
  if (route === "move") {
    const a = wsResolve(body.from);
    const b = wsResolve(body.to);
    if (!(wsStat(a.full) || {}).dir) wsWritable(b);
    const st = wsStat(a.full);
    if (!st) throw userError("There's no " + a.rel + " in the workspace.", 404);
    if (!st.dir) wsNeedVer(st, body.ver, a.rel);
    if (fs.existsSync(b.full)) throw userError(b.rel + " already exists.", 409);
    fs.mkdirSync(path.dirname(b.full), { recursive: true });
    fs.renameSync(a.full, b.full);
    return sendJson(res, 200, { from: a.rel, to: b.rel });
  }
  if (route === "mkdir") {
    const d = wsResolve(body.path);
    const st = wsStat(d.full);
    if (st && !st.dir) throw userError(d.rel + " is already a file.", 409);
    fs.mkdirSync(d.full, { recursive: true });
    return sendJson(res, 200, { path: d.rel, created: !st });
  }
  return sendJson(res, 404, { error: "Unknown workspace route." });
}

/* ══════════════════════════════════════════════════════════════════════
   Who may use /__vault/

   Every route here is for the vault page and nothing else. Any website open in
   the same browser can send a request to 127.0.0.1 — a form post or a no-cors
   fetch needs no permission — so without these checks it could drive the
   relays, including telling the AI relay to use your key.

   - Host must be this server's own address, which defeats DNS rebinding.
   - Origin, when the browser sends one, must be this server's origin.
   - Anything but GET must carry "X-Vault: 1". A page on another site can't add
     a custom header without a CORS preflight, and this server never approves
     one.
   - Sec-Fetch-Site, which browsers add to every request, must be same-origin
     (or none, for an address typed in).
   ══════════════════════════════════════════════════════════════════════ */

function ownHosts() { return ["127.0.0.1:" + PORT, "localhost:" + PORT]; }

/** "" if the request may proceed, otherwise the reason it's refused. */
function vaultGuard(req) {
  const hosts = ownHosts();
  const host = String(req.headers.host || "").toLowerCase();
  if (hosts.indexOf(host) < 0) return "Refused: this server only answers to " + hosts[0] + ".";
  const origin = req.headers.origin;
  if (origin !== undefined && hosts.map((h) => "http://" + h).indexOf(String(origin).toLowerCase()) < 0) {
    return "Refused: requests from other sites aren't accepted.";
  }
  // Browsers say where a request comes from. Only the vault page itself
  // ("same-origin") or you typing the address ("none") may use these routes;
  // this also stops another site's <script src> or <img>, which carry no
  // Origin. Programs (the launchers' probes) send no such header at all.
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") {
    return "Refused: requests from other sites aren't accepted.";
  }
  if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-vault"] !== "1") {
    return "Refused: missing X-Vault header. Reload the vault page.";
  }
  return "";
}

/** A front end that isn't running gives a sentence, not "fetch failed". */
function reachError(e, baseUrl) {
  if (e && e.status) return e;
  const code = e && e.cause && e.cause.code ? " (" + e.cause.code + ")" : "";
  return userError("Couldn't reach " + baseUrl + code + ". Is it running, and is the address right?");
}

async function handleDest(req, res, route, url) {
  if (route === "list" && req.method === "GET") {
    return sendJson(res, 200, { destinations: Array.from(destinations, ([id, d]) => destPublic(id, d)) });
  }
  if (route === "connect" && req.method === "POST") {
    const body = await readJson(req, 64 * 1024);
    try { return sendJson(res, 200, await destConnect(body)); }
    catch (e) { throw reachError(e, normalizeBase(body.baseUrl)); }
  }
  if (route === "disconnect" && req.method === "POST") {
    const body = await readJson(req, 64 * 1024);
    destinations.delete(String(body.id || ""));
    return sendJson(res, 200, { id: String(body.id || ""), connected: false });
  }
  if (route === "send" && req.method === "POST") {
    const id = url.searchParams.get("id") || "";
    const name = (url.searchParams.get("name") || "card.png").replace(/[\\/]/g, "_").slice(0, 200);
    const buf = await readBody(req, 64 * 1024 * 1024);
    if (!buf.length) throw userError("The card file was empty.");
    const d = destinations.get(id);
    try { return sendJson(res, 200, await destSend(id, name, buf)); }
    catch (e) { throw reachError(e, d ? d.baseUrl : "the destination"); }
  }
  return sendJson(res, 404, { error: "Unknown destination route." });
}

async function handleBridge(req, res, url) {
  const refused = vaultGuard(req);
  if (refused) return sendJson(res, 403, { error: refused });
  const route = url.pathname.slice("/__vault/".length);
  try {
    if (route === "status" && req.method === "GET") {
      return sendJson(res, 200, {
        destinations: Array.from(destinations, ([id, d]) => destPublic(id, d)),
        features: ["dest", "ai", "ws"],
        build: RELAY_BUILD, version: VAULT_VERSION, startedAt: STARTED_AT,
        ai: { configured: !!(ai.baseUrl && ai.model), hasKey: !!ai.key },
      });
    }
    if (route.indexOf("ai/") === 0) return await handleAi(req, res, route.slice(3));
    if (route.indexOf("ws/") === 0) return await handleWs(req, res, route.slice(3));
    if (route.indexOf("dest/") === 0) return await handleDest(req, res, route.slice(5), url);
    // Lets a newly started copy (serve.js --restart) take the port over.
    if (route === "shutdown" && req.method === "POST") {
      sendJson(res, 200, { stopping: true, build: RELAY_BUILD, pid: process.pid });
      console.log("\n  A newer copy asked for the port. Shutting down.");
      setTimeout(() => process.exit(0), 60);
      return;
    }
    return sendJson(res, 404, { error: "Unknown route." });
  } catch (e) {
    const msg = scrubSecret((e && e.message) || String(e));
    if (res.headersSent) { try { res.end(); } catch (e2) { /* already gone */ } return; }
    const status = e && [401, 404, 409, 413].indexOf(e.status) >= 0 ? e.status : 400;
    const out = { error: msg };
    if (e && e.vaultCode) out.code = e.vaultCode;
    return sendJson(res, status, out);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   What this server hands out, and the headers on every answer

   Only the app's own files are served, by exact name. Everything else in
   this folder (the agent's workspace, .git, node_modules, the tests, your
   vault.local) stays private: a file served here runs with the vault's own
   address, so an .html the agent was tricked into writing would otherwise
   be a page with full access to your vault.

   Headers on every answer:
   - nosniff: a file is only ever what its Content-Type says.
   - X-Frame-Options / frame-ancestors: no other site can show the vault in
     a frame and trick you into clicking its buttons.
   - Cross-Origin-Resource-Policy: no other site can load these answers as
     an image or a script.
   - The page's Content-Security-Policy keeps its requests and images on this
     address, so even injected script couldn't post your cards elsewhere
     with fetch() or an <img>. Scripts come from here (lib/) and, as a
     fallback, cdnjs only; inline
     script has to stay allowed, as Babel compiles the app in the page.
   ══════════════════════════════════════════════════════════════════════ */

const STATIC_FILES = {
  "/": MAIN,
  "/lib/react.production.min.js": "lib/react.production.min.js",
  "/lib/react-dom.production.min.js": "lib/react-dom.production.min.js",
  "/lib/babel.min.js": "lib/babel.min.js",
  "/lib/jszip.min.js": "lib/jszip.min.js",
  "/lib/fonts/fonts.css": "lib/fonts/fonts.css",
  "/lib/fonts/CrimsonPro-italic-latin-ext.woff2": "lib/fonts/CrimsonPro-italic-latin-ext.woff2",
  "/lib/fonts/CrimsonPro-italic-latin.woff2": "lib/fonts/CrimsonPro-italic-latin.woff2",
  "/lib/fonts/CrimsonPro-italic-vietnamese.woff2": "lib/fonts/CrimsonPro-italic-vietnamese.woff2",
  "/lib/fonts/CrimsonPro-normal-latin-ext.woff2": "lib/fonts/CrimsonPro-normal-latin-ext.woff2",
  "/lib/fonts/CrimsonPro-normal-latin.woff2": "lib/fonts/CrimsonPro-normal-latin.woff2",
  "/lib/fonts/CrimsonPro-normal-vietnamese.woff2": "lib/fonts/CrimsonPro-normal-vietnamese.woff2",
  "/lib/fonts/JetBrainsMono-normal-cyrillic-ext.woff2": "lib/fonts/JetBrainsMono-normal-cyrillic-ext.woff2",
  "/lib/fonts/JetBrainsMono-normal-cyrillic.woff2": "lib/fonts/JetBrainsMono-normal-cyrillic.woff2",
  "/lib/fonts/JetBrainsMono-normal-greek.woff2": "lib/fonts/JetBrainsMono-normal-greek.woff2",
  "/lib/fonts/JetBrainsMono-normal-latin-ext.woff2": "lib/fonts/JetBrainsMono-normal-latin-ext.woff2",
  "/lib/fonts/JetBrainsMono-normal-latin.woff2": "lib/fonts/JetBrainsMono-normal-latin.woff2",
  "/lib/fonts/JetBrainsMono-normal-vietnamese.woff2": "lib/fonts/JetBrainsMono-normal-vietnamese.woff2",
  "/lib/fonts/Outfit-normal-latin-ext.woff2": "lib/fonts/Outfit-normal-latin-ext.woff2",
  "/lib/fonts/Outfit-normal-latin.woff2": "lib/fonts/Outfit-normal-latin.woff2",
  ["/" + MAIN]: MAIN,
  "/manifest.webmanifest": "manifest.webmanifest",
  "/sw.js": "sw.js",
  "/icon-192.png": "icon-192.png",
  "/icon-512.png": "icon-512.png",
  "/RP_Card_Vault.ico": "RP_Card_Vault.ico",
  "/favicon.ico": "RP_Card_Vault.ico",
};

const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function baseHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Referrer-Policy", "no-referrer");
}

/** Plain text, never echoing what was asked for: an address can't become markup. */
function sendText(res, code, text) {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

const server = http.createServer((req, res) => {
  baseHeaders(res);
  // Only answer to this machine's own names (defeats DNS rebinding everywhere).
  if (ownHosts().indexOf(String(req.headers.host || "").toLowerCase()) < 0) {
    return sendText(res, 403, "This server only answers to " + ownHosts()[0] + ".");
  }
  let url;
  try { url = new URL(req.url, "http://" + HOST + ":" + PORT); }
  catch (e) { return sendText(res, 400, "Bad request."); }

  if (url.pathname.startsWith("/__vault/")) { handleBridge(req, res, url); return; }
  if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Method not allowed.");

  const name = Object.prototype.hasOwnProperty.call(STATIC_FILES, url.pathname) ? STATIC_FILES[url.pathname] : null;
  if (!name) return sendText(res, 404, "Not found. The vault is at " + APP_URL);
  const full = path.join(ROOT, name);

  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return sendText(res, 404, "Not found. The vault is at " + APP_URL);
    const headers = {
      "Content-Type": TYPES[path.extname(full).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-cache",
    };
    if (name === MAIN) headers["Content-Security-Policy"] = PAGE_CSP;
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(full).on("error", () => res.destroy()).pipe(res);
  });
});

const APP_URL = "http://" + HOST + ":" + PORT + "/" + MAIN;

/**
 * Hand the URL to the desktop's default handler.
 *
 * Synchronous on purpose. The "already running" path below calls this and then
 * immediately calls process.exit(), and an async execFile loses that race: Node
 * exits before the child is spawned and the browser never opens, leaving the
 * user staring at "Opening: ..." with nothing to show for it.
 *
 * All three commands return as soon as they have handed the URL off, so this
 * doesn't hold the server up. The timeout is for the rare case where a desktop
 * helper hangs — better to carry on serving than to block on it.
 */
function openInBrowser(url) {
  const p = process.platform;
  const opts = { timeout: 5000, stdio: "ignore", windowsHide: true };
  try {
    // "start" is a cmd builtin, so it needs cmd. The empty "" is the window
    // title argument: without it, a quoted URL is taken as the title and
    // nothing opens.
    if (p === "win32") execFileSync("cmd", ["/c", "start", "", url], opts);
    else if (p === "darwin") execFileSync("open", [url], opts);
    else execFileSync("xdg-open", [url], opts);
    return true;
  } catch (e) {
    return false;   // the printed URL is the fallback
  }
}

/** Is the thing already on our port our own vault server? */
function probeExisting() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: HOST, port: PORT, path: "/__vault/status", timeout: 1500 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try { JSON.parse(body); resolve(true); }
          catch (e) { resolve(false); }
        });
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

/** Ask the copy already on our port to stand down. Resolves true if it agreed. */
function requestShutdown() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: HOST, port: PORT, path: "/__vault/shutdown", method: "POST",
        headers: { "X-Vault": "1", "X-Vault-Shutdown": "1", "Content-Length": 0 }, timeout: 3000,
      },
      (res) => {
        res.resume();
        // 400 means it's an older serve.js with no shutdown route.
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Requiring this file (the tests do) must not start a server or claim a port.
   Only running it directly does. */
if (require.main !== module) {
  module.exports = {
    normalizeAiBase, originOf, addressHint, API_BASE_HINTS,
    looksLikeHtml, describeHtmlBody, upstreamMessage, scrubSecret,
    readChoice, sseParser, vaultGuard, numIn, AI_LIMITS, AI_UA, isLoopbackUrl, isOpenRouter,
    cleanMessages, cleanTools, saysToolsUnsupported, saysImagesUnsupported, WS_STARTER, cookiesOf, mergeCookies,
    RELAY_BUILD, VAULT_VERSION, NODE_MIN, nodeTooOld,
  };
  return;
}

const WANT_RESTART = process.argv.indexOf("--restart") >= 0;
let restartTried = false;

server.on("error", (e) => {
  if (e.code !== "EADDRINUSE") {
    console.error("\n  Server error: " + e.message + "\n");
    process.exit(1);
  }
  // Another copy of the vault may already be serving this folder — that's the
  // normal case when the app window is open and you now want a browser tab.
  // Don't fail; just point the browser at the running one.
  probeExisting().then(async (ours) => {
    // --restart: take the port over. The launcher passes this so that starting
    // the vault always runs the serve.js on disk, however the old one was
    // started (the .vbs leaves node running in a hidden window).
    if (ours && WANT_RESTART && !restartTried) {
      restartTried = true;
      console.log("");
      console.log("  A copy is already on port " + PORT + ". Asking it to stand down…");
      if (await requestShutdown()) {
        // Wait for it to actually let go, rather than racing it.
        for (let i = 0; i < 40; i++) {
          await wait(100);
          if (!(await probeExisting())) break;
        }
        console.log("  It stopped. Starting this one.");
        // No callback here. The first listen() registered onListening as a
        // one-shot 'listening' listener and it is still attached, because the
        // event never fired — passing it again prints the banner twice.
        server.listen(PORT, HOST);
        return;
      }
      console.log("  It didn't answer a shutdown request — it predates that route.");
      console.log("  Run \"Stop RP Card Vault.bat\", then start again.");
      console.log("");
    }
    if (ours) {
      console.log("");
      console.log("  RP Card Vault is already running on port " + PORT + ".");
      console.log("  That server keeps running; this window has nothing to do.");
      console.log("  It may be an OLDER serve.js than this one (build " + RELAY_BUILD + ") —");
      console.log("  check " + "http://" + HOST + ":" + PORT + "/__vault/status");
      console.log("");
      let opened = false;
      if (process.argv.indexOf("--no-open") < 0) opened = openInBrowser(APP_URL);
      console.log(opened ? "  Opened:  " + APP_URL : "  Open it yourself:  " + APP_URL);
      console.log("");
      console.log("  If you have just edited serve.js, the running copy is still the");
      console.log("  old one. \"Start RP Card Vault.bat\" restarts it for you.");
      console.log("");
      process.exit(0);
    }
    console.error("\n  Port " + PORT + " is in use by something that isn't the vault.");
    console.error("  Try:  node serve.js " + (PORT + 1) + "\n");
    console.error("  Note: a different port means a separate vault database.\n");
    process.exit(1);
  });
});

function onListening() {
  const missing = !fs.existsSync(path.join(ROOT, MAIN));
  console.log("");
  console.log("  RP Card Vault " + VAULT_VERSION + " (server build " + RELAY_BUILD + ")");
  console.log("  Serving:");
  console.log("    " + ROOT);
  console.log("");
  console.log("  Open:  " + APP_URL);
  if (missing) {
    console.log("");
    console.log("  WARNING: " + MAIN + " is not in this folder.");
    console.log("  Put serve.js next to RP_Card_Vault.html.");
  }
  console.log("");
  console.log("  Leave this window open while you use the vault.");
  console.log("  Press Ctrl+C to stop.");
  console.log("");

  if (!missing && process.argv.indexOf("--no-open") < 0) openInBrowser(APP_URL);
}

server.listen(PORT, HOST, onListening);
