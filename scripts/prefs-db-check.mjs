/* prefs-db-check.mjs — v133: the saved theme, on a real Postgres.
 * TEST_PG_URL=postgres://user:pass@localhost/jarvis_test node scripts/prefs-db-check.mjs
 * It DROPS user_prefs in that database first. Never point it at Neon. */
import pg from "pg";
const url = process.env.TEST_PG_URL;
if (!url || /neon\.tech|vercel-storage/.test(url)) { console.log("Set TEST_PG_URL.\n\nprefs-db: 0 passed, 1 failed"); process.exit(1); }
process.env.DATABASE_URL ||= "postgresql://test:test@localhost.invalid/test";
const pool = new pg.Pool({ connectionString: url, max: 4 });
function sql(strings, ...vals) {
  let text = ""; strings.forEach((s, i) => { text += s; if (i < vals.length) text += `$${i + 1}`; });
  const run = (c = pool) => c.query(text, vals).then(r => r.rows);
  return { run, then: (res, rej) => run().then(res, rej) };
}
const m = await import("../lib/user-prefs.js");
m.__setSqlForTests(sql);
let p = 0, f = 0;
const ok = (c, msg) => { c ? p++ : (f++, console.log("  FAIL:", msg)); };
try {
  await pool.query("drop table if exists user_prefs");
  ok(await m.getTheme("andy@matinrealestate.com") === null, "before the table exists, a read is just 'nothing saved' (no error, no table made)");
  ok((await pool.query("select to_regclass('user_prefs') as t")).rows[0].t === null, "reading never creates the table");
  ok(await m.setTheme("Andy@MatinRealEstate.com", "light") === "light", "a pick is saved");
  ok(await m.getTheme("andy@matinrealestate.com") === "light", "and read back by email, any case");
  await m.setTheme("andy@matinrealestate.com", "dark");
  const rows = (await pool.query("select * from user_prefs")).rows;
  ok(rows.length === 1 && rows[0].theme === "dark" && rows[0].email === "andy@matinrealestate.com", "picking again replaces it: one row per person");
  ok(await m.getTheme("leona@matinrealestate.com") === null, "someone who never picked has nothing saved");
  let threw = 0;
  for (const [e, t] of [["a@b.co", "neon"], ["not-an-email", "dark"], ["a@b.co", ""]]) { try { await m.setTheme(e, t); } catch { threw++; } }
  ok(threw === 3, "only dark or light, and only for a real email");
  let refused = false;
  try { await pool.query("insert into user_prefs (email, theme) values ('x@y.co', 'blue')"); } catch { refused = true; }
  ok(refused, "the database itself refuses any other theme");
  /* v141: collapsed sections */
  ok(await m.getCollapsed("andy@matinrealestate.com") === null, "nothing collapsed yet: null, not an empty list");
  ok(JSON.stringify(await m.setCollapsed("Andy@MatinRealEstate.com", ["new-leads", "todo", "new-leads", "<x>", 5])) === '["new-leads","todo"]', "a collapsed list is saved, cleaned and without repeats");
  ok(JSON.stringify(await m.getCollapsed("andy@matinrealestate.com")) === '["new-leads","todo"]' && await m.getTheme("andy@matinrealestate.com") === "dark", "read back by email, and the theme is untouched");
  ok(JSON.stringify(await m.setCollapsed("leona@matinrealestate.com", ["income"])) === '["income"]' && await m.getTheme("leona@matinrealestate.com") === null, "someone who never picked a theme can still save folds");
  await m.setCollapsed("andy@matinrealestate.com", []);
  ok(JSON.stringify(await m.getCollapsed("andy@matinrealestate.com")) === "[]", "opening everything saves an empty list");
  await pool.query("drop table user_prefs");
  await pool.query("create table user_prefs (email text primary key, theme text not null check (theme in ('dark','light')), updated_at timestamptz not null default now())");
  await pool.query("insert into user_prefs (email, theme) values ('old@matinrealestate.com', 'light')");
  m.__setSqlForTests(sql);
  ok(await m.getCollapsed("old@matinrealestate.com") === null, "a v133 table without the column reads as nothing collapsed");
  await pool.query("alter table user_prefs add column collapsed jsonb");
  await pool.query("update user_prefs set collapsed = '[\"todo\"]'::jsonb where email = 'old@matinrealestate.com'");
  m.__setSqlForTests(sql);
  const pre = await m.getDashPrefs("old@matinrealestate.com");
  ok(pre && JSON.stringify(pre.collapsed) === '["todo"]' && pre.tab === null, "v147: a table with no tab column yet still gives back the folds (tab: null)");
  await pool.query("update user_prefs set collapsed = null");
  ok(JSON.stringify(await m.setCollapsed("new@matinrealestate.com", ["todo"])) === '["todo"]' && await m.getTheme("old@matinrealestate.com") === "light", "and saving upgrades it in place, keeping saved themes");
  /* v147: the dashboard tab */
  ok(await m.setTab("New@MatinRealEstate.com", "leads") === "leads", "v147: a tab is saved");
  const dp = await m.getDashPrefs("new@matinrealestate.com");
  ok(dp.tab === "leads" && JSON.stringify(dp.collapsed) === '["todo"]', "read back with the folds untouched");
  let bad = 0;
  for (const t of ["admin", "", null, "Leads", "home; drop"]) { try { await m.setTab("new@matinrealestate.com", t); } catch { bad++; } }
  ok(bad === 5 && (await m.getDashPrefs("new@matinrealestate.com")).tab === "leads", "only the five tab names are saved");
  ok(JSON.stringify(await m.getDashPrefs("nobody@matinrealestate.com")) === '{"collapsed":null,"tab":null}', "someone with nothing saved: both null");
  ok(await m.getDashPrefs("not-an-email") === null && await m.dashPrefsFor(null) === null, "no email, no read");
  await m.setTheme("andy@matinrealestate.com", "dark");
  ok(await m.themeFor(null) === null && await m.themeFor("andy@matinrealestate.com") === "dark", "themeFor: the saved theme, or nothing when signed out");
  m.__setSqlForTests(() => new Promise(() => {}));            // a database that never answers
  const t0 = Date.now();
  ok(await m.themeFor("andy@matinrealestate.com", 150) === null && Date.now() - t0 < 1000, "a slow database never holds the page up");
  const t1 = Date.now();
  ok(await m.dashPrefsFor("andy@matinrealestate.com", 150) === null && Date.now() - t1 < 1000, "v147: nor does the tab and folds read");
} catch (e) { f++; console.log("  FAIL:", e.message); }
finally { await pool.query("drop table if exists user_prefs").catch(() => {}); await pool.end(); }
console.log(`\nprefs-db: ${p} passed, ${f} failed`);
if (f) process.exit(1);
