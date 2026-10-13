/* Postgres via Neon's HTTP driver.
 *
 * Deliberately the HTTP driver rather than node-postgres: serverless functions
 * spin up and die constantly, and a connection-pool-per-invocation is how you
 * exhaust Postgres connections on a Vercel deploy. Works with Neon and with
 * Vercel Postgres (which is Neon underneath).
 */
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL not set");
}
/* v180 (scan): a malformed address made the driver's own error print the
   whole connection string, password included, into the log. */
try { new URL(process.env.DATABASE_URL); }
catch { throw new Error("DATABASE_URL is not a valid postgres:// address (value not shown)"); }

export const sql = neon(process.env.DATABASE_URL);

/** Resolve a verified Google email to a person's row (null if they have never signed in). */
export async function agentByEmail(email) {
  if (!email) return null;
  const rows = await sql`
    select *
    from agents
    where btrim(lower(email)) = btrim(lower(${email}))
    limit 1`;
  /* v177: every column, so the sign-in check can see left_at where the roster
     sync has set it (and the lookup still works on a database without it). */
  return rows[0] || null;
}

/**
 * CIK: add someone to the people list the first time they sign in, as an
 * agent. Does nothing if they are already on it, so a role leadership set,
 * a name, or "has left" is never overwritten by a sign-in.
 */
export async function ensureAgent(email, firstName = "", lastName = "") {
  const who = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!who) return false;
  const clip = v => String(v || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 60) || null;
  const rows = await sql`
    insert into agents (email, first_name, last_name, role)
    values (${who}, ${clip(firstName)}, ${clip(lastName)}, 'agent')
    on conflict (email) do nothing
    returning email`;
  return rows.length > 0;
}

export async function snapshot(key) {
  const rows = await sql`select payload, synced_at from snapshots where key = ${key} limit 1`;
  return rows[0] || null;
}

/** v179 (scan): the same, without the named top-level keys (the team to-do
    table needs counts, not each card's lead lists, which ran to megabytes). */
export async function snapshotsWithPrefixWithout(prefix, drop) {
  const p = String(prefix).replace(/[\\%_]/g, m => "\\" + m) + "%";
  return sql`select key, payload - ${drop}::text[] as payload, synced_at from snapshots where key like ${p}`;
}

/** Every snapshot whose key starts with `prefix` (v102: "todo:<email>"). */
export async function snapshotsWithPrefix(prefix) {
  const p = String(prefix).replace(/[\\%_]/g, m => "\\" + m) + "%";
  return sql`select key, payload, synced_at from snapshots where key like ${p}`;
}

/* v180 (scan): text Postgres's jsonb can't hold (a NUL, or half an emoji
   cut by a length limit) made a whole save fail, for the whole team. */
export const jsonSafe = (k, v) => (typeof v === "string"
  ? (typeof v.toWellFormed === "function" ? v.toWellFormed() : v).replace(/\u0000/g, "")
  : v);

export async function putSnapshot(key, payload) {
  await sql`
    insert into snapshots (key, payload, synced_at)
    values (${key}, ${JSON.stringify(payload, jsonSafe)}::jsonb, now())
    on conflict (key) do update set payload = excluded.payload, synced_at = now()`;
}

/* v179 (scan): the log table is made here if it isn't there (it only came
   from schema.sql), because a "view as" that can't be logged is refused. */
let viewAsReady = null;
export async function logViewAs(actorEmail, targetEmail) {
  if (!viewAsReady) {
    viewAsReady = sql`create table if not exists view_as_log (
      id bigserial primary key, actor_email text not null, target_email text not null,
      at timestamptz not null default now())`.then(() => true, e => { viewAsReady = null; throw e; });
  }
  await viewAsReady;
  await sql`insert into view_as_log (actor_email, target_email) values (${actorEmail}, ${targetEmail})`;
}

/** Roster lookup for resolving identities that arrive without an email.
    v140: people who have left the company (left_at set by the roster sync,
    lib/roster-leavers.js) are not on it. Before the first sync that adds
    that column, everyone is, as before. */
export async function allAgents() {
  try {
    return await sql`select email, first_name, last_name, sisu_agent_id from agents where email is not null and left_at is null`;
  } catch (e) {
    if (!/left_at/.test(String(e && e.message))) throw e;
    return sql`select email, first_name, last_name, sisu_agent_id from agents where email is not null`;
  }
}

/**
 * Is there a roster yet?
 *
 * Used by /api/admin/run to decide whether demo mode's role bypass still
 * applies. Roles live on the agents table, so before the first roster sync
 * there is no role to check against and no way to seed without a bypass —
 * a genuine chicken and egg. Once a roster exists the bypass is no longer
 * needed, so it closes itself rather than staying open for the life of the
 * deployment.
 *
 * Fails CLOSED: if this cannot be answered, the answer is "there is a roster",
 * which means the bypass does not apply and the caller must be an admin. A
 * database error should never widen access.
 */
export async function rosterIsEmpty() {
  try {
    const rows = await sql`select 1 from agents limit 1`;
    return rows.length === 0;
  } catch {
    return false;
  }
}
