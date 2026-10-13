/* build157.test.mjs — v157 (Brandon, 2026-10-06): J.A.R.V.I.S. stands for
 * Joint Agent Resource & Virtual Intranet System, shown everywhere. In CIK
 * Office the browser tab says "Jarvis · Cash Is King". */
import fs from "node:fs";
import { JARVIS_FULL, JARVIS_TITLE, JARVIS_WORDS, COMPANY, LOGO, CONTACT_EMAIL } from "./lib/brand.js";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
ok(JARVIS_FULL === "Joint Agent Resource & Virtual Intranet System" && JARVIS_TITLE === "Jarvis · Cash Is King", "the words, in one place");
ok(COMPANY === "Cash Is King" && LOGO === "/brand/cik-logo.png" && fs.existsSync("./public" + LOGO) && CONTACT_EMAIL === "brandon@cashisking.com",
   "CIK's name, logo (and the file is there) and contact address, in one place");
ok(JARVIS_WORDS.filter(([a]) => a !== "&").map(([a]) => a).join("") === "JARVIS" && JARVIS_WORDS.map(([a, r]) => a + r).join(" ") === JARVIS_FULL, "the first letters spell JARVIS");
const layout = fs.readFileSync("./app/layout.jsx", "utf8");
ok(/title: JARVIS_TITLE,/.test(layout), "the browser tab");
const signin = fs.readFileSync("./app/signin/page.jsx", "utf8");
ok(/JARVIS_WORDS\.map/.test(signin), "the sign-in page");
const menu = fs.readFileSync("./app/side-menu.jsx", "utf8");
ok(/className="jx-sbfull"/.test(menu) && /className="jx-footname">J\.A\.R\.V\.I\.S\. &middot; \{JARVIS_FULL\}/.test(menu), "under the logo, and at the foot of the menu");
const css = fs.readFileSync("./app/shell.css", "utf8");
ok(/\.jx-sbfull b \{ color: var\(--jx-gold\);/.test(css), "the first letters picked out in gold");
console.log(`\nbuild157: ${p} passed, ${f} failed`);
if (f) process.exit(1);
