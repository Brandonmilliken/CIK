/* Browser-triggerable admin jobs (CIK Office).
 *
 * Copied from Jarvis's /api/admin/run with every MRE vendor job taken out
 * (Sisu, Sierra, Fello, Relitix, Shilo, Trainual, Asana, the Directory sheet).
 * What is left: the sync log, a database speed check, the ticket email test,
 * and any job listed in lib/refresh.js JOBS (the Podio sync joins that list in
 * step 4, and then runs from here too, leased and recorded).
 *
 * The guards are Jarvis's, unchanged: admin and above, never from another
 * site, never by following a link inside the app, and jobs that reach outside
 * the app only from a typed or bookmarked address.
 */
import { currentUser } from "../../../../lib/session.js";
import { runJobNow, JOBS } from "../../../../lib/refresh.js";
import { atLeast } from "../../../../lib/authz.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FIXED_JOBS = ["sync-log", "perf-probe", "ticket-email-test"];

export async function GET(req) {
  const user = await currentUser();
  /* no-store on the refusals too: a cached 403 replays after a role is fixed. */
  const NOCACHE = { "Cache-Control": "no-store" };
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401, headers: NOCACHE });

  if (!atLeast(user.role, "admin")) {
    return Response.json({ error: "forbidden", role: user.role, why: "admin or leadership required" },
      { status: 403, headers: NOCACHE });
  }

  /* Never from another site: Sec-Fetch-Site "none" is typed or bookmarked,
     "same-origin" is the app itself. A browser too old to send it is let through. */
  const site = (req.headers.get("sec-fetch-site") || "").toLowerCase();
  if (site && site !== "same-origin" && site !== "none") {
    return Response.json({ error: "Admin jobs can only be run from CIK Office itself or by typing the address." }, { status: 403, headers: NOCACHE });
  }
  /* And never by following a link inside the app (that ran the job as whoever clicked). */
  const mode = (req.headers.get("sec-fetch-mode") || "").toLowerCase();
  if (mode === "navigate" && site && site !== "none") {
    return Response.json({ error: "Type this address into the browser's address bar to run it." }, { status: 403, headers: NOCACHE });
  }

  const url = new URL(req.url);
  const job = url.searchParams.get("job") || "";
  const started = Date.now();

  /* Sending an email reaches outside the app: typed or bookmarked only. */
  if (job === "ticket-email-test" && site && site !== "none") {
    return Response.json({ error: "Type this address into the browser's address bar to run it." }, { status: 403, headers: NOCACHE });
  }

  try {
    let result;
    switch (job) {
      case "sync-log": {
        const { syncRunLog } = await import("../../../../lib/refresh.js");
        result = await syncRunLog();
        break;
      }
      case "perf-probe": {
        const { sql } = await import("../../../../lib/db.js");
        const pings = [];
        for (let i = 0; i < 5; i++) {
          const s0 = Date.now();
          await sql`select 1`;
          pings.push(Date.now() - s0);
        }
        result = { appRegion: process.env.VERCEL_REGION || null, dbPingMs: pings, dbPingBestMs: Math.min(...pings) };
        break;
      }
      /* Send the email hook a sample ticket, marked as a test. */
      case "ticket-email-test": {
        const { notifyNewTicket } = await import("../../../../lib/ticket-notify.js");
        result = await notifyNewTicket({ id: "test-" + Date.now(), title: "TEST: please ignore (CIK Office setup check)", category: "Other",
          priority: "Normal", details: "This is a test from CIK Office so the email can be set up. No one filed this ticket.",
          submittedBy: user.email, submittedName: user.displayName || "", createdAt: new Date().toISOString() });
        break;
      }
      default:
        if (Object.hasOwn(JOBS, job)) {
          result = await runJobNow(job, url.searchParams.get("force") === "yes" ? { force: true } : null);
          break;
        }
        return Response.json({
          error: "unknown job",
          jobs: [...Object.keys(JOBS), ...FIXED_JOBS],
          usage: "/api/admin/run?job=sync-log",
        }, { status: 400, headers: NOCACHE });
    }
    return Response.json({ ok: !(result && result.error), job, ms: Date.now() - started, result }, { headers: NOCACHE });
  } catch (e) {
    return Response.json({ ok: false, job, ms: Date.now() - started, error: String(e.message || e) },
      { status: 500, headers: NOCACHE });
  }
}
