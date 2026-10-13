/* Acknowledging announcements (v127).
 *
 * Brandon (2026-09-30): an announcement can be acknowledged. Once you have,
 * it leaves the top of YOUR page and goes into a "Previously acknowledged"
 * box. Admins and leadership see, under each announcement, everyone who has
 * acknowledged it and when, as a record.
 *
 * One row per person per announcement:
 *   item_id  the announcement (office_items.id in the Announcements room)
 *   email    who, taken from the signed-in session, never from the request
 *   name     their name at the time (so the record reads well even if the
 *            roster changes later)
 *   at       when they first acknowledged it
 * Acknowledging again changes nothing: the first time is the record.
 * Nothing here can un-acknowledge; the record only grows.
 */
import { sql as neonSql } from "./db.js";

let sql = neonSql;
/** For scripts/acks-db-check.mjs: the same queries over a local Postgres. */
export function __setSqlForTests(f) { sql = f; ready = null; }

let ready = null;
function ensure() {
  if (!ready) {
    ready = Promise.resolve(sql`
      create table if not exists announcement_acks (
        item_id bigint      not null,
        email   text        not null,
        name    text,
        at      timestamptz not null default now(),
        primary key (item_id, email)
      )`)
      /* v179 (scan): "what has this person acknowledged" reads by email,
         the key's second column, so it scanned the whole table. */
      .then(() => sql`create index if not exists announcement_acks_email on announcement_acks (email)`)
      .then(() => true, e => { ready = null; throw e; });
  }
  return ready;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const idOf = v => { const s = String(v ?? ""); return /^\d{1,18}$/.test(s) ? s : null; };
const low = v => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** Record that `email` has acknowledged announcement `id`. True if newly recorded. */
export async function acknowledge(id, email, name) {
  const item = idOf(id), who = low(email);
  if (!item || !EMAIL.test(who)) throw new Error("bad acknowledgement");
  await ensure();
  const rows = await sql`
    insert into announcement_acks (item_id, email, name)
    values (${item}, ${who}, ${String(name || "").slice(0, 120) || null})
    on conflict (item_id, email) do nothing
    returning item_id`;
  return rows.length > 0;
}

/** The ids (as strings) of the announcements this person has acknowledged, with when. */
export async function acksFor(email) {
  const who = low(email);
  if (!who) return new Map();
  await ensure();
  const rows = await sql`select item_id, at from announcement_acks where email = ${who}`;
  return new Map(rows.map(r => [String(r.item_id), new Date(r.at).toISOString()]));
}

/** Everyone who acknowledged each announcement, oldest first (all of them,
    or only these ids). For admins only. */
export async function acksByItem(ids = null) {
  const list = ids ? ids.map(idOf).filter(Boolean) : null;
  if (list && !list.length) return new Map();
  await ensure();
  const rows = list
    ? await sql`
        select item_id, email, name, at from announcement_acks
        where item_id = any(${list}::bigint[])
        order by at asc`
    /* v178 (scan): the NEWEST 5000, still listed oldest first. It took the
       oldest 5000, so once the team had made that many acknowledgements the
       newest announcements (the ones admins check) showed nobody at all. */
    : await sql`select * from (select item_id, email, name, at from announcement_acks
                order by at desc limit 5000) t order by at asc`;
  const out = new Map();
  for (const r of rows) {
    const k = String(r.item_id);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push({ email: r.email, name: r.name || r.email, at: new Date(r.at).toISOString() });
  }
  return out;
}

/**
 * The dashboard's announcements, split for one viewer. Pure, so it can be tested.
 *   items     the Announcements room's items ({ id, fields })
 *   mine      Map id -> when this viewer acknowledged it
 *   byItem    Map id -> [{ name, at }], only passed for admins
 * Only announcements set to show are included. v136 (Brandon, 2026-10-01):
 * the top keeps EVERY one not yet acknowledged, however many, and each stays
 * there until this person acknowledges it (it used to stop at three). The
 * box keeps the 20 most recently acknowledged.
 */
export function splitAnnouncements(items, mine = new Map(), byItem = null, roster = []) {   // roster null: unknown
  const shown = (items || [])
    .map(i => ({ id: String(i.id), f: i.fields || {} }))
    .filter(x => x.f.title && x.f.show !== "No")
    .map(x => ({ id: x.id, title: String(x.f.title), message: String(x.f.message || ""), link: String(x.f.link || "") }));
  const withAcks = a => {
    if (!byItem) return a;
    const who = (byItem.get(a.id) || []).map(r => ({ name: r.name, at: r.at }));
    /* v181 (scan): roster null = couldn't be read: say so, don't claim
       everyone has acknowledged. */
    if (roster === null) return { ...a, acks: who, notYet: [], notYetUnknown: true };
    const done = new Set((byItem.get(a.id) || []).map(r => low(r.email)));
    const waiting = (roster || []).filter(p => p && p.email && !done.has(low(p.email)))
      .map(p => [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email)
      .sort((x, y) => x.localeCompare(y, "en", { sensitivity: "base" }));
    return { ...a, acks: who, notYet: waiting };
  };
  const current = shown.filter(a => !mine.has(a.id)).map(withAcks);
  const acknowledged = shown.filter(a => mine.has(a.id))
    .map(a => ({ ...a, ackedAt: mine.get(a.id) }))
    .sort((a, b) => String(b.ackedAt).localeCompare(String(a.ackedAt)))
    .slice(0, 20).map(withAcks);
  return { current, acknowledged };
}
