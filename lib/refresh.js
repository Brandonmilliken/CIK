/* Keeping Sisu fresh without a per-minute cron.
 *
 * Vercel's Hobby plan runs cron once a DAY, which is useless for a board of
 * deals that change during business hours. This replaces it: a staleness check
 * that runs when someone opens the page.
 *
 * What that means, stated plainly: freshness follows ATTENTION. Data is current
 * whenever somebody is looking and goes stale overnight, until the daily Vercel
 * cron or the first page view of the morning picks it up. For a dashboard that
 * is the right trade — nobody is misled by a figure nobody is reading — but it
 * is not a guarantee that the database is always current. The badge on each
 * section carries the sync time so the page never overstates its own freshness.
 */
import { sql as neonSql } from "./db.js";

let sql = neonSql;
/** v181: for scripts/leases-db-check.mjs (the lease rules run on a real Postgres). */
export function __setSqlForTests(f) { sql = f; leaseTableReady = null; runTableReady = null; }
export function __leaseForTests() { return { acquireLease, releaseLease, failedAgoMs, recordSuccess, ageMs }; }

/**
 * A lease, not a lock.
 *
 * Sixty agents opening the dashboard at 8am must produce ONE Sisu pull, not
 * sixty. The obvious tool — a Postgres advisory lock — does not work here: the
 * Neon HTTP driver has no persistent session to hold one, so the lock would be
 * released the instant the statement returned.
 *
 * So the lease lives in a row, and the WHERE clause on the conflict path is
 * what makes it atomic: two requests arriving in the same millisecond both run
 * the statement, and exactly one gets a row back. The other sees zero rows and
 * moves on. A lease also self-heals — if a function times out mid-sync and
 * never releases, the next caller takes over once it expires, where a real lock
 * would have wedged the sync until someone noticed.
 */
/* v125: each "create table if not exists" is a trip to the database, and
   these ran on EVERY staleness check of every page load. Once per server
   instance is enough; a failure clears the memo so the next call retries. */
let leaseTableReady = null;
function ensureLeaseTable() {
  if (!leaseTableReady) {
    leaseTableReady = Promise.resolve(sql`
      create table if not exists sync_leases (
        name         text primary key,
        locked_until timestamptz not null,
        locked_at    timestamptz not null default now()
      )`).then(() => sql`alter table sync_leases add column if not exists owner text`)
      .then(() => true, e => { leaseTableReady = null; throw e; });
  }
  return leaseTableReady;
}

/* v178 (scan): each run takes the lease under its own token, and lets go of
   it only if it still holds it. Before, a run that outlived its lease (a slow
   vendor near the 5-minute limit) released the NEXT run's lease on its way
   out, so a third run could start beside the second: the double Sierra
   reader behind the earlier rate-limit ban. Returns the token, or false. */
async function acquireLease(name, seconds) {
  await ensureLeaseTable();
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const rows = await sql`
    insert into sync_leases (name, locked_until, owner)
    values (${name}, now() + (${seconds} || ' seconds')::interval, ${token})
    on conflict (name) do update
      set locked_until = now() + (${seconds} || ' seconds')::interval,
          locked_at    = now(),
          owner        = ${token}
      where sync_leases.locked_until < now()
    returning name`;
  return rows.length > 0 ? token : false;
}

async function releaseLease(name, token) {
  await sql`update sync_leases set locked_until = now()
            where name = ${name} and (owner = ${typeof token === "string" ? token : null} or owner is null)`;
}

