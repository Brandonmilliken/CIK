/* Help tickets: MRE Office's "Submit a Help Ticket", "My Tickets" and "Support
 * Center", moved into Jarvis (v94).
 *
 * Who sees what, checked on the server every time:
 *   - anyone signed in can SUBMIT a ticket. It is logged under their own
 *     account (the session's email, never a value from the form)
 *   - "My Tickets" reads only rows whose submitter is the viewer. The page
 *     never receives anyone else's tickets
 *   - the Support Center (every ticket, and changing status, priority,
 *     category or who it is assigned to, or deleting one) is admins and
 *     leadership only
 * Same rules as MRE Office. Every change is logged in office_changes (room
 * "tickets"), like every other room.
 *
 * The fields and choices are MRE Office's own, so tickets read the same.
 *
 * v170 (Brandon, 2026-10-08): tickets are a conversation. The support team
 * can send an update back to the agent (a message, and the status if it
 * changed); the agent sees it in My Tickets, with a bell, and can answer.
 * An answer brings the ticket back to the Support Center's bell. Every
 * message and status change is kept in office_ticket_replies, in order.
 *   agent_unread    the submitter has an update they haven't opened yet
 *   support_unread  the submitter answered and no admin has opened it yet
 */
import { sql as defaultSql } from "./db.js";
import { validateFields } from "./office-fields.js";

/* v163 (Brandon, 2026-10-07): "JARVIS", for problems with Jarvis itself. Second,
   so "Tech support" stays the one the form starts on. */
export const TICKET_CATEGORIES = [
  "Tech support", "JARVIS", "MLS/login", "Office Access", "Transaction help", "Broker/compliance",
  "Marketing request", "Vendor request", "Training request", "Lead/CRM issue",
];
export const TICKET_PRIORITIES = ["Low", "Normal", "High", "Urgent"];
export const TICKET_STATUSES = ["New", "In review", "Waiting on agent", "Resolved"];

/* A person can file plenty of real tickets in a day; this only stops a stuck
   button or a script from filling the Support Center. */
export const MAX_TICKETS_PER_DAY = 20;

/* What someone fills in on Submit a Help Ticket. */
export const NEW_TICKET_FIELDS = [
  { key: "title",    label: "What's the issue?", type: "text",     required: true, max: 200 },
  { key: "category", label: "Category",          type: "choice",   required: true, options: TICKET_CATEGORIES },
  { key: "priority", label: "Priority",          type: "choice",   required: true, options: TICKET_PRIORITIES },
  { key: "details",  label: "Details",           type: "longtext", max: 5000 },
];

/* v170: a message on a ticket, from either side. */
export const REPLY_FIELDS = [
  { key: "body", label: "Message", type: "longtext", required: true, max: 5000 },
];
/* Plenty for a real back-and-forth; stops a stuck button. */
export const MAX_REPLIES_PER_DAY = 60;

/* What the support team can change on a ticket. Title, details and who sent
   it are the submitter's words and stay as they were written. */
export const UPDATE_FIELDS = [
  { key: "status",   label: "Status",      type: "choice", required: true, options: TICKET_STATUSES },
  { key: "priority", label: "Priority",    type: "choice", required: true, options: TICKET_PRIORITIES },
  { key: "category", label: "Category",    type: "choice", required: true, options: TICKET_CATEGORIES },
  { key: "assignee", label: "Assigned to", type: "text",   max: 120 },
];

export class TicketError extends Error {
  constructor(message, errors = {}, status = 400) { super(message); this.errors = errors; this.status = status; }
}

let sql = defaultSql;
/** Tests point this at a real Postgres. Nothing else calls it. */
export function __setSqlForTests(fn) { sql = fn; ready = null; }

