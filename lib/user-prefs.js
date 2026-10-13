/* Settings that follow the person, not the browser (v133).
 *
 * Brandon (2026-09-30): once someone picks light or dark, Jarvis remembers it
 * on every browser and every device they sign in on, for good. They never have
 * to pick it again.
 *
 * One row per person:
 *   email       who, always from the signed-in session, never from the request
 *   theme       "dark" or "light" (null: never picked)
 *   collapsed   v141: the Agent Dashboard sections they have collapsed, as a
 *               list of section ids (null: never collapsed anything)
 *   tab         v147: the Agent Dashboard tab they were last on (null: Home)
 *   updated_at  when they last changed either
 *
 * The other display settings (text size, contrast, motion, underlined links)
 * stay per device on purpose: big text on a phone is often not wanted on a
 * big monitor.
 *
 * Reads never create the table: a page load that finds nothing saved simply
 * gets "nothing saved" (null) and falls back to this browser, then dark.
 */
import { sql as neonSql } from "./db.js";

let sql = neonSql;
/** For scripts/prefs-db-check.mjs: the same queries over a local Postgres. */
export function __setSqlForTests(f) { sql = f; ready = null; }

let ready = null;
function ensure() {
  if (!ready) {
    ready = (async () => {
      await sql`
        create table if not exists user_prefs (
          email      text        primary key,
          theme      text        check (theme in ('dark', 'light')),
          collapsed  jsonb,
          updated_at timestamptz not null default now()
        )`;
      /* v141: tables made by v133 had theme required and no collapsed. */
      await sql`alter table user_prefs add column if not exists collapsed jsonb`;
      await sql`alter table user_prefs alter column theme drop not null`;
      /* v147: the dashboard tab. */
      await sql`alter table user_prefs add column if not exists tab text`;
    })().then(() => true, e => { ready = null; throw e; });
  }
  return ready;
}

const low = v => (typeof v === "string" ? v.trim().toLowerCase() : "");
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

/** "dark" or "light", or null for anything else. */
export const cleanTheme = v => (v === "dark" || v === "light" ? v : null);

/** What this person picked, or null if they never have (or it can't be read). */
export async function getTheme(email) {
  try { return await getThemeOrThrow(email); }
  catch {
    return null;              // table not made yet, or the database is slow: this browser decides
  }
}

/** v179 (scan): the same, but a failed read throws instead of looking like
    "never picked" (which made the browser send its own old pick up and
    overwrite the account's). */
export async function getThemeOrThrow(email) {
  const who = low(email);
  if (!EMAIL.test(who)) return null;
  /* v180 (scan): no table yet (nobody has saved anything on this database)
     is "nothing saved", not a failure: it answered 503 to everyone. */
  let rows;
  try { rows = await sql`select theme from user_prefs where email = ${who}`; }
  catch (e) { if (e && e.code === "42P01") return null; throw e; }
  return rows.length ? cleanTheme(rows[0].theme) : null;
}

/** Save it. Returns the theme saved. */
export async function setTheme(email, theme) {
  const who = low(email), t = cleanTheme(theme);
  if (!EMAIL.test(who) || !t) throw new Error("bad preference");
  await ensure();
  await sql`
    insert into user_prefs (email, theme) values (${who}, ${t})
    on conflict (email) do update set theme = excluded.theme, updated_at = now()`;
  return t;
}

/* v141: collapsed dashboard sections. Section ids are short, lowercase and
   hyphenated ("new-leads"); anything else is dropped, and the list is capped. */
const SECTION_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export function cleanCollapsed(v) {
  if (!Array.isArray(v)) return null;
  return [...new Set(v.filter(x => typeof x === "string" && SECTION_ID.test(x)))].slice(0, 60);
}

/** The sections this person collapsed, or null if they never have (or it can't be read). */
export async function getCollapsed(email) {
  const who = low(email);
  if (!EMAIL.test(who)) return null;
  try {
    const rows = await sql`select collapsed from user_prefs where email = ${who}`;
    return rows.length ? cleanCollapsed(rows[0].collapsed) : null;
  } catch {
    return null;              // not made yet, or an older table: this browser decides
  }
}

/** Save which sections are collapsed. Returns the cleaned list saved. */
export async function setCollapsed(email, list) {
  const who = low(email), c = cleanCollapsed(list);
  if (!EMAIL.test(who) || !c) throw new Error("bad preference");
  await ensure();
  await sql`
    insert into user_prefs (email, collapsed) values (${who}, ${JSON.stringify(c)}::jsonb)
    on conflict (email) do update set collapsed = excluded.collapsed, updated_at = now()`;
  return c;
}

/** For the dashboard's first paint: the saved list, without holding the page up. */
export async function collapsedFor(email, waitMs = 400) {
  if (!email) return null;
  let timer;
  const late = new Promise(r => { timer = setTimeout(() => r(null), waitMs); });
  try { return await Promise.race([getCollapsed(email), late]); }
  finally { clearTimeout(timer); }
}

/** For the page's <head>: the saved theme, but never hold the page up for it. */
export async function themeFor(email, waitMs = 400) {
  if (!email) return null;
  let timer;
  const late = new Promise(r => { timer = setTimeout(() => r(null), waitMs); });
  try { return await Promise.race([getTheme(email), late]); }
  finally { clearTimeout(timer); }
}

/* v147: the Agent Dashboard's tabs (assets/dashboard.html TABS). */
export const DASH_TABS = Object.freeze(["home", "leads", "deals", "coaching", "training", "team"]);   // v166: + training
export const cleanTab = v => (DASH_TABS.includes(v) ? v : null);

/** Save the tab this person is on. Returns the tab saved. */
export async function setTab(email, tab) {
  const who = low(email), t = cleanTab(tab);
  if (!EMAIL.test(who) || !t) throw new Error("bad preference");
  await ensure();
  await sql`
    insert into user_prefs (email, tab) values (${who}, ${t})
    on conflict (email) do update set tab = excluded.tab, updated_at = now()`;
  return t;
}

/** Both dashboard settings in one read: { collapsed, tab }, or null. The tab
    is read through to_jsonb so a table made before v147 (no tab column yet)
    still gives back the collapsed list. */
export async function getDashPrefs(email) {
  const who = low(email);
  if (!EMAIL.test(who)) return null;
  try {
    const rows = await sql`select p.collapsed, to_jsonb(p) ->> 'tab' as tab from user_prefs p where p.email = ${who}`;
    return rows.length ? { collapsed: cleanCollapsed(rows[0].collapsed), tab: cleanTab(rows[0].tab) } : { collapsed: null, tab: null };
  } catch (e) {
    if (e && e.code === "42P01") return { collapsed: null, tab: null };   // v180: no table yet: nothing saved
    return null;
  }
}

/** For the dashboard's first paint, without holding the page up. */
export async function dashPrefsFor(email, waitMs = 400) {
  if (!email) return null;
  let timer;
  const late = new Promise(r => { timer = setTimeout(() => r(null), waitMs); });
  try { return await Promise.race([getDashPrefs(email), late]); }
  finally { clearTimeout(timer); }
}