/**
 * When each job last FINISHED.
 *
 * THIS USED TO READ max(synced_at) OFF THE DATA ITSELF, and that is a trap.
 * Every sync in this app stamps synced_at row by row as it goes, so a run that
 * dies halfway — a vendor timeout at agent 20 of 38, a function hitting the 60s
 * ceiling — leaves some rows freshly stamped and the rest untouched. max() then
 * reports the whole table as seconds old, the staleness check says "fresh,
 * nothing to do", and NOTHING EVER RETRIES. Half the board stays a day behind,
 * indefinitely, and the page's own badge vouches for it.
 *
 * Success is a property of the RUN, not of the rows it managed to write before
 * it fell over. So it is recorded once, at the end, only when the job returned
 * without throwing. A half-finished sync leaves no mark and is picked up by the
 * next page view, which is the behaviour the staleness check was always
 * supposed to have.
 *
 * (On first deploy there are no rows here, so every job reads as stale and runs
 * once. That is the right way round: one extra sync, rather than trusting a
 * completion nobody recorded.)
 */
let runTableReady = null;
function ensureRunTable() {
  if (!runTableReady) {
    runTableReady = Promise.resolve(sql`
      create table if not exists sync_runs (
        name         text primary key,
        last_success timestamptz,
        last_attempt timestamptz,
        last_error   text
      )`).then(() => true, e => { runTableReady = null; throw e; });
  }
  return runTableReady;
}

async function ageMs(name) {
  await ensureRunTable();
  const rows = await sql`select last_success as at from sync_runs where name = ${name}`;
  const at = rows[0]?.at ? new Date(rows[0].at).getTime() : null;
  return at === null ? null : Date.now() - at;
}

/* v178 (scan): how long since this job last FAILED, or null if its last run
   didn't. A sync that keeps failing was being retried on every page view,
   spending the vendor's shared rate limit each time. */
export const FAILURE_RETRY_MS = () => Number(process.env.SYNC_FAILURE_RETRY_MS || 10 * 60 * 1000);
async function failedAgoMs(name) {
  const rows = await sql`select last_attempt, last_success, last_error from sync_runs where name = ${name}`;
  const r = rows[0];
  if (!r || !r.last_attempt) return null;
  /* v180 (scan): a run that never finished (stopped at the time limit) left
     no error and no success. It counts as failed, so the next try waits too;
     it used to start again on the next page view, and hang again. */
  const unfinished = !r.last_success || new Date(r.last_success).getTime() < new Date(r.last_attempt).getTime();
  if (!r.last_error && !unfinished) return null;
  return Date.now() - new Date(r.last_attempt).getTime();
}

/* v179 (scan): the same wait, for the jobs that call runUnderLease themselves
   (history, KPI cards, lead stages, Shilo calls, the Sierra events pull).
   They were retried on every page view while their vendor was failing. */
export async function recentlyFailed(name, waitMs = FAILURE_RETRY_MS()) {
  try {
    await ensureRunTable();
    const f = await failedAgoMs(name);
    return f !== null && f < waitMs;
  } catch { return false; }
}

/* v179 (scan): midnight on the 1st of this month in Portland, as a time.
   Production synced before it holds no rows for the new month at all, so it
   is due then, whatever its age (the board sat empty until up to an hour
   after midnight on the 1st). */
export function laMonthStartMs(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric" })
    .formatToParts(now).map(x => [x.type, x.value]));
  const t = Date.UTC(+p.year, +p.month - 1, 1, 8);
  const h = +new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(new Date(t));
  return t - h * 3600000;
}

async function recordAttempt(name) {
  await ensureRunTable();
  await sql`
    insert into sync_runs (name, last_attempt) values (${name}, now())
    on conflict (name) do update set last_attempt = now()`;
}

/* v180 (scan): success is stamped with when the run STARTED (what the data
   is as of). A production run that began at 23:59 on the 31st and finished
   after midnight counted as "fresh for the new month" with no new month in it. */
async function recordSuccess(name, startedAt = null) {
  const at = startedAt || new Date().toISOString();
  await sql`
    insert into sync_runs (name, last_success, last_attempt, last_error)
    values (${name}, ${at}::timestamptz, ${at}::timestamptz, null)
    on conflict (name) do update set
      last_success = ${at}::timestamptz, last_attempt = ${at}::timestamptz, last_error = null`;
}

