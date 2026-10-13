/* acks-db-check.mjs — v127: announcement acknowledgements, on a real Postgres.
 * TEST_PG_URL=postgres://user:pass@localhost/jarvis_test node scripts/acks-db-check.mjs
 * It DROPS announcement_acks in that database first. Never point it at Neon. */
import pg from "pg";
const url = process.env.TEST_PG_URL;
if (!url || /neon\.tech|vercel-storage/.test(url)) { console.log("Set TEST_PG_URL.\n\nacks-db: 0 passed, 1 failed"); process.exit(1); }
process.env.DATABASE_URL ||= "postgresql://test:test@localhost.invalid/test";
const pool = new pg.Pool({ connectionString: url, max: 4 });
function sql(strings, ...vals) {
  let text = ""; strings.forEach((s, i) => { text += s; if (i < vals.length) text += `$${i + 1}`; });
  const run = (c = pool) => c.query(text, vals).then(r => r.rows);
  return { run, then: (res, rej) => run().then(res, rej) };
}
const m = await import("../lib/announcement-acks.js");
m.__setSqlForTests(sql);
let p = 0, f = 0;
const ok = (c, msg) => { c ? p++ : (f++, console.log("  FAIL:", msg)); };
try {
  await pool.query("drop table if exists announcement_acks");
  ok(await m.acknowledge("12", "Andy@CashIsKing.com", "Andy Wilcox"), "an acknowledgement is recorded");
  const first = (await pool.query("select at from announcement_acks")).rows[0].at;
  await new Promise(r => setTimeout(r, 20));
  ok(!(await m.acknowledge("12", "andy@cashisking.com", "Andy W")), "acknowledging again adds nothing");
  const rows = (await pool.query("select * from announcement_acks")).rows;
  ok(rows.length === 1 && rows[0].email === "andy@cashisking.com" && +rows[0].at === +first && rows[0].name === "Andy Wilcox", "and keeps the first time, and the email is stored lower-case");
  await m.acknowledge("12", "leona@cashisking.com", "Leona Park");
  await m.acknowledge("13", "leona@cashisking.com", "Leona Park");
  const mine = await m.acksFor("LEONA@cashisking.com");
  ok(mine.size === 2 && mine.has("12") && mine.has("13"), "a person's acknowledgements are found by email, any case");
  const all = await m.acksByItem();
  ok(all.get("12").map(a => a.name).join() === "Andy Wilcox,Leona Park" && all.get("13").length === 1, "the record lists everyone per announcement, oldest first");
  const some = await m.acksByItem(["13"]);
  ok(some.size === 1 && some.has("13"), "or just the ones asked for");
  let threw = 0;
  for (const [id, e] of [["abc", "a@b.co"], ["12", "not-an-email"], ["", "a@b.co"]]) { try { await m.acknowledge(id, e); } catch { threw++; } }
  ok(threw === 3, "a bad id or email is refused");
  /* v178: past 5000 acknowledgements, the NEWEST are the ones kept. */
  await pool.query(`insert into announcement_acks (item_id, email, name, at)
    select 50, 'old' || g || '@example.com', 'Old ' || g, now() - interval '30 days' + g * interval '1 second' from generate_series(1, 5000) g`);
  await pool.query(`insert into announcement_acks (item_id, email, name, at) values (99, 'new@example.com', 'Newest', now() + interval '1 minute')`);
  const big = await m.acksByItem();
  ok(big.has("99") && big.get("99")[0].name === "Newest", "v178: the newest announcement's acknowledgements still show past 5000");
  const flat = [...big.values()].flat();
  ok(flat.length === 5000, "v178: still capped at 5000");
} catch (e) { f++; console.log("  FAIL:", e.message); }
finally { await pool.query("drop table if exists announcement_acks").catch(() => {}); await pool.end(); }
console.log(`\nacks-db: ${p} passed, ${f} failed`);
if (f) process.exit(1);
