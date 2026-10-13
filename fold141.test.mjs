/* fold141.test.mjs — v141: every Agent Dashboard section folds, and the
 * folds are remembered for the person on every device. CIK Office has no
 * dashboard yet; the saved folds (and the route that saves them) are kept for
 * the Podio dashboard. The saving itself is run for real in
 * scripts/prefs-db-check.mjs. */
import fs from "node:fs";
import { cleanCollapsed } from "./lib/user-prefs.js";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

ok(JSON.stringify(cleanCollapsed(["todo", "todo", "new-leads", "Bad", "<script>", 3, "x".repeat(41)])) === '["todo","new-leads"]', "only real section ids are kept, once each");
ok(cleanCollapsed("todo") === null && cleanCollapsed(null) === null, "anything that isn't a list is refused");
ok(cleanCollapsed(Array.from({ length: 80 }, (_, i) => "s" + i)).length === 60, "and the list is capped");

const route = strip(fs.readFileSync("./app/api/prefs/route.js", "utf8"));
ok(/sameOrigin\(req\)/.test(route) && /setCollapsed\(user\.email, collapsed\)/.test(route) && !/b\.email/.test(route), "saving is signed in, from Jarvis, and for the signed-in person only");
const menu = fs.readFileSync("./app/side-menu.jsx", "utf8");
ok(/new CustomEvent\("jarvis:open-section", \{ detail: id \}\)/.test(menu) && /h2 \.sectitle/.test(menu), "the menu's On this page still names each section and opens it on the way");

console.log(`\nfold141: ${p} passed, ${f} failed`);
if (f) process.exit(1);
