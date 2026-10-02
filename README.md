# RP Card Vault

A local library for roleplay character cards (the PNG and JSON cards used by SillyTavern and similar front ends). It runs in your browser from a small local server, and nothing leaves your machine unless you turn on the optional AI features.

> **Made almost entirely with Claude (vibe-coded).** I directed it, tested it and use it every day, but nearly all of the code was written by Claude. Thoughts, complaints and advice are all welcome: open an issue. And if you copy it, borrow from it or build your own on top of it, go ahead. Just show me what you made.

## What it does

- **Reads your card folders** and builds a searchable index: names, creators, tags, tokens, lorebooks, greetings and full text.
- **Organises without touching the originals:** tags, flags, ratings, favourites and private notes live in the vault's own database.
- **Edits cards:** fields, greetings, tags and lorebook entries. **Save to card** writes them into the file, after making a backup and checking the result.
- **Copies, moves and creates cards** in the folders you've linked, and finds duplicates.
- **Sends cards to your front end:** into a folder it reads, or uploaded straight into SillyTavern, Lumiverse or any front end with an import endpoint.
- **Optional AI** with any OpenAI-compatible endpoint (a local model, OpenRouter, OpenAI and so on): summaries, critiques, tag suggestions and rewrites that wait for your approval, and an agent chat that can search your library and suggest changes.

## What it needs

- **Windows** with **Chrome or Edge**. The vault reads and files your cards through the browser's File System Access API. Brave has it switched off by default; the vault explains how to turn it on.
- **Firefox and Safari aren't supported right now.** Neither has that API, so the vault can't save edits to your card files or move them there. Support may come later, in a more limited form.
- **[Node.js](https://nodejs.org) 20 or newer.** If you run SillyTavern you probably have it. Without Node, the launcher falls back to Python and the vault runs without the AI features.

## Start it

1. Put all the files in one folder.
2. Double-click **`Start RP Card Vault.bat`**.
3. The vault opens at `http://127.0.0.1:8790/RP_Card_Vault.html`.
4. Click **Add a folder** and pick your card folder.

`Create Shortcut.bat` adds Desktop and Start Menu shortcuts.

## Updating

1. Download the latest release. Its notes, and `CHANGELOG.md`, say what changed.
2. Copy the files over the old ones.
3. Start it as before.

Your cards, tags and notes aren't in the vault's files, so nothing of yours is overwritten. **Settings → Export vault data** before an update gives you a backup anyway.

## Tested on

- Windows 10 (22H2), and GitHub's Windows test machines
- Microsoft Edge (the automated browser test) and other Chrome-based browsers
- Node.js 20 and 24
- SillyTavern 1.19 and Lumiverse, as places to send cards

Other setups will probably work; these are the ones that have been checked.

## Your data

- **The vault never deletes card files.** Moving a card copies it, checks the copy, and only then removes the original. Saving a card keeps a backup.
- **The server only listens on your own machine,** and an AI API key is held only in its memory, never written to disk.
- **Your tags, notes and edits are backed up automatically** into `_vault data` in one of your folders, every day by default, so clearing the browser doesn't lose them.
- **Nothing is loaded from the internet.** Libraries and fonts ship with the vault.
- **Card text only leaves your machine if you choose a remote AI endpoint,** and then only what you ask it to work on.

## More

- [`HOW TO RUN.txt`](HOW%20TO%20RUN.txt): the launchers, ports, running a second copy, and fixes for common problems
- [Portable use](docs/portable.md): running from a USB drive, and on computers you don't trust
- [`SECURITY.md`](SECURITY.md): how the vault protects your cards and keys
- [`CHANGELOG.md`](CHANGELOG.md): what changed in each release
- [Development](docs/development.md): tests, branches and releases
- [`CONTRIBUTING.md`](CONTRIBUTING.md): reporting problems, suggesting changes, and what to expect from a hobby project

## Thanks

- **[Lumiverse](https://github.com/prolix-oc/Lumiverse)** by Prolix OCs: the front end I use every day, and the reason this vault exists. If you're looking for a front end, give it a look.
- **[LumiAgent](https://github.com/AMousePad/LumiAgent)** by AMousePad: an agent for Lumiverse whose design inspired several of the vault agent's habits, like reading cut-off fields in parts and keeping placeholders intact.

## Not affiliated

RP Card Vault is an independent, unofficial project. It is not affiliated with, endorsed by or supported by Lumiverse, Prolix OCs, SillyTavern or any other front end it can send cards to; it just works with them. Those names belong to their owners.

It is a free hobby project, provided as is (see the license). You're responsible for the cards you keep and for following the terms of any AI service you connect it to.

## License

MIT, see [LICENSE](LICENSE).
