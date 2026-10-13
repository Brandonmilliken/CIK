/* v170: a message on a ticket.   POST { body, as?, status? }
 *
 *   as: "support"  the support team sending an update back to the agent
 *                  (with the status, if it changes). Only whoever can open
 *                  the Support Center (admins and leadership), checked here.
 *   otherwise      the agent answering on their OWN ticket. lib/tickets.js
 *                  looks the ticket up by the session's email, so anyone
 *                  else's ticket "does not exist".
 *
 * Same locks as every other write: from Jarvis itself, JSON, size-capped.
 * The answer is the list the sender's page shows: every ticket for the
 * Support Center, or the sender's own tickets for My Tickets.
 *
 * Then, after the reply, an email through Zapier (lib/ticket-notify.js): an
 * update goes to the agent who filed the ticket; an agent's answer goes to
 * the support list.
 */
import { after } from "next/server";
import { notifyTicketUpdate, notifyAgentReply } from "../../../../../lib/ticket-notify.js";
import { currentUser } from "../../../../../lib/session.js";
import { sameOrigin, readJson, NOSTORE } from "../../../../../lib/office-api.js";
import { OfficeInputError } from "../../../../../lib/office-store.js";
import { roomBySlug, canSeeRoom } from "../../../../../lib/office-rooms.js";
import { supportReply, agentReply, allTickets, myTickets, TicketError } from "../../../../../lib/tickets.js";

export const dynamic = "force-dynamic";

const json = (body, status = 200) => Response.json(body, { status, headers: NOSTORE });

/* v177 (scan): once the message is saved, a failure fetching the fresh list
   must not say "nothing was changed" (they would send it twice). The page
   keeps what it shows and picks the new list up on its next refresh. */
async function listAfterSave(load) {
  try { return await load(); }
  catch (e) { console.error("ticket list after save failed:", String(e?.message || e).slice(0, 200)); return null; }
}

/* After the answer is sent, so a slow Zapier never slows or blocks a reply. */
function emailLater(send, what) {
  after(async () => {
    const r = await send();
    if (!r.sent) console.error(`ticket ${what} email not sent:`, r.status ? `Zapier answered ${r.status}` : r.reason);
  });
}

export async function POST(req, { params }) {
  if (!sameOrigin(req)) return json({ error: "Messages must be sent from Jarvis itself." }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  const { id } = await params;
  try {
    const body = await readJson(req);
    if (body?.as === "support") {
      const support = roomBySlug("support");
      if (!support || support.where !== "jarvis" || !canSeeRoom(support, user.role)) {
        return json({ error: "Only admins and leadership can send updates from the Support Center." }, 403);
      }
      const t = await supportReply(id, { body: body.body, ...(Object.hasOwn(body, "status") ? { status: body.status } : {}) }, user, { lastSeen: body.lastReplyId });
      /* v181 (scan): the message as saved (cleaned), not as sent. */
      if (!t.self) emailLater(() => notifyTicketUpdate(t, t.savedBody, user), "update");
      return json({ ok: true, tickets: await listAfterSave(allTickets) });
    }
    const t = await agentReply(id, { body: body?.body }, user, { lastSeen: body?.lastReplyId });
    emailLater(() => notifyAgentReply(t, t.savedBody), "agent reply");
    return json({ ok: true, tickets: await listAfterSave(() => myTickets(user.email)) });
  } catch (e) {
    if (e instanceof TicketError || e instanceof OfficeInputError) return json({ error: e.message, errors: e.errors }, e.status);
    console.error("ticket reply failed:", e);
    return json({ error: "That message didn't send. Nothing was changed. Try again." }, 500);
  }
}
