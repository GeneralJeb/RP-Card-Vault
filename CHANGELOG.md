# Changelog

What changed in each release of RP Card Vault, newest first. Every release is
also on the repository's Releases page, with the same notes.

**Updating:** copy the new files over the old ones (your cards, tags, notes
and chats live in the browser and in your card folders, not in these files).
The ones that matter are `RP_Card_Vault.html`, `serve.js` and the `lib` folder.
If you skipped several releases, read every section down to the one you had.

## 1.6.8

- **Sending a card that's already in your front end's folder no longer files it away out of there.** With "File cards away after sending them" on, sending a card that lives in the folder destination itself counted it as "already there", then moved it into the filing folder, so it left the front end it had just been sent to. Such a card now stays where it is; only cards that came from somewhere else are filed away.
- **A card with a very long file name keeps its file type when it's uploaded.** Names longer than 200 characters were cut short, extension and all, so a `.json` card went to SillyTavern as a PNG and its import failed. The name is now shortened before its extension.

## 1.6.7

- **The local server no longer follows a redirect to another server.** If an address you saved (an AI endpoint, or a front end under Destinations) answered by sending the request on somewhere else, the server followed it, re-sending everything: the prompt with your card's text, a sign-in's password, an importer's token header. That happened even with Local models only on. Now a redirect is only followed on the same server. A redirect anywhere else is refused, and the error names where it pointed, so you can save that address instead if it's the right one.
- **Test connection can't hang.** An AI endpoint that sent the start of its answer and then went quiet left Test connection spinning for good, and did the same to a chat when the stalled answer was an error. Both now give up after their usual time limit and say so.

## 1.6.6

- **A forked chat keeps working.** Forking at a reply that had also called tools ("Let me search." followed by a search) copied the reply but not the tools' results. With native tool calling, the endpoint then refused every message sent in the fork, because a call was left unanswered. The fork now brings that reply's tool results with it.
- **A chat closed mid-turn can carry on.** If the vault was closed or reloaded while the agent waited for you to approve a change, the chat was saved with that call unanswered, and every later message failed the same way. The agent is now told that call never ran, and the chat goes on.
- **The text-only tool fallback reads a call whole.** For a model without tool calling, a call whose own text held `</tool>` or `<tool_result>`, such as a note about how tools are called, was cut short or thrown away, and a piece of it showed up in the reply. Those tags inside a call's arguments are now just text.

## 1.6.5

- **Suggest tags no longer turns a broken answer into junk tags.** When the model's JSON was cut off at Max tokens out, or came back in another shape (the tags as one string, a bare list in brackets, a different key), the vault split the raw text on commas and suggested tags like `{"tags": ["fantasy`. With "Add vault-only tags automatically" on, those went straight onto the card. Now a cut-off answer is reported as cut off, and any other JSON is shown as an answer that wasn't in the format asked for, with nothing proposed.
- **Tighten proposes only the rewrite.** A reply that mentioned the `<rewrite>` tag before writing its block ("Here is the <rewrite> block:") had that sentence and a stray `<rewrite>` proposed as the start of the new field text. The rewrite is now the text inside the block the closing tag ends.

## 1.6.4

- **The shortcuts open your default browser.** RP Card Vault.vbs, which the desktop and Start Menu shortcuts run, always looked for Chrome first, then Edge, then Brave, whatever your default browser was. It now asks Windows for your default browser and uses it whenever it's one the vault runs in: Chrome, Edge, Brave or Vivaldi. Only when it isn't (Firefox, say) does it fall back to that list. Brave ships with the File System Access API the vault needs switched off; the vault explains how to turn it on.
- **HOW TO RUN says that closing the vault doesn't stop its server.** It keeps running in the background, so the vault opens straight away next time; Stop RP Card Vault.bat turns it off.

**Updating:** this release changes RP Card Vault.vbs and HOW TO RUN.txt as well as the usual files. Your shortcuts don't need making again.

## 1.6.3

- **Reference folders are never written to, as they say.** Creating, copying and moving cards into a Reference folder was already refused, but Save to card, Delete, Move to trash and moving cards out of one weren't. Now nothing changes a card file in a Reference folder, or puts one there, whichever part of the vault asks (the agent included). That goes for a folder you've labelled Reference inside another folder too. The inspector's Save to card button is off for those cards and says why. To change cards there, give the folder another role (right-click it in the folder tree).
- **Editing lorebook keys keeps a regex key whole.** The keys box splits what you type at commas, which cut a regex key with a comma in it, like `/(gulls?|terns?){1,2}/i`, in two. A key written as a regex (`/…/` and its flags) is now always one key, commas and all.
- **The Raw tab says when it hasn't read the card file.** The JSON there (and Copy V3 JSON and Download JSON) includes what the card file has beyond what the vault keeps itself, such as lorebook entry extensions and V3 assets, but only once the file has been read. Until then, or when the file can't be read, the tab says so, and Copy and Download ask before going ahead without it.

