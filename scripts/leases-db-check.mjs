/* leases-db-check.mjs — v181: the lease and run-record rules (lib/refresh.js)
 * on a REAL Postgres. They were only ever checked by reading the code.
 *   TEST_PG_URL=postgres://user:pass@localhost/jarvis_test node scripts/leases-db-check.mjs
 * It DROPS sync_leases and sync_runs in that database first. Never point it at Neon.
 */
import pg from "pg";

const url = process.env.TEST_PG_URL;
if (!url || /neon\.tech|vercel-storage/.test(url)) {
  console.log("Set TEST_PG_URL to a throwaway local database. Refusing to run against Neon.");
  console.log("\nleases-db: 0 passed, 1 failed");
  process.exit(1);
}
process.env.DATABASE_URL ||= "postgresql://test:test@localhost.invalid/test";

const pool = new pg.Pool({ connectionString: url, max: 4 });
function sql(strings, ...vals) {
  let text = "";
  strings.forEach((s, i) => { text += s; if (i < vals.length) text += `$${i + 1}`; });
  const run = (c = pool) => c.query(text, vals).then(r => r.rows);
  return { run, then: (res, rej) => run().then(res, rej) };
}

const r = await import("../lib/refresh.js");
r.__setSqlForTests(sql);
const { acquireLease, releaseLease, failedAgoMs, recordSuccess } = r.__leaseForTests();
let p = 0, f = 0;
const ok = (c, msg) => { c ? p++ : (f++, console.log("  FAIL:", msg)); };

try {
  await pool.query("drop table if exists sync_leases; drop table if exists sync_runs");

  /* Leases: one holder at a time; only the holder lets go. */
  const a = await acquireLease("t1", 60);
  const b = await acquireLease("t1", 60);
  ok(typeof a === "string" && b === false, "a second taker of a held lease is refused");
  await releaseLease("t1", "someone-else");
  ok((await acquireLease("t1", 60)) === false, "an old run's token can't free the lease the current run holds");
  await releaseLease("t1", a);
  const c = await acquireLease("t1", 60);
  ok(typeof c === "string", "the holder lets go, and the next taker gets it");
  await releaseLease("t1", c);

  /* holdLease: busy is skipped, never run; waiting gets it once it's free. */
  let ran = 0;
  const held = await acquireLease("chain", 60);
  const busy = await r.holdLease("chain", 60, async () => { ran++; return "x"; });
  ok(busy && busy.skipped === "another chain is running" && ran === 0, "a busy chain lease: the work is skipped, not run beside it");
  setTimeout(() => releaseLease("chain", held), 120);
  const waited = await r.holdLease("chain", 60, async () => { ran++; return "done"; }, { waitMs: 2000, pollMs: 50 });
  ok(waited === "done" && ran === 1, "v181: with waitMs, it runs once the holder lets go");
  const thrown = await r.holdLease("chain", 60, async () => { throw new Error("boom"); });
  ok(thrown && /boom/.test(thrown.error) && typeof (await acquireLease("chain", 60)) === "string", "an error comes back as a value, and the lease is let go");

  /* Run records. */
  const started = new Date(Date.now() - 5000).toISOString();
  const res = await r.runUnderLease({ name: "job-a", leaseSeconds: 60, job: async () => ({ fine: true }) });
  ok(res.refreshed === true, "a run that returns is recorded as done");
  const row = (await pool.query("select last_success, last_attempt, last_error from sync_runs where name = 'job-a'")).rows[0];
  ok(row && row.last_success && !row.last_error && (await failedAgoMs("job-a")) === null, "...with no error, and not counted as failed");
  await recordSuccess("job-b", started);
  const rowB = (await pool.query("select last_success from sync_runs where name = 'job-b'")).rows[0];
  ok(Math.abs(new Date(rowB.last_success).getTime() - Date.parse(started)) < 1000, "success is stamped with when the run STARTED");

  const failed = await r.runUnderLease({ name: "job-c", leaseSeconds: 60, job: async () => { throw new Error("vendor down"); } });
  ok(failed.error && (await failedAgoMs("job-c")) !== null && (await r.recentlyFailed("job-c")), "a failed run waits before the next try");

  await pool.query("insert into sync_runs (name, last_attempt, last_success) values ('job-d', now(), now() - interval '1 hour')");
  ok((await failedAgoMs("job-d")) !== null, "a run that never finished (killed at the time limit) counts as failed");

  const paused = await r.runUnderLease({ name: "job-e", leaseSeconds: 60, job: async () => ({ backedOff: true, until: "2026-10-12T20:00:00Z" }) });
  const rowE = (await pool.query("select last_success, last_error from sync_runs where name = 'job-e'")).rows[0];
  ok(paused.paused === true && !paused.refreshed && !rowE.last_success && /paused/.test(rowE.last_error || ""), "v181: a run stopped by Sierra's pause is not recorded as done");
} catch (e) { f++; console.log("  FAIL: threw", e.message); }
finally {
  await pool.query("drop table if exists sync_leases; drop table if exists sync_runs").catch(() => {});
  await pool.end();
}
console.log(`\nleases-db: ${p} passed, ${f} failed`);
if (f) process.exit(1);
