/* The support team's changes to one ticket.
 *   PATCH  { status?, priority?, category?, assignee? }
 *   DELETE
 * Admins and leadership only: the same rule as the Support Center page
 * (canSeeRoom on the "support" room), checked here next to the write.
 * Both answer with every ticket, so the page shows what is stored.
 * v170: a new status is emailed to the agent who filed it (through Zapier,
 * after the answer; lib/ticket-notify.js).
 */
import { after } from "next/server";
import { notifyTicketUpdate } from "../../../../lib/ticket-notify.js";
import { currentUser } from "../../../../lib/session.js";
import { sameOrigin, readJson, NOSTORE } from "../../../../lib/office-api.js";
import { OfficeInputError } from "../../../../lib/office-store.js";
import { roomBySlug, canSeeRoom } from "../../../../lib/office-rooms.js";
import { updateTicket, deleteTicket, allTickets, TicketError } from "../../../../lib/tickets.js";

export const dynamic = "force-dynamic";

const json = (body, status = 200) => Response.json(body, { status, headers: NOSTORE });

function guard(req, user) {
  if (!sameOrigin(req)) return json({ error: "Changes must come from Jarvis itself." }, 403);
  if (!user) return json({ error: "unauthenticated" }, 401);
  const support = roomBySlug("support");
  if (!support || support.where !== "jarvis" || !canSeeRoom(support, user.role)) {
    return json({ error: "Only admins and leadership can change tickets." }, 403);
  }
  return null;
}

const fail = e => {
  if (e instanceof TicketError || e instanceof OfficeInputError) return json({ error: e.message, errors: e.errors }, e.status);
  console.error("ticket change failed:", e);
  return json({ error: "That change didn't save. Nothing was changed." }, 500);
};

export async function PATCH(req, { params }) {
  const user = await currentUser();
  const stop = guard(req, user);
  if (stop) return stop;
  const { id } = await params;
  try {
    const body = await readJson(req);
    const t = await updateTicket(id, body, user.email);
    if (t.statusChanged) {
      after(async () => {
        const r = await notifyTicketUpdate(t, "", user);
        if (!r.sent) console.error("ticket status email not sent:", r.status ? `Zapier answered ${r.status}` : r.reason);
      });
    }
    return json({ ok: true, tickets: await allTickets().catch(() => null) });
  } catch (e) { return fail(e); }
}

export async function DELETE(req, { params }) {
  const user = await currentUser();
  const stop = guard(req, user);
  if (stop) return stop;
  const { id } = await params;
  try {
    await deleteTicket(id, user.email);
    return json({ ok: true, tickets: await allTickets().catch(() => null) });
  } catch (e) { return fail(e); }
}
