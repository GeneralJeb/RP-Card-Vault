/**
 * The Windows launcher files.
 *
 *   node test/launchers.test.js
 *
 * These exist because of one real bug: the .vbs launchers were saved with Unix
 * (LF) line endings. Windows Script Host treats a lone LF as whitespace rather
 * than a statement separator, so the whole file parses as a single enormous
 * line and dies with:
 *
 *   Microsoft VBScript compilation error: Syntax error, code 800A03EA
 *
 * Nothing in the file looks wrong when you read it, which is what makes it
 * expensive. Any tool that touches these files from a non-Windows machine can
 * reintroduce it silently, so it gets a test.
 *
 * The other half is the port. Browser storage is keyed to the origin, so each
 * port is a separate vault with its own saved folder permissions. The launchers
 * all default to one port and all read a second copy's own port from
 * vault.local; if they disagreed, one launcher would open a different vault.
 *
 * Files that aren't present are skipped, so this suite can travel with just the
 * app if the launchers are left behind.
 */

const fs = require("fs");
const path = require("path");
const t = require("./harness");

const ROOT = path.join(__dirname, "..");

const DEFAULT_PORT = 8790;

const WINDOWS_SCRIPTS = [
  "RP Card Vault.vbs",
  "Open in Browser Tab.vbs",
  "Start RP Card Vault.bat",
  "Stop RP Card Vault.bat",
  "Create Shortcut.bat",
  "Create Shortcut.ps1",
  "HOW TO RUN.txt",
];