async function recordFailure(name, err) {
  /* last_success is deliberately NOT touched. It answers "when did this last
     work", and a failure does not change that answer. */
  await sql`
    insert into sync_runs (name, last_attempt, last_error)
    values (${name}, now(), ${String(err).slice(0, 300)})
    on conflict (name) do update set
      last_attempt = now(), last_error = ${String(err).slice(0, 300)}`;
}

/** What each job's last run did. For /api/admin/run, so a stuck sync is visible. */
export async function syncRunLog() {
  try {
    await ensureRunTable();
    return await sql`select name, last_success, last_attempt, last_error from sync_runs order by name`;
  } catch (e) {
    return [{ error: String(e.message || e).slice(0, 200) }];
  }
}

/**
 * Run `job` if the data has aged past `maxAgeMs` and nobody else is on it.
 *
 * NEVER THROWS. A vendor being slow must not take the dashboard down with it —
 * the page already renders whatever is stored and says how old it is, which is
 * a far better outcome than an error screen. Failures come back in the return
 * value so /api/admin/run can surface them when someone asks.
 */
async function refreshIfStale({ name, maxAgeMs, leaseSeconds, job, notBeforeMs = null }) {
  try {
    const age = await ageMs(name);
    const beforeBoundary = age !== null && notBeforeMs !== null && Date.now() - age < notBeforeMs;
    if (age !== null && age < maxAgeMs && !beforeBoundary) {
      return { name, skipped: "fresh", ageMinutes: Math.round(age / 60000) };
    }
    /* v178 (scan): failed a moment ago: wait a little before asking again. */
    const failed = await failedAgoMs(name).catch(() => null);
    if (failed !== null && failed < Math.min(FAILURE_RETRY_MS(), maxAgeMs)) {
      return { name, skipped: "failed recently", retryInMinutes: Math.ceil((Math.min(FAILURE_RETRY_MS(), maxAgeMs) - failed) / 60000) };
    }
    return await runUnderLease({ name, leaseSeconds, job });
  } catch (e) {
    return { name, error: String(e.message || e).slice(0, 200) };
  }
}

/**
 * Run a sync with the lease held, and record what happened.
 *
 * THE ONE PLACE A SYNC IS ALLOWED TO RUN. The lease exists so that sixty agents
 * opening the page at 8am produce one Sisu pull rather than sixty — but it only
 * ever covered the page-triggered path. /api/cron/sync and /api/admin/run both
 * imported the sync functions and called them directly, so the nightly cron
 * could land on top of a page-triggered pull, and pressing the admin button
 * twice ran two at once. Both then write the same rows from two connections,
 * and both spend a rate limit that is shared.
 *
 * Those two routes go through here now. They do NOT check freshness — "run it
 * now" is the whole point of both — but they do take the lease, so a second
 * caller is told to wait rather than doubling the work. And they record
 * completion the same way, which is what makes a cron run count as a sync
 * rather than a thing that happened invisibly beside one.
 *
 * NEVER THROWS. A vendor being slow must not take the dashboard down with it —
 * the page already renders whatever is stored and says how old it is, which is
 * a far better outcome than an error screen. Failures come back in the return
 * value so the caller can surface them when someone asks.
 */
/* The database side, in one object, so a test can hand in fakes and assert the
   ORDER of these calls. The order is the whole safety property here — success
   recorded after the job returns, never before — and it is not something a
   reader can verify by looking at a comment. */
export const LEASE_HOOKS = {
  acquire: acquireLease,
  release: releaseLease,
  attempt: recordAttempt,
  success: recordSuccess,
  failure: recordFailure,
};

/* v180 (scan): a lease held around a whole CHAIN of jobs, with no run record
   of its own. Each page view's chain of Sierra jobs took their own separate
   leases, so ten people opening the page at 8am ran ten Sierra readers at
   once (one per chain step). Now a second view finds the chain busy and
   leaves Sierra alone. Never throws. */
