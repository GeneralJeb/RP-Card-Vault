/**
 * Themes: every theme sets every colour, the default matches the page's own
 * stylesheet, text stays readable, and a custom accent is applied safely.
 *
 *   node test/themes.test.js
 */

const fs = require("fs");
const path = require("path");
const { loadPureRegion } = require("./pure-region");
const t = require("./harness");

const page = fs.readFileSync(path.join(__dirname, "..", "RP_Card_Vault.html"), "utf8");
const { mod: V } = loadPureRegion(["THEMES", "THEME_VARS", "THEME_CHOICES", "themeKeyFor", "themeVars"]);

/* WCAG contrast between two #rrggbb colours. */
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

console.log("\nevery theme sets every colour");
for (const [k, th] of Object.entries(V.THEMES)) {
  t.eq(th.colors.length, V.THEME_VARS.length, k + ": one value per variable");
  t.ok(V.THEME_CHOICES.indexOf(k) >= 0, k + " can be chosen in Settings");
}
{
  const root = /:root \{([\s\S]*?)\n\}/.exec(page)[1];
  for (const [i, name] of V.THEME_VARS.entries()) {
    const m = new RegExp(name.replace(/-/g, "\\-") + ":\\s*([^;]+);").exec(root);
    t.ok(m && m[1].trim() === V.THEMES.vault.colors[i], "the Vault theme's " + name + " matches the stylesheet's default", m && m[1]);
  }
}

console.log("\ntext is readable in every theme (WCAG AA: 4.5 for text)");
for (const [k, th] of Object.entries(V.THEMES)) {
  const v = Object.fromEntries(V.THEME_VARS.map((n, i) => [n, th.colors[i]]));
  for (const bg of ["--bg-primary", "--bg-secondary", "--bg-tertiary"]) {
    t.ok(contrast(v["--text-primary"], v[bg]) >= 7, k + ": main text on " + bg + " (" + contrast(v["--text-primary"], v[bg]).toFixed(1) + ")");
    t.ok(contrast(v["--text-secondary"], v[bg]) >= 4.5, k + ": secondary text on " + bg + " (" + contrast(v["--text-secondary"], v[bg]).toFixed(1) + ")");
  }
  // The faint text carries help lines at 10-11px all over the vault, so it too must pass AA.
  for (const bg of ["--bg-primary", "--bg-secondary", "--bg-tertiary", "--bg-input"]) {
    t.ok(contrast(v["--text-muted"], v[bg]) >= 4.5, k + ": muted text on " + bg + " (" + contrast(v["--text-muted"], v[bg]).toFixed(1) + ")");
  }
  for (const a of ["--accent-warm", "--accent-red", "--accent-green", "--accent-blue", "--accent-cyan", "--accent-purple", "--accent-pink"]) {
    t.ok(contrast(v[a], v["--bg-secondary"]) >= 3, k + ": " + a + " stands out from the panels (" + contrast(v[a], v["--bg-secondary"]).toFixed(1) + ")");
  }
}

console.log("\nchoosing a theme");
t.eq(V.themeKeyFor("midnight", false), "midnight", "a named theme is itself");
t.eq(V.themeKeyFor("auto", false), "vault", "Match Windows, dark: Vault");
t.eq(V.themeKeyFor("auto", true), "parchment", "Match Windows, light: Parchment");
t.eq(V.themeKeyFor("nonsense", true), "vault", "anything unknown: Vault");
t.eq(V.themeKeyFor(undefined, false), "vault", "settings from before themes: Vault");
{
  const p = V.themeVars({ theme: "parchment" }, false);
  t.ok(p.light && p.vars["--bg-primary"] === "#f3efe6", "Parchment is light, with its own colours");
  t.eq(Object.keys(p.vars).length, V.THEME_VARS.length, "and every variable is set, so switching back leaves nothing behind");
  const a = V.themeVars({ theme: "vault", accentColor: "#3366ff" }, false);
  t.eq(a.vars["--accent-warm"], "#3366ff", "a custom accent replaces the main accent");
  t.ok(/color-mix\(in srgb, #3366ff 78%, black\)/.test(a.vars["--accent-warm-dim"]) && /12%, transparent/.test(a.vars["--accent-warm-glow"]), "and its dim and glow follow it");
  for (const bad of ["red", "#36f", "#3366ff; background: url(x)", "javascript:1", 42]) {
    t.eq(V.themeVars({ theme: "vault", accentColor: bad }, false).vars["--accent-warm"], "#c7935a", "an accent that isn't #rrggbb is ignored: " + JSON.stringify(bad));
  }
}

console.log("\nthe page");
t.ok(/localStorage\.getItem\("rpCardVault-theme"\)/.test(page.slice(0, page.indexOf("<style>"))), "the remembered theme is applied in <head>, before the page is drawn");
t.ok(/if \(\/\^--\[a-z-\]\+\$\/\.test\(k\)\)/.test(page), "and only to colour variables");
t.ok(!/rgba\(" \+ \(ACCENT_RGB/.test(page) && /function acRgba\(c, a\) \{ return "color-mix\(in srgb, "/.test(page), "see-through accents are mixed from the theme's colours");

t.done();
