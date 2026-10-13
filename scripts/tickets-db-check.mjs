/* tickets-db-check.mjs — v180: the Support Center's ticket writes on a REAL
 * Postgres (the locked replies and the one-statement status change).
 *   TEST_PG_URL=postgres://user:pass@localhost/jarvis_test node scripts/tickets-db-check.mjs
 * It DROPS the office_ticket* and office_changes tables in that database
 * first. Never point it at Neon.
 */
import pg from "pg";

const url = process.env.TEST_PG_URL;
if (!url || /neon\.tech|vercel-storage/.test(url)) {
  console.log("Set TEST_PG_URL to a throwaway local database. Refusing to run against Neon.");
  console.log("\ntickets-db: 0 passed, 1 failed");
  process.exit(1);
}
process.env.DATABASE_URL ||= "postgresql://test:test@localhost.invalid/test";

const pool = new pg.Pool({ connectionString: url, max: 6 });
function sql(strings, ...vals) {
  let text = "";
  strings.forEach((s, i) => { text += s; if (i < vals.length) text += `$${i + 1}`; });
  const run = (c = pool) => c.query(text, vals).then(r => r.rows);
  return { run, then: (res, rej) => run().then(res, rej) };
}
sql.transaction = async (queries) => {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const out = [];
    for (const q of queries) out.push(await q.run(c));
    await c.query("commit");
    return out;
  } catch (e) { await c.query("rollback"); throw e; }
  finally { c.release(); }
};

const t = await import("../lib/tickets.js");
t.__setSqlForTests(sql);
let p = 0, f = 0;
const ok = (c, msg) => { c ? p++ : (f++, console.log("  FAIL:", msg)); };
const agent = { email: "andy@matinrealestate.com", displayName: "Andy" };
const admin = { email: "ada@matinrealestate.com", displayName: "Ada" };
const row = async id => (await pool.query("select * from office_tickets where id = $1", [id])).rows[0];

try {
  await pool.query("drop table if exists office_ticket_replies; drop table if exists office_tickets; drop table if exists office_changes");
  const tk = await t.createTicket(agent, { title: "Lockbox", category: t.TICKET_CATEGORIES[0], priority: "Normal", details: "x" });
  ok(tk.status === "New", "a ticket is filed");

  /* A reply from support moves New to In review and rings the agent's bell. */
  const r1 = await t.supportReply(tk.id, { body: "On it" }, admin);
  ok(r1.status === "In review" && r1.agentUnread && !r1.supportUnread, "a support reply: In review, the agent is told");

  /* Waiting on agent, then the agent answers: back to In review. */
  await t.updateTicket(tk.id, { status: "Waiting on agent" }, admin.email);
  const a1 = await t.agentReply(tk.id, { body: "Here you go" }, agent);
  ok(a1.status === "In review" && a1.supportUnread && !a1.agentUnread, "the agent's answer reopens it and tells support");

  /* v180: a priority change after that keeps the reopened status (it used
     to write back the status read before). */
  const u1 = await t.updateTicket(tk.id, { priority: "High" }, admin.email);
  ok(u1.priority === "High" && u1.status === "In review" && u1.supportUnread, "v180: a priority change leaves the status and flags as they are now");
  const hist = (await pool.query("select count(*)::int n from office_ticket_replies where ticket_id = $1 and body = ''", [tk.id])).rows[0].n;
  ok(hist === 1, "v180: only a real status move is written to the history (" + hist + ")");
  ok(!u1.statusChanged, "v180: and no email goes out for it");

  /* v180: a status change is one statement: history and ticket together. */
  const u2 = await t.updateTicket(tk.id, { status: "Resolved" }, admin.email);
  const hist2 = (await pool.query("select status_to from office_ticket_replies where ticket_id = $1 and body = '' order by id desc limit 1", [tk.id])).rows[0];
  ok(u2.status === "Resolved" && u2.statusChanged && hist2.status_to === "Resolved" && (await row(tk.id)).agent_unread, "v180: a status change, its history line and the agent's bell together");

  /* v180: a support reply and an agent reply at the same moment both land,
     and the ticket ends in a state one of them would leave. */
  await t.updateTicket(tk.id, { status: "Waiting on agent" }, admin.email);
  const both = await Promise.allSettled([
    t.supportReply(tk.id, { body: "Any news?" }, admin),
    t.agentReply(tk.id, { body: "Done now" }, agent),
  ]);
  const end = await row(tk.id);
  const msgs = (await pool.query("select count(*)::int n from office_ticket_replies where ticket_id = $1 and body in ('Any news?', 'Done now')", [tk.id])).rows[0].n;
  ok(both.every(r => r.status === "fulfilled") && msgs === 2, "v180: two replies at once are both saved");
  ok(end.status === "In review" || end.status === "Waiting on agent", "v180: ...and the status is one a reply would set (" + end.status + ")");

  /* An unknown ticket says so. */
  let missing = false;
  try { await t.updateTicket("999999", { status: "Resolved" }, admin.email); } catch (e) { missing = e instanceof t.TicketError && e.status === 404; }
  ok(missing, "a ticket that isn't there answers Not found");
  let notMine = false;
  try { await t.agentReply(tk.id, { body: "hi" }, { email: "someone@matinrealestate.com" }); } catch (e) { notMine = e instanceof t.TicketError && e.status === 404; }
  ok(notMine, "an agent can't answer someone else's ticket");
} catch (e) { f++; console.log("  FAIL: threw", e.message); }
finally {
  await pool.query("drop table if exists office_ticket_replies; drop table if exists office_tickets; drop table if exists office_changes").catch(() => {});
  await pool.end();
}
console.log(`\ntickets-db: ${p} passed, ${f} failed`);
if (f) process.exit(1);
