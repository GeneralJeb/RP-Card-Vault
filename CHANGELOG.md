# Changelog

What changed in each release of RP Card Vault, newest first. Every release is
also on the repository's Releases page, with the same notes.

**Updating:** copy the new files over the old ones (your cards, tags, notes
and chats live in the browser and in your card folders, not in these files).
The ones that matter are `RP_Card_Vault.html`, `serve.js` and the `lib` folder.
If you skipped several releases, read every section down to the one you had.

## 1.8.0

- **New: where a card stands with your front end.** The card panel's Overview has a **Front end** block with a line for each destination, and the sidebar has three new filters for the destination that Send uses: **In front end**, **Not sent** and **Changed since sent**. The vault works this out from what it knows itself, and never asks a front end what it holds:
  - **A folder destination** is a folder you've linked, so the vault can see into it. A card is *in the front end* when its very file is there, and *a different version is there* when a card with the same name and creator, or the same name, description and first message, is.
  - **An upload** (SillyTavern, Lumiverse, another importer) leaves a mark on the card: when it was sent, and which file it was. The card reads as *sent* while its file is still one that was sent, and *changed since it was sent* once you've saved changes into it.
  - **A copy you've reworked doesn't pass for the card you sent.** It may share the original's notes and tags, but it's a different file, so it reads as changed, or as not sent if you gave it a new name, description or first message.
  - The mark says what the vault sent, not what happened in the front end afterwards: a card you deleted or edited there still reads as sent. It's kept with your notes, so it's in your vault-data backups too.
- **New: a card changed outside the vault is marked, and shows what changed.** When a scan finds that a card's file has changed and the vault didn't write it (you edited the card in your front end, say), the card gets a ✎ badge, the new **Changed outside** filter finds it, and the card panel's new **History** tab shows the change side by side: the description, greetings, tags, lorebook and the rest, as they were and as they are. **Dismiss** takes the mark off. This is where a **Save to card** that was held back (see 1.7.1) sends you to look before you save.
- **New: a card's backups, to compare and to go back to.** Every **Save to card** already left a copy of the file as it was in `_vault backups`. The **History** tab now lists a card's backups with their dates. **Compare** shows what differs between a backup and the card now. **Restore** puts a backup back as the card's file: the file as it is now is backed up first, so going back can itself be undone, and what's written is read back and checked. Changes waiting for Save to card stay waiting.
- **New: lorebook checks.** The Lorebook tab has a **Checks** bar above the entries, with the book's token counts (always-on entries, everything at once, and its budget). Open it for what's worth a look, with the entries' numbers:
  - **To fix:** an entry with no keys that isn't always on (nothing can bring it in), a key written as a `/regular expression/` that isn't a valid one, an entry that's on but empty, and entries with the same text.
  - **To know:** a key that several entries share (they come in together), entries none of whose keys appears in the card's own text or in another entry (only the chat can bring them in), entries turned off, and a budget that everything at once wouldn't fit.
- **New: preview a greeting as a front end shows it.** The Greetings tab has a **Preview** button: the first message and the alternate greetings are shown with `{{char}}` and `{{user}}` filled in (and the older `<BOT>` and `<USER>`), and their `*markdown*` drawn. You choose the name `{{user}}` stands for. Placeholders only a front end can fill, like `{{time}}`, are left as written and listed. Card text is shown as text, so any HTML in a card appears as written and is never run.
- **New: saved views.** Set the sidebar up the way you like it (the search, the sort, tags, flags, folders, token limits), then **+ save this view** under **Views** and give it a name. Click a view to come back to it; the one on screen is marked. Saving under a name you've used replaces that view. Views are kept with your settings, so your vault-data backups carry them.
- **New: rename card files from a pattern.** Select cards and press **Rename…** in the selection bar. `{creator} - {name}` names each file after its card; `{version}`, `{tag}` (the first tag), `{spec}` and `{date}` work too, and a card without a creator doesn't come out as `- Ada`. You see every old and new name before anything happens.
  - Only the file's name changes: its type, its folder, the card inside and your notes stay as they are, and the card keeps its short id.
  - Each file is copied under its new name and compared byte for byte before the old one is removed, as a move is. A name another file already has is never written over: the renamed file gets a number.
  - Files that aren't readable as cards, or are in an imported or Reference folder, are left alone, and the list says why.
  - A renamed card's earlier backups stay under its old name in `_vault backups`, so its History tab starts again from there.
