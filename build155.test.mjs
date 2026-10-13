/* build155.test.mjs — v155 (Brandon, 2026-10-06): in light mode the left
 * menu and the top bar (the phone's top bar too, with the bell and gear) are
 * black. The page itself stays light. */
import fs from "node:fs";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const css = fs.readFileSync("./app/shell.css", "utf8");
const block = css.slice(css.lastIndexOf("/*", css.indexOf("v155 (Brandon, 2026-10-06)")));
ok(/\.jx-light \.jx-side, \.jx-light \.jx-topbar, \.jx-light \.jx-bar,(?: \.jx-light \.jx-tabbar,)?\s*\.jx-light \.jx-geardesk, \.jx-light \.jx-bell\.jx-belldesk \{/.test(block), "the menu, the top bar, the phone bar, the bell and the gear");
ok(/--jx-bg: #000000; --jx-side: #000000;/.test(block) && /--jx-text: #f4f3f1;/.test(block) && /color-scheme: dark;/.test(block), "wear dark mode's black and light text in light mode");
ok(/\.jx-light\.jx-contrast \.jx-side, \.jx-light\.jx-contrast \.jx-topbar/.test(block) && /outline-color: #fff;/.test(block), "with dark mode's high-contrast greys and a white focus ring when Higher contrast is on");
ok(!/\.jx-light \.jx-main[^{]*\{[^}]*--jx-bg: #000000/.test(block), "the page itself stays light");
const bare = block.replace(/\/\*[\s\S]*?\*\//g, "");
const sel = [...bare.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map(m => m[2].trim()).filter(Boolean);
ok(sel.length > 0 && sel.every(s => s.split(",").every(x => x.trim().startsWith(".jx-"))), "every selector stays inside Jarvis's own (.jx-) names");
console.log(`\nbuild155: ${p} passed, ${f} failed`);
if (f) process.exit(1);
