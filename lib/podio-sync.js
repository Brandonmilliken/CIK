/* Copying the six Podio lead apps into the database, a little at a time.
 *
 * WHY A COPY. The dashboard counts and ranks across every lead Cash Is King has
 * (Brandon chose "everything", 2026-10-14) — tens of thousands of items. Asking
 * Podio for all of that on each page view would take minutes and spend its rate
 * limit; asking the database takes milliseconds. So the database keeps one row
 * per Podio item (only the fields the dashboard uses, see lib/podio.js), and
 * this keeps it current.
 *
 * THREE KINDS OF RUN, per app, each picking up where the last one stopped:
 *
 *   1. FIRST LOAD ("backfill"): every item, oldest first, a page at a time.
 *      A run that reaches its time budget stops and the next run carries on
 *      from the same place (backfill_offset). Nothing is counted twice: rows
 *      are keyed by Podio's item id.
 *   2. CHANGES: once loaded, only items edited since the last run (from a day
 *      before it, so nothing slips through a clock difference).
 *   3. ONCE A DAY, REMOVALS: a lead moved to another app is a copy there and a
 *      deletion here, and Podio's filter never mentions deleted items. When the
 *      database holds more items for an app than Podio says it has, every item
 *      id is listed (resumable, like the first load) and rows Podio no longer
 *      has are removed. Until then, the dashboard's de-duplication by lead
 *      (lib/podio.js leadKey) keeps a moved lead from counting twice.
 */
import { sql as neonSql } from "./db.js";
import { filterItems, itemToRow, podioConfig, PodioError, appName } from "./podio.js";

let sql = neonSql;
export function __setSqlForTests(f) { sql = f; ready = null; }

export const PAGE = 250;
const SWEEP_PAGE = 500;
const SWEEP_OVERLAP = 100;
const SWEEP_EVERY_MS = 20 * 3600 * 1000;
/* Stop starting new pages this long before the budget ends: one page can take
   several seconds to arrive and save. */
const MARGIN_MS = 9000;

const COLS = ["item_id", "app_id", "app_item_id", "link", "name", "address", "lead_key", "lead_owner", "status",
  "handed_to", "jordan", "source", "lead_type", "closed_type", "lead_d", "sent_d", "signed_d", "closed_d",
  "closing_d", "kicked_d", "is_kick", "agent_set_d", "agent_met_d", "agent_signed_d", "agent_closed_d",
  "fee", "created_on", "edited_on"];

