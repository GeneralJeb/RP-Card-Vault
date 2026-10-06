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
  "scrubLogText", "makeLogNameScrub", "formatProblemLog"]);

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
