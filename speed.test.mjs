/* speed.test.mjs — v125: faster loads, and pages that keep themselves current.
 * (The dashboard feed, its Sierra pulls and the To-Do schedule did not come
 * over to CIK Office.) */
import fs from "node:fs";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ---- set-up statements run once per server, not on every request ---- */
{
  const r = strip(fs.readFileSync("./lib/refresh.js", "utf8"));
  ok(/let runTableReady = null;/.test(r) && /runTableReady = null; throw e;/.test(r), "sync_runs is created once, and retried after a failure");
  ok(/let leaseTableReady = null;/.test(r) && /await ensureLeaseTable\(\);/.test(r), "so is sync_leases");
  const o = strip(fs.readFileSync("./lib/office-store.js", "utf8"));
  ok(/seededRooms\.has\(room\.slug\)/.test(o) && /seededRooms\.add\(room\.slug\)/.test(o), "a seeded room is not asked about again");
}
/* ---- room pages ---- */
{
  const m = strip(fs.readFileSync("./app/side-menu.jsx", "utf8"));
  ok(/import Link from "next\/link";/.test(m) && /<Link key=\{href\}/.test(m), "room to room is an in-app move");
  ok(/const inApp = !onDashboard && href !== "\/";/.test(m), "but to or from the dashboard is a real page load (its script needs one)");
  ok(/router\.prefetch\(href, \{ kind: "full" \}\)/.test(m) && /onMouseEnter=\{warm\} onFocus=\{warm\}/.test(m) && !/onTouchStart=\{warm\}/.test(m), "the next room is fetched when you point at its link (v180: not on every touch while scrolling)");
  ok(/router\.refresh\(\)/.test(m) && /if \(onDashboard\) return;/.test(m), "room pages refresh themselves in place; the dashboard is left to its own");
  ok(/if \(document\.hidden \|\| typing\(\)\) return;/.test(m), "never while hidden or while someone is typing");
  ok(/className="jx-progress"/.test(m), "a loading bar shows while the next room loads");
}
/* ---- the region check ---- */
{
  const a = strip(fs.readFileSync("./app/api/admin/run/route.js", "utf8"));
  ok(/case "perf-probe":/.test(a) && /appRegion: process\.env\.VERCEL_REGION/.test(a) && !/dbHost|host:/.test(a),
     "the region check reports region names and timings, never the database address");
}
/* ---- v126: the server code runs next to the database ---- */
{
  const v = JSON.parse(fs.readFileSync("./vercel.json", "utf8"));
  ok(Array.isArray(v.regions) && v.regions.length === 1 && v.regions[0] === "pdx1",
     "Jarvis runs in Portland (pdx1), the same region as its database (us-west-2)");
  ok(!v.crons && !fs.existsSync("./app/api/cron"), "no scheduled syncs yet (and no cron route for one to call)");
}
console.log(`\nspeed: ${p} passed, ${f} failed`);
if (f) process.exit(1);
