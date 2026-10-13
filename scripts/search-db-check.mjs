/* search-db-check.mjs — v146: Jarvis search on a real Postgres.
 * TEST_PG_URL=postgres://user:pass@localhost/jarvis_test node scripts/search-db-check.mjs
 * It DROPS office_items in that database first. Never point it at Neon. */
import pg from "pg";
const url = process.env.TEST_PG_URL;
if (!url || /neon\.tech|vercel-storage/.test(url)) { console.log("Set TEST_PG_URL.\n\nsearch-db: 0 passed, 1 failed"); process.exit(1); }
process.env.DATABASE_URL ||= "postgresql://test:test@localhost.invalid/test";
const pool = new pg.Pool({ connectionString: url, max: 4 });
function sql(strings, ...vals) {
  let text = ""; strings.forEach((s, i) => { text += s; if (i < vals.length) text += `$${i + 1}`; });
  const run = (c = pool) => c.query(text, vals).then(r => r.rows);
  return { run, then: (res, rej) => run().then(res, rej) };
}
const m = await import("../lib/search.js");
m.__setSqlForTests(sql);
let p = 0, f = 0;
const ok = (c, msg) => { c ? p++ : (f++, console.log("  FAIL:", msg)); };
try {
  await pool.query("drop table if exists office_items");
  await pool.query("create table office_items (id bigserial primary key, room text not null, position int not null default 0, fields jsonb not null)");
  const add = (room, fields) => pool.query("insert into office_items (room, fields) values ($1, $2)", [room, JSON.stringify(fields)]);
  await add("vendors", { name: "Acme Roofing", category: "Roofing", description: "Fast quotes in Portland" });
  await add("vendors", { name: "Portland Plumbing", category: "Plumbing" });
  await add("admin-links", { name: "Payroll portal", url: "https://payroll.example.com" });
  await add("admin-links", { name: "Roofing intake for admins", url: "https://intake.example.com", description: "how we log vendors" });
  await add("lead-generation~scripts", { name: "Expired listing script", category: "Seller" });
  await add("vendors", { name: "50% Off Movers", category: "Moving" });

  let r = await m.searchItems("roofing", "agent");
  ok(r.length === 1 && r[0].title === "Acme Roofing" && r[0].room === "vendors" && r[0].roomLabel === "Vendors", "an agent finds the vendor, and nothing from admin rooms");
  r = await m.searchItems("roofing", "admin");
  ok(r.length === 2 && r.some(x => x.room === "admin-links"), "an admin also finds the admin-only link");
  r = await m.searchItems("portland", "agent");
  ok(r[0].title === "Portland Plumbing" && r[1].title === "Acme Roofing" && r[1].where === "Notes", "matches in the name come first; others say where they matched (the vendor's Notes)");
  r = await m.searchItems("payroll", "agent");
  ok(r.length === 0, "an agent can't find what's in Admin Links");
  r = await m.searchItems("expired", "agent");
  ok(r.length === 1 && r[0].room === "lead-generation", "an item in a second list opens its room");
  r = await m.searchItems("50%", "agent");
  ok(r.length === 1 && r[0].title === "50% Off Movers", "a % in the search is a real %, not a wildcard");
  r = await m.searchItems("'; drop table office_items; --", "admin");
  ok(Array.isArray(r) && (await pool.query("select count(*)::int n from office_items")).rows[0].n === 6, "search words are only ever data");
  ok((await m.searchItems("a", "admin")).length === 0, "one letter searches nothing");
  r = await m.searchItems("payroll.example", "admin");
  ok(r.length === 0, "a match only inside a web address doesn't count");
  /* v178: 1,100 link-only matches in a room early in the alphabet must not
     crowd out a title match in a later room. */
  await pool.query(`insert into office_items (room, position, fields)
    select 'admin-links', g, jsonb_build_object('name', 'Link ' || g, 'url', 'https://zebra.example/' || g) from generate_series(1, 1100) g`);
  await add("vendors", { name: "Zebra Movers", category: "Moving" });
  r = await m.searchItems("zebra", "admin");
  ok(r.length === 1 && r[0].title === "Zebra Movers", "v178: a name match still comes back when many link-only matches come first");
} catch (e) { f++; console.log("  FAIL:", e.message); }
finally { await pool.query("drop table if exists office_items").catch(() => {}); await pool.end(); }
console.log(`\nsearch-db: ${p} passed, ${f} failed`);
if (f) process.exit(1);
