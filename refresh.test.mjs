/* The lease is the only thing standing between "one vendor pull at 8am" and
   "sixty". It cannot be exercised without a database, so this tests the SQL's
   shape and the decision logic around it. (scripts/leases-db-check.mjs runs
   it on a real Postgres.) CIK Office has no syncs yet; the lease machinery is
   kept for the Podio sync, so the Sisu staleness timings and the feed's
   deferred refresh that Jarvis checked here did not come over. */
import fs from "node:fs";
let p = 0, f = 0;
const ok = (c, m) => { c ? p++ : (f++, console.log("  FAIL:", m)); };

const src = fs.readFileSync("lib/refresh.js", "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* The WHERE on the conflict path is the whole mechanism. Without it, every
   concurrent caller updates the row, every caller gets a row back, and all
   sixty of them start syncing — a lock that grants itself to everyone. */
ok(/on conflict \(name\) do update/.test(code), "lease upserts on conflict");
ok(/where sync_leases\.locked_until < now\(\)/.test(code),
   "lease only transfers when the previous one has EXPIRED");
ok(/returning name/.test(code), "acquire decides by whether a row came back");
ok(/rows\.length > 0/.test(code), "zero rows means someone else holds it");

// A lease must expire on its own, or one timed-out function wedges sync forever.
ok(/locked_until = now\(\) \+ \(\$\{seconds\}/.test(code) || /\|\| ' seconds'\)::interval/.test(code),
   "lease has an expiry, so a crashed sync self-heals");
/* The release moved behind an injectable hook so failmodes.test.mjs can assert
   the ORDER of these calls against a fake — which is a stronger check than this
   regex ever was. This stays as the cheap structural one: it must still be in a
   finally, however it is spelled. */
ok(/finally\s*{\s*await (releaseLease|hooks\.release)/.test(code),
   "lease is released in a finally, not only on the happy path");
/* The staleness clock must NOT be read off the data rows. max(synced_at) over a
   table reports a half-finished sync as fresh, so nothing retries it. */
ok(!/max\(synced_at\)/.test(code),
   "staleness is not read from max(synced_at) — a partial sync would look complete");
ok(/from sync_runs where name/.test(code),
   "staleness is read from recorded job completions instead");

// Never throw: a slow vendor must not take the dashboard down.
ok(/catch \(e\)[\s\S]{0,120}return \{ name, error:/.test(code),
   "failures come back as a value, never as a throw");

/* A sync that just failed waits before it is tried again, and a run that
   never finished counts as failed (v178, v180). */
ok(/skipped: "failed recently"/.test(code) && /const unfinished = !r\.last_success/.test(code),
   "a sync that failed, or never finished, is not retried on every page view");
/* Success is stamped with when the run STARTED (v180). */
ok(/await hooks\.success\(name, startedAt\)/.test(code) && code.indexOf("const startedAt = new Date().toISOString();") < code.indexOf("await job()"),
   "success is recorded as of when the run started");

console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
