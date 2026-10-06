/**
 * The problem log (Settings → Problem log): what it keeps, and that keys,
 * passwords, emails, home folders, network addresses and names never reach
 * the text you copy.
 *
 *   node test/problem-log.test.js
 */

const { loadPureRegion } = require("./pure-region");
const t = require("./harness");

const { mod: V } = loadPureRegion(["PROBLEM_LOG", "PROBLEM_LOG_MAX", "logProblem", "clearProblemLog",
  "scrubLogText", "makeLogNameScrub", "formatProblemLog", "rememberLogNames", "logNameEntries", "LOG_NAME_BOOK"]);

console.log("\nkeeping");
{
  V.clearProblemLog();
  V.logProblem("Notice", "Couldn't send");
  V.logProblem("Notice", "Couldn't send");
  V.logProblem("Agent chat", "The model sent back an empty reply", "model: x", "warn");
  t.eq(V.PROBLEM_LOG.map((e) => [e.source, e.count, e.level]), [["Notice", 2, "error"], ["Agent chat", 1, "warn"]],
    "the same problem straight after counts up instead of repeating");
  for (let i = 0; i < V.PROBLEM_LOG_MAX + 20; i++) V.logProblem("Page", "error " + i);
  t.eq(V.PROBLEM_LOG.length, V.PROBLEM_LOG_MAX, "only the newest " + V.PROBLEM_LOG_MAX + " are kept");
  t.eq(V.PROBLEM_LOG[V.PROBLEM_LOG.length - 1].text, "error " + (V.PROBLEM_LOG_MAX + 19), "the newest last");
  V.logProblem("Page", "x".repeat(10000));
  t.ok(V.PROBLEM_LOG[V.PROBLEM_LOG.length - 1].text.length <= 4000, "a huge message is clipped");
  V.clearProblemLog();
  t.eq(V.PROBLEM_LOG.length, 0, "Clear empties it");

  V.logProblem("Local server", "POST /__vault/dest/connect → HTTP 400: Couldn't reach http://127.0.0.1:9. Is it running?");
  V.logProblem("Notice", "Lumiverse: Couldn't reach http://127.0.0.1:9. Is it running?");
  t.eq(V.PROBLEM_LOG.map((e) => e.source), ["Local server"], "a notice repeating the server failure just logged isn't logged again");
  V.clearProblemLog();
  V.logProblem("Notice", "Lumiverse: Couldn't reach http://127.0.0.1:9. Is it running?");
  V.logProblem("Local server", "POST /__vault/dest/connect → HTTP 400: Couldn't reach http://127.0.0.1:9. Is it running?");
  t.eq(V.PROBLEM_LOG.map((e) => e.source), ["Local server"], "in either order: the server's line, with its route, is the one kept");
  V.logProblem("Notice", "Pick a card to send first");
  t.eq(V.PROBLEM_LOG.length, 2, "an unrelated notice is still logged");
  V.clearProblemLog();
}

console.log("\nscrubbing");
{
  const s = (x) => V.scrubLogText(x);
  const cases = [
    ["key sk-or-v1-0123456789abcdef in the text", "key [key] in the text", "an OpenRouter-style key"],
    ["sk-ant-api03-abcdefghijklmnop", "[key]", "an Anthropic-style key"],
    ["hf_abcdefghijklmnop and ghp_abcdefghijkl", "[key] and [key]", "Hugging Face and GitHub tokens"],
    ["AIzaSyA1234567890abcdefghijklmn", "[key]", "a Google key"],
    ["Authorization: Bearer abcdefgh12345678", "Authorization: [hidden] [key]", "an Authorization header"],
    ["sent Bearer abcdefgh12345678", "sent Bearer [key]", "a bearer token on its own"],
    ['{"password":"hunter22","user":"x"}', '{"password":[hidden],"user":"x"}', "a password in JSON"],
    ["apiKey=abc123&x=1", "apiKey=[hidden]&x=1", "a key in a form body"],
    ["write to generalrex1@yahoo.com", "write to [email]", "an email address"],
    ["http://jeb:pw@127.0.0.1:7860/api", "http://127.0.0.1:7860/api", "a sign-in in an address"],
    ["GET https://host.example/v1/x?key=abc&y=2", "GET https://host.example/v1/x?[…]", "a query string"],
    ["C:\\Users\\Jeb\\Documents\\Cards\\a.png", "C:\\Users\\[you]\\Documents\\Cards\\a.png", "the Windows user name in a path"],
    ["C:\\\\Users\\\\Jeb\\\\x", "C:\\\\Users\\\\[you]\\\\x", "and in an escaped path"],
    ["/home/jeb/cards and /Users/jeb/x", "/home/[you]/cards and /Users/[you]/x", "and in Linux and macOS paths"],
    ["fetch http://192.168.1.20:5001/v1 failed", "fetch http://[ip]:5001/v1 failed", "an address on your network"],
    ["http://127.0.0.1:7860 and 0.0.0.0", "http://127.0.0.1:7860 and 0.0.0.0", "this computer's addresses stay"],
    ["Edge 154.0.6000.12", "Edge 154.0.6000.12", "a version number isn't taken for an address"],
    ["max_tokens: 4096 · Tokens: 1,326", "max_tokens: 4096 · Tokens: 1,326", "token counts aren't taken for tokens"],
    ["cookie: a=1; session=abc123; csrf=xyz\nnext line", "cookie: [hidden]\nnext line", "every pair of a Cookie header, to the end of its line"],
    ['{"set-cookie":"sid=1; Path=/"}', '{"set-cookie":[hidden]}', "and a cookie in JSON"],
    ["Invalid API key gsk_ABCDEF1234567890abcdef", "Invalid API key [key]", "a Groq key"],
    ["bad key xai-ABCDEF1234567890abcdefgh", "bad key [key]", "an xAI key"],
    ["model x-ai/grok-4 and xai-short", "model x-ai/grok-4 and xai-short", "a model name isn't taken for a key"],
  ];
  for (const [input, want, label] of cases) t.eq(s(input), want, label);
}

