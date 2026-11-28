# Log

Newest first. Each run adds one entry: the date, the section checked, GitHub issues seen, what was found (confirmed bugs with their pull requests; suspicions that couldn't be reproduced, and why; or nothing), what was queued, and any proposals round opened.

## 2026-11-28 — section 4, Folders, moves, trash and renames

**Read:**
- `8b. FOLDER TREE + MOVE`: `referenceFolderError`, `cardFileLock`, `effectiveFolderRole`, `moveCardTo`, `copyIntoRoot`, `deleteCardFile`, `defaultKeeper`, the trash and private-folder tests.
- `safeFileName`, `renameBase`, `planRename`, `renameCardFile`.
- `resolveDupeGroups` in `App`.
- Tests: `test/card-files.test.js`.

On `dev` at 1.8.8 (#96 merged).

**Issues:** #95 only (the panel's round 1). Proposals 1 and 3 are ticked. **Own pull requests:** none open at the start.

**Queued bug re-checked:** the Dupes "Exact copies" mislabel still holds. It stays queued: a fix means reading big files after every rescan, and thinning already checks bytes and says which copies weren't the same.

**Findings:**
- **Confirmed: renaming from a pattern changed a card's own name.** `renameBase` tidied the whole filled-in result, so with `{name}`, "Alien v Predator" was renamed "Alien Predator" and "Kramer v Kramer" became "Kramer Kramer". Fixed in [#98](https://github.com/GeneralJeb/RP-Card-Vault/pull/98) (1.8.9): only what the pattern adds is tidied.
- **Looked at, fine:**
  - Moves and renames copy, compare byte for byte, then remove the original.
  - A move into the same folder under another spelling is a no-op.
  - Reference folders are refused everywhere, their backups included.
  - Rename keeps names unique per folder, whatever their case.
  - `safeFileName` avoids Windows device names and trailing dots.

**Feature built:** round 1, proposal 1, "Strip card text and other hidden data from photos sent to the agent chat": [#99](https://github.com/GeneralJeb/RP-Card-Vault/pull/99) (1.9.0). Proposal 3 (bulk-run cost) is ticked and comes next run.

**Queued:** the Dupes mislabel (unchanged).

## 2026-11-27 — section 3, Duplicates, versions and filing from the inbox

**Read:**
- `8. DUPLICATE DETECTION + INGEST PLANNING`, all of it: `creatorKnown`, `sameCardVersions`, `versionSets`, `versionGroupKey`, `makeDupeExcluder`, `detectDupes`, `verifiedExactCopies`, `planIngest`, `copyIntoRoot`.
- "Cards that read alike": `textShingles`, `minHashSignature`, `similarGroups`.
- `8c. TEXT DIFF`: `diffTokens`, `diffText`.
- `IngestModal`'s plan and run.
- Tests: `test/card-files.test.js`.

On `dev` at 1.8.7 (#94 merged).

**Issues:** #95 only: the feature panel's round 1, recorded in `proposalIssues` by the panel's session. It has no ticks yet, so step 5 had nothing to build. **Own pull requests:** none open at the start.

**Findings:**
- **Confirmed: Ingest skipped a big card's same-size edit as a byte-identical copy.** `byteSignature` reads only the first 256 KB and last 64 KB of a file over 320 KB. I made a 385 KB JSON card with a same-length typo fixed about 300 KB in. It shared the filed card's signature, and `planIngest` called it "Byte-identical copy already filed" and skipped it, as skip is the default. Fixed in [#96](https://github.com/GeneralJeb/RP-Card-Vault/pull/96) (1.8.8): such matches are now compared byte for byte before the plan is shown.
  - SillyTavern-written PNGs weren't hit: the last text chunk's checksum sits in the sampled tail and changes with any edit.
- **Confirmed, queued:** the Dupes view lists the same pair under Exact copies. Thinning is protected by `verifiedExactCopies`, so nothing can be lost, but the view says something untrue. It's in state.json `queued`, with how to reproduce it.
- **Looked at, fine:**
  - Dismissed groups drop out of the duplicate badge.
  - The trash and the vault's backups are left out of both Dupes and Ingest.
  - Version groups follow the 1.8.3 rule.
  - `versionSets` stops comparing wording past 600 cards of one name.
  - `copyIntoRoot` never overwrites a differing file.
  - `diffTokens` caps its table at 25M cells.

**Queued:** the Dupes exact-copies mislabel (above).

**Afterwards:** #96's macOS job failed once, in the browser step "ingest doesn't hold on to a folder that's no longer linked": a 15 s wait timed out, and no screenshot was kept. That step passed on Windows Chrome, Brave and Ubuntu in the same run. The owner merged #96, and the same code then passed every job on `dev`, macOS included (run 45922569344). So it doesn't reproduce: a one-off slowness on that runner, not the change. If the step fails on macOS again, look into it then.

## 2026-11-26 — section 2, Scanning and the index

**Read:** `2. INDEXEDDB LAYER`, all of it (`dbOpen`, `dbPutMany`, `dbDelCardRecords`, `dbHas`, `probeReads`), and `7. FILE SYSTEM ACCESS + SCAN ENGINE`, all of it (`listCardFiles`, `processCardFile`, `pngIsAnimated`, `reusableRecord`, `scanRoot`, `scanImportRoot`). Also `assignShortIds`, and the code in `App` that applies a scan's results: short ids, changed-outside marks, fingerprints followed. On `dev` at 1.8.6 (#93 merged).

**Issues:** none open. **Own pull requests:** none open at the start.

**Findings:**
- **Confirmed: a cut-off PNG gave `__NEED_FULL__` as its reason.** A PNG that ends partway through a chunk, with no card text before the cut, showed that internal marker in the card panel. Reproduced with `processCardFile` on a small and on a large cut-off file. Fixed in [#94](https://github.com/GeneralJeb/RP-Card-Vault/pull/94) (1.8.7).
- **Suspected, not reproduced: deleted subfolders may stay in the folder tree.** After a scan, `App` keeps the folder's old `dirs` when the scan returns none (`res.dirs && res.dirs.length ? res.dirs : root.dirs`). So if every subfolder of a card folder is removed outside the vault, the tree would still show them. That keeping is right for an import folder that wasn't attached again, which returns no `dirs`. The code is in the component, so it needs the browser test to show it, and I didn't build that today. Nothing changed. Worth reproducing in a later run.
- **Looked at, fine:**
  - A folder that can't be read keeps its cards rather than dropping them.
  - A file that is listed but can't be opened keeps its old record.
  - A stopped scan keeps the cards it hadn't reached.
  - Unopened records are never reused.
  - A failed read of the database is caught by `probeReads` before anything is loaded.

**Queued:** nothing.

## 2026-11-25 — section 1, Card files

**Read:** `4. PNG CHUNK READER / WRITER` and `5. CARD NORMALIZATION`, all of them (`readPngChunks`, `extractPngText`, `writeCardIntoPng`, `rewritePngText`, `normalizeCard`, `normalizeLorebook`, `parseCardBytes`, the .charx helpers). Also `cardPackedFiles`, `cardPictures`, `writeCardFile`, `buildV3Payload`, `buildV2Payload` and `mergeLorebookForSave`, and their callers `materializeEdit`, `saveCardToFile` and `cardReplacementBytes`. Tests: `test/card-files.test.js`. On `dev` at 1.8.5.

**Issues:** none open. **Own pull requests:** none open at the start.

**Probes:**
- A V3 PNG with every field, saved with no edits.
- A V2 JSON card whose lorebook is in SillyTavern's form (`entries` as an object; `key`, `keysecondary`, `order`, `disable`).
- A PNG with a RisuAI asset chunk, converted to .charx, then back to PNG and to JSON.

The pictures and asset lists came through every conversion, and the lorebook keeps its own spellings in step.

**Findings:**
- **Confirmed: a .charx lost its picture when a JSON card was put in its place.** The JSON card's asset list (often none) replaced the .charx's own, so the packed icon was no longer named. The dialog said the file keeps its picture. Fixed in [#93](https://github.com/GeneralJeb/RP-Card-Vault/pull/93) (1.8.6).
- **Looked at, not a bug:** an empty alternate greeting (`""`) is dropped on save, because `normalizeCard` filters out empty entries. Nothing a user wrote is lost, so nothing was changed. Lorebook entries also gain default fields on save (`secondary_keys: []`, `constant: false` and the like), which front ends read the same way.

**Queued:** nothing.

## 2026-11-24 — the feature panel moves to its own task

At the owner's request, the feature debate is now a separate scheduled task every five days, keeping its personas privately, so personas.md has left this branch. The daily run no longer holds debates. Proposal issues are now known by their numbers in state.json `proposalIssues`, not by title.

## 2026-11-24 — set up

The daily run was set up at the owner's request, with `dev` at 1.8.5. The first run starts with section 1, Card files. There are no open issues to carry over.
