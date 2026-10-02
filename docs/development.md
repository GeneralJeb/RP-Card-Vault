# Development

## Tests

```
npm install
npm test
```

`test/browser.test.js` drives the real page in a headless Microsoft Edge through Playwright: it adds a folder of test cards, searches, edits and saves a card, tags, trashes, sends to a folder destination and reloads. Edge comes with Windows; without it that suite is skipped locally (and fails on GitHub). If it fails, it saves a screenshot to your temp folder.

The packages are for the tests only; the vault itself needs nothing installed but Node. Keep Babel pinned to 7.23.9, the version in `lib`. The same tests run on GitHub, on Windows, for every pull request.

## Branches and releases

- Work goes into the `dev` branch through pull requests. `main` holds releases, and `dev` is merged into it by hand.
- The version lives in four places that must agree (a test checks): `APP_VERSION` in `RP_Card_Vault.html`, `VAULT_VERSION` in `serve.js`, `package.json` (and its lockfile), and the newest `## x.y.z` heading of `CHANGELOG.md`.
- The first change after a release raises the version and starts a new `CHANGELOG.md` section; later changes add to it.
- When `main` gets a version that has no release yet, GitHub tags it `v<version>` and publishes a release with that version's changelog section.

## Bundled libraries

React, ReactDOM, Babel and JSZip are in `lib`, pinned by hash. [`lib/LICENSES.md`](../lib/LICENSES.md) lists their versions and licenses, and how to change one.