function read(name) {
  const p = path.join(ROOT, name);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

/* ── line endings and encoding ─────────────────────────────────────────── */

console.log("\nWindows scripts have Windows line endings");
for (const name of WINDOWS_SCRIPTS) {
  const buf = read(name);
  if (!buf) { t.skip(name, "not in this folder"); continue; }

  const crlf = (buf.toString("latin1").match(/\r\n/g) || []).length;
  const lf = (buf.toString("latin1").match(/\n/g) || []).length;
  const bareLf = lf - crlf;
  const bareCr = (buf.toString("latin1").match(/\r(?!\n)/g) || []).length;

  t.ok(crlf > 0, name + " has CRLF line endings at all");
  t.ok(bareLf === 0, name + " has no bare LF — WSH would parse the file as one line",
    bareLf + " bare LF");
  t.ok(bareCr === 0, name + " has no bare CR", bareCr + " bare CR");
}

console.log("\nWindows scripts are plain ASCII with no BOM");
for (const name of WINDOWS_SCRIPTS) {
  const buf = read(name);
  if (!buf) continue;
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  t.ok(!bom, name + " has no UTF-8 BOM");
  const high = [];
  for (let i = 0; i < buf.length; i++) if (buf[i] > 127) high.push(i);
  t.ok(high.length === 0, name + " is pure ASCII — no smart quotes or dashes to be misread",
    high.length + " byte(s), first at offset " + high[0]);
}

/* ── VBScript shape ────────────────────────────────────────────────────── */

console.log("\nthe VBScript parses structurally");
for (const name of WINDOWS_SCRIPTS.filter((n) => n.endsWith(".vbs"))) {
  const buf = read(name);
  if (!buf) continue;
  const lines = buf.toString("latin1").split("\r\n");

  const badCont = [];
  const contComment = [];
  lines.forEach((raw, i) => {
    if (/_[ \t]+$/.test(raw)) badCont.push(i + 1);
    if (/[^\w]_[ \t]*'/.test(raw)) contComment.push(i + 1);
  });
  t.ok(badCont.length === 0, name + ": no whitespace after a line-continuation underscore",
    "line(s) " + badCont.join(", "));
  t.ok(contComment.length === 0, name + ": no comment after a line continuation",
    "line(s) " + contComment.join(", "));

  const logical = [];
  let acc = "";
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (/_$/.test(line.trimEnd())) { acc += line.trimEnd().replace(/_$/, " "); continue; }
    logical.push(acc + line);
    acc = "";
  }
  if (acc) logical.push(acc);

  const code = logical
    .map((l) => l.replace(/"(?:[^"]|"")*"/g, '""'))
    .map((l) => l.replace(/'.*$/, ""))
    .map((l) => l.trim())
    .filter(Boolean);

  const count = (re) => code.filter((l) => re.test(l)).length;

  const blockIf = count(/^If\b.*\bThen$/i);
  const endIf = count(/^End If$/i);
  t.ok(blockIf === endIf, name + ": every block If has an End If",
    blockIf + " If vs " + endIf + " End If");

  for (const [open, close, label] of [
    [/^Function\b/i, /^End Function$/i, "Function"],
    [/^Sub\b/i, /^End Sub$/i, "Sub"],
    [/^For\b/i, /^Next\b/i, "For"],
    [/^Do\b/i, /^Loop\b/i, "Do"],
  ]) {
    const a = count(open), b = count(close);
    t.ok(a === b, name + ": every " + label + " is closed", a + " open vs " + b + " close");
  }

  t.ok(/^Option Explicit$/im.test(buf.toString("latin1")),
    name + ": Option Explicit is present — an undeclared variable should be an error");

  const declared = new Set();
  for (const l of code) {
    const m = l.match(/^Dim\s+(.+)$/i);
    if (m) for (const v of m[1].split(",")) declared.add(v.trim().toLowerCase());
    const f = l.match(/^(?:Function|Sub)\s+(\w+)/i);
    if (f) declared.add(f[1].toLowerCase());
  }
  const undeclared = [];
  for (const l of code) {
    const m = l.match(/^(?:Set\s+)?(\w+)\s*=/i);
    if (m && !declared.has(m[1].toLowerCase())) undeclared.push(m[1]);
  }
  t.ok(undeclared.length === 0, name + ": every assigned variable is declared",
    undeclared.join(", "));
}

/* ── ports ─────────────────────────────────────────────────────────────── */

console.log("\nthe launchers use port " + DEFAULT_PORT + ", or the one in vault.local");
{
  const vbs = read("RP Card Vault.vbs");
  if (!vbs) t.skip("the .vbs port", "not in this folder");
  else {
    const text = vbs.toString("latin1");
    const m = text.match(/^\s*PORT\s*=\s*LocalSetting\("port",\s*"(\d+)"\)/mi);
    t.ok(!!m && Number(m[1]) === DEFAULT_PORT, "the .vbs takes its port from vault.local, else " + DEFAULT_PORT, m && m[1]);
    t.ok(/If Not IsNumeric\(PORT\) Then PORT = "8790"/.test(text), "and falls back to it if vault.local's port isn't a number");
    const code = text.split("\r\n").map((l) => l.replace(/'.*$/, "")).join("\n");
    t.ok(!/\b(8777|8788)\b/.test(code), "no other port is written into its code");
  }

  for (const name of ["Start RP Card Vault.bat", "Stop RP Card Vault.bat"]) {
    const bat = read(name);
    if (!bat) { t.skip(name + " port", "not in this folder"); continue; }
    const text = bat.toString("latin1");
    const set = text.match(/set VAULT_PORT=(\d+)/i);
    t.ok(!!set && Number(set[1]) === DEFAULT_PORT, name + " defaults to " + DEFAULT_PORT, set && set[1]);
    t.ok(/for \/f "usebackq tokens=1,\* delims==" %%a in \("%~dp0vault\.local"\)/i.test(text), "and reads vault.local");
    const code = text.split("\r\n").filter((l) => !/^\s*rem\b/i.test(l)).join("\n");
    t.ok(!/\b(8777|8788)\b/.test(code), "with no other port in its code");
  }

  const ps1 = read("Create Shortcut.ps1");
  if (!ps1) t.skip("the shortcut script", "not in this folder");
  else {
    const text = ps1.toString("latin1");
    t.ok(/\$port\s*=\s*"8790"/.test(text) && /vault\.local/.test(text), "the shortcut script reads vault.local too, else " + DEFAULT_PORT);
    t.ok(/"RP Card Vault\$suffix"/.test(text) && /\(\$label\)/.test(text),
      "and puts the label in the shortcut names, so a second copy's shortcuts don't replace the first's");
  }

  const serve = read("serve.js");
  if (serve) {
    t.ok(/\|\|\s*8790;/.test(serve.toString("utf8")), "serve.js started with no port uses " + DEFAULT_PORT);
  }

  const start = read("Start RP Card Vault.bat");
  if (start) {
    const text = start.toString("latin1");
    t.ok(/node "%~dp0serve\.js" %VAULT_PORT% --restart/i.test(text),
      "Start passes --restart, so a server already on the port is replaced");
    t.ok(!/call "%~dp0Stop RP Card Vault\.bat"/i.test(text),
      "and no longer needs to shell out to the stop script to do it");
    for (const g of Array.from(new Set(text.match(/goto\s+:(\w+)/gi) || []))) {
      const label = g.split(":")[1];
      t.ok(new RegExp("^:" + label + "\\s*$", "mi").test(text), "the .bat has a :" + label + " label");
    }
    // A bracket inside an if block ends the block unless escaped.
    const titles = text.split("\r\n").filter((l) => /^\s+title\b/i.test(l));
    t.ok(titles.length > 0 && titles.every((l) => !/[^^][()]/.test(l.replace(/^\s+title\s+/i, " "))),
      "the titles inside if blocks escape their brackets", titles.join(" | "));
  }

  // A portable Node on the drive comes before an installed one.
  if (start) {
    const text = start.toString("latin1");
    const portable = text.indexOf('if exist "%~dp0node\\node.exe" set NODE_EXE=');
    t.ok(portable > 0 && portable < text.indexOf("where node"), "Start uses node\\node.exe next to it before looking for an installed Node");
    t.ok(/"%NODE_EXE%" "%~dp0serve\.js" %VAULT_PORT% --restart/.test(text), "and runs serve.js with it, on the same port");
  }
  if (vbs) {
    const text = vbs.toString("latin1");
    t.ok(/fso\.FileExists\(base & "\\node\\node\.exe"\)/.test(text) && /& nodeExe & " serve\.js "/.test(text),
      "the .vbs launcher does the same");
  }

  const stop = read("Stop RP Card Vault.bat");
  if (stop) {
    const text = stop.toString("latin1");
    t.ok(/node\.exe/i.test(text), "the stop script only stops node.exe");
    const code = text.split("\r\n").filter((l) => !/^\s*rem\b/i.test(l)).join("\n");
    t.ok(!/findstr[^\r\n]*LISTENING/i.test(code),
      "it doesn't filter on netstat's translated state column");
    t.ok(/findstr \/e \/c:":%VAULT_PORT%"/i.test(code),
      "it requires the local address to end in the port");
    t.ok(!/taskkill[^\r\n]*\/IM/i.test(text),
      "it never kills by image name — that would take SillyTavern with it");
    t.ok(/taskkill\s+\/PID/i.test(text), "it kills by PID");
    t.ok(/enabledelayedexpansion/i.test(text),
      "delayed expansion is on — a flag set inside a for loop reads as empty without it");
    t.ok(/\/quiet/i.test(text), "it has a /quiet mode for Start to call");
    t.ok(/goto :eof/i.test(text), "which returns instead of pausing");
    const announce = text.slice(0, text.indexOf("taskkill"));
    t.ok(/echo\s+Stopping the running vault server/i.test(announce),
      "and still announces every kill, quiet or not");
  }
}

console.log("\nvault.local is read the same way by every launcher (run for real on Windows)");
if (process.platform !== "win32") t.skip("running the launchers' vault.local code", "not on Windows");
else {
  const os = require("os");
  const { execFileSync } = require("child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-local-"));
  const run = (exe, args) => execFileSync(exe, args, { cwd: dir, encoding: "latin1", windowsHide: true, timeout: 30000 }).trim();
  try {
    const start = read("Start RP Card Vault.bat");
    const vbs = read("RP Card Vault.vbs");
    const ps1 = read("Create Shortcut.ps1");
    const batPart = start && start.toString("latin1").match(/set VAULT_PORT=\d+\r\nset VAULT_LABEL=\r\n[\s\S]*?\r\n\s*\)\r\n\)\r\n/);
    const vbsFn = vbs && vbs.toString("latin1").match(/Function LocalSetting[\s\S]*?End Function/);
    const vbsPort = vbs && vbs.toString("latin1").match(/PORT = LocalSetting[^\r\n]*\r\nIf Not IsNumeric[^\r\n]*/);
    const psPart = ps1 && ps1.toString("latin1").match(/\$port\s+=\s+"8790"[\s\S]*?\r\n}\r\n/);
    t.ok(!!(batPart && vbsFn && vbsPort && psPart), "each launcher's vault.local code was found");
    const probe = (local) => {
      const f = path.join(dir, "vault.local");
      if (local == null) { if (fs.existsSync(f)) fs.unlinkSync(f); } else fs.writeFileSync(f, local);
      fs.writeFileSync(path.join(dir, "probe.bat"), "@echo off\r\n" + batPart[0].replace(/%~dp0/g, dir + "\\") + "echo %VAULT_PORT%^|%VAULT_LABEL%\r\n");
      fs.writeFileSync(path.join(dir, "probe.vbs"), "Option Explicit\r\nDim fso, base, PORT\r\nSet fso = CreateObject(\"Scripting.FileSystemObject\")\r\nbase = \"" + dir + "\"\r\n" +
        vbsFn[0] + "\r\n" + vbsPort[0] + "\r\nWScript.Echo PORT & \"|\" & LocalSetting(\"label\", \"\")\r\n");
      fs.writeFileSync(path.join(dir, "probe.ps1"), "$base = \"" + dir + "\"\r\n" + psPart[0] + "Write-Output \"$port|$label\"\r\n");
      return [
        run("cmd.exe", ["/d", "/c", path.join(dir, "probe.bat")]),
        run("cscript.exe", ["//nologo", path.join(dir, "probe.vbs")]),
        run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(dir, "probe.ps1")]),
      ];
    };
    if (batPart && vbsFn && vbsPort && psPart) {
      t.eq(probe(null), ["8790|", "8790|", "8790|"], "with no vault.local: port 8790 and no label, in the .bat, the .vbs and the shortcut script");
      t.eq(probe("port=8791\r\nlabel=test\r\n"), ["8791|test", "8791|test", "8791|test"], "with one: its port and label, in all three");
      t.eq(probe("label=only\n"), ["8790|only", "8790|only", "8790|only"], "a vault.local without a port keeps " + DEFAULT_PORT);
    }
  } catch (e) {
    t.ok(false, "running the probes", String(e && e.message || e).slice(0, 200));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

{
  const html = read("RP_Card_Vault.html");
  if (!html) t.skip("the app's port references", "not in this folder");
  else {
    const code = html.toString("utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "$1")).join("\n");
    const bad = code.split("\n")
      .map((l, i) => ({ l: l.trim(), n: i + 1 }))
      .filter((x) => /\b(8777|8788|8790)\b/.test(x.l));
    t.ok(bad.length === 0,
      "RP_Card_Vault.html hardcodes no port in code — every copy runs the same page",
      bad.map((x) => "line " + x.n + ": " + x.l.slice(0, 60)).join(" | "));
  }

  const serve = read("serve.js");
  if (!serve) t.skip("serve.js default port", "not in this folder");
  else {
    t.ok(/process\.argv\[2\]/.test(serve.toString("utf8")),
      "serve.js takes its port from the command line");
  }
}

console.log("\nno space before a pipe in a batch echo");
for (const name of WINDOWS_SCRIPTS.filter((n) => n.endsWith(".bat"))) {
  const buf = read(name);
  if (!buf) continue;
  const bad = buf.toString("latin1").split("\r\n")
    .map((l, i) => ({ l: l.trim(), n: i + 1 }))
    .filter((x) => /^echo\b[^|]*[ \t]\|/.test(x.l));
  t.ok(bad.length === 0,
    name + ": no space before a pipe in an echo",
    bad.map((x) => "line " + x.n + ": " + x.l).join(" | "));
}

console.log("\nthe double-click trap is documented where it will be read");
{
  const serve = read("serve.js");
  if (!serve) t.skip("the serve.js warning", "not in this folder");
  else {
    const head = serve.toString("utf8").slice(0, 1600);
    t.ok(/DO NOT DOUBLE-CLICK/i.test(head), "serve.js warns against double-clicking, up top");
    t.ok(head.indexOf("800A03EA") >= 0, "and names the error code so a search finds it");
    t.ok(/Start RP Card Vault\.bat/.test(head), "and points at what to run instead");
  }

  const readme = read("HOW TO RUN.txt");
  if (!readme) t.skip("HOW TO RUN.txt", "not in this folder");
  else {
    const txt = readme.toString("ascii");
    t.ok(txt.indexOf("800A03EA") >= 0, "the readme explains the error code");
    t.ok(/Start RP Card Vault\.bat/.test(txt), "and names the launcher");
    t.ok(txt.indexOf(String(DEFAULT_PORT)) >= 0, "and the port");
    t.ok(/vault\.local/.test(txt) && /port=\d+/.test(txt), "and how a second copy gets its own (vault.local)");
    t.ok(!/\b(8777|8788)\b/.test(txt) && !/\bDEV copy\b|live vault/i.test(txt), "with nothing about one person's own copies");
    t.ok(/UPDATING/.test(txt) && /vault\.local/.test(txt) && /Export vault data/.test(txt), "and how to update without losing your vault data");
  }
}

t.done();