console.log("\nnames");
{
  const names = [{ name: "Ramia", as: "[card]" }, { name: "Ramia.png", as: "[card file]" },
    { name: "Monster Girls", as: "[folder]" }, { name: "Jeb", as: "[user]" }, { name: "Al", as: "[card]" }];
  const text = "Couldn't send Ramia.png from Monster Girls/ as Jeb: ramia is busy. Also Ramiah and Al.";
  const scrub = V.makeLogNameScrub(names, text);
  t.eq(scrub(text), "Couldn't send [card file] from [folder]/ as [user]: [card] is busy. Also Ramiah and Al.",
    "names become placeholders, longest first, any case, whole words only; very short names are left");
  t.eq(V.makeLogNameScrub(names, "nothing here")("nothing here"), "nothing here", "names not in the text cost nothing");
  const many = [];
  for (let i = 0; i < 20000; i++) many.push({ name: "Card number " + i, as: "[card]" });
  const t0 = Date.now();
  V.makeLogNameScrub(many, "x".repeat(20000) + " Card number 19999 ")("Card number 19999");
  t.ok(Date.now() - t0 < 1500, "twenty thousand names are quick (" + (Date.now() - t0) + " ms)");

  const users = [{ name: "Users", as: "[folder]" }];
  t.eq(V.scrubLogText("Couldn't read C:\\Users\\Jeb\\Cards\\x.png", users), "Couldn't read C:\\[folder]\\[you]\\Cards\\x.png",
    "a folder called Users can't stop the user name being taken out: the fixed rules go first");
  t.eq(V.scrubLogText("Invalid sk-abcdefgh12345678 for Key", [{ name: "Key", as: "[card]" }]), "Invalid [key] for [card]",
    "a name isn't looked for inside a placeholder already put in");
  const dupes = [];
  for (let i = 0; i < 30000; i++) dupes.push({ name: "Fantasy", as: "[folder]" });
  const t1 = Date.now();
  V.makeLogNameScrub(dupes, "y".repeat(500000));
  t.ok(Date.now() - t1 < 300, "a name repeated thousands of times is searched for once (" + (Date.now() - t1) + " ms)");
}

console.log("\nnames seen this session");
{
  V.LOG_NAME_BOOK.clear();
  const rec = (name, file, dir, aiPrivate) => ({ name, file, dir, aiPrivate });
  V.rememberLogNames([rec("Ramia", "Ramia.png", "Monster Girls", false), rec("Hidden One", "Hidden One.png", "Secret", true)],
    [{ name: "My Cards" }], [{ username: "Jeb" }]);
  V.rememberLogNames([rec("Bram", "Bram.png", "", false)], [], []);   // Ramia and the private card have left the vault
  const all = V.logNameEntries(false).map((e) => e.name + "=" + e.as).sort();
  t.eq(all, ["Bram.png=[card] file", "Bram=[card]", "Hidden One.png=[private card] file", "Hidden One=[private card]", "Jeb=[user]",
    "Monster Girls=[folder]", "My Cards=[folder]", "Ramia.png=[card] file", "Ramia=[card]", "Secret=[folder]"].sort(),
    "cards that have since left the vault are still hidden");
  t.eq(V.logNameEntries(true).map((e) => e.name).sort(), ["Hidden One", "Hidden One.png", "Jeb", "Secret"],
    "with names shown, private cards (and their folders) and user names still aren't");
  V.rememberLogNames([rec("Hidden One", "Hidden One.png", "", false)], [], []);
  t.ok(V.logNameEntries(true).some((e) => e.name === "Hidden One"), "once private, a name stays private");
  V.LOG_NAME_BOOK.clear();
}

console.log("\nthe copied text");
{
  V.clearProblemLog();
  V.logProblem("Local server", "POST /__vault/dest/send → HTTP 401: Not connected", "");
  V.logProblem("Agent chat", "Ramia: empty reply", "model: x · key sk-abcdefgh12345678");
  const out = V.formatProblemLog(V.PROBLEM_LOG, ["RP Card Vault problem log", "Vault 1.4.0"], [{ name: "Ramia", as: "[card]" }]);
  t.ok(/^RP Card Vault problem log\nVault 1\.4\.0\n\n/.test(out), "the header comes first");
  t.ok(/\d\d:\d\d:\d\d  error  Local server: POST \/__vault\/dest\/send → HTTP 401: Not connected/.test(out), "each problem has its time, level and source");
  t.ok(/Agent chat: \[card\]: empty reply\n {10}model: x · key \[key\]/.test(out), "details are indented, and everything is scrubbed");
  t.ok(!/Ramia|sk-abc/.test(out), "nothing hidden is left");
  t.ok(/no problems logged/.test(V.formatProblemLog([], ["h"], [])), "an empty log says so");
  V.clearProblemLog();
}

t.done();
