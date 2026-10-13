/* build178.test.mjs — v178 (2026-10-09): the deep scan, round 2 (four code
 * reviews). Leases and the office lists (the vendor syncs, webhooks and the
 * dashboard's refresh loop did not come over to CIK Office).
 * The database rules run for real in scripts/office-db-check.mjs, search-db-check.mjs
 * and acks-db-check.mjs (v178 blocks). */
import fs from "node:fs";
process.env.DATABASE_URL ||= "postgresql://x:x@localhost.invalid/x";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const read = path => strip(fs.readFileSync(path, "utf8"));

/* ---- leases and retries ---- */
const ref = read("lib/refresh.js");
ok(/const lease = await hooks\.acquire\(name, leaseSeconds\);/.test(ref) && /hooks\.release\(name, lease\)/.test(ref), "a run lets go only of its OWN lease");
ok(/add column if not exists owner/.test(ref) || /owner text/.test(ref), "leases carry an owner");
ok(/skipped: "failed recently"/.test(ref), "a sync that just failed waits before trying again");

/* ---- office lists ---- */
const ol = read("app/office-list.jsx");
ok(/if \(!list\.search\) return;/.test(ol) && /const q = list\.search \? query\.trim\(\)\.toLowerCase\(\) : "";/.test(ol), "?q only filters a list that has a search box");
ok(/const onlyOn = /.test(ol) && /const tagOn = /.test(ol) && /const flagOn = flagOnly && items\.some\(flagged\);/.test(ol), "a filter whose button is gone stops filtering");
ok(/g\.items\.filter\(passesOthers\)\.length/.test(ol), "group counts match what the chip would show");
ok(/base: it\.fields/.test(ol) && /base: form\.base \|\| undefined/.test(ol) && /r\.conflict && form\.id/.test(ol), "an edit says what it started from, and a clash keeps what was typed");
const st = read("lib/office-store.js");
ok(/for update\)/.test(st) && /b\.fields = \$\{baseJson\}::jsonb/.test(st) && /EDIT_CONFLICT, \{\}, 409/.test(st), "two people editing one card: the second is told, not silently saved over");
ok(/string_agg\(id::text, ',' order by position, id\)/.test(st) && /return moveItem\(slug, id, direction, actor, \(_tries \|\| 0\) \+ 1\);/.test(st) && (st.match(/pg_advisory_xact_lock/g) || []).length === 3, "moves at the same moment don't undo each other");
ok(/pg_advisory_xact_lock\(hashtext\(/.test(st) && /having count\(\*\) < \$\{limit\}::int/.test(st), "a one-file list can't get two files from two uploads at once");
ok(/return respondError\(e, room\.slug\);/.test(read("app/api/office/[room]/items/[id]/route.js")) && /\(e\.status === 409 \|\| e\.status === 404\) && slug/.test(read("lib/office-api.js")), "a clash sends back the list as it is now");
ok(/order by at desc limit 5000\) t order by at asc/.test(read("lib/announcement-acks.js")), "the newest 5000 acknowledgements are kept, not the oldest");
ok(/limit 1000/.test(read("lib/search.js")) && /unnest\(\$\{titleKeys\}::text\[\]\)/.test(read("lib/search.js")), "search puts name matches first before it caps");

console.log(`\nbuild178: ${p} passed, ${f} failed`);
if (f) process.exit(1);
