/* build167.test.mjs — v167: the company logo in place of the gold letter "M",
 * everywhere Jarvis showed it. In CIK Office that is the Cash Is King logo
 * (public/brand/cik-logo.png), named once in lib/brand.js as LOGO. */
import fs from "node:fs";
import { LOGO, COMPANY } from "./lib/brand.js";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const img = fs.readFileSync("./public" + LOGO);
ok(LOGO === "/brand/cik-logo.png" && img.length > 1000 && img.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
   "the logo file is there and is a real PNG");
ok(!fs.existsSync("./public/brand/matin-m.jpg"), "the Matin M did not come over");

const menu = fs.readFileSync("./app/side-menu.jsx", "utf8");
ok((menu.match(/<img className="jx-mk jx-mkimg" src=\{LOGO\} alt="" width="34" height="34" aria-hidden="true" \/>/g) || []).length === 2 && !/>M<\/span>/.test(menu), "the menu and the phone top bar show the logo, not the letter");
const signin = fs.readFileSync("./app/signin/page.jsx", "utf8");
ok(/<img src=\{LOGO\} alt=\{COMPANY\}/.test(signin) && COMPANY === "Cash Is King" && !/\}\}>M<\/div>/.test(signin), "the sign-in page too, with the company's name for screen readers");
const legal = fs.readFileSync("./app/legal-shell.jsx", "utf8");
const legalImports = [...strip(legal).matchAll(/^import .* from "([^"]+)";?$/gm)].map(m => m[1]);
ok(/<img src=\{LOGO\} alt=""/.test(legal) && legalImports.join() === "../lib/brand.js", "the privacy and terms pages, importing nothing but the brand words");
ok(!/^\s*import /m.test(strip(fs.readFileSync("./lib/brand.js", "utf8"))), "and the brand words import nothing (so those pages never need the database)");
const css = fs.readFileSync("./app/shell.css", "utf8");
const base = css.indexOf("  .jx-mk {"), at = css.indexOf(".jx-mk.jx-mkimg {");
ok(base > 0 && at > base && !/^\}/m.test(css.slice(base, at)), "the phone top bar's logo style sits beside the phone .jx-mk rule (same screen sizes)");
ok(/\.jx-sidebrand \.jx-mk \{[\s\S]*?\}\n  \.jx-sidebrand \.jx-mk\.jx-mkimg \{ display: block; width: 38px; height: 38px;/.test(css), "and the computer menu's beside its own");
ok(/\.jx-mk\.jx-mkimg \{\s*display: block; padding: 0; background: #000; border: 1px solid rgba\(255, 255, 255, \.18\); object-fit: cover;/.test(css), "a black square with a faint white edge");

console.log(`\nbuild167: ${p} passed, ${f} failed`);
if (f) process.exit(1);
