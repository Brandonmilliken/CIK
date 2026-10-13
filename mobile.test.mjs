/* mobile.test.mjs — v124: phones, tablets and the display settings. */
import fs from "node:fs";
import vm from "node:vm";
import { cleanDisplay, applyDisplay, DISPLAY_BOOT, DISPLAY_KEY, DISPLAY_CLASSES, displayBoot, THEME_COLORS } from "./lib/display-prefs.js";
import { cleanTheme } from "./lib/user-prefs.js";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ---- display settings ---- */
ok(JSON.stringify(cleanDisplay({ text: "xlarge", contrast: true, motion: "yes", links: 1 })) === JSON.stringify({ theme: "dark", text: "xlarge", contrast: true, motion: false, links: false }),
   "stored settings are cleaned: only real true/false and known sizes survive");
ok(cleanDisplay({ text: "<script>" }).text === "normal" && cleanDisplay(null).text === "normal", "anything odd is standard");
const fakeEl = () => { const set = new Set(); return { classList: { add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c) }, set }; };
{
  const el = fakeEl();
  applyDisplay({ text: "large", contrast: true, motion: true, links: true }, el);
  ok([...el.set].sort().join() === "jx-contrast,jx-links,jx-motion-reduce,jx-text-large", "each setting is one class on <html>");
  applyDisplay({ text: "normal" }, el);
  ok(el.set.size === 0, "standard removes them all");
  ok(DISPLAY_CLASSES.every(c => c.startsWith("jx-")), "every class is jx- prefixed");
}
{
  const run = stored => {
    const el = fakeEl();
    vm.runInNewContext(DISPLAY_BOOT, { localStorage: { getItem: k => (k === DISPLAY_KEY ? stored : null) }, document: { documentElement: el }, JSON });
    return [...el.set].sort().join();
  };
  ok(run(JSON.stringify({ text: "xlarge", contrast: true })) === "jx-contrast,jx-text-xlarge", "the before-paint script applies what was stored");
  ok(run("not json") === "" && run(null) === "", "and does nothing (and does not throw) on junk or nothing");
  ok(run(JSON.stringify({ text: "huge", contrast: "true" })) === "", "and only accepts the real values");
  let threw = false;
  try { vm.runInNewContext(DISPLAY_BOOT, { localStorage: { getItem() { throw new Error("blocked"); } }, document: { documentElement: fakeEl() }, JSON }); } catch { threw = true; }
  ok(!threw, "blocked storage (private mode) does not break the page");
}

/* ---- the layout: zoom is never turned off ---- */
{
  const lay = fs.readFileSync("./app/layout.jsx", "utf8");
  ok(/viewport-fit=cover/.test(lay), "the page can use the full screen, with safe areas handled in CSS");
  ok(!/user-scalable\s*=\s*no|maximum-scale/.test(lay), "pinch-zoom is never turned off");
  ok(/displayBoot\(theme\)/.test(lay) && /suppressHydrationWarning/.test(lay), "display settings apply before the first paint");
}