- **New: find cards that read alike.** **Dupes → Similar text → Find similar cards** compares the wording of every card's description, personality, scenario and first message, and groups the ones that share most of it without being the same card: a rework, a touched-up repost, the same character under another name. Each group says how alike its cards are, and **compare** shows them side by side. These aren't copies, so nothing there is trashed or deleted for you. It runs when you ask, on your computer, in a few seconds for a few thousand cards; nothing is sent anywhere.

## 1.7.1

- **Notes, favourites, ratings, flags and vault-only tags stay on a card that was edited somewhere else.** They're kept under a fingerprint of the card's name, description and first message, so that copies of one card share them. But when a card's description was changed in your front end, the next scan saw a new fingerprint, and everything you'd put on the card dropped out of sight (it was still stored, under the old one). A scan now carries a card's record over when its file has changed. A copy that wasn't edited keeps the record too, and if the card now matches one that already has notes, the two are joined. Changes waiting for **Save to card** follow the card as well.
- **Save to card can't undo a change made somewhere else.** A save wrote every field from the vault's own copy of the card, taken at the last scan. If the file had changed since (edited in your front end, say), the save quietly put the old text back, and still said it had worked. Now:
  - A file that has changed since the vault last read it is **not written**. The vault says so, reads the card again, and your changes wait on it to be saved after a look.
  - A save takes every field it doesn't change **from the file itself**, as it is at that moment.
  - A card whose text never reached the vault's cache can no longer be saved with its other fields blank. A bulk **Save to card** could do that; the button in the card panel was already off for such a card.
- **A cleared browser no longer costs you your vault-data backups.** The automatic backups in `_vault data` are there for exactly this, but after the browser's data was cleared the vault started again empty, wrote a backup of nothing on the first scan, and removed the oldest real one to make room. A week on, every real backup was gone, and nothing had offered to bring one back. Now:
  - When a backup in the folder holds far more than the vault does, the vault **offers to bring it back**, in a bar above your cards. **Not now** puts the bar away for that backup.
  - An empty vault writes no backup while such a one is there.
  - A backup that holds far more than the vault does now is **never removed** to make room, however many newer ones there are.
- **The agent's workspace refuses files named only by an extension.** It takes text files only, by extension, so that a card can't talk the agent into leaving a program for you to open. A name like `.bat`, `.vbs` or `.html` slipped through, because such a name counts as having no extension, though Windows runs a file called `.bat` as a batch file all the same. They're refused now, for new files and for renames. A text file whose name starts with a dot (`.notes.md`) is still fine.
- **A move checks every byte of the copy.** Before the original is removed, the copy was compared by a signature that only samples the start and end of a big file, so a copy damaged in the middle would have passed. The whole copy is compared now.
- **A writable folder inside a Reference folder can be saved to.** With backups on, **Save to card** failed there, saying its backup folder was a Reference folder. A folder's backups can now be written wherever its cards can.
- **The safety notes say what the vault does.** `SECURITY.md` and `CONTRIBUTING.md` said the vault never deletes a card file. It does when you ask it to (**Delete permanently**, or deleting duplicates), after asking, as the README says.

## 1.7.0

