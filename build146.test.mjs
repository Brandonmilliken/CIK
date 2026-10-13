/* build146.test.mjs — v146, Build 1 of Jordan's review (2026-10-05):
 * logo and search at the top. (The dashboard half of that build did not come
 * over to CIK Office.) Search's database query is run for real in
 * scripts/search-db-check.mjs. */
import fs from "node:fs";
import { cleanQuery, likeEscape, searchableLists } from "./lib/search.js";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/* ---- search ---- */
ok(cleanQuery("  vendors ") === "vendors" && cleanQuery("a") === null && cleanQuery("x".repeat(81)) === null && cleanQuery(5) === null, "search words: 2 to 80 characters");
ok(likeEscape("50%_off\\") === "50\\%\\_off\\\\", "% and _ are searched as themselves");
const agentLists = searchableLists("agent").map(l => l.slug), adminLists = searchableLists("admin").map(l => l.slug);
ok(!agentLists.includes("admin-links") && !agentLists.includes("leadership-settings") && !agentLists.includes("support"),
   "an agent's search never reaches admin or leadership rooms");
ok(adminLists.includes("admin-links") && !adminLists.includes("leadership-settings"), "an admin's reaches admin rooms, not leadership's");
ok(agentLists.includes("vendors") && agentLists.includes("lead-generation~scripts") && agentLists.includes("company~offices"), "and every list everyone can open, second lists included");
const route = strip(fs.readFileSync("./app/api/search/route.js", "utf8"));
ok(/const user = await currentUser\(\);\s*if \(!user\) return json\(\{ error: "unauthenticated" \}, 401\);/.test(route) && /searchItems\(q, user\.role\)/.test(route) && !/export async function POST/.test(route),
   "search is signed in, read only, and uses the signed-in person's role");
const lib = fs.readFileSync("./lib/search.js", "utf8");
ok(/where room = any\(\$\{\[\.\.\.bySlug\.keys\(\)\]\}::text\[\]\)/.test(lib) && /e\.value ilike \$\{pattern\} escape/.test(lib), "only allowed rooms are searched, with the words as data");
const box = fs.readFileSync("./app/search-box.jsx", "utf8");
ok(/menuFor\(role\)/.test(box) && /fetch\(`\/api\/search\?q=\$\{encodeURIComponent\(term\)\}`/.test(box), "pages come from your own menu; items from the server");
ok(/role="combobox"/.test(box) && /role="listbox"/.test(box) && /aria-activedescendant/.test(box) && /e\.key === "Escape"/.test(box), "the search box works with a keyboard and a screen reader");
const menu = fs.readFileSync("./app/side-menu.jsx", "utf8");
ok(/\(e\.metaKey \|\| e\.ctrlKey\) && !e\.altKey && \(e\.key === "k" \|\| e\.key === "K"\)/.test(menu), "Ctrl+K or Cmd+K opens search anywhere");
ok(/className="jx-topbar"/.test(menu) && /className="jx-searchtrigger"/.test(menu) && /<span>Search<\/span>/.test(menu), "a search bar at the top on a computer; on a phone, Search in the bottom bar (v173)");
ok(/className="jx-sidebrand"/.test(menu), "the logo at the top of the menu");
const list = fs.readFileSync("./app/office-list.jsx", "utf8");
ok(/new URLSearchParams\(window\.location\.search\)/.test(list) && /sp\.get\("q"\)/.test(list), "a room opened from search starts with its search filled in");
const css = fs.readFileSync("./app/shell.css", "utf8");
ok(/\.jx-shell \{ padding-top: var\(--jx-toph\); \}/.test(css) && /\.jx-shell #head \{ top: var\(--jx-toph\); \}/.test(css), "nothing hides under the top bar");

console.log(`\nbuild146: ${p} passed, ${f} failed`);
if (f) process.exit(1);
