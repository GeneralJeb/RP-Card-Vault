/**
 * The launcher files: Windows' (.bat, .vbs, .ps1), and the Mac and Linux ones
 * (start.sh, stop.sh, Start RP Card Vault.command).
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
 * The Mac and Linux launchers have the opposite trap: saved with Windows (CRLF)
 * line endings, "#!/bin/sh" ends in a CR and the file won't start at all. They
 * must also be marked as programs, which a Windows checkout can't show, so the
 * mark is checked where git keeps it.
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

const UNIX_SCRIPTS = ["start.sh", "stop.sh", "Start RP Card Vault.command"];

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
    const portable = text.indexOf('if exist "%~dp0node\\node.exe" set "NODE_EXE=');
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
    t.ok(!/enabledelayedexpansion/i.test(text) && !/!FOUND!/.test(text),
      "delayed expansion is off (it drops a ! from the folder's path), and the found flag is read after the loop");
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
  const { execFileSync, spawnSync } = require("child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-local-"));
  const run = (exe, args) => execFileSync(exe, args, { cwd: dir, encoding: "latin1", windowsHide: true, timeout: 30000 }).trim();
  // A .bat that hits a syntax error says so on stderr and stops, so that is part of its answer.
  const runBat = (file) => {
    const r = spawnSync("cmd.exe", ["/d", "/c", file], { cwd: dir, encoding: "latin1", windowsHide: true, timeout: 30000 });
    return (r.stdout + (r.stderr ? "ERROR " + r.stderr : "")).trim();
  };
  try {
    const start = read("Start RP Card Vault.bat");
    const stop = read("Stop RP Card Vault.bat");
    const vbs = read("RP Card Vault.vbs");
    const ps1 = read("Create Shortcut.ps1");
    // Start's part runs on through the window title, which shows the label.
    const batPart = start && start.toString("latin1").match(/set VAULT_PORT=\d+\r\nset VAULT_LABEL=\r\n[\s\S]*?\r\nif defined VAULT_LABEL \([\s\S]*?\r\n\)\r\n/);
    const stopPart = stop && stop.toString("latin1").match(/set VAULT_PORT=\d+\r\n[\s\S]*?(?=set FOUND=0\r\n)/);
    const vbsFn = vbs && vbs.toString("latin1").match(/Function LocalSetting[\s\S]*?End Function/);
    const vbsPort = vbs && vbs.toString("latin1").match(/PORT = LocalSetting[^\r\n]*\r\nIf Not IsNumeric[^\r\n]*/);
    const psPart = ps1 && ps1.toString("latin1").match(/\$port\s+=\s+"8790"[\s\S]*?\r\n}\r\n/);
    t.ok(!!(batPart && stopPart && vbsFn && vbsPort && psPart), "each launcher's vault.local code was found");
    const probe = (local) => {
      const f = path.join(dir, "vault.local");
      if (local == null) { if (fs.existsSync(f)) fs.unlinkSync(f); } else fs.writeFileSync(f, local);
      fs.writeFileSync(path.join(dir, "probe.bat"), "@echo off\r\n" + batPart[0].replace(/%~dp0/g, dir + "\\") + "for /f \"delims=\" %%x in (\"%VAULT_PORT%|%VAULT_LABEL%\") do echo %%x\r\n");
      fs.writeFileSync(path.join(dir, "stop.bat"), "@echo off\r\nsetlocal\r\n" + stopPart[0].replace(/%~dp0/g, dir + "\\") + "echo %VAULT_PORT%\r\n");
      fs.writeFileSync(path.join(dir, "probe.vbs"), "Option Explicit\r\nDim fso, base, PORT\r\nSet fso = CreateObject(\"Scripting.FileSystemObject\")\r\nbase = \"" + dir + "\"\r\n" +
        vbsFn[0] + "\r\n" + vbsPort[0] + "\r\nWScript.Echo PORT & \"|\" & LocalSetting(\"label\", \"\")\r\n");
      fs.writeFileSync(path.join(dir, "probe.ps1"), "$base = \"" + dir + "\"\r\n" + psPart[0] + "Write-Output \"$port|$label\"\r\n");
      return [
        runBat(path.join(dir, "probe.bat")),
        run("cscript.exe", ["//nologo", path.join(dir, "probe.vbs")]),
        run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(dir, "probe.ps1")]),
        runBat(path.join(dir, "stop.bat")) + " (Stop)",
      ];
    };
    if (batPart && stopPart && vbsFn && vbsPort && psPart) {
      t.eq(probe(null), ["8790|", "8790|", "8790|", "8790 (Stop)"], "with no vault.local: port 8790 and no label, in Start, the .vbs, the shortcut script and Stop");
      t.eq(probe("port=8791\r\nlabel=test\r\n"), ["8791|test", "8791|test", "8791|test", "8791 (Stop)"], "with one: its port and label, in all four");
      t.eq(probe("label=only\n"), ["8790|only", "8790|only", "8790|only", "8790 (Stop)"], "a vault.local without a port keeps " + DEFAULT_PORT);
      t.eq(probe("port = 8791\r\nlabel = test\r\n"), ["8791|test", "8791|test", "8791|test", "8791 (Stop)"], "spaces around the = are allowed, in all four");
      t.eq(probe("  port=8791 \r\n"), ["8791|", "8791|", "8791|", "8791 (Stop)"], "and spaces before or after a line");
      t.eq(probe("port=8791\r\nlabel=old (backup) & more\r\n"),
        ["8791|old (backup) & more", "8791|old (backup) & more", "8791|old (backup) & more", "8791 (Stop)"],
        "a label with brackets or an & in it is only a label: Start's window title survives it");
      t.eq(probe("port=abc\r\n"), ["8790|", "8790|", "8790|", "8790 (Stop)"], "a port that isn't a number means " + DEFAULT_PORT + ", in all four");
    }
  } catch (e) {
    t.ok(false, "running the probes", String(e && e.message || e).slice(0, 200));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\nthe launchers work from a folder whose name has ( ) & ! or [ ] in it (run for real on Windows)");
if (process.platform !== "win32") t.skip("running the launchers from an odd folder", "not on Windows");
else {
  const os = require("os");
  const { spawnSync } = require("child_process");
  // "RP-Card-Vault (1)" is what Windows names a second download of the zip.
  const top = fs.mkdtempSync(path.join(os.tmpdir(), "vault-odd-"));
  const dir = path.join(top, "RP-Card-Vault (1) & co! [2]");
  // As Explorer runs a double-clicked .bat: cmd /c ""full path"".
  const runBat = (file) => {
    const r = spawnSync("cmd.exe", ["/d", "/s", "/c", "\"\"" + file + "\"\""],
      { cwd: top, encoding: "latin1", windowsHide: true, timeout: 30000, input: "", windowsVerbatimArguments: true,
        env: Object.assign({}, process.env, { PATH: path.dirname(process.execPath) + ";" + process.env.PATH }) });
    return (r.stdout + (r.stderr ? "ERROR " + r.stderr : "")).trim();
  };
  try {
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "vault.local"), "port=8799\r\n");
    const start = read("Start RP Card Vault.bat");
    const stop = read("Stop RP Card Vault.bat");
    const ps1 = read("Create Shortcut.ps1");
    t.ok(!!(start && stop && ps1), "the launchers were found");
    if (start && stop && ps1) {
      // Start, the whole file, with a serve.js that only says where it ran.
      fs.writeFileSync(path.join(dir, "Start RP Card Vault.bat"), start);
      fs.writeFileSync(path.join(dir, "serve.js"), "console.log('PROBE ' + process.cwd() + ' ' + process.argv.slice(2).join(' '));\n");
      let out = runBat(path.join(dir, "Start RP Card Vault.bat"));
      t.ok(/RP_Card_Vault\.html is not in this folder/.test(out) && out.indexOf("    " + dir + "\\") >= 0 && !/ERROR/.test(out),
        "Start without the page says so and shows the whole folder", out.slice(0, 300));
      fs.writeFileSync(path.join(dir, "RP_Card_Vault.html"), "x");
      out = runBat(path.join(dir, "Start RP Card Vault.bat"));
      t.ok(out.indexOf("PROBE " + dir + " 8799 --restart") >= 0 && !/ERROR/.test(out),
        "Start runs serve.js from that folder on vault.local's port", out.slice(0, 300));

      // Its portable Node lookup: only the lines that pick NODE_EXE, so no Node is copied.
      const nodePart = start.toString("latin1").match(/set NODE_EXE=\r\n(?:if [^\r\n]*\r\n){2}/);
      t.ok(!!nodePart, "Start's portable Node lookup was found");
      if (nodePart) {
        fs.mkdirSync(path.join(dir, "node"));
        fs.writeFileSync(path.join(dir, "node", "node.exe"), "");
        fs.writeFileSync(path.join(dir, "node-probe.bat"), "@echo off\r\n" + nodePart[0] + "for /f \"delims=\" %%x in (\"[%NODE_EXE%]\") do echo %%x\r\n");
        out = runBat(path.join(dir, "node-probe.bat"));
        t.eq(out, "[" + dir + "\\node\\node.exe]", "and finds a portable node\\node.exe there");
      }

      // Stop, up to where it would look for a server, so nothing is ever stopped.
      const head = stop.toString("latin1");
      const cut = head.indexOf("set FOUND=0\r\n");
      t.ok(cut > 0, "Stop's vault.local code was found");
      if (cut > 0) {
        fs.writeFileSync(path.join(dir, "stop-probe.bat"), head.slice(0, cut) + "for /f \"delims=\" %%x in (\"%VAULT_PORT%|%CD%\") do echo %%x\r\n");
        t.eq(runBat(path.join(dir, "stop-probe.bat")), "8799|" + dir, "Stop reads that folder's vault.local, so it looks on the right port");
      }

      // The shortcut script, up to where it would make shortcuts.
      const ps = ps1.toString("latin1");
      const psCut = ps.indexOf("function New-VaultShortcut");
      t.ok(psCut > 0, "the shortcut script's setup was found");
      if (psCut > 0) {
        fs.writeFileSync(path.join(dir, "RP Card Vault.vbs"), "' probe\r\n");
        fs.writeFileSync(path.join(dir, "RP_Card_Vault.ico"), "x");
        fs.writeFileSync(path.join(dir, "sc-probe.ps1"), ps.slice(0, psCut) + "Write-Output \"$port|$(Test-Path -LiteralPath $icon)\"\r\n");
        const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(dir, "sc-probe.ps1")],
          { encoding: "latin1", windowsHide: true, timeout: 60000, input: "" });
        t.eq((r.stdout || "").trim(), "8799|True", "the shortcut script finds the launcher, the icon and vault.local's port", (r.stdout + r.stderr).slice(0, 300));
      }
    }
  } catch (e) {
    t.ok(false, "running the launchers from an odd folder", String(e && e.message || e).slice(0, 200));
  } finally {
    fs.rmSync(top, { recursive: true, force: true });
  }
}

