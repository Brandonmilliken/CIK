/* failmodes.test.mjs — the ways this app could quietly hurt itself.
 *
 * None of these is a crash. Each one succeeds, returns a cheerful result, and
 * leaves the data wrong. (Jarvis had a third, Sisu renaming client_id and
 * emptying the In Contract board; Sisu did not come over to CIK Office.)
 *
 *   2. A sync dies halfway     → the rows it managed to write are stamped fresh,
 *      max(synced_at) says the table is current, and nothing ever retries.
 *   3. Cron and the admin button called the syncs directly → outside the lease,
 *      so two pulls could run at once against a shared rate limit, and a cron
 *      run recorded no completion at all.
 *
 * Both are tested here without a database: the lease runner takes its database calls as an injectable object so the
 * ORDER of them can be asserted — which is where the safety actually lives.
 */
import fs from "node:fs";
import { runUnderLease, JOBS } from "./lib/refresh.js";

let p = 0, f = 0;
const ok = (c, m) => { c ? p++ : (f++, console.log("  FAIL:", m)); };
const threw = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message || e); } };
const threwSync = (fn) => { try { fn(); return null; } catch (e) { return String(e.message || e); } };

/* ---- 2. A half-finished sync must not look finished -------------------- */
function fakeHooks() {
  const calls = [];
  return {
    calls,
    acquire: async (n) => { calls.push("acquire:" + n); return true; },
    release: async (n) => { calls.push("release:" + n); },
    attempt: async (n) => { calls.push("attempt:" + n); },
    success: async (n) => { calls.push("success:" + n); },
    failure: async (n) => { calls.push("failure:" + n); },
  };
}

{
  const h = fakeHooks();
  const out = await runUnderLease({ name: "production", job: async () => ({ ytd: 38 }), hooks: h });
  ok(out.refreshed === true && out.result.ytd === 38, "a job that finishes reports its result");
  ok(h.calls.join(",") === "acquire:production,attempt:production,success:production,release:production",
     `a successful run records success, in order (got ${h.calls.join(",")})`);
}

{
  /* The real failure mode: a sync that wrote SOME rows and then threw. The rows
     it wrote are stamped fresh in the database; the run is not a success. */
  const h = fakeHooks();
  const out = await runUnderLease({
    name: "production", hooks: h,
    job: async () => { /* imagine 20 of 38 agents written here */
                       throw new Error("Sisu timed out at agent 21"); },
  });
  ok(out.error && /timed out/.test(out.error), "a failed job comes back as a value, not an exception");
  ok(!h.calls.includes("success:production"),
     "A HALF-FINISHED SYNC RECORDS NO SUCCESS — this is what makes it retry");
  ok(h.calls.includes("failure:production"), "the failure is recorded, with its message");
  ok(h.calls[h.calls.length - 1] === "release:production",
     "the lease is released even when the job throws, so the next caller is not locked out");
}

{
  /* And the reason it must be the run and not the rows: success is recorded
     once, at the end. Never before the job, never per row. */
  const order = [];
  const h = fakeHooks();
  h.success = async (n) => { order.push("success"); };
  await runUnderLease({ name: "pending", hooks: h,
    job: async () => { order.push("job"); return {}; } });
  ok(order.join(",") === "job,success", "success is recorded AFTER the job returns, never before");
}

{
  /* Two callers, one lease. */
  const h = fakeHooks();
  let first = true;
  h.acquire = async () => { if (first) { first = false; return true; } return false; };
  let ran = 0;
  const job = async () => { ran++; return {}; };
  const a = await runUnderLease({ name: "pending", job, hooks: h });
  const b = await runUnderLease({ name: "pending", job, hooks: h });
  ok(a.refreshed === true, "the first caller runs");
  ok(b.skipped === "another refresh already running", "the second caller is told to wait");
  ok(ran === 1, "the vendor is called once, not twice");
}

/* ---- 3. Nothing may start a sync outside the lease --------------------- */
{
  /* CIK v1 has no syncs yet (the Podio sync joins in step 4). The registry
     is still the one place a job is named, and is empty until then. */
  ok(Object.keys(JOBS).length === 0, "every sync in the app is in the one registry (none yet)");
  ok(!fs.existsSync("./app/api/cron"), "there is no cron route to bypass it");

  const src = fs.readFileSync("./app/api/admin/run/route.js", "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  /* Importing a sync function is how the routes used to bypass the lease.
     The import is the tell — you cannot call what you have not imported. */
  ok(!/import\s*\{[^}]*\bsync(?!RunLog\b)[A-Z]\w*\b/.test(code), "admin/run does not import a sync function directly");
  ok(!/await\s+sync(?!RunLog\b)[A-Z]\w*\s*\(/.test(code), "admin/run does not call a sync function directly");
  ok(/runJobNow\s*\(/.test(code) && /if \(Object\.hasOwn\(JOBS, job\)\)/.test(code), "admin/run goes through runJobNow, for a named job only");

  /* runJobNow must refuse a name it does not know rather than doing nothing
     quietly — ?job=prodution should say so, not return ok. */
  const { runJobNow } = await import("./lib/refresh.js");
  const bad = await runJobNow("prodution");
  ok(bad.error && /unknown job/.test(bad.error), "a misspelt job name is an error, not a silent no-op");
}

console.log(`\nfailmodes: ${p} passed, ${f} failed`);
if (f) process.exit(1);