let ready = null;
export function ensurePodioTables() {
  if (!ready) {
    ready = (async () => {
      await sql`create table if not exists podio_leads (
        item_id        bigint primary key,
        app_id         integer not null,
        app_item_id    integer,
        link           text,
        name           text,
        address        text,
        lead_key       text not null,
        lead_owner     text,
        status         text,
        handed_to      text,
        jordan         text,
        source         text,
        lead_type      text,
        closed_type    text,
        lead_d         date,
        sent_d         date,
        signed_d       date,
        closed_d       date,
        closing_d      date,
        kicked_d       date,
        is_kick        boolean not null default false,
        agent_set_d    date,
        agent_met_d    date,
        agent_signed_d date,
        agent_closed_d date,
        fee            numeric(14,2),
        created_on     timestamptz,
        edited_on      timestamptz,
        synced_at      timestamptz not null default now()
      )`;
      await sql`create index if not exists podio_leads_key on podio_leads (lead_key)`;
      await sql`create index if not exists podio_leads_app on podio_leads (app_id)`;
      await sql`create table if not exists podio_sync_state (
        app_id           integer primary key,
        backfill_offset  integer not null default 0,
        backfill_done    boolean not null default false,
        backfill_started timestamptz,
        since            timestamptz,
        sweep_offset     integer,
        sweep_started    timestamptz,
        swept_at         timestamptz,
        podio_total      integer,
        updated_at       timestamptz not null default now()
      )`;
      /* cik-v5 review: a changes pass that doesn't finish in one run keeps its
         place (inc_offset) and the time it began (inc_started). */
      await sql`alter table podio_sync_state add column if not exists inc_offset integer`;
      await sql`alter table podio_sync_state add column if not exists inc_started timestamptz`;
      await sql`create table if not exists podio_sweep (
        app_id  integer not null,
        item_id bigint not null,
        primary key (app_id, item_id)
      )`;
      return true;
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}

/** Save a page of rows (insert new, overwrite changed). */
export async function upsertRows(rows) {
  if (!rows.length) return 0;
  const json = JSON.stringify(rows.map(r => Object.fromEntries(COLS.map(c => [c, r[c] ?? null]))));
  await sql`
    insert into podio_leads (item_id, app_id, app_item_id, link, name, address, lead_key, lead_owner, status,
      handed_to, jordan, source, lead_type, closed_type, lead_d, sent_d, signed_d, closed_d, closing_d,
      kicked_d, is_kick, agent_set_d, agent_met_d, agent_signed_d, agent_closed_d, fee, created_on, edited_on, synced_at)
    select item_id, app_id, app_item_id, link, name, address, lead_key, lead_owner, status,
      handed_to, jordan, source, lead_type, closed_type, lead_d, sent_d, signed_d, closed_d, closing_d,
      kicked_d, coalesce(is_kick, false), agent_set_d, agent_met_d, agent_signed_d, agent_closed_d, fee, created_on, edited_on, now()
    from json_populate_recordset(null::podio_leads, ${json}::json)
    on conflict (item_id) do update set
      app_id = excluded.app_id, app_item_id = excluded.app_item_id, link = excluded.link, name = excluded.name,
      address = excluded.address, lead_key = excluded.lead_key, lead_owner = excluded.lead_owner,
      status = excluded.status, handed_to = excluded.handed_to, jordan = excluded.jordan, source = excluded.source,
      lead_type = excluded.lead_type, closed_type = excluded.closed_type, lead_d = excluded.lead_d,
      sent_d = excluded.sent_d, signed_d = excluded.signed_d, closed_d = excluded.closed_d,
      closing_d = excluded.closing_d, kicked_d = excluded.kicked_d, is_kick = excluded.is_kick,
      agent_set_d = excluded.agent_set_d, agent_met_d = excluded.agent_met_d,
      agent_signed_d = excluded.agent_signed_d, agent_closed_d = excluded.agent_closed_d, fee = excluded.fee,
      created_on = excluded.created_on, edited_on = excluded.edited_on, synced_at = now()`;
  return rows.length;
}

async function loadState(appId) {
  const rows = await sql`select * from podio_sync_state where app_id = ${appId}`;
  if (rows[0]) return rows[0];
  await sql`insert into podio_sync_state (app_id) values (${appId}) on conflict (app_id) do nothing`;
  return (await sql`select * from podio_sync_state where app_id = ${appId}`)[0];
}

async function saveState(appId, s) {
  await sql`update podio_sync_state set
      backfill_offset = ${s.backfill_offset}, backfill_done = ${s.backfill_done},
      backfill_started = ${s.backfill_started}, since = ${s.since},
      sweep_offset = ${s.sweep_offset ?? null}, sweep_started = ${s.sweep_started ?? null},
      swept_at = ${s.swept_at ?? null}, podio_total = ${s.podio_total ?? null},
      inc_offset = ${s.inc_offset ?? null}, inc_started = ${s.inc_started ?? null}, updated_at = now()
    where app_id = ${appId}`;
}

const iso = d => (d instanceof Date ? d : new Date(d)).toISOString();

/**
 * One run, inside `budgetMs`. Never leaves a half-saved page: each page is saved
 * and its place recorded before the next is asked for. Throws on a Podio error
 * (the caller records it, and waits before trying again).
 */
export async function syncPodio({ budgetMs = 45000, cfg = podioConfig(), fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (!cfg.ok) {
    return { configured: false, missing: cfg.missing, hasKey: cfg.hasKey };
  }
  await ensurePodioTables();
  const deadline = now() + budgetMs;
  const timeLeft = () => deadline - now() > MARGIN_MS;
  const out = { configured: true, apps: {}, partial: false, missing: cfg.missing };
  /* Each Podio call may take only what is left of the budget (less a few
     seconds to save the page), so a slow answer can't carry the run past the
     function's time limit. */
  const opts = () => ({ cfg, fetchImpl, timeoutMs: Math.max(3000, Math.min(25000, deadline - now() - 3000)) });

  for (const app of cfg.apps) {
    const s = { ...(await loadState(app.id)) };
    const rep = out.apps[app.name] = { saved: 0 };

    /* 1. First load. */
    if (!s.backfill_done) {
      if (!s.backfill_started) s.backfill_started = iso(now());
      while (timeLeft()) {
        const page = await filterItems(app.id, { limit: PAGE, offset: s.backfill_offset, sort_by: "created_on", sort_desc: false }, opts());
        rep.saved += await upsertRows(page.items.map(it => itemToRow(it, app.id)));
        s.backfill_offset += page.items.length;
        s.podio_total = page.total;
        if (page.items.length < PAGE) {
          s.backfill_done = true;
          /* Edits made while the first load was running are caught next time. */
          s.since = s.backfill_started;
        }
        await saveState(app.id, s);
        if (s.backfill_done) break;
      }
      rep.firstLoad = s.backfill_done ? "done" : `${s.backfill_offset} of ${s.podio_total ?? "?"}`;
      if (!s.backfill_done) { out.partial = true; break; }
      continue;
    }

    /* 2. Changes since the last run, a page at a time, the place saved after
       each page (a busy day can hold more changes than one run can fetch). An
       item edited mid-pass moves to the end of the list and is fetched there;
       the one it shifts past is fetched by the next pass, which starts a day
       before this one did. */
    if (!timeLeft()) { out.partial = true; break; }
    if (!s.inc_started) { s.inc_started = iso(now()); s.inc_offset = 0; }
    const from = new Date(new Date(s.since || s.backfill_started || s.inc_started).getTime() - 26 * 3600 * 1000).toISOString().slice(0, 10);
    let complete = false;
    while (timeLeft()) {
      const page = await filterItems(app.id, { limit: PAGE, offset: s.inc_offset, sort_by: "last_edit_on", sort_desc: false, filters: { last_edit_on: { from } } }, opts());
      rep.saved += await upsertRows(page.items.map(it => itemToRow(it, app.id)));
      s.inc_offset += page.items.length;
      if (page.items.length < PAGE) { complete = true; s.since = s.inc_started; s.inc_started = null; s.inc_offset = null; }
      await saveState(app.id, s);
      if (complete) break;
    }
    if (!complete) { out.partial = true; break; }

    /* 3. Removals, once a day. */
    const sweptAgo = s.swept_at ? now() - new Date(s.swept_at).getTime() : Infinity;
    if (s.sweep_started || sweptAgo > SWEEP_EVERY_MS) {
      rep.removed = await sweep(app, s, { opts, timeLeft, now });
      if (rep.removed === null) { out.partial = true; break; }
    }
  }
  return out;
}

/* Returns how many rows went, or null if it ran out of time (it resumes). */
async function sweep(app, s, { opts, timeLeft, now }) {
  if (!s.sweep_started) {
    if (!timeLeft()) return null;
    const probe = await filterItems(app.id, { limit: 1, offset: 0 }, opts());
    const ours = Number((await sql`select count(*)::int as n from podio_leads where app_id = ${app.id}`)[0].n);
    s.podio_total = probe.total;
    /* Fewer here than in Podio: the first load paged by position, and a lead
       moved out of the app while it ran shifts every later item up one, so one
       can be stepped over. Load the app again from the start (saving is by
       item id, so this only fills gaps). */
    if (ours < probe.total) {
      s.backfill_done = false; s.backfill_offset = 0; s.backfill_started = iso(now()); s.swept_at = iso(now());
      await saveState(app.id, s);
      return 0;
    }
    if (ours === probe.total) {
      s.swept_at = iso(now());
      await saveState(app.id, s);
      return 0;
    }
    await sql`delete from podio_sweep where app_id = ${app.id}`;
    s.sweep_started = iso(now());
    s.sweep_offset = 0;
    await saveState(app.id, s);
  }
  while (timeLeft()) {
    const page = await filterItems(app.id, { limit: SWEEP_PAGE, offset: s.sweep_offset, sort_by: "created_on", sort_desc: false }, opts());
    const ids = page.items.map(i => Number(i.item_id)).filter(Number.isFinite);
    if (ids.length) {
      await sql`insert into podio_sweep (app_id, item_id)
                select ${app.id}, unnest(${ids}::bigint[]) on conflict do nothing`;
    }
    /* Pages overlap by SWEEP_OVERLAP: a lead moved out of the app between two
       pages shifts every later item up one place, and without the overlap
       the item at the seam would be missed here and wrongly removed. */
    s.sweep_offset += page.items.length < SWEEP_PAGE ? page.items.length : SWEEP_PAGE - SWEEP_OVERLAP;
    if (page.items.length < SWEEP_PAGE) {
      /* Every id Podio has is listed: anything else is gone. Items created
         after the listing began are kept (they may not have been listed). */
      const gone = await sql`
        delete from podio_leads l
        where l.app_id = ${app.id}
          and (l.created_on is null or l.created_on < ${s.sweep_started}::timestamptz)
          and not exists (select 1 from podio_sweep w where w.app_id = l.app_id and w.item_id = l.item_id)
        returning l.item_id`;
      await sql`delete from podio_sweep where app_id = ${app.id}`;
      s.sweep_started = null; s.sweep_offset = null; s.swept_at = iso(now());
      await saveState(app.id, s);
      return gone.length;
    }
    await saveState(app.id, s);
  }
  return null;
}

/** For the page: how far the first load has got, per app. Never throws. */
export async function podioSyncProgress() {
  try {
    await ensurePodioTables();
    const rows = await sql`
      select s.app_id, s.backfill_done, s.backfill_offset, s.podio_total, s.since,
             (select count(*)::int from podio_leads l where l.app_id = s.app_id) as stored
      from podio_sync_state s`;
    return rows.map(r => ({ app: appName(r.app_id), appId: Number(r.app_id), done: r.backfill_done,
      loaded: Number(r.stored) || 0, total: r.podio_total === null ? null : Number(r.podio_total), since: r.since }));
  } catch { return []; }
}

/** True while a run stopped part-way (a changes pass or a removal sweep left
    mid-list), so the next page view should carry it on rather than wait. */
export async function podioCatchingUp(cfg = podioConfig()) {
  if (!cfg.ok) return false;
  try {
    await ensurePodioTables();
    const rows = await sql`select 1 from podio_sync_state where inc_started is not null or sweep_started is not null limit 1`;
    return rows.length > 0 || await podioFirstLoadPending(cfg);
  } catch { return false; }
}

/** True while any configured app has not finished its first load. */
export async function podioFirstLoadPending(cfg = podioConfig()) {
  if (!cfg.ok) return false;
  try {
    await ensurePodioTables();
    const rows = await sql`select app_id from podio_sync_state where backfill_done`;
    const done = new Set(rows.map(r => Number(r.app_id)));
    return cfg.apps.some(a => !done.has(a.id));
  } catch { return false; }
}

export { PodioError };