## 1.6.2

- **Clicking into a lorebook entry's keys and out again no longer changes them.** Leaving the keys box always split its text again at every comma, even when you hadn't typed anything. A regex key with a comma in it, like `/(gulls?|terns?){1,2}/i`, came out as `{1, 2}`, a different pattern, and the card showed a lorebook change waiting to be saved. The keys are now only read again when you change them.
- **A greeting edited back to what it was is no longer a change to save.** A field typed back to the file's text stops counting as an edit, and so does a lorebook, but alternate greetings stayed "1 local edit" (and Save to card stayed on) until you pressed "revert all greetings". The same goes for adding a greeting and removing it again.
- **New theme: Lantern (dark, low glare).** For using the vault in a dark room: like Vault, warm, but with darker, browner backgrounds and text about a fifth less bright. Its red, blue, pink and purple are lifted so they're easier to read as small text. Pick it in Settings → Theme.

## 1.6.1

- **A card file the vault can't open now shows up, saying why.** Chrome and Edge can see a file whose full path is longer than Windows' 260-character limit, but can't open it, and the scan used to leave such a card out without a word: it was in your folder but not in the vault. It's now indexed as unreadable (Filters → Unreadable), with what to do: rename it to something shorter, then rescan. The scan's notice says how many couldn't be opened, and the problem log lists them. An archive that can't read a file says the same.

## 1.6.0

- **Vault archive: everything in one .zip.** Settings → Vault archive → Export archive saves your linked card folders, as they are on disk, together with your vault data (tags, notes, ratings, edits, settings and agent chats) in a single .zip. Keep it on another drive in case something goes wrong, or use it to move the vault to another computer. It's a plain zip, so any computer can open it and you can take a card out by hand.
  - **Size:** card pictures are already compressed, so an archive comes out close to the size of your folders; the card text inside them is what shrinks. Big libraries are fine: the archive is written to disk one file at a time.
  - **Optional password:** with one, every file in the archive is encrypted with AES-256, the same way WinZip and 7-Zip do it. The vault, 7-Zip and WinRAR open it; Windows' own zip viewer can't. File and folder names still show (zip keeps them in the clear). A forgotten password can't be recovered.
  - **Left out unless you tick them:** folders you keep private from the AI, and the copies Save to card keeps in `_vault backups`.
- **Restore from archive.** Pick an archive and the vault shows what's in it first (and checks the password). Then pick a folder: the archive's folders go into a new folder inside it, named after the archive, so nothing already there is touched. They're linked and scanned, and your vault data is put back on top. Every file is checked before it's written, and anything that doesn't check out, or isn't a safe file name, is skipped and listed in the problem log.

## 1.5.10

- **Ctrl+F and Ctrl+S no longer act on the card you're looking at.** With a card open, the vault took Ctrl+F (the browser's Find) as its F key and favourited or unfavourited the card, and took Ctrl+S as its S key and started sending the card to your front end. The single-key shortcuts (F, S and the arrow keys) now only work on their own, and the browser's Ctrl, Alt and Cmd shortcuts are left to the browser.
- **Random order stays put while you work.** With the grid sorted Random, favouriting a card, typing a note or any other change dealt the whole grid again, so the card you'd just changed jumped somewhere else. Random now shuffles once each time you choose it, and new or removed cards don't reshuffle the rest. The agent chat's card list uses the same shuffle as the grid, as it does for the other sorts.
- **Tag search works with "Normalize tag case and separators" off.** The tag filter box in the sidebar, the Tag manager's search and the tag suggestions under a card's tag box found almost nothing with that setting off: typing "sci" or "Sci-Fi" didn't find "Sci-Fi", and "NSFW" didn't find "NSFW". They now find the tags as they're written, in any case.

## 1.5.9

