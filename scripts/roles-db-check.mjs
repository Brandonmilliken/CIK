/* roles-db-check.mjs — v131: Leadership Settings, on a real Postgres.
 * TEST_PG_URL=postgres://user:pass@localhost/jarvis_test node scripts/roles-db-check.mjs
 * It DROPS and recreates agents and role_changes in that database. Never point it at Neon. */
import pg from "pg";
const url = process.env.TEST_PG_URL;
if (!url || /neon\.tech|vercel-storage/.test(url)) { console.log("Set TEST_PG_URL.\n\nroles-db: 0 passed, 1 failed"); process.exit(1); }
process.env.DATABASE_URL ||= "postgresql://test:test@localhost.invalid/test";
const pool = new pg.Pool({ connectionString: url, max: 4 });
function sql(strings, ...vals) {
  let text = ""; strings.forEach((s, i) => { text += s; if (i < vals.length) text += `$${i + 1}`; });
  const run = (c = pool) => c.query(text, vals).then(r => r.rows);
  return { run, then: (res, rej) => run().then(res, rej) };
}
const m = await import("../lib/roles.js");
m.__setSqlForTests(sql);
let p = 0, f = 0;
const ok = (c, msg) => { c ? p++ : (f++, console.log("  FAIL:", msg)); };
const refused = async (args, re) => { try { await m.setRole(args); return false; } catch (e) { return e instanceof m.RoleError && re.test(e.message); } };
const roleOf = async e => ((await pool.query("select role from agents where lower(email) = $1", [e])).rows[0] || {}).role;
try {
  await pool.query("drop table if exists role_changes; drop table if exists agents");
  await pool.query(`create table agents (email text primary key, sisu_agent_id integer unique, first_name text, last_name text, status text,
    brokerage_cap_amt numeric, brokerage_cap_anniversary date, start_dt date,
    role text not null default 'agent' check (role in ('agent','broker','admin','leadership')), synced_at timestamptz not null default now(), left_at timestamptz)`);
  await pool.query(`insert into agents (email, first_name, last_name, role) values
    ('brandon@cashisking.com','Brandon','Milliken','leadership'), ('Lee@CashIsKing.com','Lee','Park','leadership'),
    ('andy@cashisking.com','Andy','Wilcox','agent'), ('leona@cashisking.com','Leona','Park','admin')`);

  const out = await m.setRole({ actorEmail: "lee@cashisking.com", email: "Andy@CashIsKing.com", role: "leadership" });
  ok(out.changed && await roleOf("andy@cashisking.com") === "leadership", "leadership can make someone leadership");
  ok(await m.setRole({ actorEmail: "brandon@cashisking.com", email: "leona@cashisking.com", role: "agent" }).then(r => r.changed) && await roleOf("leona@cashisking.com") === "agent",
     "the super admin can remove someone from admin");
  ok(await refused({ actorEmail: "leona@cashisking.com", email: "andy@cashisking.com", role: "agent" }, /Only leadership/), "someone who is not leadership cannot change anyone");
  ok(await refused({ actorEmail: "lee@cashisking.com", email: "brandon@cashisking.com", role: "agent" }, /super admin/) && await roleOf("brandon@cashisking.com") === "leadership",
     "nobody can change the super admin");
  ok(await refused({ actorEmail: "lee@cashisking.com", email: "lee@cashisking.com", role: "agent" }, /own role/), "nobody changes their own role");
  ok(await refused({ actorEmail: "lee@cashisking.com", email: "andy@cashisking.com", role: "superadmin" }, /Pick agent/), "super admin cannot be handed out");
  ok(await refused({ actorEmail: "lee@cashisking.com", email: "new@cashisking.com", role: "admin" }, /isn't on the list yet/), "someone not on the list needs Add");
  const added = await m.setRole({ actorEmail: "lee@cashisking.com", email: "New@CashIsKing.com", role: "admin", add: true, firstName: "Nia", lastName: "New" });
  ok(added.added && await roleOf("new@cashisking.com") === "admin", "Add puts them on the roster with the role");
  /* Demoted leadership loses the power at once (fresh check, not the sign-in token). */
  await m.setRole({ actorEmail: "brandon@cashisking.com", email: "lee@cashisking.com", role: "admin" });
  ok(await refused({ actorEmail: "lee@cashisking.com", email: "andy@cashisking.com", role: "agent" }, /Only leadership/), "someone just removed from leadership can't make changes any more");
  const log = await m.recentChanges();
  ok(log.length === 4 && log[0].name === "Lee Park" && log[0].by === "Brandon Milliken" && log[0].from === "leadership" && log[0].to === "admin", "every change is recorded, newest first, with names");
  ok(log.some(c => c.from === null && c.to === "admin" && c.name === "Nia New"), "an added person is recorded as added");
  const people = await m.listPeople();
  ok(people[0].email === "brandon@cashisking.com" && people[0].locked && people[0].role === "superadmin", "the super admin is listed first, locked");
  ok(people.find(x => x.email === "lee@cashisking.com").role === "admin", "emails are matched in any case");
  /* v135: broker retired. */
  ok(await refused({ actorEmail: "brandon@cashisking.com", email: "andy@cashisking.com", role: "broker" }, /Pick agent, admin or leadership/), "broker can no longer be picked");
  await pool.query("insert into agents (email, first_name, last_name, role) values ('old@cashisking.com','Olga','Old','broker')");
  ok((await m.listPeople()).find(x => x.email === "old@cashisking.com").role === "agent", "someone still stored as a broker shows as an agent");
  ok(await m.setRole({ actorEmail: "brandon@cashisking.com", email: "old@cashisking.com", role: "agent" }).then(r => r.changed) && await roleOf("old@cashisking.com") === "agent", "and can be set to agent for good");

  /* v180: a role change and its audit line are one statement. */
  const before = (await pool.query("select count(*)::int n from role_changes")).rows[0].n;
  const both = await Promise.allSettled([
    m.setRole({ actorEmail: "brandon@cashisking.com", email: "andy@cashisking.com", role: "admin" }),
    m.setRole({ actorEmail: "brandon@cashisking.com", email: "andy@cashisking.com", role: "agent" }),
  ]);
  const lines = (await pool.query("select from_role, to_role from role_changes order by id desc limit 2")).rows;
  const logged = (await pool.query("select count(*)::int n from role_changes")).rows[0].n - before;
  const changed = both.filter(r => r.status === "fulfilled" && r.value.changed).length;
  ok(logged === changed && (logged < 2 || lines[0].from_role === lines[1].to_role), "v180: two changes at once are each logged once, each from the role the other left");
  ok(!(await m.setRole({ actorEmail: "brandon@cashisking.com", email: "andy@cashisking.com", role: await roleOf("andy@cashisking.com") })).changed, "v180: the same role again changes and logs nothing");

  /* v180: marking someone added by hand as having left. */
  const leftOf = async e => (await pool.query("select left_at from agents where lower(email) = $1", [e])).rows[0]?.left_at ?? null;
  ok((await m.setLeft({ actorEmail: "brandon@cashisking.com", email: "new@cashisking.com", left: true })).changed && await leftOf("new@cashisking.com") !== null, "v180: leadership can mark someone added by hand as left");
  ok((await m.listPeople()).find(x => x.email === "new@cashisking.com").left && (await m.recentChanges())[0].to === "left", "v180: ...shown as left, and recorded");
  ok(!(await m.setLeft({ actorEmail: "brandon@cashisking.com", email: "new@cashisking.com", left: true })).changed, "v180: marking twice does nothing the second time");
  ok((await m.setLeft({ actorEmail: "brandon@cashisking.com", email: "new@cashisking.com", left: false })).changed && await leftOf("new@cashisking.com") === null && (await m.recentChanges())[0].from === "left", "v180: and brought back");
  await pool.query("update agents set sisu_agent_id = 77 where email = 'andy@cashisking.com'");
  let sisuRefused = false;
  try { await m.setLeft({ actorEmail: "brandon@cashisking.com", email: "andy@cashisking.com", left: true }); } catch (e) { sisuRefused = e instanceof m.RoleError && e.status === 409; }
  ok(sisuRefused && await leftOf("andy@cashisking.com") === null, "v180: someone on Sisu's team is left to the nightly sync");
  let selfRefused = false;
  try { await m.setLeft({ actorEmail: "brandon@cashisking.com", email: "brandon@cashisking.com", left: true }); } catch (e) { selfRefused = e instanceof m.RoleError; }
  ok(selfRefused, "v180: nobody marks a super admin, or themselves, as left");
  let agentRefused = false;
  try { await m.setLeft({ actorEmail: "andy@cashisking.com", email: "leona@cashisking.com", left: true }); } catch (e) { agentRefused = e instanceof m.RoleError && e.status === 403; }
  ok(agentRefused, "v180: only leadership can");

  /* v181: a leader marked as left can't change roles in the minutes before
     their session ends. */
  await pool.query("insert into agents (email, first_name, last_name, role, left_at) values ('gone.lead@cashisking.com','Gil','Gone','leadership', now())");
  let leftLeader = false;
  try { await m.setRole({ actorEmail: "gone.lead@cashisking.com", email: "leona@cashisking.com", role: "leadership" }); } catch (e) { leftLeader = e instanceof m.RoleError && e.status === 403; }
  ok(leftLeader, "v181: a leader marked as left can't change roles");
  /* v181: "Add someone" for a person marked as left says so. */
  await m.setLeft({ actorEmail: "brandon@cashisking.com", email: "new@cashisking.com", left: true });
  let addLeft = false;
  try { await m.setRole({ actorEmail: "brandon@cashisking.com", email: "new@cashisking.com", role: "admin", add: true, firstName: "Nia" }); } catch (e) { addLeft = e instanceof m.RoleError && e.status === 409; }
  ok(addLeft, "v181: Add someone for a person marked as left points to Bring back");
  /* v181: an old address the roster sync retired can't be brought back here. */
  await pool.query("insert into agents (email, first_name, role, left_at) values ('old.addr@cashisking.com','Olive','admin', now())");
  let retired = false;
  try { await m.setLeft({ actorEmail: "brandon@cashisking.com", email: "old.addr@cashisking.com", left: false }); } catch (e) { retired = e instanceof m.RoleError && e.status === 409; }
  ok(retired, "v181: a retired old address can't be brought back");
  const ppl = await m.listPeople();
  ok(ppl.find(x => x.email === "new@cashisking.com").staff === true && ppl.find(x => x.email === "old.addr@cashisking.com").staff === false, "v181: Bring back is offered only for someone marked as left here");
  ok((await m.setLeft({ actorEmail: "brandon@cashisking.com", email: "new@cashisking.com", left: false })).changed, "v181: who was marked as left here can still be brought back");
  /* v181: only addresses that can sign in. */
  let outside = false;
  try { await m.setRole({ actorEmail: "brandon@cashisking.com", email: "someone@gmail.com", role: "admin", add: true, firstName: "Sam" }); } catch (e) { outside = e instanceof m.RoleError; }
  ok(outside, "v181: Add someone refuses an address that can't sign in");
} catch (e) { f++; console.log("  FAIL:", e.message); }
finally { await pool.query("drop table if exists role_changes; drop table if exists agents").catch(() => {}); await pool.end(); }
console.log(`\nroles-db: ${p} passed, ${f} failed`);
if (f) process.exit(1);
