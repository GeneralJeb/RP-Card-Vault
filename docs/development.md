# Development

## Tests

```
npm install
npm test
```

`test/browser.test.js` drives the real page in a headless browser through Playwright: it adds a folder of test cards, searches, edits and saves a card, tags, trashes, sends to a folder destination and reloads. If it fails, it saves a screenshot to your temp folder.

The vault runs in any Chromium browser, so the test does too:

```
node test/browser.test.js           the first installed of Edge, Chrome, Brave, then Playwright's own Chromium
node test/browser.test.js brave     that one (edge, chrome, brave, chromium, or the path to a browser's program)
npm run test:browsers               each of those that is installed, one after the other
```

A browser you name has to be installed, or the run fails. With no browser at all the suite is skipped locally (and fails on GitHub). Playwright's own Chromium needs `npx playwright install chromium` once. Firefox and Safari aren't run, because the vault can't file cards in them; what the page says to someone who opens it in one, or in a Brave with folder access still switched off, is checked in every run.

The packages are for the tests only; the vault itself needs nothing installed but Node. Keep Babel pinned to 7.23.9, the version in `lib`. The same tests run on GitHub, on Windows, for every pull request.

The launcher suite (`node test/launchers.test.js`) runs each system's launchers for real: the `.bat`, `.vbs` and `.ps1` files on Windows, and `start.sh` and `stop.sh` on a Mac or Linux. GitHub runs it on all three. It needs no packages installed.

On GitHub, every pull request runs: every suite on Windows (the browser test in Edge), the browser test again in Chrome and in Brave, every suite on Linux, and the launcher and browser suites on a Mac.

## Branches and releases

- Work goes into the `dev` branch through pull requests. `main` holds releases, and `dev` is merged into it by hand.
- The version lives in four places that must agree (a test checks): `APP_VERSION` in `RP_Card_Vault.html`, `VAULT_VERSION` in `serve.js`, `package.json` (and its lockfile), and the newest `## x.y.z` heading of `CHANGELOG.md`.
- The first change after a release raises the version and starts a new `CHANGELOG.md` section; later changes add to it.
- When `main` gets a version that has no release yet, GitHub tags it `v<version>` and publishes a release with that version's changelog section.

## Working on the code

For anyone picking the project up, person or coding assistant. These are the things that aren't obvious from the files.

- **Start from `dev`, not `main`.** `main` only moves at a release and can be many versions behind. Branch from `dev` and open the pull request into `dev`.
- **Where things are.** `RP_Card_Vault.html` is the whole page. Everything above the `/*__PURE_JS_END__*/` line is plain JavaScript with no React in it, which the tests load straight from the file (`test/pure-region.js`); put new logic there and keep the components below it thin. `serve.js` is the local server and has no dependencies. Nothing may load from the internet.
- **Reproduce before fixing.** Write the failing check first, see it fail, then fix. A test that only confirms what the code already does proves nothing.
- **A user-facing change raises the version** in all four places and adds a `CHANGELOG.md` entry. Entries are written for someone using the vault, not reading its code: what was wrong or missing, then what happens now. A change to tests, workflows or these documents alone doesn't raise it.
- **Your organising work is keyed by content.** Notes, tags, flags, ratings and unsaved changes are stored under a fingerprint of a card's name, description and first message, so copies of one card share them. Anything new kept on that record has to be carried in `editAfterSave` and `mergeEditRecords`, or it is lost when a card is saved or edited elsewhere.
- **Card files are only changed by copy, check, then replace.** Saves, moves, renames and restores all compare what was written byte for byte before the original goes. Keep to that for anything new that writes a card file.
- **Chromium 153 closes itself** when a page that has saved a folder reopens its saved data (fixed in 154). The page shows a notice instead of opening on 153. Playwright 1.63's own Chromium is a 153, so in that browser the browser test skips the steps that reload after a folder is added; don't add a reload to a step that runs there.
- **Line endings matter for the launchers.** The Windows ones (`.bat`, `.vbs`, `.ps1`, `HOW TO RUN.txt`) must be CRLF and plain ASCII; the Mac and Linux ones (`.sh`, `.command`) must be LF and marked as programs in git. `.gitattributes` sets this and the launcher suite checks it.
- **The libraries in `lib` are pinned by hash.** Changing one means changing its hash in the page and `LIB_HASH` in `sw.js`; the release suite says what to change.

## Bundled libraries

React, ReactDOM, Babel and JSZip are in `lib`, pinned by hash. [`lib/LICENSES.md`](../lib/LICENSES.md) lists their versions and licenses, and how to change one.
