/**
 * RP Card Vault service worker.
 *
 * Purpose: let the installed app open even when the little Node server isn't
 * running. The vault is a static page — the server only matters for the
 * front-end API bridge — so caching the shell means double-clicking the
 * taskbar icon always gets you your catalogue.
 *
 * Deliberately NOT cached: anything under /__vault/ (the live API bridge).
 */

// v2 dropped any copy an older version of this file saved from the wrong
// page (see the fetch handler); v3 caches the libraries from lib/; v4 the
// fonts from lib/fonts/.
const VERSION = "vault-v4";
const SHELL = [
  "/RP_Card_Vault.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/lib/react.production.min.js",
  "/lib/react-dom.production.min.js",
  "/lib/babel.min.js",
  "/lib/jszip.min.js",
  "/lib/fonts/fonts.css",
  "/lib/fonts/CrimsonPro-italic-latin-ext.woff2",
  "/lib/fonts/CrimsonPro-italic-latin.woff2",
  "/lib/fonts/CrimsonPro-italic-vietnamese.woff2",
  "/lib/fonts/CrimsonPro-normal-latin-ext.woff2",
  "/lib/fonts/CrimsonPro-normal-latin.woff2",
  "/lib/fonts/CrimsonPro-normal-vietnamese.woff2",
  "/lib/fonts/JetBrainsMono-normal-cyrillic-ext.woff2",
  "/lib/fonts/JetBrainsMono-normal-cyrillic.woff2",
  "/lib/fonts/JetBrainsMono-normal-greek.woff2",
  "/lib/fonts/JetBrainsMono-normal-latin-ext.woff2",
  "/lib/fonts/JetBrainsMono-normal-latin.woff2",
  "/lib/fonts/JetBrainsMono-normal-vietnamese.woff2",
  "/lib/fonts/Outfit-normal-latin-ext.woff2",
  "/lib/fonts/Outfit-normal-latin.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) =>
      // One bad URL shouldn't sink the whole install, so add them individually.
      Promise.all(SHELL.map((u) =>
        c.add(new Request(u, { cache: "reload", mode: u.startsWith("http") ? "cors" : "same-origin" }))
          .catch(() => null)
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // The API bridge must always hit the real server, never a cache.
  if (url.pathname.startsWith("/__vault/")) return;

  // The page itself: try the network so updates land, fall back to the cached
  // shell when the server is down. Only the real page, answered OK, is saved
  // as the shell: saving whatever a navigation returned would let a link to
  // some other address (an error page, say) stand in for the vault offline.
  const isPage = url.pathname === "/RP_Card_Vault.html" || url.pathname === "/";
  if (isPage) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put("/RP_Card_Vault.html", copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("/RP_Card_Vault.html").then((r) => r || Response.error()))
    );
    return;
  }
  // Other navigations go to the network as they are.
  if (req.mode === "navigate") return;

  // Everything else (icons, libraries, cdnjs fallbacks): cache first, they're versioned.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.status === 200 && (url.protocol === "http:" || url.protocol === "https:")) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => hit))
  );
});
