/* build173.test.mjs — v173 (Brandon, 2026-10-09), overhaul phase 1: Jarvis
 * like an app on a phone. Home-screen install (manifest + icons), a bottom
 * bar (Home, Search, Deals, Menu), and the home page switching tabs from it. */
import fs from "node:fs";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const read = path => strip(fs.readFileSync(path, "utf8"));

/* ---- home screen ---- */
const man = (await import("./app/manifest.js")).default();
ok(man.short_name === "Jarvis" && man.start_url === "/" && man.display === "standalone" && man.scope === "/", "added to a home screen it opens full screen on the dashboard, named Jarvis");
ok(man.background_color === "#000000" && man.theme_color === "#000000", "black while it opens, like the rest of Jarvis");
ok(man.icons.some(i => i.sizes === "192x192") && man.icons.some(i => i.sizes === "512x512" && i.purpose === "any") && man.icons.some(i => i.purpose === "maskable"), "with 192, 512 and a maskable icon");
for (const i of man.icons) {
  const b = fs.readFileSync("./public" + i.src);
  ok(b.slice(1, 4).toString() === "PNG" && b.readUInt32BE(16) === Number(i.sizes.split("x")[0]), `${i.src} is a ${i.sizes} PNG`);
}
const apple = fs.readFileSync("./public/brand/apple-touch-icon.png");
ok(apple.readUInt32BE(16) === 180, "and a 180px icon for iPhones");
const layout = read("app/layout.jsx");
ok(/appleWebApp: \{ capable: true, title: "Jarvis", statusBarStyle: "black-translucent" \}/.test(layout) && /apple: \[\{ url: "\/brand\/apple-touch-icon\.png"/.test(layout), "an iPhone gets the icon, the name and full screen");
ok(/viewport-fit=cover/.test(fs.readFileSync("./app/layout.jsx", "utf8")), "and the page runs up under the notch, with safe-area padding");

/* ---- the install card ---- */
const hint = read("app/install-hint.jsx");
ok(/beforeinstallprompt/.test(hint) && /deferred\.prompt\(\)/.test(hint), "Android: an Install button using the browser's own prompt");
ok(/Add to Home Screen/.test(hint) && /iPhone\|iPad\|iPod/.test(hint), "iPhone: how to do it from Share");
ok(/display-mode: standalone/.test(hint) && /navigator\.standalone/.test(hint) && /localStorage\.setItem\(KEY, "no"\)/.test(hint), "never once it's installed, and Not now is remembered");

/* ---- the bottom bar ---- */
const menu = read("app/side-menu.jsx");
const bar = menu.slice(menu.indexOf('<nav className="jx-tabbar"'), menu.indexOf("</nav>", menu.indexOf('<nav className="jx-tabbar"')));
ok(["Home", "Search", "Deals", "Menu"].every((w, i, a) => bar.indexOf(`<span>${w}</span>`) > -1 && (i === 0 || bar.indexOf(`<span>${a[i - 1]}</span>`) < bar.indexOf(`<span>${w}</span>`))), "Home, Search, Deals, Menu, in that order");
ok(/href="\/\?tab=deals"/.test(bar) && /onClick=\{toDashTab\("deals"\)\}/.test(bar) && /onClick=\{toDashTab\("home"\)\}/.test(bar), "Home and Deals switch the dashboard in place, or open it on that tab");
ok(/new CustomEvent\("jarvis:tab", \{ detail: tab \}\)/.test(menu) && /addEventListener\("jarvis:tabchanged", on\)/.test(menu), "talking to the dashboard by event");
ok(/aria-controls="jx-side" aria-expanded=\{open\}/.test(bar) && /ref=\{btnRef\}/.test(bar), "Menu opens the menu, and focus comes back to it");
ok(/aria-haspopup="dialog" aria-expanded=\{searchOpen\}/.test(bar), "Search opens Jarvis search");
ok(/aria-current=\{onDashboard && dashTab === "deals"/.test(bar), "the tab you're on is lit, and said to a screen reader");
ok(!/className="jx-menubtn"/.test(menu) && !/className="jx-searchbar"/.test(menu), "the top bar no longer carries Menu and Search");
ok(/classList\.toggle\("jx-typing"/.test(menu), "the bar steps aside while typing");
ok(/\[main, bar, tabs\]\.forEach/.test(menu), "and can't be reached behind an open menu, search or settings");

const css = fs.readFileSync("./app/shell.css", "utf8");
const v173 = css.slice(css.indexOf("v173: like an app on a phone"));
ok(/\.jx-tabbar, \.jx-install \{ display: none; \}/.test(v173), "nothing new on a computer");
ok(/height: calc\(var\(--jx-tabh\) \+ env\(safe-area-inset-bottom\)\)/.test(v173), "the bar sits above the phone's home bar");
ok(/\.jx-main \{ padding-bottom: calc\(var\(--jx-tabh\)/.test(v173) && /\.jx-main #fab \{ bottom: calc\(var\(--jx-tabh\)/.test(v173), "pages and Ask Matin AI keep clear of it");
ok(/\.jx-typing \.jx-tabbar \{ display: none; \}/.test(v173), "hidden while typing");
ok(/\.jx-light \.jx-tabbar/.test(css), "black in light mode too, like the top bar");
ok(/min-height: 48px/.test(v173), "buttons big enough for a thumb");

/* ---- the home page (CIK: it stands where the dashboard was) ---- */
const home = read("app/home.jsx"), page = read("app/page.jsx");
ok(/String\(\(await searchParams\)\?\.tab \|\| ""\) === "deals" \? "deals" : "home"/.test(page) && /history\.replaceState/.test(home), "the home page opens on ?tab=, then keeps the address in step");
ok(/window\.addEventListener\("jarvis:tab", on\)/.test(home) && /e\.detail === "home" \|\| \(deals && e\.detail === "deals"\)/.test(home), "and switches when asked, only to a tab it has (cik-v6: Deals only once Podio is connected)");
ok(/new CustomEvent\("jarvis:tabchanged", \{ detail: tab \}\)/.test(home), "and says which tab it's on");

console.log(`\nbuild173: ${p} passed, ${f} failed`);
if (f) process.exit(1);
