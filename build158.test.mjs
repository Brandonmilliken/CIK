/* build158.test.mjs — v158, step 1 of the move, as CIK Office has it: the old
 * address (cikoffice.com) goes to www.cikoffice.com, old file links are
 * left alone, and no "still in the old office" links are in the menu. */
import fs from "node:fs";
import cfg from "./next.config.mjs";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ---- the redirects ---- */
const rules = await cfg.redirects();
ok(rules.length === 1 && rules.map(r => r.has[0].value).join() === "cikoffice.com", "only the bare address (www is the app)");
ok(rules.every(r => r.has.length === 1 && r.has[0].type === "host"), "matched on the host, so www.cikoffice.com itself is never redirected");
ok(rules.every(r => r.destination === "https://www.cikoffice.com/?from=cikoffice" && r.permanent === false), "to the home page (cik-v4: with a marker, so old remembered redirects cannot loop), temporary (307) for now");
const src = rules[0].source, re = new RegExp("^/" + src.slice(src.indexOf("(") + 1, src.lastIndexOf(")")) + "$");
ok(re.test("/") && re.test("/office/vendors") && re.test("/wp-admin/") && re.test("/wp-login.php"), "every page is sent over");
ok(!re.test("/wp-content/uploads/2026/08/contacts.vcf") && !re.test("/wp-content/uploads/2025/11/x.pdf"), "old file links are answered where they are (PDFs and the like)");
ok(re.test("/wp-content/themes/x.css"), "other WordPress addresses are not kept");

/* ---- the menu ---- */
const menu = fs.readFileSync("./app/side-menu.jsx", "utf8");
ok(!/moving soon/i.test(menu) && !/Open (MRE|CIK) Office/.test(menu) && !/(MRE|CIK)_OFFICE_URL/.test(menu), "no \"Still in the old office, moving soon\" key or \"Open CIK Office\" link in the menu");

console.log(`\nbuild158: ${p} passed, ${f} failed`);
if (f) process.exit(1);
