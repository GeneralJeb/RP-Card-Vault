# Changelog

What changed in each release of RP Card Vault, newest first. Every release is
also on the repository's Releases page, with the same notes.

**Updating:** copy the new files over the old ones (your cards, tags, notes
and chats live in the browser and in your card folders, not in these files).
The ones that matter are `RP_Card_Vault.html`, `serve.js` and the `lib` folder.
If you skipped several releases, read every section down to the one you had.

## 1.2.1

- **Fixed: hundreds of duplicates with "?" for their folder.** Adding a
  folder and then, while it was still being read, the folder above it (or
  using Fix it on the nested-folder warning) let the first scan finish
  anyway: it saved every card a second time and wrote the replaced folder
  back. A scan now checks its folder still exists before saving anything,
  and removing a folder clears its records from the database itself.
- **Leftovers are cleaned up.** When the vault opens, index entries from a
  folder that's no longer there are removed, with a notice saying how many.
  No files are touched, and tags and notes are kept (they belong to the
  card's content, which the real copy still has).

## 1.2.0

- **Choose the sort the vault opens with.** Settings → Display: any sort,
  Random included, or the last one you used.
- **The cursor goes straight to the reason** when you flag a card from its
  menu, so you can type without clicking the box first.
- **A new emblem** in the top left: the app icon's stack of cards, drawn in
  your theme's colours.
- **Your vault data is backed up automatically.** Tags, notes, edits and
  chats live in the browser, which clearing browsing data wipes. Now a copy
  is saved every day into `_vault data` in your first folder (or one you
  choose), keeping the last 7. Restore one with Import vault data. Settings →
  Vault data has the folder, how often, how many, and Back up now.
- **Card backups don't pile up.** After a Save to card, that card's backups
  beyond the last 5 are removed (Settings → Editing cards: 3, 5, 10, 20, or
  every backup). Only the vault's own backup copies of that card are touched.
- **Themes.** Settings → Display: Vault (the dark, warm look so far),
  Midnight (dark, cool), Parchment (light), High contrast, or Match Windows,
  which follows Windows' light or dark setting. An accent colour of your own
  can replace the theme's. The theme is remembered, so the page opens in it.
- **Flags of your own.** Settings → Your own flags: give each a name, an
  icon, a colour, the question its note asks, and a line for the agent saying
  when to use it. They work like the built-in flags everywhere (the card
  menu, the inspector, the sidebar, search), and the agent can suggest them,
  following your line. Removing one from the list leaves it on cards that
  have it, shown in grey.
- **No outside connections at all.** The fonts now ship in `lib/fonts`, so
  the page no longer loads them from Google Fonts, which saw your IP address
  every time it started. The vault looks the same offline as online.

## 1.1.0

- **Starts with no internet.** React, ReactDOM, Babel and JSZip now ship in
  the `lib` folder, so a fresh copy (on a USB drive, say) opens on a computer
  that is offline. Each is checked against the same hash as before; if the
  `lib` folder is missing, the page falls back to cdnjs as it used to.
  Copy the `lib` folder along with the page and `serve.js` when you update.
- **Says when Node is too old.** `serve.js` needs Node.js 20 or newer and now
  says so at startup, instead of failing later with a confusing error.
- **Version numbers.** The version in Settings now follows these releases,
  and this changelog lists what changed in each.
- **Tests run on GitHub** for every pull request, on Windows, so the
  launcher checks run for real.
- **Backups aren't counted as cards.** Each Save to card leaves a copy in
  `_vault backups`; the vault no longer indexes that folder, so backups
  don't add to the card count, tag counts or Show trash. They stay on disk.
- **A warning on Chrome and Edge 153.** That version closes the whole
  browser when a page that remembers folders opens its saved data again,
  which the vault does every time it starts. On 153 the vault now shows how
  to update before opening anything. Version 154 is fine.
- **A browser test** drives the real page in Microsoft Edge on every pull
  request: add a folder, search, edit and save, tag, trash, send, reload.
- **A shorter README,** with what the vault has been tested on. USB and
  shared-computer advice moved to `docs/portable.md`.

## 1.0.0

The first numbered release: everything up to pull request #33.

- **The catalogue:** scans card folders (PNG, JSON, CharX), with search,
  tags, flags, notes, favourites, duplicates, a folder tree and a trash
  folder that stays out of the way.
- **Editing:** every card field, greetings and the lorebook, with Save to
  card (a backup is made first; card files are never deleted). Create, copy
  and move cards; bulk tags and bulk save.
- **Sending:** destinations for a front end's folder, SillyTavern, Lumiverse
  or any HTTP importer, with one default and a Send to… menu.
- **AI (optional):** card actions and an agent chat that reads, searches and
  suggests changes you approve, with a workspace, pinned cards, condensing,
  small-model mode and a model-context setting for local models.
- **Privacy:** private folders the AI never sees, a Local models only switch
  the server enforces, a log of what was sent, and OpenRouter asked not to
  log or train. The API key lives only in the local server's memory.
- **Security:** a hardened local server (only its own files, only from this
  computer, a strict content policy, pinned library hashes) and checks
  against malicious card files.
- **Portable use:** USB drives, a portable Node, "Reset and forget this
  computer", and export / import of everything the vault keeps.
