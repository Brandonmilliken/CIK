/* build157.test.mjs — the app's names, in one place. v157 showed what
 * J.A.R.V.I.S. stands for everywhere; cik-v7 (Brandon, 2026-10-15) took
 * "Joint Agent Resource & Virtual Intranet System" off every page. The
 * browser tab says "Jarvis · Cash Is King". */
import fs from "node:fs";
import * as brand from "./lib/brand.js";
const { JARVIS_TITLE, COMPANY, LOGO, CONTACT_EMAIL } = brand;
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
ok(JARVIS_TITLE === "Jarvis · Cash Is King", "the browser tab's name, in one place");
ok(COMPANY === "Cash Is King" && LOGO === "/brand/cik-logo.png" && fs.existsSync("./public" + LOGO) && CONTACT_EMAIL === "brandon@cashisking.com",
   "CIK's name, logo (and the file is there) and contact address, in one place");
ok(!("JARVIS_FULL" in brand) && !("JARVIS_WORDS" in brand), "the long name is gone from lib/brand.js");
const layout = fs.readFileSync("./app/layout.jsx", "utf8");
ok(/title: JARVIS_TITLE,/.test(layout), "the browser tab");
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const shown = ["app/side-menu.jsx", "app/signin/page.jsx", "app/layout.jsx", "app/legal-shell.jsx", "app/privacy/page.jsx", "app/terms/page.jsx", "app/manifest.js", "app/home.jsx", "app/page.jsx"];
for (const file of shown) {
  const code = strip(fs.readFileSync(file, "utf8"));
  ok(!/Joint Agent|Intranet System|J\.A\.R\.V\.I\.S|JARVIS_FULL|JARVIS_WORDS/.test(code), `${file} no longer shows "Joint Agent Resource & Virtual Intranet System"`);
}
const menu = fs.readFileSync("./app/side-menu.jsx", "utf8");
ok(!/className="jx-sbfull"/.test(menu) && /className="jx-footname">Jarvis &middot; \{COMPANY\}<\/p>/.test(menu), "under the logo: nothing; at the foot of the menu: Jarvis · Cash Is King");
ok(/aria-label=\{`Jarvis, \$\{COMPANY\}: Home`\}/.test(menu), "the logo link is read as 'Jarvis, Cash Is King: Home'");
ok(!/\.jx-sbfull/.test(fs.readFileSync("./app/shell.css", "utf8")), "and its styles are gone");
console.log(`\nbuild157: ${p} passed, ${f} failed`);
if (f) process.exit(1);