- **The vault runs on a Mac and on Linux.** It was Windows only, because its launchers were. There are now launchers for the other two, in every download:
  - **Mac:** double-click **`Start RP Card Vault.command`**. The first time, macOS may refuse a file that came from the internet: right-click it, choose **Open**, and confirm.
  - **Linux:** run **`./start.sh`** in a terminal in the vault's folder (it works on a Mac too, and is what the `.command` runs).
  - **`./stop.sh`** turns the server off. It asks the server to stop through the vault's own address, so it can never stop another program.
  - They do what the Windows launcher does: a server already on this copy's port is replaced by a fresh one, `vault.local` gives a second copy its own port (read exactly as on Windows, even a `vault.local` saved there), a portable Node in `node/bin/node` is used before an installed one, and without Node the page alone is served through Python.
  - Checked on Linux (Ubuntu 24.04), where the launchers are run for real by the tests. **Not yet tried on a real Mac:** GitHub's tests now run the launchers on one, but if it misbehaves for you, please open an issue.
- **On a Mac or Linux the vault opens in a browser that can run it.** It needs Chrome, Edge, Brave, Vivaldi or Chromium, and the default browser there is often Safari or Firefox. It now opens in your default browser when that is one of those five, and otherwise in the first of them that's installed (Chrome first). Only when none is installed does it open in the default, where the page says what it needs. On Windows nothing changes: `Start RP Card Vault.bat` opens your default browser and the shortcuts pick as they did. Your tags and notes are kept by the browser, so keep using the same one.
- **The vault names the right file to start.** Its messages said to run `Start RP Card Vault.bat` whatever the computer. On a Mac they now name `Start RP Card Vault.command`, and on Linux `start.sh`.
- **A file that can't be opened no longer blames Windows on other systems.** A card file that was in a folder's list but couldn't be opened was always put down to Windows' 260-character path limit. On a Mac or Linux, which have no such limit, it now says the file was most likely moved or removed, and to rescan.
- **Smaller wording changes for the same reason.** The theme choice is **Match your system**, a card dragged out of the window lands in Finder or your file manager, and the problem log speaks of your user name on this computer.

## 1.6.26

- **One card with "sign" in its name no longer stops an upload.** Sending several cards to SillyTavern, Lumiverse or another importer stops early when the front end signs you out or stops running. It decided that by looking for words like "sign" in the error, and a refusal can name the card, so one refused card called "Assignment" or "Designer" (or a refusal that said "design") left every card after it unsent. The run now stops only when the local server says the sign-in is gone or the front end can't be reached.
- **Very long card names keep their emoji when uploaded.** A name over 200 characters is shortened before it's sent, and the cut could fall in the middle of an emoji, which then reached the front end as `�`. It's now cut on whole characters.

## 1.6.25

- **A front end can't show you its own token or password back.** When a destination refused a card or a sign-in and quoted what it was sent ("refused key abc123", "wrong password …"), that token, password or session went straight to the screen and into the problem log, where copying the log for a bug report would pass it on. The local server now hides them as `[hidden]`, as it already did for the AI key.
- **A runaway AI reply can't stall the local server.** An endpoint that streamed one very long line made the server search the whole line again on every new piece, taking seconds per few megabytes, with every other request (pages, sends, the workspace) waiting behind it. Each piece is now looked at once.

## 1.6.24

