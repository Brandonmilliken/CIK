/* File a help ticket.   POST { title, category, priority, details }
 * v137: GET  the numbers for the bell in the top right corner.
 * v170: everyone signed in gets { mine }: how many of THEIR OWN tickets have
 *       an update they haven't opened. Whoever can open the Support Center
 *       also gets { newCount, repliedCount }: tickets still New, and tickets
 *       an agent has answered. Numbers only, never the tickets.
 *
 * Anyone signed in. Same locks as every other write: it must come from
 * Jarvis itself (Origin), be JSON, and fit the size cap. The ticket is filed
 * under the SESSION's email; nothing in the body can change who sent it.
 * The answer is only the new ticket, never anyone else's.
 *
 * v156: once it is saved, Zapier is told, and a Zap emails it out
 * (lib/ticket-notify.js, TICKET_EMAIL_HOOK_URL in Vercel).
 */
import { after } from "next/server";
import { currentUser } from "../../../lib/session.js";
import { notifyNewTicket } from "../../../lib/ticket-notify.js";
import { sameOrigin, readJson, NOSTORE } from "../../../lib/office-api.js";
import { OfficeInputError } from "../../../lib/office-store.js";
import { createTicket, supportCounts, myUnreadCount, TicketError } from "../../../lib/tickets.js";
import { roomBySlug, canSeeRoom } from "../../../lib/office-rooms.js";

export const dynamic = "force-dynamic";

const json = (body, status = 200) => Response.json(body, { status, headers: NOSTORE });

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  try {
    const mine = await myUnreadCount(user.email);
    if (!canSeeRoom(roomBySlug("support"), user.role)) return json({ mine });
    return json({ mine, ...(await supportCounts()) });
  } catch { return json({ error: "unavailable" }, 503); }
}

export async function POST(req) {
  if (!sameOrigin(req)) return json({ error: "Tickets must be sent from Jarvis itself." }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  try {
    const body = await readJson(req);
    const ticket = await createTicket(user, body);
    /* v156: the email, through Zapier, after the reply (lib/ticket-notify.js). */
    after(async () => {
      const r = await notifyNewTicket(ticket);
      /* v181 (scan): a network failure (no status) is logged too. */
      if (!r.sent && (r.status || (r.reason && !/not set/i.test(String(r.reason))))) console.error("ticket email not sent:", r.status ? `Zapier answered ${r.status}` : r.reason);
    });
    return json({ ok: true, ticket });
  } catch (e) {
    if (e instanceof TicketError || e instanceof OfficeInputError) return json({ error: e.message, errors: e.errors }, e.status);
    console.error("ticket create failed:", e);
    return json({ error: "That ticket didn't go through. Nothing was sent. Try again." }, 500);
  }
}