/* ---- the menu ---- */
{
  const menu = strip(fs.readFileSync("./app/side-menu.jsx", "utf8"));
  ok(/className="jx-skip" href="#jx-content"/.test(menu), "a Skip to content link comes first");
  ok(/<header className="jx-bar">/.test(menu), "phones get a top bar");
  ok(/aria-controls="jx-side" aria-expanded=\{open\}[\s\S]{0,200}?aria-hidden="true"[\s\S]{0,300}?<span>Menu<\/span>/.test(menu), "the menu icon is hidden from screen readers and the button says Menu in words (v173: in the bottom bar)");
  ok(/setAttribute\("inert", ""\)/.test(menu) && /removeAttribute\("inert"\)/.test(menu), "the page behind the open menu is inert, and comes back when it closes");
  ok(/trapTab\(e, navRef\.current\)/.test(menu) && /trapTab\(e, dispRef\.current\)/.test(menu), "Tab stays inside the open menu and the settings sheet");
  ok(/onTouchEnd/.test(menu) && /dx < -60/.test(menu), "a swipe to the left closes the menu");
  ok(/On this page/.test(menu) && /#page section\[id\]/.test(menu), "on the dashboard the menu lists the page's sections");
  ok(/h\.focus\(\{ preventScroll: true \}\)/.test(menu), "jumping to a section moves the screen reader there too");
  ok(/role="dialog" aria-modal="true" aria-labelledby="jx-display-title"/.test(menu), "Display settings is a labelled dialog");
  ok(/<fieldset className="jx-fs">\s*<legend>Text size<\/legend>/.test(menu) && /type="radio"/.test(menu), "text size is a real radio group with a legend");
  ok((menu.match(/type="checkbox"/g) || []).length === 1 && /toggle\("contrast"/.test(menu) && /toggle\("motion"/.test(menu) && /toggle\("links"/.test(menu),
     "contrast, motion and links are real checkboxes");
  ok(/try \{ localStorage\.setItem/.test(menu), "saving a setting cannot throw in private mode");
}

/* ---- pages carry the skip target ---- */
{
  const page = fs.readFileSync("./app/page.jsx", "utf8");
  const room = fs.readFileSync("./app/office/[room]/page.jsx", "utf8");
  ok((page.match(/<main className="jx-main jx-room" id="jx-content" tabIndex=\{-1\}>/g) || []).length === 1, "the home page's column is the main landmark and the skip target");
  ok((room.match(/<main className="jx-main jx-room" id="jx-content" tabIndex=\{-1\}>/g) || []).length === 2, "so is every room page's (both kinds of room: a view and a list)");
  ok(!/<main(?![^>]*id="jx-content")/.test(page + room), "and no page has a main that isn't the skip target");
}

/* ---- phone CSS ---- */
{
  const css = strip(fs.readFileSync("./app/shell.css", "utf8"));
  const phone = css.slice(css.indexOf("@media (max-width: 999.98px)"));
  ok(/\.jx-bar \{ display: none; \}/.test(css), "desktop does not get the phone bar");
  ok(/\.jx-main input, \.jx-main select, \.jx-main textarea \{ font-size: 16px; \}/.test(phone), "boxes you type in are 16px, so iPhones do not zoom in on them");
  ok(/\.jx-search, \.jx-field input, \.jx-field textarea, \.jx-field select \{ font-size: 16px; min-height: 44px; \}/.test(phone), "on room pages too");
  ok(/min-height: 44px/.test(phone) && /\.jx-menubtn, \.jx-dispbtn \{[^}]*min-width: 44px; min-height: 44px/.test(phone), "buttons are at least 44px");
  ok(/env\(safe-area-inset-bottom\)/.test(css) && /env\(safe-area-inset-top\)/.test(css), "buttons keep clear of the notch and the home bar");
  ok(/\.jx-contrast\.jx-contrast \{/.test(css), "higher contrast outranks the dashboard's own colours");
  ok(/\.jx-motion-reduce \*[^{]*\{\s*transition: none !important; animation: none !important/.test(css), "less motion turns off every transition");
  ok(/\.jx-text-xlarge [^{]*\{ zoom: 1\.32; \}/.test(css), "the largest text setting grows the page");
  ok(/minmax\(min\(260px, 100%\), 1fr\)/.test(css), "room cards never force the page wider than a phone");
}

/* ---- v132: light and dark ---- */
{
  ok(cleanDisplay({}).theme === "dark" && cleanDisplay({ theme: "light" }).theme === "light" && cleanDisplay({ theme: "neon" }).theme === "dark", "dark is the default; only light or dark");
  const el = fakeEl();
  applyDisplay({ theme: "light" }, el);
  ok(el.set.has("jx-light"), "light adds jx-light");
  applyDisplay({ theme: "dark" }, el);
  ok(!el.set.has("jx-light"), "dark removes it");
  const run = stored => { const e = fakeEl(); vm.runInNewContext(DISPLAY_BOOT, { localStorage: { getItem: () => stored }, document: { documentElement: e, querySelector: () => null }, JSON }); return [...e.set].join(); };
  ok(run(JSON.stringify({ theme: "light" })) === "jx-light" && run(null) === "", "the before-paint script applies light, and dark by default");
  const css = strip(fs.readFileSync("./app/shell.css", "utf8"));
  ok(/\.jx-light\.jx-light \{[^}]*--bg: #f6f4ef;[^}]*--jx-bg: #f6f4ef;/.test(css), "light recolours the dashboard and the rooms");
  ok(/\.jx-light\.jx-contrast\.jx-contrast \{/.test(css), "higher contrast has its own light version");
  ok(/\.jx-geardesk \{\s*display: inline-flex;[^}]*position: fixed; top: 12px; right: 16px;/.test(css), "on a computer the settings gear sits in the top right corner");
  const menu = fs.readFileSync("./app/side-menu.jsx", "utf8");
  ok(/className="jx-geardesk"/.test(menu) && /<legend>Appearance<\/legend>/.test(menu) && /themeRadio\("dark", "Dark"/.test(menu) && /themeRadio\("light", "Light"/.test(menu), "Settings has Appearance: Dark or Light");
  ok((menu.match(/<span className="jx-sr">Settings<\/span>/g) || []).length === 2, "both gear buttons are named Settings for screen readers");
}

/* ---- v133: the theme follows the person ---- */
{
  const boot = (saved, stored) => {
    const e = fakeEl(); const box = { v: stored };
    vm.runInNewContext(displayBoot(saved), { localStorage: { getItem: () => box.v, setItem: (k, v) => { box.v = v; } }, document: { documentElement: e, querySelector: () => null }, JSON });
    return { cls: [...e.set].sort().join(), stored: box.v };
  };
  let r = boot("light", null);
  ok(r.cls === "jx-light" && JSON.parse(r.stored).theme === "light", "a new browser opens in the saved theme from the first paint, and remembers it");
  r = boot("dark", JSON.stringify({ theme: "light", text: "large" }));
  ok(r.cls === "jx-text-large" && JSON.parse(r.stored).theme === "dark" && JSON.parse(r.stored).text === "large", "the saved theme wins over this browser's, and this device's text size is kept");
  r = boot(null, JSON.stringify({ theme: "light" }));
  ok(r.cls === "jx-light", "nothing saved yet: this browser's own pick still applies");
  ok(displayBoot("<script>") === DISPLAY_BOOT && displayBoot(null) === DISPLAY_BOOT, "only dark or light ever reaches the page");
  let threw = false;
  try { vm.runInNewContext(displayBoot("light"), { localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }, document: { documentElement: fakeEl(), querySelector: () => null }, JSON }); } catch { threw = true; }
  ok(!threw, "blocked storage still does not break the page");
  ok(cleanTheme("light") === "light" && cleanTheme("dark") === "dark" && cleanTheme("Light") === null && cleanTheme({}) === null, "the server keeps only dark or light");
  const lay = strip(fs.readFileSync("./app/layout.jsx", "utf8"));
  ok(/await currentUser\(\)/.test(lay) && /themeFor\(user\.email\)/.test(lay) && /catch \{ return null; \}/.test(lay), "the page reads the signed-in person's saved theme, and a failure is never an error page");
  const route = strip(fs.readFileSync("./app/api/prefs/route.js", "utf8"));
  ok(/currentUser\(\)/.test(route) && /sameOrigin\(req\)/.test(route) && /setTheme\(user\.email/.test(route) && !/b\.email/.test(route), "saving is signed in, from Jarvis itself, and always for the signed-in person");
  const menu = strip(fs.readFileSync("./app/side-menu.jsx", "utf8"));
  ok(/if \(k === "theme"\) \{ lastThemePick\.current = Date\.now\(\); saveTheme\(v\); \}/.test(menu), "picking light or dark saves it to the account");
  ok(/saveTheme\(DISPLAY_DEFAULTS\.theme\)/.test(menu), "Reset to standard saves dark everywhere too");
  ok(/fetch\("\/api\/prefs", \{ credentials: "same-origin", cache: "no-store" \}\)/.test(menu) && /visibilitychange/.test(menu), "an open browser picks up a change made elsewhere when you come back to it");
  ok(/if \(mine\) saveTheme\(mine\)/.test(menu), "a pick made before this version is kept and saved");
  ok(/follows you to every device/.test(menu), "Settings says the theme follows you");
}

/* ---- v145: dark mode is true black ---- */
{
  const css = strip(fs.readFileSync("./app/shell.css", "utf8"));
  ok(/--jx-bg: #000000;/.test(css) && /--jx-side: #000000;/.test(css), "the shell's page and menu backgrounds are true black");
  const lay = fs.readFileSync("./app/layout.jsx", "utf8");
  ok(/content="#000000"/.test(lay) && /background: "#000000"/.test(lay), "before anything loads, and the phone's status bar, too");
  ok(THEME_COLORS.dark === "#000000" && THEME_COLORS.light === "#f6f4ef", "light mode is unchanged");
  ok(/background: "#000000"/.test(fs.readFileSync("./app/signin/page.jsx", "utf8")) && /background: "#000000"/.test(fs.readFileSync("./app/legal-shell.jsx", "utf8")), "the sign-in and legal pages match");
}
console.log(`\nmobile: ${p} passed, ${f} failed`);
if (f) process.exit(1);