console.log("\nserve.js refuses a port it can't use, in plain words");
{
  const { spawnSync } = require("child_process");
  for (const bad of ["99999", "8791.5", "-5"]) {
    const r = spawnSync(process.execPath, [path.join(ROOT, "serve.js"), bad, "--no-open"], { encoding: "utf8", windowsHide: true, timeout: 30000 });
    const said = (r.stdout || "") + (r.stderr || "");
    t.ok(r.status === 1 && said.indexOf(bad) >= 0 && /vault\.local/.test(said) && !/RangeError|\n\s+at /.test(said),
      "port " + bad + ": exits with a message naming it, not a stack trace", said.slice(0, 200));
  }
}

console.log("\nthe .vbs opens your default browser when it can run the vault (run for real on Windows)");
{
  const vbs = read("RP Card Vault.vbs");
  const text = vbs ? vbs.toString("latin1") : "";
  const fn = (n) => (text.match(new RegExp("Function " + n + "[\\s\\S]*?End Function")) || [""])[0];
  t.ok(!vbs || (fn("DefaultChromium") && /UrlAssociations\\http\\UserChoice\\ProgId/.test(text) && /found = DefaultChromium\(\)/.test(text)),
    "it asks Windows for the default browser before trying its own list");
  if (!vbs || process.platform !== "win32") t.skip("running the .vbs browser choice", vbs ? "not on Windows" : "not in this folder");
  else {
    const os = require("os");
    const { execFileSync } = require("child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-browser-"));
    try {
      const cases = [
        ['"C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --single-argument %1', "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", true],
        ['"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --single-argument %1', "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", true],
        ["C:\\Apps\\Vivaldi\\vivaldi.exe -- %1", "C:\\Apps\\Vivaldi\\vivaldi.exe", true],
        ['"C:\\Program Files\\Mozilla Firefox\\firefox.exe" -osint -url "%1"', "C:\\Program Files\\Mozilla Firefox\\firefox.exe", false],
        ["", "", false],
      ];
      const vbq = (x) => '"' + x.replace(/"/g, '""') + '"';
      fs.writeFileSync(path.join(dir, "probe.vbs"), "Option Explicit\r\nDim fso\r\nSet fso = CreateObject(\"Scripting.FileSystemObject\")\r\n" +
        fn("ExeFromCommand") + "\r\n" + fn("IsChromium") + "\r\n" +
        cases.map((c) => "WScript.Echo ExeFromCommand(" + vbq(c[0]) + ") & \"|\" & IsChromium(ExeFromCommand(" + vbq(c[0]) + "))").join("\r\n") + "\r\n");
      const got = execFileSync("cscript.exe", ["//nologo", path.join(dir, "probe.vbs")], { encoding: "latin1", windowsHide: true, timeout: 30000 }).trim().split(/\r?\n/);
      t.eq(got, cases.map((c) => c[1] + "|" + (c[2] ? "True" : "False")),
        "it reads the program from the browser's command line, and takes Chrome, Edge, Brave or Vivaldi but not Firefox");
    } catch (e) {
      t.ok(false, "running the .vbs browser choice", String(e && e.message || e).slice(0, 200));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

/* ── the Mac and Linux launchers ───────────────────────────────────────── */

console.log("\nthe Mac and Linux launchers have Unix line endings and are marked as programs");
for (const name of UNIX_SCRIPTS) {
  const buf = read(name);
  if (!buf) { t.skip(name, "not in this folder"); continue; }
  const text = buf.toString("latin1");
  t.ok(text.indexOf("\r") < 0, name + " has no CR: after \"#!/bin/sh\" one would stop it from starting");
  t.ok(text.indexOf("#!/bin/sh\n") === 0, name + " starts with #!/bin/sh");
  t.ok(!Array.from(buf).some((b) => b > 127), name + " is pure ASCII");
  if (process.platform !== "win32") t.ok((fs.statSync(path.join(ROOT, name)).mode & 0o111) !== 0, name + " is marked as a program on disk");
  // What a release is built from is git's copy, where the mark is a file mode.
  let mode = "";
  try {
    mode = require("child_process").execFileSync("git", ["ls-files", "-s", "--", name], { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 15000 }).slice(0, 6);
  } catch (e) { mode = ""; }
  if (!mode) t.skip(name + " in git", "not a git checkout");
  else t.eq(mode, "100755", name + " is marked as a program in git");
}

console.log("\nthe Mac and Linux launchers use port " + DEFAULT_PORT + ", or the one in vault.local");
{
  const start = read("start.sh"), stop = read("stop.sh"), command = read("Start RP Card Vault.command");
  for (const [name, buf] of [["start.sh", start], ["stop.sh", stop]]) {
    if (!buf) { t.skip(name + " port", "not in this folder"); continue; }
    const text = buf.toString("latin1");
    const set = text.match(/^VAULT_PORT=(\d+)$/m);
    t.ok(!!set && Number(set[1]) === DEFAULT_PORT, name + " defaults to " + DEFAULT_PORT, set && set[1]);
    t.ok(/done < "\$DIR\/vault\.local"/.test(text), "and reads vault.local");
    t.ok(/case "\$VAULT_PORT" in ''\|\*\[!0-9\]\*\) VAULT_PORT=8790 ;; esac/.test(text), "falling back to it if vault.local's port isn't a number");
    const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    t.ok(!/\b(8777|8788)\b/.test(code), "with no other port in its code");
  }
  if (start) {
    const text = start.toString("latin1");
    t.ok(/"\$NODE" "\$DIR\/serve\.js" "\$VAULT_PORT" --restart "\$@"/.test(text),
      "start.sh passes --restart, so a server already on the port is replaced, and passes its own arguments on");
    const portable = text.indexOf('if [ -x "$DIR/node/bin/node" ]; then NODE=$DIR/node/bin/node');
    t.ok(portable > 0 && portable < text.indexOf("command -v node"), "it uses node/bin/node next to it before looking for an installed Node");
    t.ok(/mktemp -d/.test(text) && /trap 'rm -rf "\$STAGE"' EXIT/.test(text) && /--bind 127\.0\.0\.1 --directory "\$STAGE"/.test(text),
      "without Node, Python serves a copy of the app's own files, on this computer only, and the copy is removed afterwards");
  }
  if (stop) {
    const text = stop.toString("latin1");
    const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    t.ok(/\/__vault\/shutdown/.test(code) && /X-Vault: 1/.test(code), "stop.sh asks the server to stop, through the vault's own address");
    t.ok(!/\b(kill|pkill|killall)\b/.test(code), "and never kills anything: only a vault server can answer that request");
  }
  if (command) t.ok(/exec sh \.\/start\.sh "\$@"/.test(command.toString("latin1")), "the .command a Mac double-clicks runs start.sh");
}

/** A port nothing is listening on. */
function freePort() {
  return new Promise((resolve) => {
    const s = require("net").createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

/** The vault server's status on a port, or null when nothing answers. */
function vaultStatus(port) {
  return new Promise((resolve) => {
    const req = require("http").get({ host: "127.0.0.1", port, path: "/__vault/status", timeout: 2000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

async function unixLaunchers() {
  console.log("\nvault.local is read by start.sh and stop.sh as the Windows launchers read it (run for real on a Mac or Linux)");
  const start = read("start.sh"), stop = read("stop.sh");
  if (process.platform === "win32" || !start || !stop) {
    t.skip("running start.sh and stop.sh", process.platform === "win32" ? "on Windows" : "not in this folder");
    return;
  }
  const os = require("os");
  const { spawn, spawnSync } = require("child_process");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-unix-"));
  const made = dir;
  let server = null;
  try {
    const block = (buf) => (buf.toString("latin1").match(/# --- vault\.local ---\n([\s\S]*?)# --- end vault\.local ---\n/) || [])[1];
    const startPart = block(start), stopPart = block(stop);
    t.ok(!!(startPart && stopPart), "each launcher's vault.local code was found");
    const probe = (local) => {
      const f = path.join(dir, "vault.local");
      if (local == null) { if (fs.existsSync(f)) fs.unlinkSync(f); } else fs.writeFileSync(f, local);
      const run = (part, print) => {
        fs.writeFileSync(path.join(dir, "probe.sh"), "DIR=$1\n" + part + print + "\n");
        return spawnSync("sh", [path.join(dir, "probe.sh"), dir], { encoding: "latin1", timeout: 30000 }).stdout.trim();
      };
      return [run(startPart, "printf '%s|%s\\n' \"$VAULT_PORT\" \"$VAULT_LABEL\""), run(stopPart, "printf '%s (Stop)\\n' \"$VAULT_PORT\"")];
    };
    if (startPart && stopPart) {
      // The same cases, with the same answers, as the Windows launchers get above.
      t.eq(probe(null), ["8790|", "8790 (Stop)"], "with no vault.local: port 8790 and no label");
      t.eq(probe("port=8791\r\nlabel=test\r\n"), ["8791|test", "8791 (Stop)"], "with one (saved on Windows, CRLF and all): its port and label");
      t.eq(probe("label=only\n"), ["8790|only", "8790 (Stop)"], "a vault.local without a port keeps " + DEFAULT_PORT);
      t.eq(probe("port = 8791\r\nlabel = test\r\n"), ["8791|test", "8791 (Stop)"], "spaces around the = are allowed");
      t.eq(probe("  port=8791 \r\n"), ["8791|", "8791 (Stop)"], "and spaces before or after a line");
      t.eq(probe("port=8791\r\nlabel=old (backup) & more\r\n"), ["8791|old (backup) & more", "8791 (Stop)"], "a label with brackets or an & in it is only a label");
      t.eq(probe("port=abc\r\n"), ["8790|", "8790 (Stop)"], "a port that isn't a number means " + DEFAULT_PORT);
      t.eq(probe("port=8791; echo hacked\n"), ["8790|", "8790 (Stop)"], "and so does one with a command after it: nothing in vault.local is ever run");
      t.eq(probe("port=8791"), ["8791|", "8791 (Stop)"], "a last line with no line break still counts");
    }

    console.log("\nstart.sh starts the vault and stop.sh stops it, from a folder with ( ) & ! [ ] in its name (run for real on a Mac or Linux)");
    // The name a second download gets, and the characters that tripped the Windows launchers.
    const top = dir;
    dir = path.join(top, "RP-Card-Vault (1) & [copy] !");
    fs.mkdirSync(dir);
    for (const name of ["start.sh", "stop.sh", "Start RP Card Vault.command", "serve.js", "RP_Card_Vault.html"]) {
      fs.copyFileSync(path.join(ROOT, name), path.join(dir, name));
    }
    const port = await freePort();
    fs.writeFileSync(path.join(dir, "vault.local"), "port = " + port + "\r\nlabel = test\r\n");
    // Started from another folder, as a double-click does, through the .command.
    let out = "";
    server = spawn("sh", [path.join(dir, "Start RP Card Vault.command"), "--no-open"], { cwd: os.tmpdir(), stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", (c) => (out += c));
    server.stderr.on("data", (c) => (out += c));
    const exited = new Promise((resolve) => server.on("exit", (code) => resolve(code)));
    let status = null;
    for (let i = 0; i < 100 && !status; i++) { await wait(100); status = await vaultStatus(port); }
    t.ok(!!status, "the server answers on vault.local's port", out.slice(-300));
    t.eq(status && status.version, require("../serve.js").VAULT_VERSION, "and it's the serve.js next to the launcher");
    t.ok(out.indexOf(dir.replace(/^\/private/, "")) >= 0 || out.indexOf(fs.realpathSync(dir)) >= 0, "serving the launcher's own folder, wherever it was started from", out.slice(0, 300));

    const stopped = spawnSync("sh", [path.join(dir, "stop.sh")], { cwd: os.tmpdir(), encoding: "utf8", timeout: 30000 });
    t.ok(/Stopped\./.test(stopped.stdout), "stop.sh says it stopped it", stopped.stdout + stopped.stderr);
    const code = await Promise.race([exited, wait(10000).then(() => "still running")]);
    t.eq(code, 0, "the server's window finishes");
    t.ok(/Server stopped\./.test(out), "and says the server stopped");
    t.ok(!(await vaultStatus(port)), "nothing answers on the port any more");
    server = null;
    const again = spawnSync("sh", [path.join(dir, "stop.sh")], { cwd: os.tmpdir(), encoding: "utf8", timeout: 30000 });
    t.ok(new RegExp("Nothing was listening on " + port).test(again.stdout), "stop.sh with nothing running says so", again.stdout + again.stderr);

    // A port no computer has: the server says so in a sentence, and the launcher's window ends.
    fs.writeFileSync(path.join(dir, "vault.local"), "port=99999\n");
    const bad = spawnSync("sh", [path.join(dir, "start.sh"), "--no-open"], { cwd: os.tmpdir(), encoding: "utf8", timeout: 30000 });
    const said = (bad.stdout || "") + (bad.stderr || "");
    t.ok(/Port 99999 can't be used/.test(said) && /vault\.local/.test(said) && !/RangeError|\n\s+at /.test(said), "a port that can't be used is said in a sentence, not a page of error text", said.slice(0, 300));
  } catch (e) {
    t.ok(false, "running start.sh and stop.sh", String(e && e.message || e).slice(0, 200));
  } finally {
    if (server) { try { server.kill(); } catch (e) { /* already gone */ } }
    fs.rmSync(made, { recursive: true, force: true });
  }
}

unixLaunchers().then(() => t.done());