- **Shift-click selects the cards you see between your two clicks.** The vault remembered where in the grid you last clicked, not which card, so after a re-sort, a search or a rescan, Shift-click started from whatever card had moved into that spot. That could select cards you never meant to, ready for the next Move, Trash or Delete. It now starts from the card you clicked. If that card is no longer shown, Shift-click picks just the card you click.
- **Taking a merged tag off a selection takes off every spelling of it.** After merging "sci-fi" into "Science Fiction" in the Tag manager, removing "Science Fiction" with Tag… left the cards tagged "sci-fi", so the tag stayed in the list. Tag… now matches tags the way the tag list groups them, so it removes both. Adding a tag a card already has under a merged spelling no longer adds it a second time.
- **A tag called "constructor" shows up as itself.** It was listed as "function Object() { [native code] }" and couldn't be filtered by. With "Normalize tag case and separators" off in Settings, tags such as "toString" were affected too.
- **The Tag manager suggests merging "-y" words with their "-ies" plurals.** "Story" and "stories" (or "fantasy" and "fantasies") were never suggested as the same tag, though the code meant to. "Movie" and "movies" are still suggested as before.

## 1.5.8

- **Moving a big card onto one with the same name no longer loses it.** To tell whether a file is already where it's going, the vault compares the start and end of large files, not every byte. Two versions of a big card (say a JSON card with a large lorebook, where one entry's order changed) can match on that, so moving one into a folder holding the other skipped the copy as "already there" and then removed the card you moved. Now a file only counts as already there when every byte matches; otherwise the card lands beside it as "Name (2)". The same check guards Copy to, ingest and save backups.
- **The duplicate finder's "Trash redundant" and "Delete redundant" only remove true copies.** Exact copies are found the same quick way, so a different version of a big card could be listed as an exact copy and removed. Before removing anything from an exact-copy group, the vault now checks every byte against the copy it keeps, and leaves any that differ (or that can't be read) where they are, saying how many. If the copy being kept can't be read, nothing in that group is touched.
- **Cards in the vault's own trash folder no longer count as duplicates.** With no trash folder chosen in Settings, Move to trash puts cards in "_vault trash". The duplicate finder still counted those, so a card you'd trashed made the live one look like a duplicate, and ingest called a card you wanted back "already filed". That folder is now ignored like the other trash and backup folders.

## 1.5.7

- **A folder you keep private from the AI stays private when a doubled-up registration is fixed.** When one linked folder sat inside another, the vault offered to fix it with "Fix it", which drops the inner registration and keeps the cards under the outer folder. Its settings were left behind on the dropped registration, so a private folder quietly became open to the AI, and its trash folder, folder labels and duplicate-check rules stopped applying. They now move to the same folder under the outer one, as they already did when you add the folder around a linked one.
- **A linked folder's role is kept when the folder around it is added.** Adding a folder that contains one you'd already linked dropped the inner folder's role (Inbox, Archive and so on); it's now kept as that subfolder's label, as "Fix it" does.
- **Renaming a private folder only in capitals keeps it private.** Windows treats "Secret" and "secret" as the same folder, but after such a rename the vault no longer saw it as private, and its cards could reach the AI. Private folders now match whatever the capitals.

## 1.5.6

- **Stopping a rescan no longer drops cards from the vault.** Pressing Stop part-way through a rescan took every card the scan hadn't reached yet as deleted: they vanished from the grid, lost their thumbnails and cached text, and came back with new short ids on the next scan. A stopped scan now leaves those cards as they were. The same goes for folders added with the read-only folder picker.
- **A folder that can't be read no longer leaves the scan stuck.** If a folder was removed, or couldn't be opened, while a scan listed it, the scan stopped with an error and the progress bar stayed up for good, with no Rescan button. Now an unreadable subfolder is passed over and its cards keep their place; if the whole folder can't be read, the scan says so and changes nothing.
- **A card file that's in use keeps its place.** A card the scan couldn't open at that moment, for example while another program had it locked, disappeared from the grid until the vault was reloaded. It now stays listed as it was.

## 1.5.5

- **Save to card keeps a card's assets.** Saving a v3 card wrote back only the fields the vault shows, so its list of assets (icon, emotions, backgrounds), its creator notes in other languages, and any field a front end had added of its own were dropped from the file. They are now written back as they were. The same goes for Copy and Download copy, and the Raw tab now shows them too.
- **A save that only partly reaches the disk is undone.** Save to card reads the file back to check it, but a write cut short could still pass: the older (v2) copy of the card sits first in the file and still read as the card, so the vault kept a file with half its picture and no v3 data. The check now also makes sure the file on disk is exactly what was written, and puts the original back if not.

## 1.5.4

- **Big cards keep their group-only greetings and nickname.** A card large enough that only its older (v2) copy of the data fitted in the first part of the file the scan reads was listed as v2 and lost its group-only greetings, nickname and source in the vault; the next Save to card then wrote them back empty. The scan now reads the whole file when that happens. This could hit any card that stores its v2 copy before its v3 copy, as Save to card does, at roughly 200 to 400 KB of text.
- **A lorebook with an empty slot no longer stops the card loading.** A card whose lorebook list had a `null` in it showed as unreadable ("Cannot read properties of null"). The empty slot is now skipped and the rest of the card reads as normal.
- **A .charx reads its own card.json.** When a .charx had no card.json at the top, the vault took the first file whose name merely ended in card.json, such as `discard.json`.

