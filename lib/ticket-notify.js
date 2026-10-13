/* An email when somebody files a help ticket (v156, Brandon, 2026-10-06).
 *
 * Jarvis does not send email itself. It tells Zapier, and a Zap sends the
 * email from MRE's own Google account to whoever Brandon lists in the Zap.
 * So who gets it, the subject line and the wording are all changed in
 * Zapier, with no change to Jarvis.
 *
 * How: after a ticket is saved (after the reply, so filing a ticket is never
 * slower or blocked by this), one POST of the ticket to a Zapier "Catch Hook"
 * address kept in Vercel as TICKET_EMAIL_HOOK_URL. No address set: nothing
 * is sent and nothing breaks. Only https://hooks.zapier.com addresses are
 * accepted, so a typo can never send tickets somewhere else.
 */
const ORIGIN = () => (process.env.JARVIS_ORIGIN || "https://jarvis.cikoffice.com").replace(/\/+$/, "");

/** The Zapier address, or null if it isn't set or isn't a Zapier hook. */
export function ticketHookUrl(raw = process.env.TICKET_EMAIL_HOOK_URL) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname === "hooks.zapier.com" && !u.username && !u.password ? u.toString() : null;
  } catch { return null; }
}

/* v181 (scan): invisible direction and zero-width characters go too (text
   could read reversed in the email), it is cut by whole characters, and a
   cut says so. */
const INVISIBLE = /[\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff\u{E0000}-\u{E007F}]/gu;
const clip = (v, n) => {
  const t = Array.from(String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(INVISIBLE, ""));
  return t.length > n ? t.slice(0, n).join("") + " … (continued in Jarvis)" : t.join("");
};

/** What Zapier gets: the ticket, a link to the Support Center, and ready-made subject and body lines. Pure. */
export function ticketPayload(t, origin = ORIGIN()) {
  const who = clip(t.submittedName, 120) || clip(t.submittedBy, 200);
  const title = clip(t.title, 200);
  const link = `${origin}/office/support`;
  return {
    event: "ticket.created",
    id: clip(t.id, 20),
    title,
    category: clip(t.category, 60),
    priority: clip(t.priority, 30),
    details: clip(t.details, 4000),
    submittedBy: clip(t.submittedBy, 200),
    submittedName: clip(t.submittedName, 120),
    createdAt: clip(t.createdAt, 40),
    link,
    subject: `New help ticket: ${title}`.slice(0, 200),
    text: [
      `${who} filed a help ticket in Jarvis.`,
      "",
      `Title: ${title}`,
      `Category: ${clip(t.category, 60)}`,
      `Priority: ${clip(t.priority, 30)}`,
      "",
      clip(t.details, 4000),
      "",
      `Open the Support Center: ${link}`,
    ].join("\n"),
  };
}

/** Tell Zapier about a new ticket. Never throws; says what happened. */
export async function notifyNewTicket(t, { url = ticketHookUrl(), fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!url) return { sent: false, reason: "TICKET_EMAIL_HOOK_URL is not set to a hooks.zapier.com address" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ticketPayload(t)),
      signal: ctl.signal,
      redirect: "error",
    });
    return { sent: res.ok, status: res.status };
  } catch (e) {
    return { sent: false, reason: String((e && e.message) || e).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

/* ---- v170: updates both ways --------------------------------------------------
 * Same Zapier hook, two more kinds of message (the Zap picks by "event"):
 *   ticket.update       the support team replied, or changed the status. Sent
 *                       to the agent who filed it: Jarvis's own record of who
 *                       filed it, never anything typed in. The Zap only
 *                       sends it to one address at an MRE domain.
 *   ticket.agent-reply  the agent answered. Sent to the support list, the
 *                       same people who get new tickets.
 * Nothing sent if the message would say nothing.
 */
const firstLine = (s, n) => clip(s, n).replace(/\s+/g, " ").trim();

/* v172: Zapier quietly drops a message whose "id" it has seen before, and
   the new-ticket email already used the ticket's number. So each update
   gets an id of its own (ticket, kind, and the moment of the change), and
   the ticket's number travels as ticketId. */
export function eventId(t, kind) {
  const at = Date.parse(t?.updatedAt || "");
  return `${clip(t?.id, 20)}-${kind}-${Number.isFinite(at) ? at : Date.now()}`;
}

/** The agent's email about an update. `reply` is the message the team wrote
    ("" for a status change on its own); `actor` is who did it. Pure. */
export function updatePayload(t, reply, actor, origin = ORIGIN()) {
  const title = clip(t.title, 200);
  const status = clip(t.status, 30);
  const body = clip(reply, 4000).trim();
  const who = firstLine(actor?.displayName, 120) || "The CIK support team";
  const link = `${origin}/office/my-tickets`;
  return {
    event: "ticket.update",
    id: eventId(t, "update"),
    ticketId: clip(t.id, 20),
    title,
    status,
    to: clip(t.submittedBy, 200).trim().toLowerCase(),
    replyTo: clip(actor?.email, 200).trim().toLowerCase(),
    link,
    subject: (body ? `Update on your help ticket: ${title}` : `Your help ticket is now ${status}: ${title}`).slice(0, 200),
    text: [
      body ? `${who} replied to your help ticket.` : `Your help ticket is now ${status}.`,
      "",
      `Ticket: ${title}`,
      `Status: ${status}`,
      ...(body ? ["", body] : []),
      "",
      `See the whole conversation, or reply, in Jarvis: ${link}`,
    ].join("\n"),
  };
}

/** The support list's email when an agent answers. Pure. */
export function agentReplyPayload(t, reply, origin = ORIGIN()) {
  const title = clip(t.title, 200);
  const who = clip(t.submittedName, 120) || clip(t.submittedBy, 200);
  const link = `${origin}/office/support`;
  return {
    event: "ticket.agent-reply",
    id: eventId(t, "agent-reply"),
    ticketId: clip(t.id, 20),
    title,
    status: clip(t.status, 30),
    submittedBy: clip(t.submittedBy, 200),
    submittedName: clip(t.submittedName, 120),
    link,
    subject: `Reply on help ticket: ${title}`.slice(0, 200),
    text: [
      `${who} replied on their help ticket.`,
      "",
      `Ticket: ${title}`,
      `Status: ${clip(t.status, 30)}`,
      "",
      clip(reply, 4000).trim(),
      "",
      `Open the Support Center: ${link}`,
    ].join("\n"),
  };
}

async function post(payload, { url = ticketHookUrl(), fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!url) return { sent: false, reason: "TICKET_EMAIL_HOOK_URL is not set to a hooks.zapier.com address" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctl.signal,
      redirect: "error",
    });
    return { sent: res.ok, status: res.status };
  } catch (e) {
    return { sent: false, reason: String((e && e.message) || e).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

/** Email the agent about an update. Never throws; says what happened. */
export function notifyTicketUpdate(t, reply, actor, opts) {
  const p = updatePayload(t, reply, actor);
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(p.to)) return Promise.resolve({ sent: false, reason: "no agent address" });
  return post(p, opts);
}

/** Email the support list about an agent's answer. Never throws. */
export function notifyAgentReply(t, reply, opts) {
  if (!clip(reply, 4000).trim()) return Promise.resolve({ sent: false, reason: "empty" });
  return post(agentReplyPayload(t, reply), opts);
}
