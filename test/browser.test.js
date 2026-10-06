/**
 * The real page in a real browser, end to end.
 *
 *   node test/browser.test.js
 *
 * The other suites test the parts; this one drives the page itself, the way
 * you would, in a headless Microsoft Edge driven by Playwright:
 *
 *   start → add a folder → scan → search → edit and Save to card → tag →
 *   move to trash → send to a folder destination → Settings and AI panels →
 *   reload, and everything is still there
 *
 * The folder picker can't be clicked through headless, so the test hands the
 * page a folder in the browser's private storage (OPFS) instead, filled with
 * real card files built by the page's own code. Everything runs against a
 * scratch server on a free port with a scratch workspace.
 *
 * Edge rather than Playwright's own Chromium: Edge comes with Windows (and
 * with GitHub's Windows machines) and it's a browser people really use.
 * Without Edge the suite is skipped on your computer, but fails on GitHub
 * (CI is set).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { loadPureRegion } = require("./pure-region");
const t = require("./harness");

const ROOT = path.join(__dirname, "..");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { mod: V } = loadPureRegion(["solidPng", "writeCardIntoPng", "buildV2Payload", "newCardPayload", "parseCardBytes"]);
const cardPng = (o, rgb) => {
  const v3 = V.newCardPayload(o);
  return Buffer.from(V.writeCardIntoPng(V.solidPng(40, 60, rgb), v3, V.buildV2Payload(v3)));
};

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function up(port) {
  return new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port, path: "/__vault/status" }, (res) => { res.resume(); resolve(res.statusCode === 200); })
      .on("error", () => resolve(false));
  });
}

/* ── OPFS helpers, run inside the page ── */

async function writeFiles(page, dir, files) {
  await page.evaluate(async ({ dir, files }) => {
    let d = await navigator.storage.getDirectory();
    for (const part of dir.split("/")) d = await d.getDirectoryHandle(part, { create: true });
    for (const [name, b64] of files) {
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      await w.close();
    }
  }, { dir, files: files.map(([n, buf]) => [n, buf.toString("base64")]) });
}

/** Every file under an OPFS folder, as "sub/dir/name" → size. */
async function listFiles(page, dir) {
  return page.evaluate(async (dir) => {
    const out = {};
    const walk = async (h, pre) => {
      for await (const [name, e] of h.entries()) {
        if (e.kind === "directory") await walk(e, pre + name + "/");
        else out[pre + name] = (await e.getFile()).size;
      }
    };
    await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle(dir), "");
    return out;
  }, dir);
}