## 1.5.3

- **The Fields tab shows a saved change straight away.** After Save to card (for example right after accepting an AI suggestion), the Fields and Raw tabs kept showing the text from before the save until you picked another card and came back. They now reload as soon as the saved file is read back.

## 1.5.2

- **A message shown twice in a row stays up the second time.** Each message
  used to be taken down a few seconds later by its text, so the same words
  shown again soon after vanished at once: Back up now, clicked within a
  few seconds of an automatic backup, said nothing at all. Each message now
  gets its own full time on screen.
  
A tidy-up of the code changed since 1.3.0. Almost all of it works exactly as
before; two small differences:

- **Two more folder settings follow your folders** after an import or when a
  folder replaces the one inside it: the duplicate finder's per-folder
  choices, and the folders Ingest last used.
- **Ingest's "Move source to _ingested/" uses the same checked move as the
  rest of the vault,** so it shows up in the Log like any other move.

Under the hood: one copy of the "move, check, then remove" steps, one guard
against files that unpack to gigabytes, the agent chat no longer re-reads
its tool results for every piece of a streamed reply, the grid is told when
it appears instead of checking after every change, and the Python fallback
updates its copy of the vault instead of rebuilding it each start.

## 1.5.1

Fixes for GitHub's code scanning and Dependabot alerts.

- **The local server tells the page an error's message and nothing more.**
  An error with no message used to be turned into text whole, which can
  include where in the code it happened. Now the page gets a plain sentence
  and the details go to the server's window.
- **Test tooling:** regex escaping in two tests is complete, a pattern in the
  test harness can no longer slow to a crawl on unusual input, and
  `source-map-js` (used only by the tests) is updated to 1.2.2.

## 1.5.0

The look and setup review.

- **Easier to read.** The faint grey help text now passes the accessibility
  guideline for contrast (4.5:1) in the Vault, Midnight and Parchment
  themes; it was as low as 2.7:1.
- **A calmer header.** The buttons share one plain style. Colour is kept
  for what needs you: the number of duplicates, the AI when it's on (amber
  when it isn't ready), and Folders while you have none.
- **Notices sit in the bottom-right corner,** clear of the cards in the
  middle and of the buttons along the bottom of a window.
- **The card inspector's tabs wrap** onto a second line instead of running
  off the edge, and work from the keyboard.
- **The first screen is centred.** The note for people who used the vault
  before is folded under "Used the vault before?".
- **The spec badge (v3) only shows on cards in a different format** from
  most of your library, so it marks what's unusual.
