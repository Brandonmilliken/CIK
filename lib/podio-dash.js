/* The Deals dashboard's numbers, read from the copy of Podio (lib/podio-sync.js).
 *
 * WHAT COUNTS (Brandon, 2026-10-14: the leaderboard ranks Closed deals + fees,
 * and Offers signed; everyone can see everyone; default window last 30 days):
 *
 *   New leads      Lead Date in the window.
 *   Offers sent    Offer Sent Date in the window (lib/podio.js sent_d).
 *   Offers signed  Offer Signed Date in the window (signed_d).
 *   Closed         Closing Date in the window, status Closed or Sold Flip.
 *   Fees           the fees of those closed deals (WS Fee, else Assignment Fee).
 *   Kicked         handed to an OUTSIDE agent, Kicked To Agent Date in the
 *                  window; "kicked by" is the Lead Owner (agent_kicks.py rules).
 *
 * Each lead counts ONCE even when Podio holds two copies of it (one per app it
 * has passed through): the copy in Elysium wins, else the most recently edited.
 *
 * A PERSON is a Lead Owner. Jordan and Jacob also see the leads handed to them
 * (they are in-house, so a lead handed to them is theirs to work).
 */
import { sql as neonSql } from "./db.js";
import { ELYSIUM_ID, IN_HOUSE, LEAD_APPS } from "./podio.js";
import { ensurePodioTables } from "./podio-sync.js";

let sql = neonSql;
export function __setSqlForTests(f) { sql = f; }

export const PERIODS = [
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];