- **Models that number their tool calls badly lose none of them.** Some servers mark every tool call as number 0, or don't number them at all. Two calls in one reply were then glued into one, with arguments like `{"path":"a.md"}{}`, so the first failed and the second never ran. They stay separate calls now, and two calls with the same id get an id each.
- **`bulk_tags` no longer tags every card by mistake.** Given a filter it doesn't have (`where: { name: "Ada" }`), it ignored the filter and changed every card it could see. It now changes nothing and says which filters there are. The `duplicates` filter works there and in `random_card`, where it used to find nothing.
- **Private folders stay private by name too.** `list_folders` sent the names of folders you keep private from the AI to the model, and a card could be created, copied or moved into one. They're left out now, along with their subfolders.
- **`fs_edit` can't write the word "undefined".** A call with no `replace` swapped the text for the literal word "undefined" (or "null") in your file. It's refused now; an empty `replace` still takes text out.
- **A search can't freeze the page.** A regular expression like `(a+)+$` from the model would lock up the vault until the tab was closed. `grep_cards` now refuses patterns of that kind and asks for something simpler. A plain search for the same characters is fine.
- **A field that doesn't exist is an error, not "no matches".** `grep_cards` with a made-up field name said no card matched, and `read_card` gave back an empty card. Both now name the fields there are.
- **Workspace errors no longer show where you keep things.** Some failed file changes (a name that's too long, a folder below a file, a folder moved into itself, a read-only file) sent the full path on your computer, user name included, to the screen and to the model. They're plain sentences now, and a failed save no longer leaves a `.tmp-` file behind.
- **Files in an older encoding keep their accents.** A workspace file saved in Windows' old encoding read with "é" as "�", and any change, by the agent or in the Files dialog, wrote that back for good. Changing such a file is now refused, with a note to save it as UTF-8 first. It can still be read.
- **Send pressed twice sends once.** A second press while a new chat was still reading `agent.md` sent the message twice and ran two replies at once.
- **A condense finishes in its own chat.** During a condense you could start a new chat, open another or delete the one condensing; when it finished you were pulled back to the old chat, and a deleted one came back. Those buttons now wait, as they do during a reply.
- **Smaller fixes for the agent.** Two chats made moments apart with the same title no longer share a handoff file. `todo_write` given plain strings keeps them instead of emptying the list. A question's options never show as "[object Object]". `edit_lorebook` given a list as `set` no longer writes nonsense keys. `list_cards` and `list_duplicates` past the end say there's nothing there, instead of "showing 51–50".

## 1.6.23

- **Cached AI answers stay put through a save.** After **Save to card** changed a card's name, description or first message, the ✦ AI tab said nothing was cached until you left the tab and came back.
- **A bulk AI run survives a save.** If you saved a card while a bulk run (✦ Suggest tags, or your own prompt) was going, that card's answer and suggestions went to its old copy, where you could never see them. They now land on the card.
- **Tags that start with a number keep it.** Suggest tags turned "1950s" into "s", "18+" into "+" and "3D" into "D". Only real list numbers ("1. fantasy") are taken off now, and markdown stars around a tag go too.
- **A reply cut off in a plain list is refused.** When the answer hit Max tokens out partway through a comma-separated list, the half-written last tag was offered as a tag (and added straight away in auto-tags mode). It now says the answer was cut off, as it does for JSON.
- **No more "[object Object]".** A tag or a critique note that came back as something other than text showed as "[object Object]". Those are now skipped, and a tag list with no text in it shows the model's reply instead.
- **Tighten gives back what the card says.** Card text containing `<card>` came back as `&lt;card>` and would have gone into the card that way. Notes written inside the rewrite block no longer end up in the field, a reply with unusual letters before the block no longer loses most of the rewrite, and a rewrite that differs only in its line endings counts as unchanged.
- **The ✦ AI tab says what's really sent.** With your own prompts, the line at the bottom always listed the usual fields, even for a prompt reading only one field, or all of them including the system prompt. It now lists what that prompt sends. The trim notice now gives the real limit, too: with Model context set, it said 24,000 characters when the model's context had cut it to about 2,000, and pointed you at the wrong setting.
- **A diff of a huge card can't freeze the page.** A card with tens of thousands of changed paragraphs hung the tab while the diff was worked out. Past a limit, the changed part now shows as replaced whole.

## 1.6.22

- **The card panel shows what a save wrote.** After **Save to card**, a change to anything but the name, description or first message (personality, scenario, greetings, lorebook and the rest) went into the file, but the card panel went on showing the old text until you picked another card. And it could cost you the save: change another greeting or lorebook entry while the old ones were showing, save again, and the old text went back into the file. The panel now shows the saved card as soon as the save is done, and later edits build on it.
- **Nothing you do while a card is saving gets lost.** A favourite, note, rating or field changed while the save was being written was dropped when it finished. And after a save that changed the name, description or first message, the card panel showed the old text and lost your favourite and notes from view until the rescan was over (a while, on a big folder), and a note written in that time was lost. All of that now stays.
- **An emptied lorebook position is saved.** Clearing an entry's **position** looked done, but the save kept the old one in the file. It's now gone from the file. A position the file holds as a number also stays a number when another part of the book is saved, rather than turning into text.
- **A lorebook entry's order can be negative.** Typing "-5" into the **order** box gave "05", because the box put a 0 back as soon as it held only "-". Typing into a box you'd emptied doesn't leave a 0 in front any more either. Emptying the box and leaving it now keeps the number it had.
- **A lorebook you started and emptied again is no lorebook.** **+ Start a lorebook** followed by removing its only entry left **Save to card (1)** waiting, and saving wrote an empty lorebook into the card. The card is now back as it was.
- **The Lorebook and Greetings tabs count what they show.** The Lorebook tab's number was the file's, so it didn't change as you added or removed entries; the Greetings tab didn't count a first message you'd just written.
- **Keys no longer reach the card behind a full-size picture.** With a picture open, **f** favourited the card behind it, **s** sent it to your front end, "/" went to the search box, and with only one picture the arrow keys moved to another card and closed the picture. They now do nothing until it's closed.
- **A picture opens only for the card you're on.** Clicking a card's picture and moving to another card while its file was still being read opened the first card's picture over the second.
- **Copy path and Copy V3 JSON say so when the copy didn't work.** When the browser refused, they tried nothing else and still said it was copied. They now try the older way too, and tell you if that didn't work either. **Copy file path** in the right-click menu does the same.
- **A card's created date in seconds with a fraction shows correctly.** The Overview showed such a card as made in January 1970.
- **The Fields tab no longer says the file is never changed.** It said so right below the **Save to card** button. It now says what that button does.

## 1.6.21

- **A deep search no longer shows cards for words you've already typed over.** With **Deep text** on, the cards found by the last words searched stayed in the grid for a moment after you typed other words, until the next search had run (a fraction of a second), along with their "deep hits" count. Only what the words in the box now find is shown.
- **Escape on a right-click menu closes just the menu.** With the card panel open, Escape closed the menu and the card panel behind it. And while a menu was up, the arrow keys moved to another card and **f** and **s** acted on the card behind it. The keys now leave the cards alone until the menu is closed.
- **A right-click menu stays open when you click inside it.** A click on its title, on a line between items, or on its scroll bar (which a long menu has in a small window) closed the menu, so the items further down couldn't be reached with the mouse.
- **"/" in a dialog no longer jumps to the search box behind it.** In Settings or any other dialog, with no box in it being typed in, "/" moved the cursor into the vault's search box behind the dialog, so what you typed next filtered the cards out of sight. It now does that only when no dialog or menu is up.

## 1.6.20

- **Adding a tag and taking it off again no longer leaves an edit behind.** In the card panel's Tags & Notes, a card tag you added and then removed left the card marked **Locally edited**, with **Save to card (1)** waiting for nothing. The card is now back as it was, the way a field, greeting or lorebook entry typed back already is.
- **Tags you add to a card are marked again.** The card tags you added in the vault were meant to show with a purple outline, apart from the card's own, but showed in the same colour as the rest. They're purple again.
- **Keys no longer reach the card behind the flag dialog.** With the flag dialog open and the cursor out of its reason box, **f** favourited the card behind it, **s** sent it to your front end, the arrow keys moved to another card, and **Escape** closed the card panel instead of nothing. They now do nothing until the dialog is closed, as with every other dialog.

## 1.6.19

- **Move to trash never makes a trash folder inside a Reference folder.** With no trash folder chosen in Settings, the trash goes next to the cards being trashed. When the first card picked was in a Reference folder (one that's never written to), the vault made a "_vault trash" folder inside it anyway, and then refused to move anything there, so the other cards you'd picked stayed put too. The trash now goes in a folder that can be written to, the cards that can go are moved, and the ones in a Reference folder stay where they are.
- **A move that's only partly possible says what did move.** When some of the cards picked for a move (or for the trash) were in a read-only folder, the notice said they couldn't be moved and nothing else, even though the rest had moved. One notice now says both.

## 1.6.18

- **Ingest no longer quietly does nothing after a folder is removed.** Ingest remembers the folders you took cards from and filed them into. If one of those folders had since been removed from the vault (or removed and added again), it stayed picked but out of sight: nothing showed as picked, and **Copy** could do nothing at all, without a word. Folders that are no longer linked are now left out, and Ingest starts from its usual choices (your Inbox and Library folders) instead.

## 1.6.17

- **.charx cards can be saved.** Save to card on a .charx used to stop with "Don't know how to write this file type in place". It now writes your changes into the card inside the .charx and keeps every picture and other file in it as it was, with the same backup and read-back check as a PNG save. Duplicate and Download copy also make a .charx now; before, they made a .json and left the pictures behind.
- **.charx cards show their picture** in the grid and the card panel, taken from the icon packed inside. Clicking it opens it full size, as for a PNG card. A .charx already in the vault is read once more on the next scan to get its picture.
- **New: Download as…, next to Download copy.** It saves the card as PNG, CHARX or JSON, whatever its own format, and brings its pictures along:
  - **CHARX:** the card's picture and the pictures it embeds become files in the zip.
  - **PNG:** a .charx's icon becomes the picture, and its other pictures are stored inside the PNG the way RisuAI does. A card without a picture gets a drawn one with its name.
  - **JSON:** text only. The vault says how many pictures were left out.
  - Pictures given as a web address or a data: address stay as they are in every format. Download copy still keeps the card's own format.
- **An animated card no longer keeps playing after you move away.** Moving the pointer off a card just as it started playing could leave it playing until you pointed at it again. Moving anywhere else now stops it.

## 1.6.16

- **A card whose file is gone now leaves the vault for good.** After a **Full re-parse**, cards whose files had been deleted outside the vault disappeared from the grid, but came back the next time the vault opened. The same happened on any rescan to a card whose text hadn't been cached (it was read again, and if its file was gone, it was never removed). Both now drop the card once its file is gone. Stopping a Full re-parse part-way also no longer hides the cards it hadn't reached yet.

## 1.6.15

- **A card's picture opens full size.** Click the picture in the card panel and it opens centred over the vault, as large as fits the window (never larger than it is), with its size shown. ← and → step through the card's other pictures; Escape, ✕ or a click outside closes it, and the card stays open.
- **New Gallery tab: the pictures a card embeds.** Some cards carry extra pictures (expressions, backgrounds and the like) inside the file. The card panel's Gallery tab shows them all, next to the card's own picture: the ones RisuAI-style PNG cards hold, the pictures packed inside a .charx, and any written into the card's asset list. Click one to see it full size. Assets that aren't pictures, or are only a web address rather than inside the file, are counted but not shown, and the vault never fetches them. With Animated card pictures set to Never play, these are shown still too.
- **The header buttons have their colours back.** Since 1.5.0 they were all the same quiet grey, with colour only for something that needed you. Each now has its own colour again, as before: Rescan cyan, Ingest warm, Dupes red, Tags purple, Folders green, AI blue, Log and Settings muted. Kept from 1.5.0: the AI button turns warm with ⚠ when the AI is on but not ready, Folders is lit up while you have none, and Dupes shows its count.

## 1.6.14

- **Animated (APNG) cards are marked, and play.** A card whose picture is an animated PNG now has a ▶ badge on its tile, and the new **Animated** filter in the sidebar shows just those (the agent can find them too). The vault notices them on your next scan without reading every card again.
  - **Playing:** an animated picture plays while you point at its card, and in the card panel when you open it. Never the whole grid at once: animated cards can be large, and thousands playing together would slow everything down.
  - **Your choice:** Settings → Animated card pictures: Play when you point at them (the default), Always play (every animated card on screen plays, which can slow the vault down when many are showing) or Never play. Turning off Windows' animation effects stops them too.
- **Save to card keeps the animation.** It always did, and now a test makes sure it stays that way: every animation chunk is kept, in order, with the card text before them as the APNG format allows.

## 1.6.13

- **Save to card no longer deletes the backup it has just made.** After your computer's clock goes back (the autumn hour change, or a clock that ran fast being put right), the backups made earlier carry later times in their names than the new one. Pruning kept the newest-looking ones, so the copy of the file from just before this save was the one deleted. The backup a save makes is now always kept.
- **Copying a card never overwrites a file.** When `card.png` and `card (2).png` to `card (51).png` were all already in the folder, a move, copy or backup wrote over `card (51).png`. It now stops with a message instead.
- **A failed save with backups off no longer points you to a backup.** In the rare case where a save went wrong and the original couldn't be put back either, the message said to recover from "your backup", even with backups turned off. It now says there's no earlier copy.

## 1.6.12

- **A card whose lorebook has an odd scan depth no longer blanks the vault.** If a card file's lorebook gave its scan depth as something other than a number (a list of settings, for example), opening the card's Lorebook tab emptied the whole page until you reloaded it. The scan depth is now shown as the file has it, and the page carries on.

## 1.6.11

- **"Local models only" no longer lets through names that only start with 127.** An address like `http://127.example.com/v1` counted as "this computer", so with Local models only on, the relay would still send your cards and key to that remote server, and the AI panel didn't warn that it was unencrypted. Only real 127 addresses (and localhost and ::1) count as local now.
- **The tests can no longer pass by stopping early.** A test file that got stuck waiting on something that never happened used to end quietly and be counted as passed, with the rest of its checks never run. It now fails and says it stopped before it finished. More checks were added where flipping a safety check in the code went unnoticed: a move whose copy lands damaged, Save to card in a Reference folder with backups off, backup pruning, links out of the agent workspace, hidden data streams and DNS rebinding of the page itself.

## 1.6.10

- **Spaces in vault.local no longer make the launchers disagree.** A line written `port = 8791` (or with a space before or after it) was read by the shortcuts but not by `Start RP Card Vault.bat` or `Stop RP Card Vault.bat`, so Start opened the 8790 vault, with the other copy's folder permissions and data, and Stop couldn't find the server it was meant to stop. All the launchers read it the same way now.
- **A label with brackets or an & in it no longer breaks Start.** `label=test (old)` stopped `Start RP Card Vault.bat` with "was unexpected at this time" before it started anything, and a label like `old & more` ran the words after the & as a command. A label is now only ever text in the window title.
- **A port in vault.local that isn't a number means 8790 everywhere.** The shortcuts and the server already did that, but Stop looked for a server on the bad port and found nothing.

## 1.6.9

- **The problem log hides private cards' file names when a send fails.** A failed upload to a front end was logged with the request it made, and that request carries the card's file name in web-address form (`Secret%20Lover.png`), so a private card's name with a space or an accent in it got through into the text you copy. That part of the line is now taken out.
- **A Windows user name with a space in it is fully taken out of the problem log.** In `C:\Users\Jeb Smith\...` only the first word was hidden, which left "Smith" in the copied text. The whole name goes now, and the same for macOS paths.
- **A password with a quote mark in it is fully hidden.** In a line like `"password": "a \"quoted\" word"`, everything after the first escaped quote was left showing.
- **Names spelt with a Turkish dotted İ are hidden.** A card or folder called "İpek" stayed visible in the problem log.
- **Settings no longer freezes for seconds over a log full of long errors.** A problem log of long runs of letters with no @ in them (base64 in an error message, say) took about three seconds to scrub, every time a new problem came in while Settings was open, and every time it was copied. It now takes a few milliseconds.

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