- **"AI settings"** is the name of the ✦ AI window everywhere (it was "AI
  harness"). While the AI features are off, its settings are dimmed, and
  stay editable so you can set them up first.
- **"1 card", "1 folder"** in the header, not "1 cards".
- **A download for running it.** Each release now has
  `RP-Card-Vault-<version>.zip`: the vault, its launchers and the docs a
  user reads, without the tests and developer files. The README says to get
  that one and double-click `Start RP Card Vault.bat`.
- **Docs that match what happens:** the vault deletes a card file only when
  you ask, and `HOW TO RUN.txt` and `Stop RP Card Vault.bat` describe how
  starting works now.

## 1.4.4

- **Show diff is side by side.** The original text is on the left, with what
  the change takes out marked in red; the new text is on the right, with
  what it puts in marked in green. Each paragraph sits beside its new
  version, and one scroll moves both. This is the same everywhere a change
  is shown: Proposed changes, AI actions and the agent chat (where changes
  already made read "Before" and "After").
- **A proposed rewrite shows in full.** Before you open the diff, the whole
  new text is there in a box that scrolls, not just its first lines.

## 1.4.3

- **Fixed: a new vault showed only the first 6 cards.** The grid measured
  its size once, when the page opened, and a new vault has no grid then
  (it shows "Point the vault at your card folders"). Unmeasured, it drew
  one column's worth of cards, about 6, until the tile size was changed. It
  now measures itself as soon as it appears.

## 1.4.2

Fixes from a full review of the vault.

- **Fixed: moving cards could delete them.** Moving cards into the folder
  they were already in, under another spelling ("fantasy" for "Fantasy",
  which Windows treats as the same folder), removed them after "checking"
  the copy, which was the card itself. Such a move now does nothing.
- **Fixed: private folders could stop being private.** Importing vault
  data after adding your folders again, or adding a folder around a private
  one, lost the setting, and the AI could read those cards. Private folders,
  the trash, the backup and filing folders, folder destinations and folder
  labels now follow the folder. An import adds to your private folders and
  never removes one, and says if one it holds isn't linked here.
- **Fixed: one card's save could delete another's backups.** Backups now go
  in `_vault backups/` under a copy of the card's own folder path, so two
  cards with the same file name in different folders keep their own.
  Backups made before this stay where they are.
- **Ingest's "Move source to _ingested/"** no longer overwrites an earlier
  copy there (it numbers the new one), and only removes the source once its
  copy reads back the same.
- **A .charx can't make the tab run out of memory.** What its card unpacks
  to is now counted as it unpacks, not taken from the file's own header.
- **Sending to a front end can't hang.** Lumiverse, SillyTavern and other
  import calls give up after 60 seconds with a message.
- **Sending to a folder says why a card failed,** not just how many.
- **The desktop shortcut prefers Chrome and Edge over Brave,** which needs a
  setting changed before it can read folders.
- **Without Node, the Python fallback serves only the vault's own files,**
  from a temporary copy, not everything in its folder.
- **An updated library can't be left behind in the offline copy.** The
  service worker now changes whenever a library does, so it's fetched again.

## 1.4.1

- **Fixed: an answer lost after a repeated tool result.** 1.3.3 kept the
  answer only when the repeated result ended in a closing tag, but most
  tools (inspect_card, list_cards and others) return plain lines, so the
  answer was still cut and the reply failed. A repeated result now ends
  where its data does: lines of the real result, "Key: value" lines, lists
  and card lines go; the first ordinary sentence is the answer, and stays.
- **The problem log hides more:**
  - names of cards and folders that have left the vault since, private ones
    included
  - every cookie in a cookie header
  - Groq and xAI keys
  - your Windows user name, even with a card or folder called "Users"
- **The problem log is quieter:** failures the vault handles on its own
  (a model without tool calling, a file changed since it was read) aren't
  logged, and a notice repeating a server error is one line, not two.
- **"Copied" in the log's header** is now the time you pressed Copy log.

## 1.4.0

- **A problem log, to copy into a bug report.** Settings → Problem log
  lists this session's errors and warnings: failed notices, errors from the
  local server, agent chat errors (with the model and how it calls tools),
  failed AI actions and page errors, with the vault, server and browser
  versions on top. Copy log copies exactly what it shows. API keys, tokens,
  passwords, email addresses, your Windows user name, addresses on your
  network, destination user names and private cards are always taken out;
  other card and folder names are too, unless you tick Show card and folder
  names. It's kept only while the page is open and never sent anywhere.

## 1.3.3

- **An empty agent reply says why.** "The model sent back an empty reply"
  now says whether the model only repeated a tool result, ran into Max
  tokens, was blocked by the provider (with the reason it gave), or really
  sent nothing.
- **A repeated tool result no longer swallows the answer after it.** In
  text-only mode a model that repeated a result without closing the block
  lost everything it wrote after it; the block now ends where the vault's
  result did, and the answer is kept.

## 1.3.2

- **Text-only tool calls: no made-up results in replies.** In that mode a
  model could write its own `<tool_result>` block, repeating or inventing
  what a tool returned, and it showed in the chat. Only the vault writes
  those: a reply that makes one up after a tool call is cut there (the real
  result follows), and one quoted on its own is removed.

## 1.3.1

- **Sending never fails silently.** A send whose cards had left the vault
  (filed away after an earlier send, or renamed and rescanned) did nothing
  and said nothing. Now the selection drops cards that are gone, a send
  with nothing to send says so, and an unexpected error is shown instead of
  swallowed.
- **"File cards away after sending" with no folder** now says the card
  wasn't filed away, instead of skipping it quietly.
- **A connected destination says why it's locked:** "Disconnect to change
  the address or username."
- **Agent chat on endpoints that refuse tool results.** Some providers take
  tool calls but then reject the reply carrying the result ("Role 'function'
  is not supported"). The chat now switches to writing its tool calls as
  text, as it already did for models with no tool support at all.

## 1.3.0

- **The agent can see duplicates.** A new tool, list_duplicates, gives it
  the duplicate finder's groups as the Dupes view shows them: identical
  files, the same card in different files, and version drift (same name and
  creator, different content). list_cards can filter to any of those, and
  inspect_card says which copies a card has. Private cards are counted but
  never named, and groups you marked "not duplicates" stay out.

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
