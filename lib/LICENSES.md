# Third-party libraries

The page loads these four files from this folder, so the vault starts without
an internet connection. They are byte-for-byte the cdnjs copies the page used
before; the page pins each one's SHA-512 hash (its `integrity` attribute), and
`test/release.test.js` checks the files still match.

| File | Library | Version | License | Source |
| --- | --- | --- | --- | --- |
| `react.production.min.js` | React | 18.2.0 | MIT | https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js |
| `react-dom.production.min.js` | ReactDOM | 18.2.0 | MIT | https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js |
| `babel.min.js` | Babel standalone | 7.23.9 | MIT | https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.9/babel.min.js |
| `jszip.min.js` | JSZip (includes pako) | 3.10.1 | MIT or GPLv3 (used here under MIT); pako: MIT | https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js |

## Fonts

`fonts/` holds the page's three fonts, so it never contacts Google Fonts:
Crimson Pro, JetBrains Mono and Outfit, as WOFF2 files from Google Fonts with
`fonts/fonts.css` describing them. All three are under the SIL Open Font
License 1.1; each one's license, with its copyright line, is in
`fonts/OFL-<name>.txt`.

To change a version of a library, replace the file, put its new hash in both of its
`integrity` attributes in `RP_Card_Vault.html` (the local tag and the cdnjs
fallback), and update this table.

## Copyright notices

- React and ReactDOM: Copyright (c) Facebook, Inc. and its affiliates.
- Babel: Copyright (c) 2014-present Sebastian McKenzie and other contributors.
- JSZip: Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz
  Buchinger, António Afonso.
- pako (inside JSZip): Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei
  Tupitcin.

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
