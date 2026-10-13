/* build174.test.mjs — v174 (Brandon, 2026-10-09), overhaul phase 2: the
 * dashboard on a phone. In CIK Office only the swiping between the home
 * page's tabs is left (the dashboard's banner, badges, folded sections and
 * Ask Matin AI button did not come over). */
import fs from "node:fs";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const menu = strip(fs.readFileSync("./app/side-menu.jsx", "utf8"));
ok(/if \(!onDashboard\) return;\s*let start = null;/.test(menu) && /addEventListener\("touchstart", down, \{ passive: true \}\)/.test(menu), "swiping is on the dashboard only, and never slows scrolling");
ok(/Math\.abs\(dx\) < 70 \|\| Math\.abs\(dx\) < Math\.abs\(dy\) \* 2/.test(menu) && /Date\.now\(\) - start\.at < 700/.test(menu), "only a clear, quick sideways swipe counts");
ok(/input, textarea, select, \[contenteditable=true\], \.tabbar, #chat, #jump/.test(menu) && /ox === "auto" \|\| ox === "scroll"/.test(menu), "not one that starts on something that slides itself, or a box you type in");
ok(/classList\.contains\("jx-locked"\)/.test(menu), "nor while a menu or sheet is open");
ok(/new CustomEvent\("jarvis:tab", \{ detail: next\.dataset\.v \}\)/.test(menu), "it moves to the next or previous tab the dashboard has");

console.log(`\nbuild174: ${p} passed, ${f} failed`);
if (f) process.exit(1);
