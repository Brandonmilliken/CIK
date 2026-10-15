/* Leadership Settings (v131): who is an admin or in leadership.
 *
 * Brandon (2026-09-30): anyone can be added to or removed from admin or
 * leadership from inside Jarvis, except the super admins (Brandon Milliken,
 * and from v142 Jordan Matin), who cannot be edited (SUPER_ADMINS in lib/authz.js).
 *
 * Rules, all checked here on the server:
 *   - only leadership (or the super admin) may change anyone's role, and
 *     that is looked up fresh from the database on every change, so someone
 *     just removed from leadership cannot keep making changes
 *   - the super admin can't be changed by anyone
 *   - nobody changes their own role (so no one locks themselves out by accident)
 *   - only the stored roles: agent, admin, leadership (v135: broker retired;
 *     anyone still stored as one shows and counts as an agent)
 *   - someone not on the roster yet (staff with no Sisu record) can be added
 *     by email; the nightly roster sync never changes a role
 * Every change is written to role_changes: who, whose, from, to, when.
 */
import { sql as neonSql } from "./db.js";
import { ROLES, isSuperAdmin, effectiveRole, atLeast, isAllowedIdentity } from "./authz.js";

let sql = neonSql;
/** For scripts/roles-db-check.mjs: the same queries over a local Postgres. */
export function __setSqlForTests(f) { sql = f; ready = null; }

let ready = null;
function ensure() {
  if (!ready) {
    ready = Promise.resolve(sql`
      create table if not exists role_changes (
        id         bigserial primary key,
        actor      text        not null,
        email      text        not null,
        from_role  text,
        to_role    text        not null,
        at         timestamptz not null default now()
      )`).then(() => true, e => { ready = null; throw e; });
  }
  return ready;
}