/** Today in Portland, as "YYYY-MM-DD". */
export function laToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const addDays = (ymd, n) => {
  const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The window for a period key, as Portland calendar days (inclusive). */
export function periodRange(key, now = new Date()) {
  const today = laToday(now);
  const [y, m] = today.split("-").map(Number);
  const p = PERIODS.find(x => x.key === key) || PERIODS[0];
  switch (p.key) {
    case "month": return { ...p, from: `${today.slice(0, 7)}-01`, to: today };
    case "lastmonth": {
      const first = `${y}-${String(m).padStart(2, "0")}-01`;
      const last = addDays(first, -1);
      return { ...p, from: `${last.slice(0, 7)}-01`, to: last };
    }
    case "year": return { ...p, from: `${y}-01-01`, to: today };
    case "all": return { ...p, from: null, to: null };
    default: return { ...p, key: "30d", from: addDays(today, -29), to: today };
  }
}

const STAGE_ORDER = ["offer assigned", "offer signed", "offer sent", "verbal offer"];

/** The Podio link for a row: Podio's own, else built from the app and number. */
export function podioLink(r) {
  if (r.link) return r.link;
  const app = LEAD_APPS.find(a => a.id === Number(r.app_id));
  return app && r.app_item_id ? `https://podio.com/cashiskingcom/cash-is-king/apps/${app.slug}/items/${r.app_item_id}` : null;
}

/** Where a kicked lead has got to with the outside agent. */
export function agentStage(r) {
  if (r.agent_closed_d) return "Agent closed";
  if (r.agent_signed_d) return "Agent signed";
  if (r.agent_met_d) return "Agent met";
  if (r.agent_set_d) return "Agent set";
  const s = String(r.status || "");
  return /^(agent|listing|kicked)/i.test(s) ? s : "Kicked";
}

/* A date column arrives as midnight in the server's own time zone, so its
   day is read in that zone (toISOString would give the day before anywhere
   west of UTC). */
const pad2 = n => String(n).padStart(2, "0");
const ymd = v => (v ? (v instanceof Date
  ? `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`
  : String(v).slice(0, 10)) : null);
const num = v => (v === null || v === undefined ? null : Number(v));

/**
 * Everything the Deals tab shows, for one person ("" = everyone) and one window.
 * Throws on a database error (the API route turns that into a message).
 */
export async function dealsDashboard({ person = "", period = "30d", now = new Date() } = {}) {
  await ensurePodioTables();
  const range = periodRange(period, now);
  const from = range.from, to = range.to;
  const who = String(person || "").trim().toLowerCase().slice(0, 60) || null;
  const inHouse = who !== null && IN_HOUSE.includes(who);

  /* The six questions are independent: asked at once, the page waits for the
     slowest, not the sum. Each reads one row per lead (top of this file). */
  const LIMIT = 150;
  const [people, [tiles], board, pipeRows, closedRows, kickRows] = await Promise.all([podioPeopleRows(), sql`
    with best as (
      select distinct on (lead_key) * from podio_leads
      order by lead_key, (app_id = ${ELYSIUM_ID}) desc, edited_on desc nulls last
    ), mine as (
      select * from best
      where ${who}::text is null or lower(lead_owner) = ${who} or (${inHouse} and lower(handed_to) = ${who})
    )
    select
      count(*) filter (where lead_d   between coalesce(${from}::date, '-infinity') and coalesce(${to}::date, 'infinity'))::int as new_leads,
      count(*) filter (where sent_d   between coalesce(${from}::date, '-infinity') and coalesce(${to}::date, 'infinity'))::int as offers_sent,
      count(*) filter (where signed_d between coalesce(${from}::date, '-infinity') and coalesce(${to}::date, 'infinity'))::int as offers_signed,
      count(*) filter (where closed_d between coalesce(${from}::date, '-infinity') and coalesce(${to}::date, 'infinity'))::int as closed,
      coalesce(sum(fee) filter (where closed_d between coalesce(${from}::date, '-infinity') and coalesce(${to}::date, 'infinity')), 0)::float as fees,
      count(*) filter (where is_kick and (kicked_d between coalesce(${from}::date, '-infinity') and coalesce(${to}::date, 'infinity')
                                          or (${from}::date is null and kicked_d is null)))::int as kicked,
      count(*) filter (where lower(status) in ('verbal offer', 'offer sent', 'offer signed', 'offer assigned'))::int as in_pipeline
    from mine`,
  sql`
    with best as (
      select distinct on (lead_key) * from podio_leads
      order by lead_key, (app_id = ${ELYSIUM_ID}) desc, edited_on desc nulls last
    )
    select lead_owner as name,
      count(*) filter (where closed_d between coalesce(${from}::date, '-infinity') and coalesce(${to}::date, 'infinity'))::int as closed,
      coalesce(sum(fee) filter (where closed_d between coalesce(${from}::date, '-infinity') and coalesce(${to}::date, 'infinity')), 0)::float as fees,
      count(*) filter (where signed_d between coalesce(${from}::date, '-infinity') and coalesce(${to}::date, 'infinity'))::int as signed
    from best
    where coalesce(lead_owner, '') <> ''
    group by lead_owner`,
  sql`
    with best as (
      select distinct on (lead_key) * from podio_leads
      order by lead_key, (app_id = ${ELYSIUM_ID}) desc, edited_on desc nulls last
    )
    select item_id, app_id, app_item_id, link, name, address, lead_owner, status, handed_to, sent_d, signed_d, closing_d, edited_on
    from best
    where lower(status) in ('verbal offer', 'offer sent', 'offer signed', 'offer assigned')
      and (${who}::text is null or lower(lead_owner) = ${who} or (${inHouse} and lower(handed_to) = ${who}))
    order by edited_on desc nulls last
    limit 400`,
  sql`
    with best as (
      select distinct on (lead_key) * from podio_leads
      order by lead_key, (app_id = ${ELYSIUM_ID}) desc, edited_on desc nulls last
    )
    select item_id, app_id, app_item_id, link, name, address, lead_owner, closed_type, fee, closed_d
    from best
    where closed_d between coalesce(${from}::date, '-infinity') and coalesce(${to}::date, 'infinity')
      and (${who}::text is null or lower(lead_owner) = ${who} or (${inHouse} and lower(handed_to) = ${who}))
    order by closed_d desc, item_id desc
    limit ${LIMIT}`,
  /* Kicks belong to whoever kicked them: the Lead Owner only. */
  sql`
    with best as (
      select distinct on (lead_key) * from podio_leads
      order by lead_key, (app_id = ${ELYSIUM_ID}) desc, edited_on desc nulls last
    )
    select item_id, app_id, app_item_id, link, name, address, lead_owner, handed_to, status, kicked_d,
           agent_set_d, agent_met_d, agent_signed_d, agent_closed_d
    from best
    where is_kick
      and (kicked_d between coalesce(${from}::date, '-infinity') and coalesce(${to}::date, 'infinity')
           or (${from}::date is null and kicked_d is null))
      and (${who}::text is null or lower(lead_owner) = ${who})
    order by kicked_d desc nulls last, item_id desc
    limit ${LIMIT}`,
  ]);

  const leaderboard = board
    .map(r => ({ name: r.name, closed: Number(r.closed) || 0, fees: Number(r.fees) || 0, signed: Number(r.signed) || 0 }))
    .filter(r => r.closed || r.signed || r.fees)
    .sort((a, b) => b.closed - a.closed || b.fees - a.fees || b.signed - a.signed || a.name.localeCompare(b.name));
  const pipeline = pipeRows
    .sort((a, b) => STAGE_ORDER.indexOf(String(a.status).toLowerCase()) - STAGE_ORDER.indexOf(String(b.status).toLowerCase())
      || String(ymd(b.signed_d) || ymd(b.sent_d) || "").localeCompare(String(ymd(a.signed_d) || ymd(a.sent_d) || "")))
    .slice(0, LIMIT)
    .map(r => ({ id: String(r.item_id), name: r.name, address: r.address, owner: r.lead_owner, status: r.status,
      handedTo: r.handed_to, sent: ymd(r.sent_d), signed: ymd(r.signed_d), closing: ymd(r.closing_d), link: podioLink(r) }));
  const closed = closedRows.map(r => ({ id: String(r.item_id), name: r.name, address: r.address, owner: r.lead_owner,
    type: r.closed_type, fee: num(r.fee), date: ymd(r.closed_d), link: podioLink(r) }));
  const kicks = kickRows.map(r => ({ id: String(r.item_id), name: r.name, address: r.address, owner: r.lead_owner,
    to: r.handed_to, stage: agentStage(r), date: ymd(r.kicked_d), link: podioLink(r) }));

  const t = tiles || {};
  return {
    period: { key: range.key, label: range.label, from, to },
    periods: PERIODS,
    person: who ? (people.find(p => p.name.toLowerCase() === who)?.name || (inHouse ? who[0].toUpperCase() + who.slice(1) : person)) : "",
    people: [...people.map(p => p.name), ...IN_HOUSE.map(n => n[0].toUpperCase() + n.slice(1)).filter(n => !people.some(p => p.name.toLowerCase() === n.toLowerCase()))],
    tiles: {
      newLeads: Number(t.new_leads) || 0, offersSent: Number(t.offers_sent) || 0, offersSigned: Number(t.offers_signed) || 0,
      closed: Number(t.closed) || 0, fees: Number(t.fees) || 0, kicked: Number(t.kicked) || 0, inPipeline: Number(t.in_pipeline) || 0,
    },
    leaderboard,
    pipeline,
    closed,
    kicks,
    limit: LIMIT,
  };
}

/** The Lead Owners, busiest first. */
function podioPeopleRows() {
  return sql`
    select lead_owner as name, count(*)::int as n from podio_leads
    where coalesce(lead_owner, '') <> '' group by lead_owner order by count(*) desc`;
}

/** Everyone the "Showing" menu offers: the Lead Owners, then Jordan and Jacob
    if they are not Lead Owners themselves. Never throws (empty on error). */
export async function podioPeople() {
  try {
    await ensurePodioTables();
    const rows = await podioPeopleRows();
    return [...rows.map(p => p.name), ...IN_HOUSE.map(n => n[0].toUpperCase() + n.slice(1)).filter(n => !rows.some(p => p.name.toLowerCase() === n.toLowerCase()))];
  } catch { return []; }
}

/** Which person a signed-in user is, by first name (null if not a Lead Owner). */
export function personFor(displayName, people) {
  const first = String(displayName || "").trim().split(/\s+/)[0].toLowerCase();
  if (!first || first.includes("@")) return null;
  return (people || []).find(p => String(p).toLowerCase() === first) || null;
}
