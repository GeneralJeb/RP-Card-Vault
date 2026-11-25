# Log

Newest first. Each run adds one entry: the date, the section checked, GitHub issues seen, what was found (confirmed bugs with their pull requests; suspicions that couldn't be reproduced, and why; or nothing), what was queued, and any proposals round opened.

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
