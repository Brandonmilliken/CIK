/* roles.test.mjs — v131: Leadership Settings and the super admin. */
import fs from "node:fs";
import { effectiveRole, isSuperAdmin, atLeast, SUPER_ADMINS, ROLES } from "./lib/authz.js";
import { roomBySlug, menuFor, canSeeRoom } from "./lib/office-rooms.js";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

ok(SUPER_ADMINS.length === 1 && SUPER_ADMINS[0] === "brandon@cashisking.com" && Object.isFrozen(SUPER_ADMINS), "Brandon is the one super admin at Cash Is King, and the list can't be changed while running");
ok(!isSuperAdmin("jmatin@matinrealestate.com") && effectiveRole("jmatin@matinrealestate.com", "agent") === "agent", "Jarvis's other super admin (Matin's) is not one here");
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
  ok(/select role, \(to_jsonb\(agents\) ->> 'left_at'\) as left_at from agents where lower\(email\) = \$\{actor\}/.test(lib) && (lib.match(/await actorRole\(actor\)/g) || []).length === 2, "the changer's own role is checked fresh from the database every time (v181: and someone marked as left counts as an agent)");
  ok(/insert into role_changes/.test(lib), "every change is recorded");
  const ed = fs.readFileSync("./app/roles-editor.jsx", "utf8");
  ok(/Yes, change it/.test(ed) && /that&rsquo;s you/.test(ed) && /can&rsquo;t be changed here, by anyone/.test(ed), "the page confirms each change, locks your own row and says the super admin is fixed");
}
console.log(`\nroles: ${p} passed, ${f} failed`);
if (f) process.exit(1);
