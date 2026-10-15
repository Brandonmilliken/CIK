/* roles.test.mjs — v131: Leadership Settings and the super admin. */
import fs from "node:fs";
import { effectiveRole, isSuperAdmin, atLeast, SUPER_ADMINS, ROLES } from "./lib/authz.js";
import { roomBySlug, menuFor, canSeeRoom } from "./lib/office-rooms.js";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

ok(SUPER_ADMINS.length === 2 && SUPER_ADMINS[0] === "brandon@cashisking.com" && SUPER_ADMINS[1] === "jmatin@matinrealestate.com" && Object.isFrozen(SUPER_ADMINS),
   "Brandon and Jordan Matin are the super admins (cik-v10), and the list can't be changed while running");
ok(isSuperAdmin("jmatin@matinrealestate.com") && effectiveRole("jmatin@matinrealestate.com", "agent") === "superadmin", "Jordan is a super admin whatever role is stored for him");
ok(!isSuperAdmin("brandon@matinrealestate.com") && !isSuperAdmin("brandon@cashisking.co") && !isSuperAdmin("brandon@cashisking.com.evil.com"), "only his exact sign-in address counts");
ok(isSuperAdmin(" Brandon@CashIsKing.com ") && !isSuperAdmin("someone@cashisking.com") && !isSuperAdmin("") && !isSuperAdmin(null), "matched on the sign-in email, any case");
ok(effectiveRole("brandon@cashisking.com", "agent") === "superadmin" && effectiveRole("brandon@cashisking.com", "leadership") === "superadmin", "Brandon is super admin whatever is stored");
ok(effectiveRole("x@cashisking.com", "superadmin") === "agent", "nobody else can claim super admin (a stored or token 'superadmin' counts as agent)");
ok(effectiveRole("x@cashisking.com", "leadership") === "leadership" && effectiveRole("x@m.com", "nonsense") === "agent", "everyone else keeps their stored role; anything odd is agent");
ok(atLeast("superadmin", "leadership") && atLeast("superadmin", "admin") && !atLeast("leadership", "superadmin"), "super admin is above leadership");
ok(!ROLES.includes("superadmin"), "super admin is never one of the roles that can be stored or picked");
/* v135: broker retired. */
ok(JSON.stringify(ROLES) === JSON.stringify(["agent", "admin", "leadership"]), "the roles are agent, admin and leadership");
{
  const ed = fs.readFileSync("./app/roles-editor.jsx", "utf8");
  ok(/const CHOICES = \["agent", "admin", "leadership"\];/.test(ed) && !/chip\("broker"/.test(ed) && !/broker:/.test(ed), "Leadership Settings offers Agent, Admin and Leadership only");
}

const room = roomBySlug("leadership-settings");
ok(room && room.view === "roles" && room.minRole === "leadership", "Leadership Settings is its own page, for leadership");
ok(canSeeRoom(room, "superadmin") && canSeeRoom(room, "leadership") && !canSeeRoom(room, "admin") && !canSeeRoom(room, "agent"), "leadership and the super admin see it; admins and agents do not");
ok(menuFor("superadmin").flatMap(g => g.rooms).length === menuFor("leadership").flatMap(g => g.rooms).length, "the super admin's menu has everything leadership's has");

{
  const a = strip(fs.readFileSync("./auth.js", "utf8"));
  ok(/token\.role = effectiveRole\(token\.email, agent\.role \?\? "agent"\)/.test(a) && /session\.user\.role = effectiveRole\(token\.email/.test(a), "sign-in and every session apply the super admin rule");
  const sess = strip(fs.readFileSync("./lib/session.js", "utf8"));
  ok(/const preview = previewRoleFor\(user\.role, asked\);/.test(sess), "every page's role (and its preview) is worked out from the session's role, which carries it");
  const r = strip(fs.readFileSync("./app/api/roles/route.js", "utf8"));
  ok(/const user = await currentUser\(\)/.test(r) && /if \(!sameOrigin\(req\)\)/.test(r) && /atLeast\(user\.role, "leadership"\)/.test(r), "the roles door: signed in, from Jarvis, leadership");
  ok(/actorEmail: user\.email/.test(r) && !/b\.actor/.test(r), "who made the change always comes from the session");
  const lib = strip(fs.readFileSync("./lib/roles.js", "utf8"));
  ok(/select role, \(to_jsonb\(agents\) ->> 'left_at'\) as left_at from agents where lower\(email\) = \$\{actor\}/.test(lib) && (lib.match(/await actorRole\(actor\)/g) || []).length === 3, "the changer's own role is checked fresh from the database every time (v181: and someone marked as left counts as an agent; cik-v11: for Remove too)");
  ok(/insert into role_changes/.test(lib), "every change is recorded");
  const ed = fs.readFileSync("./app/roles-editor.jsx", "utf8");
  ok(/Yes, change it/.test(ed) && /that&rsquo;s you/.test(ed) && /can&rsquo;t be changed here, by anyone/.test(ed), "the page confirms each change, locks your own row and says the super admin is fixed");
}
/* cik-v11 (Brandon, 2026-10-15): remove someone added by mistake (a typo'd
   address). Checked against a real Postgres too (harness roles-remove-check). */
{
  const lib = fs.readFileSync("./lib/roles.js", "utf8");
  const fn = lib.slice(lib.indexOf("export async function removePerson"));
  ok(/atLeast\(myRole, "leadership"\)/.test(fn) && /isSuperAdmin\(who\)/.test(fn) && /who === actor/.test(fn), "only leadership removes, never a super admin, never yourself");
  ok(/if \(!found\.left_at\) throw new RoleError\("Mark them as having left first/.test(fn), "only someone already marked as left (two steps, so nobody vanishes in one click)");
  ok(/sisu_agent_id != null\) throw/.test(fn) && /delete from agents where lower\(email\) = \$\{who\} and left_at is not null and sisu_agent_id is null/.test(fn), "and only a row added by hand");
  ok(/insert into role_changes[\s\S]{0,120}'left', 'removed'/.test(fn), "the history records the removal");
  const route = fs.readFileSync("./app/api/roles/route.js", "utf8");
  ok(/b\.remove === true[\s\S]{0,120}removePerson\(\{ actorEmail: user\.email, email: b\.email \}\)/.test(route), "the API takes { email, remove: true }, actor from the session");
  ok(route.indexOf("sameOrigin(req)") < route.indexOf("removePerson({") && route.indexOf("user.demo") < route.indexOf("removePerson({"), "after the same-site and demo-mode checks");
  const ed = fs.readFileSync("./app/roles-editor.jsx", "utf8");
  ok(/onClick=\{\(\) => setRemoving\(p\.email\)\}>Remove/.test(ed) && /Yes, remove/.test(ed) && /send\(\{ email: p\.email, remove: true \}/.test(ed), "the page asks 'Yes, remove' before removing");
  ok(/removed: "Removed"/.test(ed) && /p\.name !== p\.email && <span className="jx-sub"> &middot; \{p\.email\}/.test(ed), "the history says Removed, and the Left list shows each email (so a typo is visible)");
}
console.log(`\nroles: ${p} passed, ${f} failed`);
if (f) process.exit(1);
