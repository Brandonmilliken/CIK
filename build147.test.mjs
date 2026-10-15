/* build147.test.mjs — v147, Build 2 of Jordan's review (2026-10-05):
 * "Viewing as: Owner / Manager / Member" for leadership and the super admins,
 * and the saved tab. (The tabbed dashboard itself did not come over to CIK
 * Office.) The tab's database column is run for real in
 * scripts/prefs-db-check.mjs. */
import fs from "node:fs";
import { previewRoleFor, canPreviewRoles, PREVIEW_ROLES, PREVIEW_COOKIE } from "./lib/authz.js";
import { cleanTab, DASH_TABS } from "./lib/user-prefs.js";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = n => strip(fs.readFileSync(n, "utf8"));

/* ---- Viewing as: the rule ---- */
ok(PREVIEW_COOKIE === "jx_preview" && JSON.stringify(PREVIEW_ROLES) === '["admin","agent"]', "Manager is admin, Member is agent; Owner is no preview");
ok(canPreviewRoles("superadmin") && canPreviewRoles("leadership") && !canPreviewRoles("admin") && !canPreviewRoles("agent") && !canPreviewRoles(undefined),
   "only leadership and the super admins get the switch");
ok(previewRoleFor("superadmin", "agent") === "agent" && previewRoleFor("leadership", "admin") === "admin", "they can look as a manager or a member");
ok(previewRoleFor("admin", "agent") === null && previewRoleFor("agent", "agent") === null, "nobody else can use the cookie, even to look lower");
ok(["leadership", "superadmin", "owner", "", null, undefined, "AGENT", "agent; x"].every(v => previewRoleFor("leadership", v) === null),
   "a hand-made cookie can never raise anyone, or mean anything else");
ok(previewRoleFor("superadmin", "superadmin") === null, "previewing as yourself is no preview");

/* ---- Viewing as: everywhere ---- */
const session = read("lib/session.js");
ok(/import \{ cookies \} from "next\/headers";/.test(session) && /jar\.get\(PREVIEW_COOKIE\)/.test(session), "the server reads the preview from the request");
ok(/const preview = previewRoleFor\(user\.role, asked\);\s*return \{ \.\.\.user, realRole: user\.role, role: preview \|\| user\.role, preview \};/.test(session),
   "every page and API answer gets the lowered role; the real one is kept beside it");
ok((session.match(/return withPreview\(\{/g) || []).length === 2, "for Google sign-in and demo mode alike");
for (const n of ["app/page.jsx", "app/office/[room]/page.jsx"]) {
  const src = read(n);
  ok(!/<SideMenu role=\{user\.role\} \/>/.test(src) && /<SideMenu role=\{user\.role\} realRole=\{user\.realRole\} preview=\{user\.preview\}( deals=\{[^}]+\})? \/>/.test(src), `${n}: the menu gets the real role and the preview`);
}
const menu = fs.readFileSync("app/side-menu.jsx", "utf8");
ok(/const canPreview = canPreviewRoles\(realRole \|\| role\);/.test(menu), "the switch shows by what you really are, so it never disappears mid-preview");
ok(/\{ v: "", label: "Leadership"/.test(menu) && /\{ v: "admin", label: "Admin"/.test(menu) && /\{ v: "agent", label: "Agent"/.test(menu), "Leadership, Admin, Agent (CIK; Jarvis says Broker)");
ok(/Max-Age=\$\{PREVIEW_HOURS \* 3600\}/.test(menu) && /const PREVIEW_HOURS = 8;/.test(menu) && /Max-Age=0/.test(menu), "a preview turns itself off after 8 hours; Owner clears it");
ok(/if \(room && v && !canSeeRoom\(room, v\)\) location\.href = "\/";/.test(menu), "switching on a room that role can't open goes to the dashboard, not a dead end");
ok(/k\.startsWith\("jarvis\.viewas"\)\)\.forEach\(k => sessionStorage\.removeItem\(k\)\)/.test(menu), "switching starts \"View as\" an agent over, so the two never mix");
ok(/className="jx-previewstrip" role="status"/.test(menu) && /Back to Leadership/.test(menu), "while it is on, a strip on every page says so, with a way back");
ok(/role="group" aria-label="Viewing as"/.test(menu) && /aria-pressed=\{o\.v === viewing\}/.test(menu), "the switch says which one is on, to a screen reader too");
ok(/\{viewAs\("top"\)\}/.test(menu) && /\{viewAs\("side"\)\}/.test(menu), "at the top on a computer, in the menu on a phone");
const css = fs.readFileSync("app/shell.css", "utf8");
ok(/\.jx-viewas-top \{ display: flex;/.test(css) && /\.jx-viewas-side \{ display: flex;/.test(css), "and styled for both");

/* ---- the tabs ----
   CIK Office has no tabbed dashboard; the server-side tab list and the prefs
   route that saves it are kept, and must still refuse anything else. */
ok(JSON.stringify(DASH_TABS) === '["home","leads","deals","coaching","training","team"]', "the server knows the same tabs (v166: six, with Training)");
ok(cleanTab("deals") === "deals" && cleanTab("Deals") === null && cleanTab("") === null && cleanTab(null) === null, "only the five tab names are saved");
const prefs = read("app/api/prefs/route.js");
ok(/const tab = b && cleanTab\(b\.tab\);/.test(prefs) && /if \(tab\) out\.tab = await setTab\(user\.email, tab\);/.test(prefs), "the prefs API saves the tab for the signed-in person");

console.log(`\nbuild147: ${p} passed, ${f} failed`);
if (f) process.exit(1);