async function readFile(page, dir, rel) {
  const b64 = await page.evaluate(async ({ dir, rel }) => {
    let h = await (await navigator.storage.getDirectory()).getDirectoryHandle(dir);
    const parts = rel.split("/");
    for (const p of parts.slice(0, -1)) h = await h.getDirectoryHandle(p);
    const buf = new Uint8Array(await (await (await h.getFileHandle(parts[parts.length - 1])).getFile()).arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, { dir, rel });
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function main() {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (e) { return skipAll("the playwright package isn't installed (npm install)"); }
  let browser;
  try { browser = await chromium.launch({ channel: "msedge" }); }
  catch (e) {
    if (/is not found|Executable doesn't exist|playwright install/i.test(e.message)) return skipAll("Microsoft Edge isn't installed");
    throw e;
  }
  console.log("Microsoft Edge " + browser.version());
  // Chromium 153 (and Edge 153) close the whole browser when a page that has
  // saved a folder handle opens its saved data again: a regression, fixed in
  // 154. On 153 the vault shows a notice before opening anything. On a real
  // 153 the reload step checks that it does; on a newer Edge, a tab that
  // claims to be 153 does.
  const reloadCrashes = Number(browser.version().split(".")[0]) === 153;
  const UA_153 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.3405.12";

  const port = await freePort();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "vault-browser-ws-"));
  const server = spawn(process.execPath, [path.join(ROOT, "serve.js"), String(port), "--no-open"],
    { cwd: ROOT, env: Object.assign({}, process.env, { VAULT_WORKSPACE: ws }), stdio: "ignore" });
  const cleanup = async () => {
    try { await browser.close(); } catch (e) { /* already closed */ }
    try { server.kill(); } catch (e) { /* already gone */ }
    try { fs.rmSync(ws, { recursive: true, force: true }); } catch (e) { /* busy on Windows: left in temp */ }
  };
  for (let i = 0; i < 100 && !(await up(port)); i++) await wait(100);

  const url = "http://127.0.0.1:" + port + "/RP_Card_Vault.html";
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const problems = [];
  const offsite = [];
  page.on("pageerror", (e) => problems.push("page error: " + e.message));
  page.on("console", (m) => {
    // Babel's note that the app is over 500 KB is expected and harmless.
    if (m.type() === "error" && !/code generator has deoptimised/.test(m.text())) problems.push("console: " + m.text());
  });
  // Nothing may come from anywhere but the vault itself: libraries and fonts included.
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith("http://127.0.0.1:" + port + "/") && !/^(data|blob):/.test(u)) offsite.push(u);
  });
  // Confirmations are answered yes, as you would.
  page.on("dialog", (d) => d.accept());
  // The folder picker hands over an OPFS folder: "Cards" unless told otherwise.
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () =>
      (window.__pickFolder || "Cards").split("/").reduce(async (h, part) => (await h).getDirectoryHandle(part, { create: true }), navigator.storage.getDirectory());
  });

  const toast = (re) => page.getByText(re).first().waitFor();
  const tile = (name) => page.locator(".cardTile").filter({ hasText: name }).first();
  const shown = async () => Number(((await page.getByText(/\d+ shown/).first().innerText()).match(/(\d+) shown/) || [])[1]);

  const step = async (title, fn) => {
    console.log("\n" + title);
    try { await fn(); }
    catch (e) {
      t.ok(false, title + " — " + e.message.split("\n")[0]);
      const shot = path.join(process.env.RUNNER_TEMP || os.tmpdir(), "vault-browser-fail.png");
      try { await page.screenshot({ path: shot, fullPage: true }); console.log("  screenshot: " + shot); } catch (x) { /* page gone */ }
      throw e;
    }
  };

  try {
    await step("the page starts", async () => {
      await page.goto(url);
      await page.locator("#root[data-mounted='1']").waitFor({ timeout: 30000 });
      t.ok(!(await page.getByText("RP Card Vault failed to start").count()), "no failure panel");
      t.ok(await page.evaluate(() => [typeof React, typeof ReactDOM, typeof Babel, typeof JSZip].join() === "object,object,object,function"),
        "React, ReactDOM, Babel and JSZip are loaded");
      if (reloadCrashes) {
        // A real 153 shows the browser-bug notice first. This profile is new and
        // has no saved folders yet, so going ahead is safe.
        await page.getByText(/^Update (Edge|Chrome) before opening the vault$/).waitFor();
        t.ok(true, "on a 153 browser the notice comes first");
        await page.getByRole("button", { name: "Open the vault anyway" }).click();
      }
    });

    await writeFiles(page, "Cards", [
      ["Ada Clockmaker.png", cardPng({ name: "Ada Clockmaker", description: "A clockmaker.", tags: ["victorian"] }, [90, 60, 120])],
      ["Bram Lighthouse.png", cardPng({ name: "Bram Lighthouse", description: "Keeps the light.", tags: ["sea"] }, [40, 90, 120])],
      ["Cora Gardener.png", cardPng({ name: "Cora Gardener", description: "Grows roses.", tags: [] }, [60, 120, 60])],
    ]);
    await page.evaluate(async () => (await navigator.storage.getDirectory()).getDirectoryHandle("Frontend", { create: true }));

    await step("adding a folder scans its cards", async () => {
      await page.getByText("Add a folder").first().click();
      await toast(/Scan complete — 3 cards indexed/);
      for (const n of ["Ada Clockmaker", "Bram Lighthouse", "Cora Gardener"]) t.ok(await tile(n).isVisible(), n + " is in the grid");
      t.eq(await shown(), 3, "3 shown");
      // The grid wasn't on the page when it first loaded (the "add a folder"
      // screen was), and must still measure itself. Unmeasured, it counts one
      // column and draws only the first few cards of a bigger folder.
      const cols = Number(await page.locator(".card-grid").getAttribute("data-cols"));
      t.ok(cols > 1, "the grid measured itself once it appeared (" + cols + " columns)");
    });

    await step("the vault data is backed up into the folder after the first scan", async () => {
      await toast(/Vault data backed up to Cards\/_vault data/);
      const files = Object.keys(await listFiles(page, "Cards")).filter((f) => /^_vault data\//.test(f));
      t.eq(files.length, 1, "one backup file in Cards/_vault data", files);
      t.ok(/^_vault data\/rp-card-vault-data \d{8}-\d{6}\.json$/.test(files[0] || ""), "named with the date and time", files[0]);
      const data = JSON.parse(Buffer.from(await readFile(page, "Cards", files[0])).toString("utf8"));
      t.ok(data.app === "RP Card Vault" && data.format === 2 && Array.isArray(data.edits), "it's a full vault-data export that Import vault data reads");
      t.ok(/\b3 cards\b/.test(await page.locator("body").innerText()), "and isn't indexed as a card");
    });

    await step("search narrows the grid", async () => {
      const box = page.getByPlaceholder(/^Search/);
      await box.fill("lighthouse");
      await page.waitForFunction(() => /\b1 shown\b/.test(document.body.innerText));
      t.ok(await tile("Bram Lighthouse").isVisible() && !(await tile("Ada Clockmaker").count()), "only Bram Lighthouse matches");
      await box.fill("");
      await page.waitForFunction(() => /\b3 shown\b/.test(document.body.innerText));
      t.ok(true, "clearing it brings the rest back");
    });

    await step("an edit is saved into the card file, with a backup", async () => {
      await tile("Ada Clockmaker").click();
      await page.getByText("Fields", { exact: true }).click();
      const desc = page.locator("xpath=//label[normalize-space()='Description']/following::textarea[1]");
      await desc.fill("A clockmaker who repairs time itself.");
      const save = page.getByRole("button", { name: /Save to card \(1\)/ });
      await save.click();
      await page.getByRole("button", { name: /Saved/ }).first().waitFor();
      const parsed = await V.parseCardBytes(await readFile(page, "Cards", "Ada Clockmaker.png"), "Ada Clockmaker.png");
      t.ok(parsed.ok && parsed.data.description === "A clockmaker who repairs time itself.", "the file on disk has the new description", parsed.data && parsed.data.description);
      t.eq(parsed.data.name, "Ada Clockmaker", "and keeps everything else");
      const files = Object.keys(await listFiles(page, "Cards"));
      t.ok(files.some((f) => /backup/i.test(f) && /Ada Clockmaker/.test(f)), "a backup of the original was made first", files);
      // The save rescans the folder; the backup must not be indexed as a card.
      await page.waitForTimeout(1500);
      t.ok(/\b3 cards\b/.test(await page.locator("header, body").first().innerText()), "the backup isn't counted as a card (still 3 cards)");
      t.eq(await page.getByText("_vault backups", { exact: true }).count(), 0, "and the backup folder isn't in the folder tree");
    });

    await step("a tag is added", async () => {
      await page.getByText(/^Tags & Notes/).click();
      const tagBox = page.getByPlaceholder("add tag, Enter to commit").first();   // card tags (the second box is vault-only tags)
      await tagBox.fill("clockwork");
      await tagBox.press("Enter");
      await page.getByPlaceholder("filter tags…").fill("clockwork");
      await page.locator("text=clockwork").nth(1).waitFor();
      t.ok(true, "it appears in the sidebar's tag list");
      await page.getByPlaceholder("filter tags…").fill("");
    });

    await step("moving to trash hides the card, and Show trash brings it back", async () => {
      await tile("Cora Gardener").click({ button: "right" });
      await page.getByText("Move to trash", { exact: true }).click();
      await page.waitForFunction(() => /\b2 shown\b/.test(document.body.innerText));
      t.ok(!(await tile("Cora Gardener").count()), "Cora Gardener leaves the grid");
      const files = Object.keys(await listFiles(page, "Cards"));
      t.ok(files.some((f) => /trash/i.test(f) && /Cora Gardener\.png$/.test(f)) && files.indexOf("Cora Gardener.png") < 0,
        "the file moved into the trash folder; nothing was deleted", files);
      await page.getByText("Show trash", { exact: true }).click();
      await tile("Cora Gardener").waitFor();
      t.ok(true, "Show trash shows it");
      await page.getByText("Show trash", { exact: true }).click();
    });

    await step("a card is sent to a folder destination", async () => {
      await page.evaluate(() => { window.__pickFolder = "Frontend"; });
      await page.getByRole("button", { name: "Folders", exact: true }).click();
      await page.getByRole("button", { name: "+ Add folder" }).click();
      await page.getByText(/Added Frontend/).first().waitFor();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByText("Frontend", { exact: true }).first().click({ button: "right" });
      await page.getByText("Send cards here (add as a destination)").click();
      // With one destination the card menu has a single item; with several, a Send to… submenu.
      await tile("Bram Lighthouse").click({ button: "right" });
      await page.getByText("Send to front end", { exact: true }).click();
      await toast(/sent to/i);
      const sent = Object.keys(await listFiles(page, "Frontend"));
      t.ok(sent.some((f) => /Bram Lighthouse/.test(f)), "Bram Lighthouse arrived in the front end's folder", sent);
    });

    await step("only the newest backups of a card are kept", async () => {
      await page.getByRole("button", { name: "⚙" }).first().click();
      await page.getByLabel("Backups kept per card").selectOption("3");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await tile("Ada Clockmaker").click();
      await page.getByText("Fields", { exact: true }).click();
      const desc = page.locator("xpath=//label[normalize-space()='Description']/following::textarea[1]");
      for (const n of [2, 3, 4]) {
        await desc.fill("A clockmaker who repairs time itself, take " + n + ".");
        await page.getByRole("button", { name: /Save to card \(\d+\)/ }).click();
        await page.getByRole("button", { name: /Saved/ }).first().waitFor();
        await page.waitForTimeout(300);
      }
      const backups = Object.keys(await listFiles(page, "Cards")).filter((f) => /^_vault backups\/Ada Clockmaker /.test(f));
      t.eq(backups.length, 3, "after 4 saves, 3 backups of Ada Clockmaker remain", backups);
      const parsed = await V.parseCardBytes(await readFile(page, "Cards", "Ada Clockmaker.png"), "Ada Clockmaker.png");
      t.eq(parsed.data.description, "A clockmaker who repairs time itself, take 4.", "and the card itself has the last save");
      // Back to the first description, which the reload step checks for.
      await desc.fill("A clockmaker who repairs time itself.");
      await page.getByRole("button", { name: /Save to card \(\d+\)/ }).click();
      await page.getByRole("button", { name: /Saved/ }).first().waitFor();
    });

    await step("Back up now writes another vault-data backup", async () => {
      await page.getByRole("button", { name: "⚙" }).first().click();
      await page.getByRole("button", { name: "Back up now" }).click();
      await toast(/Vault data backed up to Cards\/_vault data/);
      await page.waitForTimeout(1100);
      const files = Object.keys(await listFiles(page, "Cards")).filter((f) => /^_vault data\//.test(f));
      t.ok(files.length >= 1, "a backup is there", files);
      t.ok(await page.getByText(/^Last backup /).isVisible(), "and Settings says when the last one was made");
      await page.getByRole("button", { name: "Close", exact: true }).click();
    });

    await step("sending always says what happened", async () => {
      // "File cards away after sending" on, but no folder chosen for it.
      await page.getByRole("button", { name: "⚙" }).first().click();
      await page.getByText("File cards away after sending them").click();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await tile("Bram Lighthouse").click({ button: "right" });
      await page.getByText("Send to front end", { exact: true }).click();
      await toast(/not filed away: no folder is chosen/);
      t.ok(true, "with filing on but no folder, the send says it didn't file the card away");
      await page.getByRole("button", { name: "⚙" }).first().click();
      await page.getByText("File cards away after sending them").click();
      await page.getByRole("button", { name: "Close", exact: true }).click();

      // A card that leaves the vault (renamed on disk, then rescanned) leaves the selection too.
      await tile("Ada Clockmaker").click();
      await tile("Bram Lighthouse").click({ modifiers: ["Control"] });
      await page.getByText("2 selected").waitFor();
      await page.evaluate(async () => {
        const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("Cards");
        const f = await (await d.getFileHandle("Bram Lighthouse.png")).getFile();
        const w = await (await d.getFileHandle("Bram Renamed.png", { create: true })).createWritable();
        await w.write(await f.arrayBuffer()); await w.close();
        await d.removeEntry("Bram Lighthouse.png");
      });
      await page.getByRole("button", { name: "Rescan", exact: true }).click();
      await page.waitForFunction(() => !/\b2 selected\b/.test(document.body.innerText), null, { timeout: 15000 });
      t.ok(true, "the renamed card drops out of the selection, so Send can't act on it");
    });

    await step("Settings and the AI panel open without errors", async () => {
      await page.getByRole("button", { name: "⚙" }).first().click();
      await page.getByText("Destinations — where", { exact: false }).first().waitFor();
      t.ok(await page.getByText(/RP Card Vault v\d+\.\d+\.\d+/).first().isVisible(), "Settings shows the version");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "✦ AI" }).click();
      await page.getByText(/API key|Endpoint|Base URL/i).first().waitFor();
      t.ok(true, "the AI panel opens with no key set");
      t.eq(problems.length, 0, "no errors so far", problems);
      await page.getByRole("button", { name: "Close", exact: true }).click();
    });

    await step("the problem log in Settings collects problems, scrubbed", async () => {
      await page.evaluate(() => {
        setTimeout(() => { throw new Error("test failure for Ada Clockmaker at C:\\Users\\Jeb\\x with sk-abcdefgh12345678"); });
      });
      await page.getByRole("button", { name: "⚙" }).first().click();
      const log = page.locator(".problem-log-text");
      await log.waitFor();
      await page.waitForFunction(() => /test failure/.test(document.querySelector(".problem-log-text").innerText));
      let text = await log.innerText();
      t.ok(/^RP Card Vault problem log/.test(text) && /Vault \d+\.\d+\.\d+ · server \d+\.\d+\.\d+/.test(text), "it starts with the versions");
      t.ok(/error  Page: test failure for \[card\] at C:\\Users\\\[you\]\\x with \[key\]/.test(text),
        "a page error is logged with the card name, user name and key taken out");
      t.ok(!/Ada Clockmaker|Jeb|sk-abc/.test(text), "none of them is left anywhere");
      await page.getByText("Show card and folder names").click();
      text = await log.innerText();
      t.ok(/test failure for Ada Clockmaker/.test(text) && !/Jeb|sk-abc/.test(text), "Show card and folder names shows names, never the rest");
      await page.getByText("Show card and folder names").click();
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      t.ok(/no problems logged/.test(await log.innerText()), "Clear empties it");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      // The error thrown above was on purpose; anything else still counts.
      problems.splice(0, problems.length, ...problems.filter((p) => !/test failure for/.test(p)));
    });

    await step("a flag of your own is made in Settings and put on a card", async () => {
      await page.getByRole("button", { name: "⚙" }).first().click();
      await page.getByRole("button", { name: "+ Add a flag" }).click();
      const row = page.locator(".custom-flag-row").last();
      await row.getByLabel("Icon").fill("🎨");
      await row.getByLabel("Flag name").fill("Needs art");
      await row.getByLabel("Colour").selectOption("pink");
      await row.getByLabel("Note question").fill("What's missing?");
      await row.getByLabel("For the agent").fill("The card has no picture of its own, or only a placeholder.");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await tile("Bram Lighthouse").click({ button: "right" });
      await page.getByText(/^Flag this card/).hover();
      await page.getByText("Needs art", { exact: true }).last().click();
      const reason = page.getByPlaceholder("What's missing?");
      await reason.waitFor();
      t.ok(true, "the flag dialog asks your flag's own question");
      // Menu items act on mousedown; the click mustn't take focus away from the reason box.
      t.ok(await reason.evaluate((el) => el === document.activeElement), "and the cursor is already in the reason box");
      await page.keyboard.type("Only the default picture.");
      await page.getByRole("button", { name: /Apply “Needs art”/ }).click();
      await page.getByText("Needs art", { exact: false }).first().waitFor();
      const saved = await page.evaluate(async () => {
        const db = await new Promise((res) => { const r = indexedDB.open("rpCardVault"); r.onsuccess = () => res(r.result); });
        const all = await new Promise((res) => { const q = db.transaction("edits").objectStore("edits").getAll(); q.onsuccess = () => res(q.result); });
        return all.map((e) => (e.flags || []).map((f) => f.key + ":" + f.note)).flat();
      });
      // Keys are made when a flag is added and never change, so renaming it is safe.
      t.ok(saved.some((x) => /^u-[a-z0-9-]+:Only the default picture.$/.test(x)), "the card has the flag, with its note", saved);
    });

    // Saved folders are read by key only: their records hold folder handles,
    // and reading one back closes Chromium/Edge 153 (GitHub's Edge).
    const rootKeys = () => page.evaluate(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open("rpCardVault"); r.onsuccess = () => res(r.result); });
      return await new Promise((res) => { const q = db.transaction("roots").objectStore("roots").getAllKeys(); q.onsuccess = () => res(q.result); });
    });
    const cardRecords = () => page.evaluate(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open("rpCardVault"); r.onsuccess = () => res(r.result); });
      return await new Promise((res) => { const q = db.transaction("cards").objectStore("cards").getAll(); q.onsuccess = () => res(q.result.map((c) => ({ rootId: c.rootId, file: c.file }))); });
    });
    // Index records whose folder isn't registered (each shows as a "?" duplicate).
    const orphanCount = async () => {
      const ids = new Set(await rootKeys());
      return (await cardRecords()).filter((c) => !ids.has(c.rootId)).length;
    };

    await step("replacing a folder by the folder above it, mid-scan, leaves nothing behind", async () => {
      const many = [];
      for (let i = 0; i < 300; i++) many.push(["Extra " + i + ".png", cardPng({ name: "Extra " + i, description: "Filler card " + i + "." }, [i % 255, 80, 120])]);
      await writeFiles(page, "Parent/Big", many);
      const before = new Set(await rootKeys());
      // Add the inner folder; its 300 cards start being read...
      await page.evaluate(() => { window.__pickFolder = "Parent/Big"; });
      await page.getByRole("button", { name: "Folders", exact: true }).click();
      await page.getByRole("button", { name: "+ Add folder" }).click();
      await page.getByText(/Added Big/).first().waitFor();
      // ...and straight away the folder above it, which replaces the inner one.
      await page.evaluate(() => { window.__pickFolder = "Parent"; });
      await page.getByRole("button", { name: "+ Add folder" }).click();
      await page.getByText(/Added Parent/).first().waitFor();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      // Let both scans run to their end.
      await page.waitForTimeout(6000);
      t.eq(await orphanCount(), 0, "no records are left without a folder (no \"?\" duplicates)");
      const added = (await rootKeys()).filter((k) => !before.has(k));
      t.eq(added.length, 1, "one folder was added in the end, Parent: the inner one's scan didn't write it back", added);
      const extras = (await cardRecords()).filter((c) => /^Extra \d+\.png$/.test(c.file));
      t.ok(extras.length === 300 && extras.every((c) => c.rootId === added[0]), "each of the 300 cards is indexed once, under the folder above", extras.length);
    });

    if (!reloadCrashes) await step("leftover records from before are cleaned up when the vault opens", async () => {
      await page.evaluate(async () => {
        const db = await new Promise((res) => { const r = indexedDB.open("rpCardVault"); r.onsuccess = () => res(r.result); });
        await new Promise((res) => {
          const tx = db.transaction("cards", "readwrite");
          for (const n of ["Ada Clockmaker.png", "Bram Lighthouse.png"]) tx.objectStore("cards").put({ id: "gone:" + n, rootId: "gone", rel: n, dir: "", file: n, name: n.replace(".png", ""), ok: true, fp: "x" + n, tags: [] });
          tx.oncomplete = res;
        });
      });
      t.eq(await orphanCount(), 2, "two records without a folder are planted");
      await page.reload();
      await page.locator("#root[data-mounted='1']").waitFor({ timeout: 30000 });
      await page.getByText(/Cleaned up 2 leftover index entries/).first().waitFor();
      t.ok(true, "the vault says it cleaned them up");
      t.eq(await orphanCount(), 0, "and they're gone from the index");
    });

    await step("a theme is applied, and is there from the first moment after a reload", async () => {
      await page.getByRole("button", { name: "⚙" }).first().click();
      await page.getByLabel("Theme").selectOption("parchment");
      await page.getByLabel("Sort when the vault opens").selectOption("tokensDesc");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      t.eq(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(243, 239, 230)", "Parchment turns the page light");
      t.ok(await page.locator(".app-emblem").isVisible(), "the header shows the app's emblem");
      await page.reload({ waitUntil: "domcontentloaded" });
      const early = await page.evaluate(() => ({
        bg: document.documentElement.style.getPropertyValue("--bg-primary"),
        mounted: document.getElementById("root").getAttribute("data-mounted"),
      }));
      t.ok(early.bg === "#f3efe6", "after a reload it's on the page before the vault has even started", early);
      await page.locator("#root[data-mounted='1']").waitFor({ timeout: 30000 });
      if (!reloadCrashes) {
        await tile("Ada Clockmaker").waitFor();
        t.eq(await page.locator("select").filter({ has: page.locator("option[value='tokensDesc']") }).first().inputValue(), "tokensDesc",
          "the grid opens with the sort chosen in Settings");
        await page.getByRole("button", { name: "⚙" }).first().click();
        await page.getByLabel("Sort when the vault opens").selectOption("name");
        await page.getByLabel("Theme").selectOption("vault");
        await page.getByRole("button", { name: "Close", exact: true }).click();
        t.eq(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(13, 15, 19)", "and back to Vault");
      }
    });

    // The notice must come up before the vault opens any saved data: on a
    // real 153, opening it is what closes the browser.
    const checkNotice = async (p) => {
      await p.locator("#root[data-mounted='1']").waitFor({ timeout: 30000 });
      await p.getByText(/^Update (Edge|Chrome) before opening the vault$/).waitFor();
      t.ok(true, "a notice explains the browser bug instead of opening the vault");
      t.ok(await p.getByText(/^(edge|chrome):\/\/settings\/help$/).isVisible(), "and says how to update the browser");
      t.eq(await p.locator(".cardTile").count(), 0, "the vault itself isn't opened");
    };

    if (reloadCrashes) await step("after a reload on a real Edge 153, the notice comes up instead of a crash", async () => {
      await page.reload();
      await checkNotice(page);
      await page.waitForTimeout(3000);
      t.ok(browser.isConnected(), "and Edge is still running a few seconds later");
    });
    else await step("after a reload everything is still there", async () => {
      await page.reload();
      await page.locator("#root[data-mounted='1']").waitFor({ timeout: 30000 });
      await tile("Ada Clockmaker").waitFor();
      t.ok(await tile("Bram Lighthouse").isVisible(), "the cards are still indexed");
      await tile("Ada Clockmaker").click();
      await page.getByText("Fields", { exact: true }).click();
      t.eq(await page.locator("xpath=//label[normalize-space()='Description']/following::textarea[1]").inputValue(),
        "A clockmaker who repairs time itself.", "the saved description");
    });

    if (!reloadCrashes) await step("on a browser that claims to be 153, the notice comes first", async () => {
      const p = await ctx.newPage();
      p.on("pageerror", (e) => problems.push("page error (153 tab): " + e.message));
      p.on("dialog", (d) => d.accept());
      await p.addInitScript((ua) => {
        Object.defineProperty(Navigator.prototype, "userAgent", { get: () => ua });
        // Count every attempt to open saved data.
        window.__idbOpens = 0;
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function () { window.__idbOpens++; return open.apply(this, arguments); };
      }, UA_153);
      await p.goto(url);
      await checkNotice(p);
      await p.waitForTimeout(1000);
      t.eq(await p.evaluate(() => window.__idbOpens), 0, "nothing has opened the vault's saved data");
      // This Edge isn't really 153, so going ahead is safe here.
      await p.getByRole("button", { name: "Open the vault anyway" }).click();
      await p.locator(".cardTile").filter({ hasText: "Ada Clockmaker" }).first().waitFor();
      t.ok(await p.evaluate(() => window.__idbOpens) > 0, "Open the vault anyway opens it, with everything there");
      await p.close();
    });

    console.log("\nthroughout");
    t.eq(problems.length, 0, "no page errors or console errors", problems);
    for (const u of offsite) console.log("  fetched from outside: " + u);
    t.eq(offsite.length, 0,"nothing was fetched from anywhere but the vault (libraries and fonts come from lib/)", offsite);
  } catch (e) {
    console.log("  stopped: " + e.message.split("\n")[0]);
  } finally {
    await cleanup();
  }
  t.done();
}

function skipAll(why) {
  if (process.env.CI) { t.ok(false, "the browser test can't run: " + why); }
  else t.skip("the browser test", why);
  t.done();
}

main().catch((e) => { console.error(e); process.exit(1); });