/* v181: `waitMs` keeps trying (every 5 seconds) for that long before giving
   up, for callers that should run once the current holder is done (the
   scheduled to-do run, admin tools) rather than skip. */
export async function holdLease(name, seconds, fn, { waitMs = 0, pollMs = 5000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let token = null;
  const until = Date.now() + waitMs;
  for (;;) {
    try { token = await acquireLease(name, seconds); } catch { return { skipped: "lease unavailable" }; }
    if (token || Date.now() + pollMs > until) break;
    await sleep(pollMs);
  }
  if (!token) return { skipped: "another chain is running" };
  try { return await fn(); }
  catch (e) { return { error: String((e && e.message) || e).slice(0, 200) }; }
  finally { await releaseLease(name, token).catch(() => {}); }
}

export async function runUnderLease({ name, leaseSeconds = 300, job, hooks = LEASE_HOOKS }) {
  try {
    const lease = await hooks.acquire(name, leaseSeconds);
    if (!lease) {
      return { name, skipped: "another refresh already running" };
    }
    const startedAt = new Date().toISOString();
    await hooks.attempt(name).catch(() => {});
    try {
      const result = await job();
      /* v181 (scan): a run that stopped at once for Sierra's "slow down"
         pause did nothing: it is recorded as not done (it was a "success",
         so the sync log looked healthy all through a Sierra ban). */
      if (result && result.backedOff) {
        await hooks.failure(name, "paused: Sierra asked Jarvis to slow down" + (result.until ? " until " + result.until : "")).catch(() => {});
        return { name, refreshed: false, paused: true, result };
      }
      /* Only here. Not per row, not on the way in — a run that threw before
         this line left no completion behind and will be retried. */
      await hooks.success(name, startedAt).catch(() => {});
      return { name, refreshed: true, result };
    } catch (e) {
      await hooks.failure(name, e.message || e).catch(() => {});
      return { name, error: String(e.message || e).slice(0, 300) };
    } finally {
      await hooks.release(name, lease).catch(() => {});
    }
  } catch (e) {
    return { name, error: String(e.message || e).slice(0, 200) };
  }
}

/**
 * Every sync this app has, by name, in ONE list.
 *
 * The cron route and the admin route each used to import the sync functions
 * themselves and call them directly. Three places knowing how to start a sync
 * is three places that can disagree about it — and they did: only one of them
 * took the lease, and only one of them recorded that the sync had happened.
 *
 * Now there is one list. A new job added here is automatically leased,
 * recorded, and runnable from cron, from the admin button, and from the
 * staleness check, because all three read this.
 */
export const JOBS = {
  /* CIK v1: no scheduled jobs yet. The Podio sync (agent dashboard) is
     added here in step 4, and is then leased, recorded and runnable from
     cron and the admin button like Jarvis's jobs. */
};

/**
 * Run one named job now, whatever its age — leased and recorded.
 * This is what /api/cron/sync and /api/admin/run call.
 */
export function runJobNow(name, opts = null) {
  const j = Object.hasOwn(JOBS, name) ? JOBS[name] : null;
  if (!j) return Promise.resolve({ name, error: `unknown job "${name}"` });
  /* v130: a longer run (the scheduled To-Do refresh) holds the lease for as
     long as it works, so nothing else starts beside it. */
  const leaseSeconds = opts && opts.leaseSeconds ? opts.leaseSeconds : j.leaseSeconds;
  return runUnderLease({ name, leaseSeconds, job: () => j.run(opts || {}) });
}

/** When a job last synced, and whether the last try failed. Never throws. */
export async function jobSyncStatus(name) {
  try {
    await ensureRunTable();
    const rows = await sql`select last_success, last_attempt, last_error from sync_runs where name = ${name}`;
    return rows[0] || null;
  } catch { return null; }
}

/** For tests and the admin page: the recorded runs. */
export { ageMs as __ageMs };