let ready = null;
export function ensureTicketSchema() {
  if (!ready) {
    ready = (async () => {
      /* v179 (scan): one quick look first; the nine statements below only
         when something is missing (see ensureOfficeSchema). */
      const have = await sql`
        select to_regclass('office_ticket_replies_author') is not null and to_regclass('office_changes') is not null
           and exists (select 1 from information_schema.columns where table_name = 'office_tickets' and column_name = 'support_unread') as ok`;
      if (have[0] && have[0].ok) return;
      await sql`
        create table if not exists office_tickets (
          id              bigserial primary key,
          title           text not null,
          category        text not null,
          priority        text not null,
          status          text not null default 'New',
          details         text not null default '',
          submitted_by    text not null,
          submitted_name  text not null default '',
          assignee        text not null default '',
          created_at      timestamptz not null default now(),
          updated_at      timestamptz not null default now(),
          updated_by      text
        )`;
      await sql`create index if not exists office_tickets_mine on office_tickets (lower(submitted_by), created_at desc)`;
      await sql`create index if not exists office_tickets_status on office_tickets (status, created_at desc)`;
      /* v170: the conversation. Adding columns with a default is safe on the
         live table; old tickets simply start with nothing unread. */
      await sql`alter table office_tickets add column if not exists agent_unread boolean not null default false`;
      await sql`alter table office_tickets add column if not exists support_unread boolean not null default false`;
      await sql`
        create table if not exists office_ticket_replies (
          id            bigserial primary key,
          ticket_id     bigint not null references office_tickets(id) on delete cascade,
          author_email  text not null,
          author_name   text not null default '',
          from_support  boolean not null,
          body          text not null default '',
          status_to     text,
          created_at    timestamptz not null default now()
        )`;
      await sql`create index if not exists office_ticket_replies_ticket on office_ticket_replies (ticket_id, created_at, id)`;
      await sql`create index if not exists office_ticket_replies_author on office_ticket_replies (lower(author_email), created_at desc)`;
      /* The change log is shared with the other rooms; make sure it exists
         even if no list room has been opened on this database yet. */
      await sql`
        create table if not exists office_changes (
          id          bigserial primary key,
          room        text not null,
          item_id     bigint,
          action      text not null check (action in ('create','update','delete','move')),
          actor_email text not null,
          before      jsonb,
          after       jsonb,
          at          timestamptz not null default now()
        )`;
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}

const iso = d => (d ? new Date(d).toISOString() : null);
export const shapeTicket = r => ({
  id: String(r.id),
  title: r.title,
  category: r.category,
  priority: r.priority,
  status: r.status,
  details: r.details || "",
  submittedBy: r.submitted_by,
  submittedName: r.submitted_name || "",
  assignee: r.assignee || "",
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  agentUnread: Boolean(r.agent_unread),
  supportUnread: Boolean(r.support_unread),
  replies: [],
});

const shapeReply = r => ({
  id: String(r.id),
  fromSupport: Boolean(r.from_support),
  authorName: r.author_name || "",
  authorEmail: r.author_email,
  body: r.body || "",
  statusTo: r.status_to || "",
  at: iso(r.created_at),
});

/* v170: each ticket's messages and status changes, oldest first, in one query. */
async function withReplies(tickets) {
  if (!tickets.length) return tickets;
  const ids = tickets.map(t => t.id);
  const rows = await sql`
    select * from office_ticket_replies where ticket_id = any(${ids}::bigint[])
    order by id`;   // v181 (scan): saving order (created_at is when the save BEGAN, before waiting on the lock)
  const by = new Map(tickets.map(t => [t.id, t]));
  for (const r of rows) by.get(String(r.ticket_id))?.replies.push(shapeReply(r));
  return tickets;
}
const cleanName = (user, email) => {
  const n = String(user?.displayName || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
  return n === email ? "" : n;
};

const isId = id => typeof id === "string" && /^[1-9]\d{0,17}$/.test(id);
/* v181: the newest message id the page had shown, or null. */
const seenId = v => (isId(String(v ?? "")) ? String(v) : null);
const cleanEmail = e => (typeof e === "string" ? e.trim().toLowerCase() : "");

async function log(itemId, action, actor, before, after) {
  /* v177 (scan): the change is already saved when this runs. A failure here
     must not tell the person "nothing was changed" (they would send it again);
     it is written to the server log instead. */
  try { await logNow(itemId, action, actor, before, after); }
  catch (e) { console.error(`ticket change log failed (${action} ${itemId}):`, String(e?.message || e).slice(0, 200)); }
}
async function logNow(itemId, action, actor, before, after) {
  await sql`
    insert into office_changes (room, item_id, action, actor_email, before, after)
    values ('tickets', ${itemId}, ${action}, ${actor},
            ${before === null ? null : JSON.stringify(before)}::jsonb,
            ${after === null ? null : JSON.stringify(after)}::jsonb)`;
}

/**
 * File a ticket as `user` (the signed-in person, from the session).
 * The submitter is always the session's email. A "submittedBy" in the form
 * is ignored, so nobody can file a ticket as someone else.
 */
export async function createTicket(user, input) {
  const email = cleanEmail(user?.email);
  if (!email) throw new TicketError("Sign in first.", {}, 401);
  const v = validateFields(NEW_TICKET_FIELDS, input);
  if (!v.ok) throw new TicketError("Some fields need fixing.", v.errors);
  await ensureTicketSchema();
  /* v179 (scan): the count and the insert in one go, behind a lock on this
     person, so many requests at once can't all slip under the limit. */
  const [, rows] = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtext(${"tickets:" + email}))`,
    sql`
      insert into office_tickets (title, category, priority, details, submitted_by, submitted_name, updated_by)
      select ${v.fields.title}, ${v.fields.category}, ${v.fields.priority}, ${v.fields.details}, ${email}, ${cleanName(user, email)}, ${email}
      where (select count(*) from office_tickets
             where lower(submitted_by) = ${email} and created_at > now() - interval '1 day') < ${MAX_TICKETS_PER_DAY}::int
      returning *`,
  ]);
  if (!rows.length) {
    throw new TicketError(`You've sent ${MAX_TICKETS_PER_DAY} tickets in the last 24 hours, which is the most one person can send. Try again later, or ask an admin directly.`, {}, 429);
  }
  const t = shapeTicket(rows[0]);
  await log(rows[0].id, "create", email, null, t);
  return t;
}

/** The viewer's own tickets, newest first. Filtered here, by the session's email. */
export async function myTickets(email) {
  const e = cleanEmail(email);
  if (!e) return [];
  await ensureTicketSchema();
  const rows = await sql`
    select * from office_tickets where lower(submitted_by) = ${e}
    order by agent_unread desc, created_at desc, id desc limit 200`;
  return withReplies(rows.map(shapeTicket));
}

/** v170: what the support team hasn't looked at yet: tickets still New, and
    tickets the agent has answered since. The caller checks the viewer is an admin. */
export async function supportCounts() {
  await ensureTicketSchema();
  const rows = await sql`
    select count(*) filter (where status = 'New')::int as new_n,
           count(*) filter (where support_unread and status <> 'New')::int as replied_n
    from office_tickets`;
  return { newCount: Number(rows[0]?.new_n) || 0, repliedCount: Number(rows[0]?.replied_n) || 0 };
}

/** v170: how many of the viewer's own tickets have an update they haven't opened. */
export async function myUnreadCount(email) {
  const e = cleanEmail(email);
  if (!e) return 0;
  await ensureTicketSchema();
  const rows = await sql`select count(*)::int as n from office_tickets where lower(submitted_by) = ${e} and agent_unread`;
  return Number(rows[0]?.n) || 0;
}

/** v170: the viewer opened My Tickets, so their updates are read. Only their own. */
export async function markMineSeen(email, ids = null) {
  const e = cleanEmail(email);
  if (!e) return 0;
  await ensureTicketSchema();
  /* v179 (scan): only the tickets the page actually showed as new. Clearing
     all of them also cleared an update that arrived after the list was
     read, which then never showed as new anywhere. */
  if (Array.isArray(ids)) {
    const list = ids.map(String).filter(isId).slice(0, 200);
    if (!list.length) return 0;
    const rows = await sql`update office_tickets set agent_unread = false
      where lower(submitted_by) = ${e} and agent_unread and id = any(${list}::bigint[]) returning id`;
    return rows.length;
  }
  const rows = await sql`update office_tickets set agent_unread = false where lower(submitted_by) = ${e} and agent_unread returning id`;
  return rows.length;
}

/** v170: an admin opened a ticket the agent had answered. The caller checks the viewer is an admin. */
export async function markSupportSeen(id, lastSeenReplyId = null) {
  if (!isId(id)) throw new TicketError("That ticket does not exist.", {}, 404);
  await ensureTicketSchema();
  /* v180 (scan): given the newest message the page showed, cleared only if
     the agent hasn't written again since (a reply landing after the page was
     drawn was marked seen without ever being shown). */
  const after = lastSeenReplyId != null && isId(String(lastSeenReplyId)) ? String(lastSeenReplyId) : null;
  const rows = await sql`update office_tickets set support_unread = false
    where id = ${id}
      and (${after}::bigint is null or not exists (
        select 1 from office_ticket_replies r where r.ticket_id = ${id} and not r.from_support and r.id > ${after}::bigint))
    returning id`;
  if (!rows.length && after) {
    const there = await sql`select 1 from office_tickets where id = ${id}`;
    if (there.length) return { id: String(id), stillNew: true };
  }
  if (!rows.length) throw new TicketError("That ticket does not exist.", {}, 404);
  return { id: String(rows[0].id) };
}

/** Every ticket, for the Support Center: New first, then ones the agent has
    answered (v170), then the rest open before resolved, newest first. The
    caller checks the viewer is an admin. */
export async function allTickets() {
  await ensureTicketSchema();
  const rows = await sql`
    select * from office_tickets
    order by case when status = 'New' then 0 when support_unread then 1 else 2 end,
             case status when 'New' then 0 when 'In review' then 1 when 'Waiting on agent' then 2 else 3 end,
             created_at desc, id desc
    limit 1000`;
  return withReplies(rows.map(shapeTicket));
}

/* v180: nothing saved: say whether the ticket was deleted meanwhile (404) or
   the daily limit was reached (429). Always throws. */
async function gone(id, limitMsg) {
  const there = await sql`select 1 from office_tickets where id = ${id}`;
  if (!there.length) throw new TicketError("That ticket does not exist.", {}, 404);
  throw new TicketError(limitMsg, {}, 429);
}

async function repliesToday(email) {
  const rows = await sql`
    select count(*)::int as n from office_ticket_replies
    where lower(author_email) = ${email} and body <> '' and created_at > now() - interval '1 day'`;
  /* v177 (scan): messages only. A status change from Update status leaves a
     line in the history too, but it is not a message and must not use up
     someone's sixty. */
  return Number(rows[0]?.n) || 0;
}

/**
 * v170: the support team sends an update back to the agent: a message, and
 * the status if it changes (a ticket still New moves to In review, since
 * someone has picked it up). The agent's bell lights up. The caller checks
 * `user` is an admin.
 */
export async function supportReply(id, input, user, { lastSeen = null } = {}) {
  const email = cleanEmail(user?.email);
  if (!email) throw new TicketError("Sign in first.", {}, 401);
  if (!isId(id)) throw new TicketError("That ticket does not exist.", {}, 404);
  const v = validateFields(REPLY_FIELDS, input || {});
  if (!v.ok) throw new TicketError("Some fields need fixing.", v.errors);
  const wanted = input && Object.hasOwn(input, "status") ? input.status : undefined;
  if (wanted !== undefined && !TICKET_STATUSES.includes(wanted)) throw new TicketError("Some fields need fixing.", { status: "Pick one of the statuses." });
  await ensureTicketSchema();
  const before = await sql`select * from office_tickets where id = ${id}`;
  if (!before.length) throw new TicketError("That ticket does not exist.", {}, 404);
  if (await repliesToday(email) >= MAX_REPLIES_PER_DAY) throw new TicketError(`That's ${MAX_REPLIES_PER_DAY} messages in the last 24 hours, the most one person can send.`, {}, 429);
  const current = shapeTicket(before[0]);
  /* v177 (scan): an admin answering their OWN ticket from the Support Center
     is not news for them: no bell, no "New update" (and the route sends no
     email). */
  const self = cleanEmail(current.submittedBy) === email;
  /* v177 (scan): the message and the ticket's new state are saved together,
     so a hiccup can never leave one without the other. */
  /* v179 (scan): behind a lock on this person, the message is saved only
     while they're under the daily limit, and the ticket changes only if it
     was (so many replies at once can't slip past the count above). The
     message is found again by this transaction's own time, now(). */
  /* v180 (scan): the ticket row is locked first and the new status worked
     out from it as it is NOW (it was worked out from a read taken before, so
     an agent's reply landing in between was undone: back to "Waiting on
     agent", with its flag cleared). */
  const want = wanted === undefined ? null : wanted;
  const [, , , rows] = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtext(${"ticket-replies:" + email}))`,
    sql`select id from office_tickets where id = ${id} for update`,
    sql`
      insert into office_ticket_replies (ticket_id, author_email, author_name, from_support, body, status_to)
      select t.id, ${email}, ${cleanName(user, email)}, true, ${v.fields.body},
             nullif(coalesce(${want}::text, case when t.status = 'New' then 'In review' else t.status end), t.status)
      from office_tickets t
      where t.id = ${id}
        and (select count(*) from office_ticket_replies
             where lower(author_email) = ${email} and body <> '' and created_at > now() - interval '1 day') < ${MAX_REPLIES_PER_DAY}::int`,
    sql`
      update office_tickets
      set status = coalesce(${want}::text, case when status = 'New' then 'In review' else status end),
          agent_unread = (agent_unread or ${!self}),
          /* v181 (scan): your own side's "new" mark is cleared only if
             nothing came in that you hadn't seen when you wrote. */
          support_unread = (${seenId(lastSeen)}::bigint is not null and support_unread and exists (
            select 1 from office_ticket_replies r where r.ticket_id = ${id} and not r.from_support and r.id > ${seenId(lastSeen)}::bigint)),
          updated_at = now(), updated_by = ${email}
      where id = ${id}
        and exists (select 1 from office_ticket_replies r
                    where r.ticket_id = ${id} and r.author_email = ${email} and r.created_at = now())
      returning *`,
  ]);
  if (!rows || !rows.length) await gone(id, `That's ${MAX_REPLIES_PER_DAY} messages in the last 24 hours, the most one person can send.`);
  const after = shapeTicket(rows[0]);
  await log(id, "update", email, current, { ...after, reply: v.fields.body });
  /* v181 (scan): the message as saved (cleaned), for the email. */
  return Object.assign(after, { self, savedBody: v.fields.body });
}

/**
 * v170: the agent answers on their own ticket. Only the person who filed it
 * (by the session's email); anyone else gets "does not exist". A ticket that
 * was waiting on them, or resolved, goes back to In review, and the Support
 * Center's bell lights up.
 */
export async function agentReply(id, input, user, { lastSeen = null } = {}) {
  const email = cleanEmail(user?.email);
  if (!email) throw new TicketError("Sign in first.", {}, 401);
  if (!isId(id)) throw new TicketError("That ticket does not exist.", {}, 404);
  const v = validateFields(REPLY_FIELDS, input || {});
  if (!v.ok) throw new TicketError("Some fields need fixing.", v.errors);
  await ensureTicketSchema();
  const before = await sql`select * from office_tickets where id = ${id} and lower(submitted_by) = ${email}`;
  if (!before.length) throw new TicketError("That ticket does not exist.", {}, 404);
  if (await repliesToday(email) >= MAX_REPLIES_PER_DAY) throw new TicketError(`That's ${MAX_REPLIES_PER_DAY} messages in the last 24 hours, the most one person can send. Try again later.`, {}, 429);
  const current = shapeTicket(before[0]);
  /* v180 (scan): locked and worked out from the row as it is now, too. */
  const [, , , rows] = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtext(${"ticket-replies:" + email}))`,
    sql`select id from office_tickets where id = ${id} for update`,
    sql`
      insert into office_ticket_replies (ticket_id, author_email, author_name, from_support, body, status_to)
      select t.id, ${email}, ${cleanName(user, email)}, false, ${v.fields.body},
             case when t.status in ('Waiting on agent', 'Resolved') then 'In review' end
      from office_tickets t
      where t.id = ${id}
        and (select count(*) from office_ticket_replies
             where lower(author_email) = ${email} and body <> '' and created_at > now() - interval '1 day') < ${MAX_REPLIES_PER_DAY}::int`,
    sql`
      update office_tickets
      set status = case when status in ('Waiting on agent', 'Resolved') then 'In review' else status end,
          support_unread = true,
          agent_unread = (${seenId(lastSeen)}::bigint is not null and agent_unread and exists (
            select 1 from office_ticket_replies r where r.ticket_id = ${id} and r.from_support and r.id > ${seenId(lastSeen)}::bigint)),
          updated_at = now(), updated_by = ${email}
      where id = ${id}
        and exists (select 1 from office_ticket_replies r
                    where r.ticket_id = ${id} and r.author_email = ${email} and r.created_at = now())
      returning *`,
  ]);
  if (!rows || !rows.length) await gone(id, `That's ${MAX_REPLIES_PER_DAY} messages in the last 24 hours, the most one person can send. Try again later.`);
  const after = shapeTicket(rows[0]);
  await log(id, "update", email, current, { ...after, reply: v.fields.body });
  return Object.assign(after, { savedBody: v.fields.body });
}

