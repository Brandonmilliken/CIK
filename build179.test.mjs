/* build179.test.mjs — v179 (2026-10-09): the deep scan, round 3 (ten code
 * reviews: logins, routes, tickets, office rooms, the dashboard, its data,
 * the vendor syncs, the shell, webhooks, and the database). CIK Office keeps
 * the logins, tickets, office, shell and database parts.
 * Database rules run for real in scripts/office-db-check.mjs (v179 block:
 * ticket limits under load, seen-by-id, imports and replaces at once). */
import fs from "node:fs";
process.env.DATABASE_URL ||= "postgresql://x:x@localhost.invalid/x";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const read = path => strip(fs.readFileSync(path, "utf8"));

/* ---- who sees what ---- */
const auth = read("auth.js");
ok(/if \(!agent && !lookupFailed && token\.sisuAgentId !== undefined\) \{\s*token\.sisuAgentId = null;\s*token\.role = effectiveRole\(token\.email, "agent"\);/.test(auth), "someone removed from the roster outright drops to agent");
ok(/export const currentUser = cache\(async function currentUser\(\)/.test(read("lib/session.js")), "who's asking is worked out once per request");

/* ---- the refresh clock (kept for the Podio sync to come) ---- */
const refresh = await import("./lib/refresh.js");
ok(refresh.laMonthStartMs(new Date("2026-10-01T07:30:00Z")) === Date.parse("2026-10-01T07:00:00Z") &&
   refresh.laMonthStartMs(new Date("2026-11-15T12:00:00Z")) === Date.parse("2026-11-01T07:00:00Z") &&
   refresh.laMonthStartMs(new Date("2026-12-03T12:00:00Z")) === Date.parse("2026-12-01T08:00:00Z"), "the 1st of the month at midnight in Portland, either side of the clock change");

/* ---- tickets ---- */
const tl = read("lib/tickets.js");
ok((tl.match(/pg_advisory_xact_lock/g) || []).length === 3, "ticket and reply limits hold under many requests at once");
const tu = read("app/tickets.jsx");
ok(/filter\(k => ed\[k\] !== ed\.was\[k\]\)/.test(tu), "Update status sends only what was changed (no reverting a status that moved)");
ok(/seen\.current\.delete\(t\.id\);/.test(tu) && /if \(busy\) return;/.test(tu), "the support bell clears for a second reply; the page never stops refreshing");

/* ---- office ---- */
const up = read("app/api/office/[room]/files/route.js");
ok(/for \(const f of room\.list\.fields \|\| \[\]\) \{[\s\S]{0,140}input\[f\.key\] = v;/.test(up) && /body\.set\(f\.key, String\(fields\[f\.key\]\)\)/.test(read("app/office-list.jsx")),
   "uploads send every field (Listing SOP and Approved scripts need a category)");
const st = read("lib/office-store.js");
ok(/async function logChange\([^)]*\) \{\s*try \{ await writeLog\(/.test(st), "the change log can't turn a saved change into an error");
ok(/on conflict \(room\) do nothing returning room/.test(st) && /this list holds exactly one file/.test(st), "imports: one run wins; a one-file list imports one");
ok(/useEffect\(\(\) => \{\s*if \(firstSync\.current\) \{ firstSync\.current = false; return; \}\s*if \(form \|\| busy \|\| confirmId\) return;\s*setItems\(initial\);/.test(read("app/office-list.jsx")), "room lists take the page's refresh");

/* ---- the shell ---- */
const sm = read("app/side-menu.jsx");
ok(/\.jx-side, \.jx-geardesk, \.jx-belldesk, \.jx-previewstrip, \.jx-install, \.jx-skip/.test(sm) && /setSearchOpen\(false\); setDispOpen\(true\);/.test(sm), "search and settings keep the keyboard inside them");
ok(/if \(!mq\.matches\) setOpen\(false\);/.test(sm), "turning an iPad sideways closes the phone menu");
ok(/if \(searchOpenRef\.current\) \{ closeSearchRef\.current\(\); return; \}/.test(sm), "Ctrl+K closes search and puts focus back");
ok(/e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey/.test(sm), "no loading bar for a link opened in a new tab");
ok(/const z = tip\.offsetWidth \?/.test(read("app/mls-coverage-tips.jsx")), "the MLS map tip lands by the pointer at large text sizes");
ok(!/#5a5854|#6f6d68/.test(read("app/signin/page.jsx")) && /#a3a09a/.test(read("app/legal-shell.jsx")), "sign-in and legal pages' small text is readable");

/* ---- database ---- */
ok(/create table if not exists view_as_log/.test(read("lib/db.js")), "the view-as log is made if missing");
ok(/announcement_acks_email/.test(read("lib/announcement-acks.js")), "one whole-table read per page is gone (acknowledgements by email use an index)");
ok(/to_regclass\('office_ticket_replies_author'\)/.test(tl) && /to_regclass\('office_items_origin'\)/.test(st), "table setup is one quick look when nothing is missing");
ok(/acksByItem\(anns\.map\(i => String\(i\.id\)\)\)/.test(read("app/office/[room]/page.jsx")), "admins see every acknowledgement of the announcements there are");
ok(/getThemeOrThrow/.test(read("app/api/prefs/route.js")) && /return v && typeof v === "object" && !Array\.isArray\(v\) \? v : null;/.test(read("app/api/prefs/route.js")), "settings: a failed read is 503, and a non-object body is a 400");

console.log(`\nbuild179: ${p} passed, ${f} failed`);
if (f) process.exit(1);
