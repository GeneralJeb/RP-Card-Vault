# Portable use

## Running from a USB drive

The vault runs from any folder, a USB drive included.

- **Bring Node with you.** Download the Windows *zip* build from [nodejs.org](https://nodejs.org) and unpack it into a folder named `node`, so `node\node.exe` sits next to `Start RP Card Vault.bat`. The launchers use it before looking for an installed one, so the computer doesn't need Node.
- **No internet needed.** The libraries the page runs on are in the `lib` folder, so the vault starts on an offline computer.
- **Your vault data stays with the browser, not the drive.** Tags, notes, edits, chats and folder access are kept by the browser on each computer. To carry them, use **Settings → Export vault data**, then **Import vault data** on the next computer. The cards themselves, and the agent's workspace, are on the drive.
- **The first scan on each computer takes longer on a slow drive,** because every card is read once. After that, only changed files are read.

## On a computer you don't trust

A computer can read and change anything on a drive plugged into it, including the vault's own files. A compromised one could alter `serve.js` so that it misbehaves on the next computer you use.

- **Prefer your own computers.** Don't plug the drive into a computer you don't trust and then into one you do.
- **Don't type an API key into a computer you don't trust.** Use a local model, or no AI, there.
- **Before you leave, use Settings → Reset and forget this computer.** It removes everything the vault stored in that browser and drops the API key from the local server.
- **On public Wi-Fi, only use AI endpoints that start with `https://`.** The vault warns you about `http://` addresses that aren't on this computer.