/** Change a ticket's status, priority, category or assignee. The caller checks the actor is an admin. */
export async function updateTicket(id, input, actor) {
  if (!isId(id)) throw new TicketError("That ticket does not exist.", {}, 404);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TicketError("Nothing to change.");
  await ensureTicketSchema();
  const before = await sql`select * from office_tickets where id = ${id}`;
  if (!before.length) throw new TicketError("That ticket does not exist.", {}, 404);
  const current = shapeTicket(before[0]);
  /* Only the keys sent are changed; the rest keep their current values, and
     the whole result is checked. */
  const merged = Object.fromEntries(UPDATE_FIELDS.map(f => [f.key, Object.hasOwn(input, f.key) ? input[f.key] : current[f.key]]));
  const v = validateFields(UPDATE_FIELDS, merged);
  if (!v.ok) throw new TicketError("Some fields need fixing.", v.errors);
  /* v180 (scan): ...and only those are WRITTEN. The other columns used to be
     written back from the read above, so a reply landing in between (which
     reopens the ticket) was undone by an unrelated priority change. The row
     is locked, the change worked out from it as it is now, and the history
     line written in the same statement only if the status really moved. */
  const sent = k => (Object.hasOwn(input, k) ? v.fields[k] : null);
  /* v177 (scan): your own ticket's status is not news for you. */
  const self = cleanEmail(current.submittedBy) === cleanEmail(actor);
  const rows = await sql`
    with b as (select * from office_tickets where id = ${id} for update),
    u as (
      update office_tickets o
      set status = coalesce(${sent("status")}::text, b.status),
          priority = coalesce(${sent("priority")}::text, b.priority),
          category = coalesce(${sent("category")}::text, b.category),
          assignee = coalesce(${sent("assignee")}::text, b.assignee),
          updated_at = now(), updated_by = ${actor},
          agent_unread = (o.agent_unread or (coalesce(${sent("status")}::text, b.status) <> b.status and ${!self}::boolean))
      from b where o.id = b.id
      returning o.*, b.status as old_status),
    h as (
      insert into office_ticket_replies (ticket_id, author_email, author_name, from_support, body, status_to)
      select id, ${actor}, '', true, '', status from u where status <> old_status
      returning 1)
    select u.*, (select count(*) from h)::int as moved_n from u`;
  if (!rows.length) throw new TicketError("That ticket does not exist.", {}, 404);
  const moved = Number(rows[0].moved_n) > 0;
  const after = shapeTicket(rows[0]);
  await log(id, "update", actor, current, after);
  /* v170: the route emails the agent when this is true (v177: not about your own ticket). */
  return Object.assign(after, { statusChanged: moved && !self });
}

export async function deleteTicket(id, actor) {
  if (!isId(id)) throw new TicketError("That ticket does not exist.", {}, 404);
  await ensureTicketSchema();
  const rows = await sql`delete from office_tickets where id = ${id} returning *`;
  if (!rows.length) throw new TicketError("That ticket does not exist.", {}, 404);
  await log(id, "delete", actor, shapeTicket(rows[0]), null);
  return { id: String(rows[0].id) };
}
