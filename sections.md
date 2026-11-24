# Sections

One per run, in order; after the last, back to 1. Names in `code` are functions or the page's own numbered headings (`RP_Card_Vault.html` is split by headings such as `7. FILE SYSTEM ACCESS + SCAN ENGINE`). Line numbers drift, so go by names. Each section lists the tests that cover it, and what tends to go wrong there.

## 1. Card files: reading and writing every format
- Page: `4. PNG CHUNK READER / WRITER`, `5. CARD NORMALIZATION (V1 / V2 / V3 / CHARX)`; `parseCardBytes`, `normalizeCard`, `writeCardIntoPng`, `writeCardFile`, `cardFormatOf`, the .charx helpers, `buildV2Payload`, `buildV3Payload`.
- Tests: `test/card-files.test.js`.
- Watch for: fields dropped or changed on a round trip, extensions a front end needs that get lost, malformed or hostile files (huge chunks, bad zips, bad UTF-8), V2 and V3 disagreeing in one PNG.

## 2. Scanning and the index
- Page: `7. FILE SYSTEM ACCESS + SCAN ENGINE`, `2. INDEXEDDB LAYER`; `scanRoot`, `processCardFile`, `listCardFiles`, `reusableRecord`, `assignShortIds`, `dbDelCardRecords`, `probeReads`, and the start-up load in `App`.
- Tests: `test/store.test.js`, `test/card-files.test.js`, `test/browser.test.js`.
- Watch for: cards indexed twice or lost, a stale record kept after the file changed, short ids reused or lost, a failed read taken for an empty vault.

## 3. Duplicates, versions and filing from the inbox
- Page: `8. DUPLICATE DETECTION + INGEST PLANNING`, `8c. TEXT DIFF`, "cards that read alike"; `detectDupes`, `sameCardVersions`, `versionSets`, `planIngest`, `similarGroups`, `diffText`.
- Tests: `test/card-files.test.js`, `test/destinations.test.js`.
- Watch for: unrelated cards grouped, real copies missed, dismissed groups coming back, a slow pass on thousands of cards.

## 4. Folders, moves, trash and renames
- Page: `8b. FOLDER TREE + MOVE`; `moveCardTo`, `copyIntoRoot`, `deleteCardFile`, `renameCardFile`, `planRename`, `referenceFolderError`, folder roles, the trash.
- Tests: `test/card-files.test.js`, `test/browser.test.js`.
- Watch for: a file removed before its copy is checked, anything written into a Reference folder, names that clash or are too long on Windows, notes or short ids lost by a move.

## 5. Edits, Save to card, backups and history
- Page: `13. EDIT OVERLAY + EXPORT HELPERS`, "lorebook edits", "a card's history"; `effectiveField`, `editAfterSave`, `mergeEditRecords`, `editsFollowingCards`, `saveCardToFile`, `backupsToPrune`, `restoreCardBackup`, `replaceCardFileBytes`, `cardReplacementBytes`, changed-outside marks.
- Tests: `test/card-files.test.js`, `test/store.test.js`, `test/browser.test.js`.
- Watch for: an edit or note lost on save, rename or outside change; a save undoing a change made elsewhere; the wrong backup pruned; a write not checked before the original goes.

## 6. Tags, flags, saved views and search
- Page: `6. TAG SYSTEM`, `16. DEEP SEARCH`, `12. FILTER SIDEBAR`, "saved views"; `buildTagIndex`, `resolveTags`, flags (`FLAG_PRESETS`, custom flags), `savedViewsWith`, the filter logic.
- Tests: `test/store.test.js`, `test/ai-pure.test.js`, `test/browser.test.js`.
- Watch for: aliases and hidden tags leaking, counts that don't match the grid, a saved view that restores the wrong filters, search missing what it should find.

## 7. AI prompts and the ✦ AI tab
- Page: `8d. AI HARNESS (pure)`; `aiBuildRequest`, `buildCardContext`, Reads and Never cut, `interpretAiResult`, the parsers, proposals, the answer cache; the ✦ AI tab and panel components.
- Tests: `test/ai-pure.test.js`, `test/ai-notes.test.js`, `test/ai-ui.test.js`.
- Watch for: card text escaping its fence, a request bigger than it says, a proposal overwriting newer edits, a cached answer shown as current when it isn't.

## 8. The agent chat
- Page: `8e. AGENT CHAT (pure)`, `AgentPanel`; the tools (`AGENT_TOOL_IMPL`), `agentMatchCards`, context fitting, condensing, rate limits, private folders.
- Tests: `test/agent-pure.test.js`, `test/ai-ui.test.js`.
- Watch for: a tool changing what it says it only reads, private cards reaching the model, a chat that loses or repeats messages, limits not applied.

## 9. The local server: AI relay, destinations and workspace
- `serve.js`: `AI relay — /__vault/ai/*`, `Destinations — /__vault/dest/*`, `Agent workspace: /__vault/ws/*`.
- Tests: `test/ai-routes.test.js`, `test/relay-pure.test.js`, `test/destinations.test.js`.
- Watch for: a key sent anywhere but its own address, workspace paths escaping the folder, uploads failing silently, streams left hanging.

## 10. The local server: who may use it, what it serves, starting and stopping
- `serve.js`: "Who may use /__vault/", "What this server hands out, and the headers on every answer", port handling, `--restart`, `browserCommands`; the page's `vaultFetch`; `SECURITY.md`.
- Tests: `test/security.test.js`, `test/relay-pure.test.js`, `test/launchers.test.js`.
- Watch for: a website or another app reaching `/__vault/`, a file served that shouldn't be, a restart that stops the wrong process.

## 11. Vault data: backups, export, import and the archive
- Page: "automatic backups of vault data", Export and Import vault data, the archive (WinZip AES), the restore offer, the failed-read screen, the problem log.
- Tests: `test/archive.test.js`, `test/store.test.js`, `test/problem-log.test.js`.
- Watch for: a backup that can't be restored, an emptier backup replacing a fuller one, secrets in the problem log, a wrong password accepted.

## 12. Launchers, packaging and CI
- `Start RP Card Vault.bat`, `Stop RP Card Vault.bat`, the `.vbs` files, `Create Shortcut.*`, `start.sh`, `stop.sh`, `Start RP Card Vault.command`, `HOW TO RUN.txt`, `.github/workflows/*.yml`, `sw.js`, `manifest.webmanifest`, the version in its four places.
- Tests: `test/launchers.test.js`, `test/release.test.js`.
- Watch for: line endings, paths with spaces or odd characters, `vault.local` read differently by different launchers, a release missing a file.

## 13. The grid and the card panel
- Page: `9. STYLES`, `10. SMALL REUSABLE COMPONENTS`, `11. THUMBNAILS + VIRTUALIZED GRID`, `14. INSPECTOR` (its tabs: Overview, Fields, Tags & Notes, Lorebook, Greetings, History, Raw, ✦ AI).
- Tests: `test/browser.test.js`, `test/themes.test.js`, `test/ai-ui.test.js`.
- Watch for: the panel showing another card's data after a switch, keys reaching the wrong place, text that says one thing while the code does another.

## 14. Dialogs, Settings and the app's wiring
- Page: `15. MODALS`, `17. MAIN APP` (keyboard shortcuts, selection, toasts, scans, settings).
- Tests: `test/browser.test.js`, `test/vault-sanity.test.js`.
- Watch for: a dialog closing and losing input, a setting not saved or not applied, a scan started twice, a toast that misreports what happened.
