# Security

## Reporting a security problem

Please don't post it in a public issue. Use the repository's **Security** tab → **Report a vulnerability**, which only the maintainer can see. If that isn't available, open an issue that just says you have a security problem to report, with no details, and the maintainer will get in touch. Never include a real API key.

This is a hobby project, so there's no promised response time, but security reports come first.

## How the vault protects you

RP Card Vault runs on your own machine. These are the protections it relies on, and what each one stops. `test/security.test.js` attacks a real server to check them, and runs with `npm test`.

## The local server (`serve.js`)

- **It listens on 127.0.0.1 only.** Other machines on your network can't reach it.
- **It only answers to its own address** (`127.0.0.1:<port>` or `localhost:<port>`). A website that points its own domain name at your machine (DNS rebinding) is refused.
- **It serves the app's own files and nothing else in its folder:** the page, the manifest, the icons and the service worker. Your agent workspace, `.git`, the tests and `vault.local` are never served.
- **Its error pages are plain text** and never repeat the address back, so a crafted link can't inject script.
- **The relays (`/__vault/*`) only obey the vault page itself.** Each request needs:
  - the vault's own Origin
  - an `X-Vault` header, which other sites can't add
  - a `Sec-Fetch-Site` of `same-origin`

  Another website open in your browser can't change your AI settings, use your key, read your workspace or shut the server down, whether it tries a form, a fetch, a script tag or an image.
- **Oversized requests are refused** with a clear answer.

## The page

- **It can't be shown in a frame on another site,** which stops clickjacking.
- **A Content-Security-Policy keeps its requests and images on its own address,** so even injected text can't send your cards elsewhere through a fetch or an image. Scripts load only from the vault itself (its `lib` folder), with cdnjs as a fallback when that folder is missing. Fonts come only from the vault itself (`lib/fonts`); the page contacts no other site.
- **The libraries are pinned by hash** (Subresource Integrity), the copies in `lib` and the cdnjs fallbacks alike. A modified copy is refused.
- **The service worker only keeps the real page** for offline use.

## Front-end sign-ins

Signing in to an upload destination (SillyTavern, Lumiverse, another importer) happens through the local server, which keeps the session or token in memory only, per destination, until its window closes. Passwords are never stored, and the page never sees tokens or cookies.

## Your API key

- **It's held only in the server's memory.** It's never written to disk, never sent to the page, and never put in an error message.
- **It only goes to the endpoint you saved it with.** Pointing the vault at a different host forgets it.

## Card files

- **Card text is shown as text,** never as markup.
- **Only a PNG's card chunks are unpacked,** and never past 64 MB. A file built to unpack to gigabytes is refused, not opened. The same limit applies to `.charx` files.
- **Keys like `__proto__` in a card change nothing outside that card.**
- **File names can't become Windows device names** (`CON`, `NUL`, …).
- **The vault never deletes a card file.** Moves are copied and checked before the original is removed, and saving keeps a backup.

## The AI agent

Card text reaches the agent, so a card could try to give it instructions.

- **It's told card text is material, never instructions.**
- **It has no tool to delete cards.** It can only move cards between folders you've linked.
- **Its workspace accepts text files only** (`.md`, `.txt`, `.json`, `.csv` and similar). It can't create or rename anything into a `.bat`, `.vbs`, `.ps1`, `.exe`, `.lnk`, `.html` or other program or page. Windows device names, hidden data streams (`file:stream`) and paths outside the workspace are refused.
- **Links in its replies only open when you click them,** and hovering shows the full address first.

## Privacy with AI services

A model service sees everything sent to it, and what it keeps is up to its own policy. The vault limits what is sent:

- **Private folders:** right-click a folder and choose **Keep private from the AI**. Its cards, and those below it, are never sent to a model. The agent can't list, search, read or change them, and every card action refuses them.
- **Local models only** (✦ AI panel): any address that isn't on this computer is refused, by the page and by the local server.
- **What was sent** (✦ AI panel): every request of this session, word for word. It's kept only while the page is open.
- **OpenRouter:** the vault asks OpenRouter by default to use only providers that don't log or train on prompts.
- **Unencrypted addresses:** the AI panel warns when an address is `http://` and not on this computer.
- **The agent reads cards only when it needs to.** Its rules keep it to the cards you name, and it has no internet access of its own.

## Known limits

- **The page compiles itself in the browser with Babel,** so its policy has to allow inline script. The other protections above don't depend on that.
- **The endpoint you choose sees what you send it.** With a remote endpoint that means the card text you ask about. A local model keeps everything on your machine.
- **A model can ramble forever while still sending text.** The Stop button, the step limit and the per-minute limits are the brakes for that.