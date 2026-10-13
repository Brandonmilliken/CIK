/* build176.test.mjs — v176 (2026-10-09): two light-mode fixes found in the
 * site scan. The phone's bottom bar is solid black (see-through let a light
 * page's words show behind it), and the install card's Not now button is
 * dark like the card. */
import fs from "node:fs";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const css = fs.readFileSync("./app/shell.css", "utf8");
const bar = css.slice(css.indexOf("  .jx-tabbar {"), css.indexOf("}", css.indexOf("  .jx-tabbar {")));
ok(/background: #000;/.test(bar) && !/rgba\(0, 0, 0, \.94\)/.test(bar) && !/backdrop-filter/.test(bar), "the bottom bar is solid black");
ok(/\.jx-installbtns \.jx-ghost \{ background: #1a1a1f; color: #f4f3f1; border: 1px solid #33333b; \}/.test(css), "Not now matches the black card in both themes");
console.log(`\nbuild176: ${p} passed, ${f} failed`);
if (f) process.exit(1);