const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;
const low = v => (typeof v === "string" ? v.trim().toLowerCase() : "");
const clip = (v, n) => String(v || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

/** Everyone on the roster with their role, leadership and admins first. */
export async function listPeople() {
  /* v140: with left_at, so the page can set aside people who have left. */
  let rows;
  await ensure();
  /* v181 (scan): with the last change on record, so "Bring back" is offered
     only for someone marked as left HERE (not an old address the roster
     sync retired, which would let it sign in again with its old role). */
  try { rows = await sql`select a.email, a.first_name, a.last_name, a.role, a.status, a.left_at, a.sisu_agent_id,
           (select c.to_role from role_changes c where c.email = lower(btrim(a.email)) order by c.at desc, c.id desc limit 1) as last_change
         from agents a where a.email is not null`; }
  catch (e) {
    if (!/left_at/.test(String(e && e.message))) throw e;
    rows = await sql`select email, first_name, last_name, role, status, sisu_agent_id from agents where email is not null`;
  }
  const rank = { leadership: 0, admin: 1, agent: 2 };
  return rows.map(r => {
    const email = low(r.email);
    const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || email;
    return { email, name, role: effectiveRole(email, r.role), stored: r.role, status: r.status || "", locked: isSuperAdmin(email),
             left: r.left_at ? new Date(r.left_at).toISOString() : null,
             /* v180: added by hand (no Sisu record), so only leadership can
                mark them as having left. */
             /* cik-v12: or with no history at all (a super admin may clear it;
                CIK has no roster sync, so nothing here is retired by one). */
             staff: r.sisu_agent_id == null && (!r.left_at || r.last_change === "left" || r.last_change == null) };
  }).sort((a, b) => (a.locked ? -1 : b.locked ? 1 : 0)
    || (rank[a.role] ?? 9) - (rank[b.role] ?? 9)
    || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** The last changes, newest first, with names where the roster has them. */
export async function recentChanges(limit = 30) {
  await ensure();
  return (await sql`
    select c.id, c.actor, c.email, c.from_role, c.to_role, c.at,
           trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')) as who,
           trim(coalesce(b.first_name, '') || ' ' || coalesce(b.last_name, '')) as by_name
    from role_changes c
    left join agents a on lower(a.email) = c.email
    left join agents b on lower(b.email) = c.actor
    order by c.at desc limit ${limit}`).map(r => ({
      id: String(r.id), email: r.email, name: r.who || r.email, by: r.by_name || r.actor,
      from: r.from_role, to: r.to_role, at: new Date(r.at).toISOString(),
    }));
}

/* v181 (scan): the actor's role as it is NOW, and someone marked as left
   counts as an agent (a leader marked as left could still change roles in
   the minutes before their session ended). */
async function actorRole(actor) {
  const me = (await sql`select role, (to_jsonb(agents) ->> 'left_at') as left_at from agents where lower(email) = ${actor}`)[0];
  if (me && me.left_at && !isSuperAdmin(actor)) return "agent";
  return effectiveRole(actor, me ? me.role : "agent");
}

export class RoleError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/**
 * Change one person's role. `actorEmail` is the signed-in person (from the
 * session, never the request). `add` allows creating a roster row for
 * someone who is not on it yet, with the name given.
 */
export async function setRole({ actorEmail, email, role, add = false, firstName = "", lastName = "" }) {
  const actor = low(actorEmail), who = low(email);
  if (!EMAIL.test(who)) throw new RoleError("That isn't an email address.");
  if (!ROLES.includes(role)) throw new RoleError("Pick agent, admin or leadership.");

  /* Fresh from the database, not the sign-in token, which can be 15 minutes old. */
  const myRole = await actorRole(actor);
  if (!atLeast(myRole, "leadership")) throw new RoleError("Only leadership can change roles.", 403);
  if (isSuperAdmin(who)) throw new RoleError("That's a super admin, and super admins can't be changed here.", 403);
  if (who === actor) throw new RoleError("You can't change your own role. Ask another member of leadership.", 403);

  await ensure();
  const found = (await sql`select email, role, (to_jsonb(agents) ->> 'left_at') as left_at from agents where lower(email) = ${who}`)[0];
  if (!found && !add) throw new RoleError("That email isn't on the list yet. Use Add someone to add them.", 404);
  /* v181 (scan): "Add someone" for a person marked as left said "added",
     and they stayed locked out. */
  if (found && add && found.left_at) throw new RoleError("They're on the roster but marked as left. Use Bring back under \"Left the company\".", 409);
  /* v181 (scan): only an address that can actually sign in. */
  if (!found && add && !isAllowedIdentity(who, true)) throw new RoleError("That address can't sign in to Jarvis (it isn't on an allowed domain or the allow-list).");
  if (found && found.role === role) return { changed: false, email: who, role };

  /* v180 (scan): the change and its line in role_changes are ONE statement,
     so neither is ever saved without the other, and "from" is the role the
     row actually had at that moment (two leaders at once both logged
     "from agent" before). */
  if (found) {
    const rows = await sql`
      with old as (select email, role from agents where lower(email) = ${who} for update),
      upd as (update agents a set role = ${role} from old
              where a.email = old.email and old.role is distinct from ${role}
              returning old.role as from_role)
      insert into role_changes (actor, email, from_role, to_role)
      select ${actor}, ${who}, from_role, ${role} from upd
      returning from_role`;
    if (!rows.length) return { changed: false, email: who, role };
    return { changed: true, email: who, role, from: rows[0].from_role, added: false };
  }
  const first = clip(firstName, 60), last = clip(lastName, 60);
  if (!first) throw new RoleError("Add their first name too.");
  await sql`
    with ins as (insert into agents (email, first_name, last_name, role) values (${who}, ${first}, ${last || null}, ${role})
                 on conflict (email) do update set role = excluded.role
                 returning email)
    insert into role_changes (actor, email, from_role, to_role)
    select ${actor}, ${who}, null, ${role} from ins`;
  return { changed: true, email: who, role, from: null, added: true };
}

/**
 * v180 (scan): mark someone added by hand as having left (or bring them
 * back). The nightly roster sync only marks people with a Sisu record, so a
 * TC or marketing person added here could never be cut off: sign-in, and the
 * 15-minute re-check, refuse anyone marked as left. Same rules as a role
 * change, and written to role_changes ("left" / back to their role).
 */
export async function setLeft({ actorEmail, email, left }) {
  const actor = low(actorEmail), who = low(email);
  if (!EMAIL.test(who)) throw new RoleError("That isn't an email address.");
  const myRole = await actorRole(actor);
  if (!atLeast(myRole, "leadership")) throw new RoleError("Only leadership can do that.", 403);
  if (isSuperAdmin(who)) throw new RoleError("That's a super admin, and super admins can't be changed here.", 403);
  if (who === actor) throw new RoleError("You can't mark yourself as having left.", 403);
  await ensure();
  const found = (await sql`select email, role, sisu_agent_id, left_at from agents where lower(email) = ${who}`)[0];
  if (!found) throw new RoleError("That email isn't on the roster.", 404);
  if (found.sisu_agent_id != null) throw new RoleError("Their record is managed by a sync, so it can't be changed here.", 409);
  const leave = left === true;
  /* v181 (scan): bring back only someone marked as left here (an old
     address the roster sync retired stays retired). */
  if (!leave && found.left_at) {
    const last = (await sql`select to_role from role_changes where email = ${who} order by at desc, id desc limit 1`)[0];
    /* cik-v12: no history (cleared by a super admin) is fine too. */
    if (last && last.to_role !== "left") throw new RoleError("That address was retired by a sync, so it can't be brought back here.", 409);
  }
  const rows = await sql`
    with old as (select email, role, left_at from agents where lower(email) = ${who} and sisu_agent_id is null for update),
    upd as (update agents a set left_at = case when ${leave} then now() else null end from old
            where a.email = old.email and (old.left_at is null) = ${leave}
            returning old.role as role)
    insert into role_changes (actor, email, from_role, to_role)
    select ${actor}, ${who}, case when ${leave} then role else 'left' end, case when ${leave} then 'left' else role end from upd
    returning to_role`;
  return { changed: rows.length > 0, email: who, left: leave };
}

/**
 * cik-v12 (Brandon, 2026-10-15): empty the Recent changes history. SUPER
 * ADMINS ONLY, decided by the verified sign-in email (never a stored role),
 * so leadership can't wipe the record of their own changes. Nobody's role or
 * access changes. The server log keeps who cleared it and how many lines went.
 */
export async function clearHistory({ actorEmail }) {
  const actor = low(actorEmail);
  if (!isSuperAdmin(actor)) throw new RoleError("Only a super admin can clear the history.", 403);
  await ensure();
  const gone = await sql`delete from role_changes returning id`;
  console.log("[roles] history cleared by", actor, "lines:", gone.length);
  return { changed: gone.length > 0, cleared: gone.length };
}

/**
 * cik-v11 (Brandon, 2026-10-15): take someone off the list altogether, e.g. an
 * address added with a typo. Two steps on purpose: only someone already
 * marked as left (and added by hand, not by a sync) can be removed, so a real
 * person is never one click from vanishing. Same rules as a role change. The
 * history keeps its lines, plus one saying they were removed. If the address
 * ever signs in for real, it comes back as a new agent.
 */
export async function removePerson({ actorEmail, email }) {
  const actor = low(actorEmail), who = low(email);
  if (!EMAIL.test(who)) throw new RoleError("That isn't an email address.");
  const myRole = await actorRole(actor);
  if (!atLeast(myRole, "leadership")) throw new RoleError("Only leadership can do that.", 403);
  if (isSuperAdmin(who)) throw new RoleError("That's a super admin, and super admins can't be changed here.", 403);
  if (who === actor) throw new RoleError("You can't remove yourself.", 403);
  await ensure();
  const found = (await sql`select email, sisu_agent_id, left_at from agents where lower(email) = ${who}`)[0];
  if (!found) throw new RoleError("That email isn't on the list.", 404);
  if (found.sisu_agent_id != null) throw new RoleError("Their record is managed by a sync, so it can't be removed here.", 409);
  if (!found.left_at) throw new RoleError("Mark them as having left first, then remove them.", 409);
  const rows = await sql`
    with gone as (delete from agents where lower(email) = ${who} and left_at is not null and sisu_agent_id is null returning email)
    insert into role_changes (actor, email, from_role, to_role)
    select ${actor}, ${who}, 'left', 'removed' from gone
    returning to_role`;
  return { changed: rows.length > 0, email: who, removed: rows.length > 0 };
}
