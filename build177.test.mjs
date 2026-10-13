/* build177.test.mjs — v177 (2026-10-09): fixes from the deep scan (three code
 * reviews plus a hands-on sweep). Logins and permissions, tickets, and the
 * phone layout. (The Sierra to-do and dashboard fixes did not come over.) The ticket database rules run for real in
 * scripts/office-db-check.mjs (v177 block); signing out on leaving runs in
 * identity.test.mjs. */
import fs from "node:fs";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const read = path => strip(fs.readFileSync(path, "utf8"));

/* ---- permissions ---- */
const auth = read("auth.js");
ok(/if \(!isAllowedIdentity\(token\.email, true\)\) return null;/.test(auth) && /if \(agent && agent\.left_at && !isSuperAdmin\(token\.email\)\) return null;/.test(auth), "leaving the company, or the allow-list, ends a session at the next role check");
ok(/select \*\s*from agents\s*where btrim\(lower\(email\)\)/.test(read("lib/db.js")), "the lookup sees left_at");

/* ---- tickets ---- */
const lib = read("lib/tickets.js");
ok(/and body <> '' and created_at > now\(\) - interval '1 day'/.test(lib), "status changes don't count as messages");
/* v180: a status change is one statement now (no transaction needed). */
ok((lib.match(/await sql\.transaction\(\[/g) || []).length === 3, "a reply (both ways) and a status change save in one go");
ok(/try \{ await logNow\(/.test(lib), "the change log can't turn a saved change into an error");
ok(/agent_unread = \(agent_unread or \$\{!self\}\)/.test(lib) && /return Object\.assign\(after, \{ self, savedBody: v\.fields\.body \}\);/.test(lib), "answering your own ticket isn't news for you");
const reply = read("app/api/tickets/[id]/reply/route.js");
ok(/if \(!t\.self\) emailLater\(/.test(reply), "and emails no one");
ok(/async function listAfterSave\(load\) \{\s*try \{ return await load\(\); \}\s*catch \(e\) \{[^}]*return null; \}/.test(reply), "a saved message is never reported as not sent");
ok((read("app/api/tickets/[id]/route.js").match(/allTickets\(\)\.catch\(\(\) => null\)/g) || []).length === 2, "nor a saved status change or delete");
const ui = read("app/tickets.jsx");
ok(/news\.forEach\(t => fresh\.current\.add\(t\.id\)\);\s*setItems\(prev => mergeNewer\(prev, initial, new Set\(\)\)\);\s*const unread = initial\.filter\(t => t\.agentUnread\)\.map\(t => t\.id\);\s*if \(unread\.length\) send\("\/api\/tickets\/seen"/.test(ui), "My Tickets takes the page's refreshed list, and tells the bell");
/* v179: forms keep their own state, so only a save in progress holds it. */
ok(/if \(busy\) return;[\s\S]{0,900}setItems\(prev => mergeNewer\(prev, initial, gone\.current\)\);/.test(ui), "the Support Center too, never in the middle of a change");
ok(/keep === t\.id \? true : undefined/.test(ui) && /setKeep\(method === "DELETE" \? null : t\.id\);/.test(ui), "a ticket stays open after you save, send or cancel");
const menu = read("app/side-menu.jsx");
ok(/onClick=\{e => \{ if \(here\) \{ e\.preventDefault\(\); router\.refresh\(\); \} \}\}/.test(menu), "the bell, tapped on its own page, fetches it again");

/* ---- phone layout ---- */
ok(/window\.visualViewport\.scale > 1\.02\) return;/.test(menu), "no tab change while pinch-zoomed");
ok(/aria-current=\{onDashboard && \(dashTab === "home" \|\| !dashTab\)/.test(menu), "Home is lit on the Home tab only");
const hint = read("app/install-hint.jsx");
ok(/await deferred\.userChoice;[\s\S]*?setDeferred\(null\);\s*setMode\(null\);/.test(hint), "no dead Install button after the browser's prompt is dismissed");
const css = fs.readFileSync("./app/shell.css", "utf8");
ok(/\.jx-text-large \.jx-main #page > \.tabbar, \.jx-text-large \.jx-room \.jx-filters \{ top: calc\(\(var\(--jx-barh\) \+ env\(safe-area-inset-top\)\) \/ 1\.15\); \}/.test(css)
   && /\/ 1\.32\); \}/.test(css), "pinned rows sit flush under the bar with bigger text");
ok(!/\.jx-main #toastbox/.test(css), "the shell's toast rule that could never apply is gone");

console.log(`\nbuild177: ${p} passed, ${f} failed`);
if (f) process.exit(1);
