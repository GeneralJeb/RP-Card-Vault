# Contributing

Thanks for taking an interest. A few things to know first.

## This is a hobby project

RP Card Vault is built and maintained by one person in their spare time, mostly with Claude doing the coding. There's no schedule, no support team and no promises:

- **Replies are best effort.** Issues and pull requests are read, but it may take a while, and some won't get a fix.
- **It's free, and stays free.** No paid features, ads or sponsorships. That's also a condition of the Lumiverse license the vault's Lumiverse support relies on.
- **What gets built is the maintainer's call.** Good ideas may still be turned down if they don't fit.

## Reporting a problem

Open an issue with:

- what you did, what you expected, and what happened instead
- your Windows version, browser and version (Settings → the version under the title), and Node version (`node --version`)
- anything the page or the server window printed, with **your API key and any card text you'd rather keep private removed**

**Security problems:** please don't post them in a public issue. See [SECURITY.md](SECURITY.md) for how to report them privately.

## Suggesting a change

Ideas, complaints and advice are all welcome as issues. For a bigger change, open an issue to talk it over before writing code, so you don't spend time on something that won't be merged.

## Pull requests

- Work goes into the **`dev`** branch; `main` holds releases. Open pull requests against `dev`.
- Run the tests first: `npm install`, then `npm test`. The same tests run on GitHub for every pull request, on Windows.
- Keep to what's there: the page is a single file (`RP_Card_Vault.html`), the server has no dependencies (`serve.js`), and nothing may load from the internet.
- Never weaken the safety rules: the vault doesn't delete card files, the API key lives only in the server's memory, and the AI only suggests changes the user approves. [SECURITY.md](SECURITY.md) lists the rest.
- [docs/development.md](docs/development.md) covers the tests, the version number and the changelog.

By submitting a pull request, you agree that your contribution is licensed under the project's [MIT License](LICENSE).

## Using it in your own project

Go ahead; that's what the MIT License is for. Keep the copyright notice, and if you build something with it, the maintainer would love to see the result.
