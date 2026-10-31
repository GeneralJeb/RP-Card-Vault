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

const { mod: V } = loadPureRegion(["solidPng", "writeCardIntoPng", "buildV2Payload", "newCardPayload", "parseCardBytes", "readZipDirectory", "readZipEntry", "makeChunk", "cardPictures"]);
const cardPng = (o, rgb, more) => {
  const v3 = V.newCardPayload(o);
  Object.assign(v3.data, more || {});
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
  // The save dialog hands over an OPFS file: window.__saveAs, a path.
  await page.addInitScript(() => {
    window.showSaveFilePicker = async (o) => {
      const parts = (window.__saveAs || o.suggestedName).split("/");
      let h = await navigator.storage.getDirectory();
      for (const p of parts.slice(0, -1)) h = await h.getDirectoryHandle(p, { create: true });
      return h.getFileHandle(parts[parts.length - 1], { create: true });
    };
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
      ["Bram Lighthouse.png", cardPng({ name: "Bram Lighthouse", description: "Keeps the light.", tags: ["sea"] }, [40, 90, 120], {
        alternate_greetings: ["The lamp is lit.", "A storm is coming."],
        character_book: { name: "Coast", entries: [{ keys: ["/\\b(gulls?|terns?){1,2}\\b/i", "seabird"], content: "Birds of the coast.", insertion_order: 100 }] },
      })],
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

    await step("Ctrl+F and Ctrl+S are the browser's, not the card's f and s", async () => {
      const favourites = () => page.evaluate(() => new Promise((res) => {
        const r = indexedDB.open("rpCardVault");
        r.onsuccess = () => {
          const q = r.result.transaction("edits", "readonly").objectStore("edits").getAll();
          q.onsuccess = () => res(q.result.filter((e) => e.favorite).length);
        };
      }));
      const before = await favourites();
      await tile("Bram Lighthouse").click();
      await page.keyboard.press("Control+f");
      await page.keyboard.press("Control+s");
      await page.waitForTimeout(500);
      t.eq(await favourites(), before, "Ctrl+F doesn't favourite the card you're looking at");
      t.eq(await page.getByText("Normalize tag case and separators").count(), 0, "and Ctrl+S doesn't start a send (which opens Settings with no destination)");
      await page.keyboard.press("Escape");
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
      // The save clears the vault's edit, so the field has to show the file's new text.
      t.eq(await desc.inputValue(), "A clockmaker who repairs time itself.", "the Fields tab shows the saved text without picking another card");
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

    await step("looking through a card's lorebook and greetings changes nothing", async () => {
      await tile("Bram Lighthouse").click();
      const saved = page.getByRole("button", { name: /Saved/ }).first();
      await page.getByRole("tab", { name: /^Lorebook/ }).click();
      // A regex key can hold a comma: going in and out of the box mustn't split it.
      const keys = page.locator(".lore-keys").first();
      await keys.click();
      await keys.press("Tab");
      t.eq(await keys.inputValue(), "/\\b(gulls?|terns?){1,2}\\b/i, seabird", "the keys are as the file has them");
      t.ok(await saved.isVisible(), "and there's nothing to save");
      // Editing the keys keeps the regex whole too, and typing them back is no change.
      await keys.fill("/\\b(gulls?|terns?){1,2}\\b/i, seabird, gannet");
      await keys.press("Tab");
      t.eq(await keys.inputValue(), "/\\b(gulls?|terns?){1,2}\\b/i, seabird, gannet", "editing the keys keeps the regex key whole");
      await page.getByRole("button", { name: /Save to card \(1\)/ }).waitFor();
      await keys.fill("/\\b(gulls?|terns?){1,2}\\b/i, seabird");
      await keys.press("Tab");
      t.ok(await saved.isVisible(), "and typing them back leaves nothing to save");
      // A greeting typed back to what it was is no change either, as a field is.
      await page.getByRole("tab", { name: /^Greetings/ }).click();
      const second = page.locator("xpath=//label[starts-with(normalize-space(), 'Alternate greetings')]/following::textarea[2]");
      t.eq(await second.inputValue(), "A storm is coming.", "the second greeting is the file's");
      await second.fill("A storm is coming tonight.");
      await page.getByRole("button", { name: /Save to card \(1\)/ }).waitFor();
      await second.fill("A storm is coming.");
      t.ok(await saved.isVisible(), "typing it back leaves nothing to save");
    });

    await step("a lorebook whose scan depth isn't a number still opens", async () => {
      // The file's own value is shown as text; React can't draw an object, and
      // one used to take the whole page down.
      await writeFiles(page, "Cards", [["Eli Oddbook.png", cardPng({ name: "Eli Oddbook", description: "Odd book." }, [120, 120, 40], {
        character_book: { name: "Odd", scan_depth: { depth: 4 }, token_budget: "lots", entries: [{ keys: ["odd"], content: "Odd." }] },
      })]]);
      await page.getByRole("button", { name: "Rescan", exact: true }).click();
      await tile("Eli Oddbook").click();
      await page.getByRole("tab", { name: /^Lorebook/ }).click();
      const row = page.locator("div").filter({ has: page.getByText("Scan depth", { exact: true }) }).last();
      await row.waitFor();
      t.eq(await row.innerText(), "Scan depth\n{\"depth\":4}", "the scan depth is shown as the file has it");
      t.ok(await tile("Eli Oddbook").isVisible(), "and the page is still there");
      await page.evaluate(async () => (await (await navigator.storage.getDirectory()).getDirectoryHandle("Cards")).removeEntry("Eli Oddbook.png"));
      await page.getByRole("button", { name: "Rescan", exact: true }).click();
      await page.waitForFunction(() => !Array.from(document.querySelectorAll(".cardTile")).some((e) => /Eli Oddbook/.test(e.textContent)));
    });

    await step("the Raw tab says when it hasn't read the card file, and asks before copying without it", async () => {
      await tile("Ada Clockmaker").click();
      await page.getByRole("tab", { name: /^Raw/ }).click();
      await page.locator("pre").filter({ hasText: "chara_card_v3" }).first().waitFor();
      await page.waitForFunction(() => !document.querySelector(".raw-warning"));
      t.ok(true, "once the file is read there's no warning");
      // A card whose file has gone since the last scan: the file can't be read.
      await writeFiles(page, "Cards", [["Dora Vanishing.png", cardPng({ name: "Dora Vanishing", description: "Here and gone." }, [120, 40, 40])]]);
      await page.getByRole("button", { name: "Rescan", exact: true }).click();
      await tile("Dora Vanishing").waitFor();
      await page.evaluate(async () => (await (await navigator.storage.getDirectory()).getDirectoryHandle("Cards")).removeEntry("Dora Vanishing.png"));
      await tile("Dora Vanishing").click();
      await page.getByRole("tab", { name: /^Raw/ }).click();
      const warn = page.locator(".raw-warning").filter({ hasText: "couldn't be read" });
      await warn.waitFor();
      t.ok(/couldn't be read/.test(await warn.innerText()) && /lorebook entry extensions/.test(await warn.innerText()), "a file that can't be read is said so, and what that leaves out", await warn.innerText());
      const asked = [];
      const seen = (d) => asked.push(d.message());
      page.on("dialog", seen);
      await page.getByRole("button", { name: "Copy V3 JSON" }).click();
      await toast(/V3 JSON copied \(without the file's extra fields\)/);
      page.off("dialog", seen);
      t.ok(asked.length === 1 && /Copy it anyway\?/.test(asked[0]), "Copy asks first, and still copies when you say yes", asked);
      await page.getByRole("button", { name: "Rescan", exact: true }).click();
      await page.waitForFunction(() => !Array.from(document.querySelectorAll(".cardTile")).some((e) => /Dora Vanishing/.test(e.textContent)));
    });

    await step("a card in a Reference folder can't be saved to its file", async () => {
      const setRole = async (role) => {
        await page.locator(".folder-tree, body").first().getByText("Cards", { exact: true }).first().click({ button: "right" });
        await page.getByText(/^Role: /).hover();
        await page.getByText(role, { exact: true }).last().click();
      };
      await setRole("Reference");
      await tile("Cora Gardener").click();
      await page.getByText("Fields", { exact: true }).click();
      const desc = page.locator("xpath=//label[normalize-space()='Description']/following::textarea[1]");
      await desc.fill("Grows roses and thorns.");
      const save = page.locator("button", { hasText: "Save to card (1)" }).first();
      await save.waitFor();
      t.ok(await save.isDisabled(), "Save to card is off");
      t.ok(/Reference folder, which is never written to/.test(await save.getAttribute("title")), "and says why", await save.getAttribute("title"));
      await desc.fill("Grows roses.");
      await setRole("Library");
      t.ok(true, "the folder is a Library again");
    });

    await step("an animated card is marked, filtered, and plays only while you point at it", async () => {
      // A two-frame APNG (red, then blue) made into a card the way Save to card does.
      const zlib = require("zlib");
      const be = (n) => { const x = Buffer.alloc(4); x.writeUInt32BE(n); return x; };
      const chunk = (type, data) => Buffer.from(V.makeChunk(type, new Uint8Array(data)));
      const pix = (r, g, bl) => zlib.deflateSync(Buffer.concat([0, 1].map(() => Buffer.from([0].concat(Array(2).fill([r, g, bl, 255]).flat())))));
      const fctl = (seq) => Buffer.concat([be(seq), be(2), be(2), be(0), be(0), Buffer.from([0, 50, 0, 100, 0, 0])]);
      const apng = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", Buffer.concat([be(2), be(2), Buffer.from([8, 6, 0, 0, 0])])),
        chunk("acTL", Buffer.concat([be(2), be(0)])), chunk("fcTL", fctl(0)), chunk("IDAT", pix(200, 40, 40)),
        chunk("fcTL", fctl(1)), chunk("fdAT", Buffer.concat([be(2), pix(40, 40, 200)])), chunk("IEND", Buffer.alloc(0)),
      ]);
      const v3 = V.newCardPayload({ name: "Animated Ada", description: "Moves." });
      await writeFiles(page, "Cards", [["Animated Ada.png", Buffer.from(V.writeCardIntoPng(new Uint8Array(apng), v3, V.buildV2Payload(v3)))]]);
      await page.getByRole("button", { name: "Rescan", exact: true }).click();
      const anim = tile("Animated Ada");
      await anim.waitFor();
      t.ok(await anim.getByTitle("Animated picture").isVisible(), "its tile has the ▶ badge");
      t.eq(await tile("Ada Clockmaker").getByTitle("Animated picture").count(), 0, "a still card doesn't");
      await page.getByText("Animated", { exact: true }).first().click();
      await page.waitForFunction(() => /\b1 shown\b/.test(document.body.innerText));
      t.ok(true, "the Animated filter shows just that card");
      await page.getByText("Animated", { exact: true }).first().click();
      await page.mouse.move(2, 2);
      t.eq(await page.locator(".card-moving").count(), 0, "nothing plays while nothing is pointed at");
      await anim.hover();
      const moving = anim.locator("img.card-moving");
      await moving.waitFor();
      t.ok(/^blob:/.test(await moving.getAttribute("src")), "pointing at it plays the card's own file");
      await page.mouse.move(2, 2);
      await page.waitForFunction(() => !document.querySelector(".cardTile .card-moving"));
      t.ok(true, "and it stops when you move away");
      await anim.click();
      await page.mouse.move(2, 2);
      await page.locator(".card-moving").first().waitFor();
      t.eq(await page.locator(".cardTile .card-moving").count(), 0, "the card panel plays it, the grid doesn't");
      const setMode = async (label) => {
        await page.getByRole("button", { name: "⚙" }).first().click();
        const sel = page.getByLabel("Animated card pictures");
        const was = await sel.inputValue();
        await sel.selectOption({ label });
        await page.getByRole("button", { name: "Close", exact: true }).click();
        return was;
      };
      // Never play: neither the grid nor the card panel.
      t.eq(await setMode("Never play"), "hover", "Settings starts at Play when you point at them");
      await anim.hover();
      await page.waitForTimeout(800);
      t.eq(await page.locator(".card-moving").count(), 0, "with Never play, neither plays");
      // Always play: it plays with nothing pointed at, and still cards stay still.
      await setMode("Always play");
      await page.mouse.move(2, 2);
      await anim.locator("img.card-moving").waitFor();
      t.ok(true, "with Always play, the tile plays without being pointed at");
      t.eq(await page.locator(".cardTile .card-moving").count(), 1, "and only the animated card does");
      await setMode("Play when you point at them");
      await page.waitForFunction(() => !document.querySelector(".cardTile .card-moving"));
      t.ok(true, "back to pointing, it stops");
      await page.evaluate(async () => (await (await navigator.storage.getDirectory()).getDirectoryHandle("Cards")).removeEntry("Animated Ada.png"));
      await page.getByRole("button", { name: "Rescan", exact: true }).click();
      await page.waitForFunction(() => !Array.from(document.querySelectorAll(".cardTile")).some((e) => /Animated Ada/.test(e.textContent)));
    });

    await step("a .charx card shows its picture, saves as a .charx and downloads in any format", async () => {
      const JSZip = global.JSZip = require("../lib/jszip.min.js");
      const pic = (rgb) => Buffer.from(V.solidPng(30, 40, rgb));
      const cx = V.newCardPayload({ name: "Charx Cora", description: "Before." });
      cx.data.assets = [{ type: "icon", uri: "embeded://assets/icon/images/main.png", name: "main", ext: "png" },
        { type: "emotion", uri: "embeded://assets/emotion/images/sad.png", name: "sad", ext: "png" }];
      const zip = new JSZip();
      zip.file("card.json", JSON.stringify(cx));
      zip.file("assets/icon/images/main.png", pic([160, 30, 30]));
      zip.file("assets/emotion/images/sad.png", pic([30, 30, 160]));
      zip.file("module.risum", "a front end's own module");
      await writeFiles(page, "Cards", [["Charx Cora.charx", await zip.generateAsync({ type: "nodebuffer" })]]);
      await page.getByRole("button", { name: "Rescan", exact: true }).click();
      await tile("Charx Cora").locator("img").first().waitFor();
      t.ok(true, "its tile shows the icon packed in it");

      await tile("Charx Cora").click();
      await page.getByText("Fields", { exact: true }).click();
      await page.locator("xpath=//label[normalize-space()='Description']/following::textarea[1]").fill("After.");
      await page.getByRole("button", { name: /Save to card \(1\)/ }).click();
      await page.getByRole("button", { name: /Saved/ }).first().waitFor();
      const saved = await readFile(page, "Cards", "Charx Cora.charx");
      const back = await V.parseCardBytes(saved, "Charx Cora.charx");
      const inside = await JSZip.loadAsync(saved);
      t.ok(back.ok && back.data.description === "After.", "Save to card writes into the .charx", back.data && back.data.description);
      t.ok(Buffer.compare(await inside.file("assets/emotion/images/sad.png").async("nodebuffer"), pic([30, 30, 160])) === 0 && !!inside.file("module.risum"),
        "and its pictures and other files are still in it");

      const download = async (act) => {
        const [dl] = await Promise.all([page.waitForEvent("download"), act()]);
        return { name: dl.suggestedFilename(), bytes: new Uint8Array(fs.readFileSync(await dl.path())) };
      };
      const own = await download(() => page.getByRole("button", { name: "Download copy" }).click());
      t.eq(own.name, "Charx Cora (vault).charx", "Download copy keeps the card's own format");
      const asPng = await download(() => page.getByLabel("Download as").selectOption("png"));
      const png = await V.parseCardBytes(asPng.bytes, asPng.name);
      t.ok(asPng.name === "Charx Cora (vault).png" && png.ok && png.data.description === "After.", "Download as PNG gives a PNG card", asPng.name);
      t.eq((await V.cardPictures(asPng.bytes, asPng.name)).pictures.map((p) => p.name), ["Card picture", "sad"], "with the icon as its picture and the expression inside");
      const asJson = await download(() => page.getByLabel("Download as").selectOption("json"));
      t.ok(asJson.name === "Charx Cora (vault).json" && JSON.parse(Buffer.from(asJson.bytes).toString()).data.description === "After.", "Download as JSON gives the text", asJson.name);
      await toast(/2 pictures or files couldn't come along \(JSON holds no pictures/);
      t.ok(true, "and says the two pictures were left out");

      await page.getByRole("button", { name: "Duplicate" }).click();
      await page.waitForFunction(() => Array.from(document.querySelectorAll(".cardTile")).some((e) => /Charx Cora \(copy\)/.test(e.textContent)));
      t.ok(Object.keys(await listFiles(page, "Cards")).includes("Charx Cora (copy).charx"), "Duplicate makes a .charx too");

      await page.keyboard.press("Escape");
      await page.evaluate(async () => {
        const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("Cards");
        for (const n of ["Charx Cora.charx", "Charx Cora (copy).charx"]) await d.removeEntry(n);
      });
      await page.getByRole("button", { name: "Rescan", exact: true }).click();
      await page.waitForFunction(() => !Array.from(document.querySelectorAll(".cardTile")).some((e) => /Charx Cora/.test(e.textContent)));
    });

    await step("a card's picture opens full size, and its Gallery shows the pictures it embeds", async () => {
      const pic = (rgb) => V.solidPng(30, 40, rgb);
      const b64 = (x) => Buffer.from(x).toString("base64");
      const v3 = V.newCardPayload({ name: "Gallery Gwen", description: "Has pictures." });
      v3.data.assets = [
        { type: "icon", uri: "ccdefault:", name: "main", ext: "png" },
        { type: "emotion", uri: "__asset:0", name: "happy", ext: "png" },
        { type: "background", uri: "data:image/png;base64," + b64(pic([0, 120, 0])), name: "meadow", ext: "png" },
      ];
      let card = Buffer.from(V.writeCardIntoPng(pic([160, 30, 30]), v3, V.buildV2Payload(v3)));
      const chunk = Buffer.from(V.makeChunk("tEXt", new Uint8Array(Buffer.concat([Buffer.from("chara-ext-asset_:0"), Buffer.from([0]), Buffer.from(b64(pic([30, 30, 160])))]))));
      card = Buffer.concat([card.subarray(0, card.length - 12), chunk, card.subarray(card.length - 12)]);
      await writeFiles(page, "Cards", [["Gallery Gwen.png", card]]);
      await page.getByRole("button", { name: "Rescan", exact: true }).click();
      await tile("Gallery Gwen").click();

      const viewer = page.locator(".picture-viewer");
      const caption = viewer.locator(".picture-caption");
      await page.locator(".inspector-picture").click();
      await viewer.waitFor();
      await page.waitForFunction(() => /30 × 40/.test((document.querySelector(".picture-caption") || {}).textContent || ""));
      t.ok(/^Card picture · 30 × 40 · 1 of 3$/.test((await caption.innerText()).trim()), "clicking the card's picture opens it full size, at its real size", await caption.innerText());
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() => /happy/.test(document.querySelector(".picture-caption").textContent));
      t.ok(/^happy · emotion/.test((await caption.innerText()).trim()), "→ steps to the next picture the card holds", await caption.innerText());
      await page.keyboard.press("Escape");
      await viewer.waitFor({ state: "detached" });
      t.ok(await page.locator(".inspector-picture").isVisible(), "Escape closes the picture, and the card stays open");

      await page.getByRole("tab", { name: /^Gallery/ }).click();
      const items = page.locator(".card-gallery .gallery-item");
      await items.first().waitFor();
      t.eq(await items.count(), 3, "the Gallery tab shows the card's own picture and the two it embeds");
      await items.nth(2).click();
      await viewer.waitFor();
      t.ok(/^meadow · background/.test((await caption.innerText()).trim()), "clicking one opens that one", await caption.innerText());
      await viewer.click({ position: { x: 5, y: 5 } });
      await viewer.waitFor({ state: "detached" });
      t.ok(true, "a click outside the picture closes it");

      // With Never play, pictures are drawn still.
      await page.getByRole("button", { name: "⚙" }).first().click();
      await page.getByLabel("Animated card pictures").selectOption({ label: "Never play" });
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await items.first().click();
      await viewer.locator("canvas").waitFor();
      t.eq(await viewer.locator("img").count(), 0, "with Never play the full-size picture is a still");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "⚙" }).first().click();
      await page.getByLabel("Animated card pictures").selectOption({ label: "Play when you point at them" });
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.evaluate(async () => (await (await navigator.storage.getDirectory()).getDirectoryHandle("Cards")).removeEntry("Gallery Gwen.png"));
      await page.getByRole("button", { name: "Rescan", exact: true }).click();
      await page.waitForFunction(() => !Array.from(document.querySelectorAll(".cardTile")).some((e) => /Gallery Gwen/.test(e.textContent)));
    });

    await step("Shift-click selects the cards between, in the order shown now", async () => {
      const sort = page.locator("select").filter({ has: page.locator("option[value='nameDesc']") }).first();
      const was = await sort.inputValue();
      await sort.selectOption("name");
      await tile("Ada Clockmaker").click();
      await page.keyboard.press("Escape");
      // Z–A puts Cora first. The range starts at Ada wherever Ada is now, not
      // at the place Ada had before the re-sort (Cora's place now).
      await sort.selectOption("nameDesc");
      await tile("Bram Lighthouse").click({ modifiers: ["Shift"] });
      await page.getByText(/\b\d+ selected\b/).first().waitFor();
      const n = Number(((await page.locator("body").innerText()).match(/(\d+) selected/) || [])[1]);
      t.eq(n, 2, "Ada to Bram is 2 cards, Cora isn't one of them");
      await page.getByRole("button", { name: "clear", exact: true }).click();
      await sort.selectOption(was);
    });

    await step("taking a merged tag off a selection takes off every spelling of it", async () => {
      const managerRow = (k) => page.locator(".tagRow", { has: page.getByRole("button", { name: "pin" }) }).filter({ hasText: k }).first();
      await page.getByRole("button", { name: "Tags", exact: true }).click();
      await managerRow("sea").getByRole("button", { name: "merge…" }).click();
      await managerRow("victorian").getByRole("button", { name: "← merge here" }).click();
      await page.getByText("sea → victorian").waitFor();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await tile("Ada Clockmaker").click();
      await tile("Bram Lighthouse").click({ modifiers: ["Control"] });
      await page.getByText("2 selected").waitFor();
      await page.getByRole("button", { name: "Tag…", exact: true }).click();
      const remove = page.getByPlaceholder("add tag, Enter to commit").nth(1);
      await remove.fill("Victorian");
      await remove.press("Enter");
      await page.getByRole("button", { name: /^Apply to 2/ }).click();
      await toast(/Tagged 2 cards/);
      const listed = (await page.locator("body").innerText()).split("\n").filter((l) => /^(victorian|sea)$/i.test(l.trim()));
      t.eq(listed, [], "neither Ada's \"victorian\" nor Bram's \"sea\" (merged into it) is left in the tag list");
      // Put the tag settings back for the steps after this one.
      await page.getByRole("button", { name: "Tags", exact: true }).click();
      await page.getByText("sea → victorian").locator("span").click();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "clear", exact: true }).click();
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
      // The same message again, before the first has gone: the first one's
      // timer (4.2 s) must not take the second down with it.
      await page.waitForTimeout(1900);
      await page.getByRole("button", { name: "Back up now" }).click();
      await page.waitForTimeout(2500);
      t.ok(await page.getByText(/Vault data backed up to Cards\/_vault data/).first().isVisible(),
        "Back up now again a moment later says so too, for its own full time");
      await page.getByRole("button", { name: "Close", exact: true }).click();
    });

    await step("sending always says what happened", async () => {
      // "File cards away after sending" on, but no folder chosen for it.
      await page.getByRole("button", { name: "⚙" }).first().click();
      await page.getByText("File cards away after sending them").click();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      // The Bram in Cards, not the copy already in Frontend (which stays where it is).
      await page.getByText("Cards", { exact: true }).first().click();
      await page.waitForFunction(() => /\b2 shown\b/.test(document.body.innerText));
      await tile("Bram Lighthouse").click({ button: "right" });
      await page.getByText("Send to front end", { exact: true }).click();
      await toast(/not filed away: no folder is chosen/);
      t.ok(true, "with filing on but no folder, the send says it didn't file the card away");
      await page.getByText("Cards", { exact: true }).first().click();
      await page.waitForFunction(() => /\b3 shown\b/.test(document.body.innerText));
      await page.getByRole("button", { name: "⚙" }).first().click();
      await page.getByText("File cards away after sending them").click();
      await page.getByRole("button", { name: "Close", exact: true }).click();

      // A card that leaves the vault (renamed on disk, then rescanned) leaves the selection too.
      await tile("Ada Clockmaker").click();
      await tile("Bram Lighthouse").click({ modifiers: ["Control"] });
      await page.getByText("2 selected").waitFor();
      await writeFiles(page, "Cards", [["Bram Renamed.png", Buffer.from(await readFile(page, "Cards", "Bram Lighthouse.png"))]]);
      await page.evaluate(async () => (await (await navigator.storage.getDirectory()).getDirectoryHandle("Cards")).removeEntry("Bram Lighthouse.png"));
      await page.getByRole("button", { name: "Rescan", exact: true }).click();
      await page.waitForFunction(() => !/\b2 selected\b/.test(document.body.innerText), null, { timeout: 15000 });
      t.ok(true, "the renamed card drops out of the selection, so Send can't act on it");
    });

    await step("a card already in the front end's folder stays there when sends are filed away", async () => {
      await writeFiles(page, "Frontend", [["Dina Diver.png", cardPng({ name: "Dina Diver", description: "Dives for pearls.", tags: [] }, [30, 60, 150])]]);
      await page.getByRole("button", { name: "Rescan", exact: true }).click();
      await tile("Dina Diver").waitFor({ timeout: 15000 });
      // Filing on, into Cards' top level.
      await page.getByRole("button", { name: "⚙" }).first().click();
      await page.getByText("File cards away after sending them").click();
      const pick = page.locator("select").filter({ has: page.locator("option", { hasText: "Pick a folder…" }) }).last();
      await pick.selectOption(await pick.evaluate((s) => Array.from(s.options).filter((o) => o.parentElement.label === "Cards" && o.textContent === "(top level)")[0].value));
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await tile("Dina Diver").click({ button: "right" });
      await page.getByText("Send to front end", { exact: true }).click();
      await toast(/already there/);
      await page.waitForTimeout(500);
      t.ok(Object.keys(await listFiles(page, "Frontend")).indexOf("Dina Diver.png") >= 0, "Dina Diver is still in the front end's folder");
      t.ok(!Object.keys(await listFiles(page, "Cards")).some((f) => /Dina Diver/.test(f)), "and wasn't filed away out of it");
      await page.getByRole("button", { name: "⚙" }).first().click();
      await page.getByText("File cards away after sending them").click();
      await page.getByRole("button", { name: "Close", exact: true }).click();
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

    await step("a vault archive is exported with a password, and restored into a new folder", async () => {
      await page.evaluate(() => { window.__saveAs = "Out/vault.zip"; });
      await page.getByRole("button", { name: "⚙" }).first().click();
      await page.getByLabel("Archive password", { exact: true }).fill("s3cret");
      await page.getByLabel("Archive password again").fill("s3cret");
      await page.getByRole("button", { name: "Export archive" }).click();
      await toast(/^Archive saved: \d+ files? from \d+ folders?, .*encrypted/);
      const zip = Buffer.from(await readFile(page, "Out", "vault.zip"));
      const read = async (off, len) => new Uint8Array(zip.subarray(off, off + len));
      const entries = await V.readZipDirectory(read, zip.length);
      const names = entries.map((e) => e.name);
      t.ok(names.includes("cards/Cards/Ada Clockmaker.png") && names.includes("vault-data.json") && names.includes("manifest.json"),
        "it holds the cards, the vault data and the manifest", names);
      t.ok(!names.some((n) => /_vault (backups|data)\//.test(n)), "but not the save backups or the vault-data copies (not asked for)");
      t.ok(entries.every((e) => e.name === "README.txt" ? !(e.flags & 1) : e.flags & 1), "everything but the README is encrypted");
      const ada = entries.find((e) => e.name === "cards/Cards/Ada Clockmaker.png");
      t.eq(Buffer.from(await V.readZipEntry(read, zip.length, ada, "s3cret")).toString("hex"),
        Buffer.from(await readFile(page, "Cards", "Ada Clockmaker.png")).toString("hex"), "a card in it is the file on disk, byte for byte");

      await page.getByRole("button", { name: "⚙" }).first().click();
      const pick = () => page.getByLabel("Archive to restore").setInputFiles({ name: "vault.zip", mimeType: "application/zip", buffer: zip });
      await page.getByLabel("Archive password", { exact: true }).fill("wrong");
      await pick();
      await toast(/That password doesn't open this archive/);
      t.ok(true, "a wrong password is caught before anything is written");
      await page.getByLabel("Archive password", { exact: true }).fill("s3cret");
      await pick();
      const picked = page.locator(".archive-picked");
      await picked.waitFor();
      t.ok(/Encrypted/.test(await picked.innerText()), "the right one shows what's inside before restoring", await picked.innerText());
      await page.evaluate(() => { window.__pickFolder = "Restored"; });
      const adas = await page.locator(".cardTile").filter({ hasText: "Ada Clockmaker" }).count();
      await page.getByRole("button", { name: "Choose where to restore…" }).click();
      // One notice once it's all done: a quick scan mustn't swap it for another before you can read it.
      await toast(/^Restored \d+ files? into vault and linked \d+ folders?, and brought back \d+ card records/);
      t.ok(true, "one notice says what was restored and that the vault data is back");
      t.eq(Buffer.from(await readFile(page, "Restored", "vault/Cards/Ada Clockmaker.png")).toString("hex"),
        Buffer.from(await readFile(page, "Cards", "Ada Clockmaker.png")).toString("hex"), "the card is back on disk, in a new folder named after the archive");
      await page.waitForFunction((n) => document.querySelectorAll(".cardTile").length > 0 &&
        Array.from(document.querySelectorAll(".cardTile")).filter((e) => /Ada Clockmaker/.test(e.textContent)).length > n, adas);
      t.ok(true, "the restored folder is linked and scanned (its Ada Clockmaker is in the grid too)");
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

    await step("a card whose file is gone leaves the index, also when it's read again", async () => {
      const extras = async () => (await cardRecords()).filter((c) => /^Extra [01]\.png$/.test(c.file)).map((c) => c.file).sort();
      const gone = async (want) => {
        for (let i = 0; i < 100 && (await extras()).join() !== want.join(); i++) await page.waitForTimeout(200);
        return extras();
      };
      const rescan = async (name) => {
        await page.getByRole("button", { name: "Folders", exact: true }).click();
        await page.getByRole("button", { name }).click();
        await page.getByRole("button", { name: "Close", exact: true }).click();
      };
      const remove = (n) => page.evaluate(async (n) =>
        (await (await (await navigator.storage.getDirectory()).getDirectoryHandle("Parent")).getDirectoryHandle("Big")).removeEntry(n), n);
      t.eq(await extras(), ["Extra 0.png", "Extra 1.png"], "two of the cards are indexed");
      // Extra 1's text isn't cached, so a rescan reads it again; then its file goes.
      await page.evaluate(async () => {
        const db = await new Promise((res) => { const r = indexedDB.open("rpCardVault"); r.onsuccess = () => res(r.result); });
        const keys = await new Promise((res) => { const q = db.transaction("bodies").objectStore("bodies").getAllKeys(); q.onsuccess = () => res(q.result); });
        await new Promise((res) => { const tx = db.transaction("bodies", "readwrite"); tx.objectStore("bodies").delete(keys.find((k) => /:Big\/Extra 1\.png$/.test(k))); tx.oncomplete = res; });
      });
      await remove("Extra 1.png");
      await rescan("Rescan changed");
      t.eq(await gone(["Extra 0.png"]), ["Extra 0.png"], "a card with no cached text is dropped once its file is gone");
      await remove("Extra 0.png");
      await rescan("Full re-parse");
      t.eq(await gone([]), [], "and Full re-parse drops a card whose file is gone, so it doesn't come back after a reload");
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

    if (!reloadCrashes) await step("fixing a folder registered inside another keeps it private from the AI", async () => {
      // A registration of Parent/Big left from before, private and labelled.
      const outerId = (await page.evaluate(async () => {
        const db = await new Promise((res) => { const r = indexedDB.open("rpCardVault"); r.onsuccess = () => res(r.result); });
        const big = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("Parent")).getDirectoryHandle("Big");
        const settings = await new Promise((res) => { const q = db.transaction("kv").objectStore("kv").get("settings"); q.onsuccess = () => res(q.result); });
        await new Promise((res) => {
          const tx = db.transaction(["roots", "kv"], "readwrite");
          tx.objectStore("roots").put({ id: "oldbig", name: "Big", role: "archive", handle: big, addedAt: Date.now(), lastScan: 0 });
          tx.objectStore("kv").put(Object.assign({}, settings, { privateFolders: ["oldbig::"] }), "settings");
          tx.oncomplete = res;
        });
      }), (await cardRecords()).find((c) => /^Extra \d+\.png$/.test(c.file)).rootId);
      await page.reload();
      await page.locator("#root[data-mounted='1']").waitFor({ timeout: 30000 });
      await page.getByText(/sits inside/).first().waitFor();
      await page.getByRole("button", { name: "Fix it" }).click();
      await toast(/Dropped the duplicate registration/);
      const kv = await page.evaluate(async () => {
        const db = await new Promise((res) => { const r = indexedDB.open("rpCardVault"); r.onsuccess = () => res(r.result); });
        const get = (k) => new Promise((res) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result); });
        return { priv: (await get("settings")).privateFolders, roles: await get("folderRoles") };
      });
      t.ok(kv.priv.indexOf(outerId + "::Big") >= 0, "Parent/Big is still private from the AI", kv.priv);
      t.eq(kv.roles[outerId + "::Big"], "archive", "and keeps its role as a label");
      t.ok(!(await rootKeys()).includes("oldbig"), "the inner registration is gone");
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
