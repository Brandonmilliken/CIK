/* build180.test.mjs — v180 (2026-10-09): the deep scan, round 4 (twenty-five
 * code reviews). Database rules run for real in scripts/*-db-check.mjs
 * (v180 blocks: tickets-db, roles-db). The vendor, Matin AI, dashboard and
 * per-agent-tool parts did not come over to CIK Office. */
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
process.env.DATABASE_URL ||= "postgresql://x:x@localhost.invalid/x";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const read = path => strip(fs.readFileSync(path, "utf8"));

/* ---- leases, the database, sign-in logs ---- */
const refresh = read("lib/refresh.js");
ok(/export async function holdLease\(name, seconds, fn, \{ waitMs = 0/.test(refresh), "one chain of jobs at a time across page views");
const { jsonSafe } = await import("./lib/db.js");
const saved = JSON.parse(JSON.stringify({ a: "x\u0000y", b: "ok\ud83d" }, jsonSafe));
ok(saved.a === "xy" && !/[\ud800-\udfff]/.test(saved.b.replace(/\ufffd/g, "")), "text Postgres can't store (a NUL, half an emoji) is cleaned before saving");
ok(/new URL\(process\.env\.DATABASE_URL\)/.test(read("lib/db.js")) && /value not shown/.test(fs.readFileSync("lib/db.js", "utf8")), "a malformed DATABASE_URL is never printed");
const auth = read("auth.js");
ok(/allowedEmailCount: allowedEmails\(\)\.length/.test(auth) && !/allowedEmails: allowedEmails\(\)/.test(auth), "a refused sign-in logs how many single addresses are allowed, not who");

/* ---- roles, settings ---- */
const roles = read("lib/roles.js");
ok(/with old as \(select email, role from agents where lower\(email\) = \$\{who\} for update\)/.test(roles) && /insert into role_changes \(actor, email, from_role, to_role\)\s*select \$\{actor\}, \$\{who\}, from_role, \$\{role\} from upd/.test(roles),
   "a role change and its audit line are one statement");
ok(/export async function setLeft\(/.test(roles) && /if \(found\.sisu_agent_id != null\) throw new RoleError/.test(roles) && /typeof b\.left === "boolean"/.test(read("app/api/roles/route.js")),
   "someone added by hand can be marked as left (and brought back)");
const re = read("app/roles-editor.jsx");
ok(/Mark as left/.test(re) && /Bring back/.test(re) && /setPending\(null\);\s*\}, \[q, show\]\)/.test(re), "Leadership Settings: Mark as left; a hidden pending change is dropped");
const up = read("lib/user-prefs.js");
ok((up.match(/42P01/g) || []).length === 2, "no settings table yet is 'nothing saved', not an outage");
const { displayBoot, THEME_UNSYNCED_KEY, DISPLAY_KEY } = await import("./lib/display-prefs.js");
{
  const vm = await import("node:vm");
  const run = (store) => {
    const cls = new Set();
    const ls = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
    vm.runInNewContext(displayBoot("dark"), { localStorage: ls, document: { documentElement: { classList: { add: c => cls.add(c) } }, querySelector: () => null }, JSON });
    return cls;
  };
  ok(run({ [DISPLAY_KEY]: JSON.stringify({ theme: "light" }), [THEME_UNSYNCED_KEY]: "1" }).has("jx-light"), "a theme pick that didn't reach the account isn't undone on the next load");
  ok(!run({ [DISPLAY_KEY]: JSON.stringify({ theme: "light" }) }).has("jx-light"), "...while a saved one still wins");
}
const sm = read("app/side-menu.jsx");
ok(/if \(isUnsynced\(\)\) \{ const mine = storedTheme\(\) \|\| "dark"; saveTheme\(mine\); return; \}/.test(sm) && /if \(r\.ok\) unsynced\(false\)/.test(sm), "the menu re-sends a theme whose save failed");
ok(/first = false;/.test(sm) && sm.indexOf("first = false;") > sm.indexOf('if (!r.ok) return;'), "the old-theme carry-over waits for an answer");
ok(/function visibleOr\(/.test(sm) && /visibleOr\(searchOpener\.current, btnRef\.current\)/.test(sm), "focus returns to something you can see");
ok(/const behind = \(searchOpen \|\| dispOpen \|\| \(open && isPhone\(\)\)\)/.test(sm) && /<InstallHint locked=\{open \|\| dispOpen \|\| searchOpen\} \/>/.test(sm) && /inert=\{locked \|\| undefined\}/.test(read("app/install-hint.jsx")),
   "the phone menu keeps the page and the install card out of reach");
ok(!/office-rooms/.test(sm) && !/office-rooms/.test(read("app/search-box.jsx")), "the menu and search don't download every room's contents");
{
  const { MENU } = await import("./lib/office-menu.js");
  const { ROOM_GROUPS } = await import("./lib/office-rooms.js");
  const want = ROOM_GROUPS.map(g => ({ label: g.label, rooms: g.rooms.map(r => {
    const o = { slug: r.slug, label: r.label };
    if (r.minRole) o.minRole = r.minRole;
    if (r.where && r.where !== "jarvis") o.where = r.where;   // v181: the menu's "still in the old office" dot reads it
    const blurb = r.blurb || (r.list && r.list.blurb) || "";
    if (blurb) o.blurb = blurb;
    return o;
  }) }));
  ok(isDeepStrictEqual(MENU, want), "lib/office-menu.js matches the rooms in lib/office-rooms.js (regenerate it if a room changed)");
  const { menuFor } = await import("./lib/office-menu.js");
  const slugs = role => menuFor(role).flatMap(g => g.rooms.map(r => r.slug));
  ok(!slugs("agent").includes("admin-links") && !slugs("agent").includes("support") && slugs("admin").includes("admin-links") && slugs("admin").includes("support") &&
     !slugs("admin").includes("leadership-settings") && slugs("leadership").includes("leadership-settings") && slugs("agent").includes("directory"),
     "the menu shows each role its rooms");
}

/* ---- sign-in and pages ---- */
const si = read("app/signin/page.jsx");
ok(/redirectTo: next \|\| "\/"/.test(si) && /\^\\\/\(\?!\[\/\\\\\]\)/.test(si), "sign-in returns to the page you asked for, only on this site");
{
  const m = /function safeNext\(v\) \{[\s\S]*?\n\}/.exec(fs.readFileSync("app/signin/page.jsx", "utf8"));
  const safeNext = new Function(m[0] + "; return safeNext;")();
  ok(safeNext("/office/support") === "/office/support" && safeNext("/?tab=deals") === "/?tab=deals" && safeNext("//evil.com") === "" && safeNext("/\\evil.com") === "" && safeNext("https://evil.com") === "" && safeNext("/signin?next=/") === "",
     "...and never to another site");
}
const lay = read("app/layout.jsx");
ok(/export const viewport = \{ width: "device-width", initialScale: 1, viewportFit: "cover" \};/.test(lay) && !/<meta name="viewport"/.test(lay), "the notch spacing survives moving between pages");
ok(!/^import .*lib\/session\.js/m.test(lay) && !/^import .*lib\/user-prefs\.js/m.test(lay) && /await Promise\.all\(\[import\("\.\.\/lib\/session\.js"\), import\("\.\.\/lib\/user-prefs\.js"\)\]\)/.test(lay),
   "Privacy, Terms and sign-in render without a database");
const nc = fs.readFileSync("next.config.mjs", "utf8");
ok(/source: "\/\(\(\?!privacy\$\|terms\$\)\.\*\)"/.test(nc) && /staleTimes: \{ static: 30 \}/.test(nc), "Privacy and Terms can be indexed; a warmed room link is at most 30 seconds old");
ok(!/orientation/.test(read("app/manifest.js")), "an installed tablet can turn sideways");

/* ---- the look ---- */
const css = fs.readFileSync("app/shell.css", "utf8");
ok(!/\n\s*\.jx-main h2 \{ font-size: 20px;/.test(css), "rooms keep their own phone heading sizes");
ok(/--gold: #7a560f;/.test(css) && /--jx-gold: #7a560f;/.test(css) && /--good: #256b42; --warn: #8f4c0f;/.test(css), "light theme: gold and badges pass 4.5 : 1");
ok(/\.jx-searchrow:focus-within \{/.test(css), "keyboard focus shows on search");
ok(/@media \(min-width: 1000px\) \{\s*\.jx-shell \.jx-main section \{ scroll-margin-top: calc\(var\(--jx-toph\) \+ 100px\); \}/.test(css), "on a computer a jump lands below the header");

console.log(`\nbuild180: ${p} passed, ${f} failed`);
if (f) process.exit(1);
