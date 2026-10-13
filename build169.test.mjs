/* build169.test.mjs — v169: boxes almost black (#060607) in dark mode, and
 * the same when "Higher contrast" is on (it had its own lighter grey). */
import fs from "node:fs";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };

const css = fs.readFileSync("./app/shell.css", "utf8");
const block = (sel) => { const i = css.indexOf(sel + " {"); return i < 0 ? "" : css.slice(i, css.indexOf("}", i)); };
const hc = block(".jx-contrast.jx-contrast");
ok(/--panel: #060607; --panel2: #111114; --panel3: #18181d;/.test(hc), "Higher contrast: the page's boxes are near-black");
ok(/--jx-panel: #060607; --jx-panel2: #111114;/.test(hc), "and the menu's and rooms' boxes match");
ok(!/#101013|#1c1c22/.test(hc.replace(/\/\*[\s\S]*?\*\//g, "")), "the old lighter greys are gone");
ok(/--line: #50505c; --line2: #676774;/.test(hc) && /--dim: #e2dfd9;/.test(hc), "brighter text and stronger lines unchanged");

// Light mode keeps its white boxes: its rule comes later at equal strength,
// and light + contrast is stronger still.
ok(css.indexOf(".jx-light.jx-light {") > css.indexOf(".jx-contrast.jx-contrast {"), "light mode's rule comes after, so it wins");
ok(/--jx-panel: #ffffff;/.test(block(".jx-light.jx-light")) && /--panel: #ffffff;/.test(block(".jx-light.jx-contrast.jx-contrast")), "light boxes stay white");

ok(/^\s*--jx-panel: #060607;\s*--jx-panel2: #111114;/m.test(css) && (css.match(/--jx-panel: #060607; --jx-panel2: #111114;/g) || []).length === 2, "the menu, rooms and light mode's dark bars match");
ok((css.match(/rgba\(6,6,7,0\)/g) || []).length === 2 && !/rgba\(11,11,13,0\)/.test(css), "the scroll fades fade into the new box colour");
const signin = fs.readFileSync("./app/signin/page.jsx", "utf8");
ok(/background: "#111114"/.test(signin), "the sign-in box matches");

console.log(`\nbuild169: ${p} passed, ${f} failed`);
if (f) process.exit(1);
