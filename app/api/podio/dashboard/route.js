/* The Deals tab's data: GET /api/podio/dashboard?period=30d&person=Mike
 *
 * Anyone signed in (Brandon, 2026-10-14: everyone sees everything). Answers
 * from the database copy of Podio at once, then — after the answer has gone —
 * brings that copy up to date if it is due (lib/refresh.js refreshPodioIfStale).
 * The page asks again a little later when it is told a refresh is running.
 */
import { after } from "next/server";
import { currentUser } from "../../../../lib/session.js";
import { dealsDashboard, personFor, podioPeople } from "../../../../lib/podio-dash.js";
import { podioConfig } from "../../../../lib/podio.js";
import { podioSyncProgress, podioFirstLoadPending } from "../../../../lib/podio-sync.js";
import { refreshPodioIfStale, jobSyncStatus } from "../../../../lib/refresh.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NOCACHE = { "Cache-Control": "no-store" };

export async function GET(req) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401, headers: NOCACHE });

  const url = new URL(req.url);
  const period = String(url.searchParams.get("period") || "30d").slice(0, 12);
  const asked = url.searchParams.get("person");
  const cfg = podioConfig();

  const [status, progress, loading] = await Promise.all([
    jobSyncStatus("podio"), podioSyncProgress(), podioFirstLoadPending(cfg),
  ]);
  const sync = {
    configured: cfg.ok,
    hasKey: cfg.hasKey,
    missing: cfg.missing,
    lastSuccess: status?.last_success || null,
    lastError: status?.last_error ? "The last Podio update didn't finish. It will try again shortly." : null,
    loading,
    apps: progress,
  };

  if (cfg.ok) {
    after(async () => {
      const r = await refreshPodioIfStale();
      if (r && r.error) console.error("podio sync failed", JSON.stringify(r).slice(0, 400));
    });
  }

  try {
    /* No person asked for: the viewer's own leads if they are a Lead Owner,
       else everyone. "all" (or empty) asks for everyone outright. */
    const me = personFor(user.displayName, await podioPeople());
    const person = asked === null ? (me || "") : (asked === "all" ? "" : asked);
    const data = await dealsDashboard({ person, period });
    return Response.json({ ...data, sync, me }, { headers: NOCACHE });
  } catch (e) {
    console.error("deals dashboard failed", String((e && e.message) || e).slice(0, 300));
    return Response.json({ error: "The Deals numbers couldn't load just now. Try again in a moment.", sync },
      { status: 500, headers: NOCACHE });
  }
}
