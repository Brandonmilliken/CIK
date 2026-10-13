/* v170: "I've seen it", so the bell stops counting it.   POST { mine: true } or { id }
 *
 *   { mine: true }  the viewer opened My Tickets: THEIR OWN updates are read
 *                   (by the session's email; nothing else can be named).
 *   { id }          an admin opened a ticket the agent had answered. Only
 *                   whoever can open the Support Center.
 * Nothing about a ticket's content changes, and nothing is logged.
 */
import { currentUser } from "../../../../lib/session.js";
import { sameOrigin, readJson, NOSTORE } from "../../../../lib/office-api.js";
import { OfficeInputError } from "../../../../lib/office-store.js";
import { roomBySlug, canSeeRoom } from "../../../../lib/office-rooms.js";
import { markMineSeen, markSupportSeen, TicketError } from "../../../../lib/tickets.js";

export const dynamic = "force-dynamic";

const json = (body, status = 200) => Response.json(body, { status, headers: NOSTORE });

export async function POST(req) {
  if (!sameOrigin(req)) return json({ error: "That must come from Jarvis itself." }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  try {
    const body = await readJson(req);
    if (body?.mine === true) return json({ ok: true, cleared: await markMineSeen(user.email, Array.isArray(body.ids) ? body.ids : null) });
    const support = roomBySlug("support");
    if (!support || support.where !== "jarvis" || !canSeeRoom(support, user.role)) return json({ error: "not found" }, 404);
    await markSupportSeen(String(body?.id ?? ""), body?.lastReplyId ?? null);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof TicketError || e instanceof OfficeInputError) return json({ error: e.message, errors: e.errors }, e.status);
    console.error("ticket seen failed:", e);
    return json({ error: "unavailable" }, 500);
  }
}
