/* office-db-check.mjs — run the CIK Office list store against a REAL Postgres.
 *
 * office-list.test.mjs checks the rules by reading the code. This runs the SQL:
 * the partial unique index, the ON CONFLICT clause that has to name it, the
 * jsonb_array_elements import, the jsonb_to_recordset renumber. (Jarvis's
 * file rooms, its bundled Tech Stack seed, and the Directory and Asana syncs
 * did not come over to CIK Office, so their blocks are gone from here.) Those are the
 * lines most likely to be wrong and least visible by reading.
 *
 * It needs a throwaway database, so it is not part of `npm test`:
 *   npm i --no-save pg
 *   TEST_PG_URL=postgres://user:pass@localhost/jarvis_test node scripts/office-db-check.mjs
 * It DROPS the office_* tables in that database first. Never point it at Neon.
 *
 * The store talks to Neon's HTTP driver, whose `sql` is a tagged template with a
 * .transaction([...]) method. This hands it a stand-in with the same shape
 * over node-postgres, so the store's own code runs unchanged.
 */
import pg from "pg";

const url = process.env.TEST_PG_URL;
if (!url || /neon\.tech|vercel-storage/.test(url)) {
  console.log("Set TEST_PG_URL to a throwaway local database. Refusing to run against Neon.");
  console.log("\noffice-db: 0 passed, 1 failed");
  process.exit(1);
}
process.env.DATABASE_URL ||= "postgresql://test:test@localhost.invalid/test";

const pool = new pg.Pool({ connectionString: url, max: 6 });
let failTxAt = -1;   // make the next transaction throw before its Nth statement

function sql(strings, ...vals) {
  let text = "";
  strings.forEach((s, i) => { text += s; if (i < vals.length) text += `$${i + 1}`; });
  const run = (c = pool) => c.query(text, vals).then(r => r.rows);
  return { run, then: (res, rej) => run().then(res, rej) };
}
sql.transaction = async (queries) => {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const out = [];
    for (let i = 0; i < queries.length; i++) {
      if (i === failTxAt) { failTxAt = -1; throw new Error("injected failure inside the transaction"); }
      out.push(await queries[i].run(c));
    }
    await c.query("commit");
    return out;
  } catch (e) { await c.query("rollback"); throw e; }
  finally { c.release(); }
};

const store = await import("../lib/office-store.js");
const { listItems, createItem, updateItem, deleteItem, moveItem, ensureOfficeSchema, OfficeInputError, importItems, roomState, addFileItem, fileItem, replaceFileItem, fileByOriginPath } = store;
const { fingerprint } = await import("../lib/office-fields.js");
const { roomBySlug, ALL_ROOMS } = await import("../lib/office-rooms.js");
/* A room not moved yet. None in CIK Office (every room is here from day one). */
const WAITING = ALL_ROOMS.find(r => r.where !== "jarvis")?.slug || "no-such-room";

let p = 0, f = 0;
const ok = (c, m) => { c ? p++ : (f++, console.log("  FAIL:", m)); };
const rejects = async (fn, pred, m) => {
  try { await fn(); ok(false, m + " (it did not throw)"); }
  catch (e) { ok(pred(e), m + ` (threw: ${e.message})`); }
};
const reset = async () => {
  await pool.query("drop table if exists office_ticket_replies, office_items, office_seeds, office_changes, office_settings, office_tickets");
  store.__setSqlForTests(sql);
};
const q = (t, v) => pool.query(t, v).then(r => r.rows);
const ME = "brandon@cashisking.com";

try {
  /* ---- a room with no seed: its first read marks it, exactly once --------- */
  /* CIK Office has no bundled seeds: a room that is not filled by the import
     starts empty, and its first read records that (so it is not asked again). */
  await reset();
  const R = "marketing";
  const [a, b, c] = await Promise.all([listItems(R), listItems(R), listItems(R)]);
  ok(a.length === 0 && b.length === 0 && c.length === 0, "three simultaneous first visits see an empty room");
  const seeds = await q("select * from office_seeds");
  ok(seeds.length === 1 && seeds[0].room === R && seeds[0].item_count === 0, "and it is recorded once, as empty");
  ok((await q("select count(*)::int n from office_items"))[0].n === 0, "and nothing is stored");

  /* ---- a first read that fails halfway leaves no mark, and retries -------- */
  await reset();
  await ensureOfficeSchema();
  failTxAt = 1;
  await rejects(() => listItems(R), e => /injected/.test(e.message), "a failure inside the first read surfaces");
  ok((await q("select count(*)::int n from office_seeds"))[0].n === 0,
     "and the marker was rolled back with it, so it is not recorded as done");
  ok((await listItems(R)).length === 0 && (await q("select count(*)::int n from office_seeds"))[0].n === 1, "the next visit records it properly");
  for (let k = 1; k <= 14; k++) await createItem(R, { name: `Asset ${k}`, format: "PDF", description: "", url: `https://assets.example/${k}` }, ME);
  ok((await listItems(R)).length === 14, "fourteen assets added by hand");

  /* ---- add ----------------------------------------------------------------- */
  const added = await createItem(R, { name: "Canva", url: "https://www.canva.com/", description: "Design" }, ME);
  let list = await listItems(R);
  ok(list.length === 15 && list[14].id === added.id && list[14].fields.name === "Canva", "a new tool is added at the end");
  await rejects(() => createItem(R, { name: "Bad", url: "javascript:alert(1)" }, ME),
    e => e instanceof OfficeInputError && e.errors.url, "a script link is refused by the store too, not only the page");
  await rejects(() => createItem(R, { name: "" }, ME),
    e => e instanceof OfficeInputError && e.errors.name, "a tool with no name is refused");
  await rejects(() => createItem(WAITING, { name: "X" }, ME), e => /not a list room/.test(e.message),
    "a room that has not moved cannot be written to");
  ok((await listItems(R)).length === 15, "and none of the refused writes stored anything");

  /* ---- change -------------------------------------------------------------- */
  await updateItem(R, added.id, { name: "Canva Pro", url: "", description: "Design, with a line\nbreak" }, ME);
  list = await listItems(R);
  const changed = list.find(i => i.id === added.id);
  ok(changed.fields.name === "Canva Pro" && changed.fields.url === "" && changed.fields.description.includes("\n"),
     "a change is saved, including clearing the link and keeping a line break");
  await rejects(() => updateItem(R, "999999", { name: "Ghost" }, ME),
    e => e.status === 404, "changing an item that does not exist is a 404, not a silent success");
  for (const bad of ["1; drop table office_items", "0", "-1", "1.5", "", "abc"]) {
    await rejects(() => updateItem(R, bad, { name: "X" }, ME), e => e.status === 404, `a malformed id is refused: ${JSON.stringify(bad)}`);
  }

  /* ---- one room's URL cannot reach another room's item --------------------- */
  const other = (await q(`insert into office_items (room, position, fields) values ('some-other-room', 10, '{"name":"Theirs"}') returning id`))[0].id;
  await rejects(() => updateItem(R, String(other), { name: "Hijacked" }, ME), e => e.status === 404,
    "an item from another room cannot be changed through Marketing");
  await rejects(() => deleteItem(R, String(other), ME), e => e.status === 404,
    "nor deleted through it");
  ok((await q("select fields from office_items where id = $1", [other]))[0].fields.name === "Theirs", "and it is untouched");

  /* ---- move ---------------------------------------------------------------- */
  list = await listItems(R);
  ok((await moveItem(R, list[0].id, "up", ME)).moved === false, "the first item cannot move up");
  ok((await moveItem(R, list[list.length - 1].id, "down", ME)).moved === false, "the last cannot move down");
  await moveItem(R, list[1].id, "up", ME);
  let after = await listItems(R);
  ok(after[0].id === list[1].id && after[1].id === list[0].id, "moving the second item up swaps the first two");
  const pos = (await q("select position from office_items where room = 'marketing' order by position")).map(r => r.position);
  ok(pos.every((x, i) => x === (i + 1) * 10), "positions are renumbered 10, 20, 30… with no ties");
  await q("update office_items set position = 50 where room = 'marketing'");   // every item tied
  const tied = await listItems(R);
  await moveItem(R, tied[3].id, "up", ME);
  after = await listItems(R);
  ok(after[2].id === tied[3].id, "a move still works when every item is tied, and heals the ties");
  await rejects(() => moveItem(R, tied[0].id, "sideways", ME), e => e instanceof OfficeInputError, "only up or down");

  /* ---- delete -------------------------------------------------------------- */
  await deleteItem(R, added.id, ME);
  ok(!(await listItems(R)).some(i => i.id === added.id), "a deleted tool is gone");
  await rejects(() => deleteItem(R, added.id, ME), e => e.status === 404, "deleting it twice is a 404");

  /* ---- the change log ------------------------------------------------------ */
  const log = await q("select action, actor_email, before, after from office_changes where room = 'marketing' order by id");
  const acts = log.map(r => r.action);
  ok(["create", "update", "move", "delete"].every(a => acts.includes(a)), `every kind of change is logged (${[...new Set(acts)].join(", ")})`);
  ok(log.every(r => r.actor_email === ME), "with who made it");
  const upd = log.find(r => r.action === "update");
  ok(upd.before.name === "Canva" && upd.after.name === "Canva Pro", "and what the item looked like before and after");
  ok(log.find(r => r.action === "delete").after === null, "a delete keeps the deleted item's contents in `before`");
  ok(log.length === acts.filter(a => ["create", "update", "move", "delete"].includes(a)).length &&
     !log.some(r => r.action === "update" && r.before?.name === "Ghost"), "refused changes are not logged as changes");

  /* ---- emptying the room does not refill it -------------------------------- */
  for (const it of await listItems(R)) await deleteItem(R, it.id, ME);
  ok((await listItems(R)).length === 0, "delete every tool and the room stays empty; the old copy does not creep back");

  /* ---- the size limit ------------------------------------------------------ */
  await q(`insert into office_items (room, position, fields)
           select 'marketing', g * 10, jsonb_build_object('name', 'T' || g) from generate_series(1, $1) g`, [store.MAX_ITEMS_PER_ROOM]);
  await rejects(() => createItem(R, { name: "One too many" }, ME), e => e instanceof OfficeInputError,
    `a room holding ${store.MAX_ITEMS_PER_ROOM} items refuses another`);

  /* ---- v83: the one-time import from CIK Office ----------------------------- */
  await reset();
  const gspec = roomBySlug("gis").list.fields;
  const maps = [
    { originId: "g1", fields: { name: "Clackamas", url: "https://cmap.clackamas.us/maps/", state: "Oregon", note: "Oregon" } },
    { originId: "g2", fields: { name: "Gresham", url: "https://gis.greshamoregon.gov/GreshamMap/?a=1&b=two", state: "Oregon", note: "Multnomah County" } },
    { originId: "g3", fields: { name: "Clark", url: "https://gis.clark.wa.gov/x", state: "Washington", note: "" } },
    { originId: "g4", fields: { name: "Multnomah", url: "https://www3.multco.us/H5V/", state: "Oregon", note: "Multnomah County" } },
  ];
  ok((await roomState("gis")).imported === false, "before the import, GIS says it is waiting");
  ok((await listItems("gis")).length === 0, "and has no items");
  ok((await roomState("gis")).imported === false, "and opening it did not mark it done");

  await rejects(() => importItems("gis", [...maps.slice(0, 1), { originId: "bad", fields: { name: "X", url: "javascript:alert(1)", state: "Oregon" } }], ME),
    e => e.errors?.problems?.some(p => p.originId === "bad" && p.field === "url"), "one bad item refuses the whole import, and names it");
  await rejects(() => importItems("gis", [{ originId: "sp", fields: { name: "Trailing ", url: "https://a.example/", state: "Oregon", note: "" } }], ME),
    e => e.errors?.problems?.some(p => p.field === "name" && /cleaning/.test(p.error)), "an item cleaning would change is refused, not tidied");
  await rejects(() => importItems("gis", [maps[0], maps[0]], ME),
    e => e.errors?.problems?.some(p => p.error === "duplicate"), "a duplicated CIK Office id is refused");
  await rejects(() => importItems("gis", [{ fields: maps[0].fields }], ME),
    e => e.errors?.problems?.some(p => p.field === "originId"), "an item with no CIK Office id is refused");
  await rejects(() => importItems("gis", [], ME), e => e instanceof OfficeInputError, "an empty import is refused");
  await rejects(() => importItems("marketing", maps, ME), e => e.status === 409, "a room that is not an import room cannot be imported into");
  ok((await q("select count(*)::int n from office_items where room = 'gis'"))[0].n === 0 &&
     (await roomState("gis")).imported === false, "and none of those refusals wrote anything");

  failTxAt = 2;
  await rejects(() => importItems("gis", maps, ME), e => /injected/.test(e.message), "a failure inside the import surfaces");
  ok((await q("select count(*)::int n from office_items where room = 'gis'"))[0].n === 0 &&
     (await roomState("gis")).imported === false, "and rolls back completely: no items, not marked done");

  const r1 = await importItems("gis", maps, ME);
  ok(r1.imported === 4, "the import stores every item");
  ok(r1.fingerprint === await fingerprint(gspec, maps.map(m => m.fields)),
     "and its fingerprint matches one computed from the source, so the copy is exact");
  const gl = await listItems("gis");
  ok(gl.map(i => i.fields.name).join() === "Clackamas,Gresham,Clark,Multnomah", "in the order it was sent");
  ok(gl[1].fields.url === maps[1].fields.url, "a link keeps its query string exactly");
  ok((await roomState("gis")).imported === true && (await roomState("gis")).count === 4, "the room now says it is filled");
  const ilog = await q("select count(*)::int n from office_changes where room = 'gis' and action = 'create' and actor_email = $1", [ME]);
  ok(ilog[0].n === 4, `each imported item is in the change log, with who ran the import (${ilog[0].n})`);
  await rejects(() => importItems("gis", maps, ME), e => e.status === 409, "running the import again is refused");
  ok((await listItems("gis")).length === 4, "and changes nothing");

  const both = await Promise.allSettled([importItems("resources", [{ originId: "r1", fields: { name: "W-9", url: "https://drive.google.com/file/d/x/view", category: "Resources" } }], ME),
                                         importItems("resources", [{ originId: "r1", fields: { name: "W-9", url: "https://drive.google.com/file/d/x/view", category: "Resources" } }], ME)]);
  ok((await listItems("resources")).length === 1, "two imports racing each other still store one copy");
  ok(both.filter(b => b.status === "fulfilled").length >= 1, "and at least one of them reports success");

  /* ---- moving within a group --------------------------------------------- */
  // GIS order is Clackamas(OR), Gresham(OR), Clark(WA), Multnomah(OR)
  await moveItem("gis", gl[3].id, "up", ME);   // Multnomah up: skips Clark, swaps with Gresham
  const gm = (await listItems("gis")).map(i => i.fields.name).join();
  ok(gm === "Clackamas,Multnomah,Clark,Gresham", `"up" moves within the item's own group (${gm})`);
  const gl2 = await listItems("gis");
  ok((await moveItem("gis", gl2[2].id, "up", ME)).moved === false, "the only Washington map has nowhere to move");

  /* ---- v86: the Directory, imported once and then kept by hand ------------- */
  {
    const D = roomBySlug("directory").list.fields;
    const people = [
      { originId: "p1", fields: { name: "Ava Lead", title: "Owner", email: "ava@example.com", phone: "503-555-0101", secondaryPhone: "", group: "Leadership" } },
      { originId: "p2", fields: { name: "Cara Coord", title: "Transaction Coordinator", email: "cara@example.com / desk@example.com", phone: "503-555-0103", secondaryPhone: "503-555-0199", group: "Support Staff" } },
      { originId: "p3", fields: { name: "Dan Deals", title: "Acquisitions", email: "dan@example.com", phone: "", secondaryPhone: "", group: "Acquisitions" } },
    ];
    ok((await roomState("directory")).imported === false, "the Directory waits for its copy");
    const imp = await importItems("directory", people, ME);
    ok(imp.imported === 3 && imp.fingerprint === await fingerprint(D, people.map(x => x.fields)), "the Directory's copy stores every person, exactly");
    const added = await createItem("directory", { name: "Eli New", title: "Outside Sales", email: "eli@example.com", phone: "360-555-0110", group: "Outside Sales" }, ME);
    const now = await listItems("directory");
    ok(now.length === 4 && now[3].id === added.id, "after that, admins keep it up to date by hand");
    await rejects(() => importItems("directory", people, ME), e => e.status === 409, "and the copy can't run again over their changes");
  }

  /* ---- v88: Vendors, a category outside the list, and Preferred ------------ */
  {
    const V = roomBySlug("vendors").list.fields;
    const vend = [
      { originId: "v1", fields: { name: "Acme Roofing", category: "Roofers", area: "Portland", phone: "503-555-0100", email: "a@acme.example", website: "https://acme.example/", description: "Fast quotes.", preferred: "yes" } },
      { originId: "v2", fields: { name: "Blue Gutters", category: "Gutters", area: "", phone: "", email: "", website: "", description: "", preferred: "no" } },
    ];
    const r = await importItems("vendors", vend, ME);
    ok(r.imported === 2 && r.fingerprint === await fingerprint(V, vend.map(v => v.fields)),
       "Vendors imports exactly, including a category that is not in the list");
    const got = await listItems("vendors");
    ok(got[1].fields.category === "Gutters" && got[0].fields.preferred === "yes", "and reads back the same");
    await rejects(() => createItem("vendors", { ...vend[0].fields, preferred: "maybe" }, ME),
      e => e instanceof OfficeInputError && e.errors.preferred, "Preferred can only be yes or no");
  }

  /* ---- v89: MLS Info (CIK Office has no rule-book PDFs) ---------------------- */
  {
    const M = roomBySlug("mls-info").list.fields;
    const mls = [
      { originId: "m1", fields: { name: "RMLS", abbr: "RMLS", area: "Oregon and SW Washington", description: "", support: "Help Desk: 503.555.0100", phone: "877.555.0101", url: "https://www.rmlsweb.example/" } },
      { originId: "m2", fields: { name: "KCAR", abbr: "KCAR", area: "Klamath County", description: "", support: "", phone: "541.555.0102", url: "http://kcar.example/" } },
    ];
    const r = await importItems("mls-info", mls, ME);
    ok(r.imported === 2 && r.fingerprint === await fingerprint(M, mls.map(x => x.fields)) && !("files" in r),
       "MLS Info's cards import exactly, and an ordinary list reports no files");

    const meta = n => ({ pathname: `office/mls-info/rules-${n}-AbC123xyZ.pdf`, size: 1000 + n, sha256: String(n).repeat(64).slice(0, 64), type: "application/pdf" });
    await rejects(() => importItems("vendors", [{ originId: "x", fields: { name: "X", category: "Roofers" } }], ME, [meta(1)]), e => e instanceof OfficeInputError, "an ordinary list takes no files");
    ok((await fileItem((await listItems("mls-info"))[0].id)) === null, "an ordinary card is not a file");
    ok((await fileItem("0")) === null && (await fileItem("1 or 1=1")) === null && (await fileItem("99999999")) === null,
       "a bad or missing id finds nothing");
    ok((await fileByOriginPath("/wp-content/uploads/2026/08/nothing.vcf")) === null &&
       (await fileByOriginPath("/wp-content/uploads/../x")) === null &&
       (await fileByOriginPath("/etc/passwd")) === null &&
       (await fileByOriginPath("/wp-content/uploads/2026/08/x.vcf' or '1'='1")) === null,
       "an old file address with nothing behind it, or a crafted one, finds nothing");
    await rejects(() => addFileItem("mls-info", { name: "x" }, meta(5), ME), e => /does not hold files/.test(e.message), "files only go into a file list (CIK has none yet)");
    await rejects(() => replaceFileItem("mls-info", "1", meta(5), ME), e => /does not hold files/.test(e.message), "and nothing can be replaced with one");
  }

  /* ---- v94: help tickets ---------------------------------------------------- */
  {
    const T = await import("../lib/tickets.js");
    T.__setSqlForTests(sql);
    const agent = { email: "Andy@Example.com", displayName: "Andy Agent" };
    const other = { email: "bea@example.com", displayName: "Bea Broker" };
    const base = { title: "Can't log into RMLS", category: "MLS/login", priority: "High", details: "Password expired." };
    const t1 = await T.createTicket(agent, { ...base, submittedBy: "boss@example.com", status: "Resolved" });
    ok(t1.submittedBy === "andy@example.com" && t1.status === "New" && t1.submittedName === "Andy Agent",
       "a ticket is filed under the session's email, as New, whatever the form said");
    await T.createTicket(other, { ...base, title: "Office door code" , category: "Office Access", priority: "Normal" });
    const mine = await T.myTickets("ANDY@example.com");
    ok(mine.length === 1 && mine[0].id === t1.id, "My Tickets shows only your own, however your address is capitalised");
    ok((await T.myTickets("")).length === 0 && (await T.myTickets(null)).length === 0, "no email, no tickets");
    ok((await T.allTickets()).length === 2, "the Support Center sees everyone's");
    ok((await T.supportCounts()).newCount === 2, "v137: the bell counts the two New tickets");
    await rejects(() => T.createTicket(agent, { ...base, category: "Pizza" }), e => e.status === 400 && e.errors.category, "a made-up category is refused");
    await rejects(() => T.createTicket({}, base), e => e.status === 401, "a ticket needs a signed-in person");

    const up = await T.updateTicket(t1.id, { status: "Waiting on agent", assignee: "Front desk" }, "lead@example.com");
    ok(up.status === "Waiting on agent" && up.assignee === "Front desk" && up.priority === "High" && up.title === base.title,
       "the support team changes the status and assignee; the rest stays as it was");
    ok((await T.myTickets("andy@example.com"))[0].status === "Waiting on agent", "and the submitter sees the new status");
    await rejects(() => T.updateTicket(t1.id, { status: "Done" }, "lead@example.com"), e => e.errors?.status, "a made-up status is refused");
    await rejects(() => T.updateTicket("99999999", { status: "Resolved" }, "lead@example.com"), e => e.status === 404, "a missing ticket is not found");
    await rejects(() => T.updateTicket("1 or 1=1", { status: "Resolved" }, "lead@example.com"), e => e.status === 404, "a bad id is not found");
    const order = (await T.allTickets()).map(t => t.status);
    ok(order[0] === "New" && order[1] === "Waiting on agent", "open tickets come first, New before Waiting on agent");
    ok((await T.supportCounts()).newCount === 1, "v137: a ticket moved on from New leaves the bell's count");

    /* ---- v170: the conversation ---- */
    const lead = { email: "Lead@example.com", displayName: "Lee Lead" };
    ok(await T.myUnreadCount("andy@example.com") === 1, "v170: the status change lit Andy's bell");
    let a1 = (await T.myTickets("andy@example.com"))[0];
    ok(a1.agentUnread && a1.replies.length === 1 && a1.replies[0].statusTo === "Waiting on agent" && a1.replies[0].body === "" && a1.replies[0].fromSupport,
       "and it is in the ticket's history as a status change");
    ok(await T.markMineSeen("ANDY@example.com") === 1 && await T.myUnreadCount("andy@example.com") === 0, "opening My Tickets clears it, however the address is capitalised");
    ok(await T.markMineSeen("andy@example.com") === 0, "and a second time there is nothing to clear");

    const t2 = (await T.myTickets("bea@example.com"))[0];
    const r1 = await T.supportReply(t2.id, { body: "Door code is on the way.\nCheck your text." }, lead);
    ok(r1.status === "In review" && r1.agentUnread && !r1.supportUnread, "an update on a New ticket moves it to In review and lights Bea's bell");
    ok(await T.myUnreadCount("bea@example.com") === 1 && await T.myUnreadCount("andy@example.com") === 0, "only Bea's");
    let b = (await T.myTickets("bea@example.com"))[0];
    ok(b.replies.length === 1 && b.replies[0].body.includes("\n") && b.replies[0].authorName === "Lee Lead" && b.replies[0].authorEmail === "lead@example.com" && b.replies[0].statusTo === "In review",
       "Bea sees the message, who sent it, and the new status, with line breaks kept");
    const r2 = await T.supportReply(t2.id, { body: "Done?", status: "Waiting on agent" }, lead);
    ok(r2.status === "Waiting on agent", "the team can set the status with the message");
    const r3 = await T.supportReply(t2.id, { body: "One more thing" }, lead);
    b = (await T.myTickets("bea@example.com"))[0];
    ok(r3.status === "Waiting on agent" && b.replies.length === 3 && !b.replies[2].statusTo, "with no status sent, it stays; no status line is added");
    await rejects(() => T.supportReply(t2.id, { body: "   " }, lead), e => e.status === 400 && e.errors.body, "an empty message is refused");
    await rejects(() => T.supportReply(t2.id, { body: "x", status: "Done" }, lead), e => e.status === 400 && e.errors.status, "a made-up status is refused");
    await rejects(() => T.supportReply("99999999", { body: "x" }, lead), e => e.status === 404, "a missing ticket is not found");
    await rejects(() => T.supportReply(t2.id, { body: "x".repeat(5001) }, lead), e => e.status === 400, "messages are capped at 5,000 characters");

    await rejects(() => T.agentReply(t2.id, { body: "Not my ticket" }, agent), e => e.status === 404, "Andy cannot answer on Bea's ticket: it does not exist for him");
    const back = await T.agentReply(t2.id, { body: "Got it, thanks!" }, { email: "BEA@example.com", displayName: "Bea Broker" });
    ok(back.status === "In review" && back.supportUnread && !back.agentUnread, "Bea answers: back to In review, and the Support Center's bell lights");
    ok((await T.supportCounts()).repliedCount === 1, "the bell counts one answered ticket");
    const fresh = await T.createTicket(agent, { ...base, title: "Printer jam" });
    const order2 = await T.allTickets();
    ok(order2[0].id === fresh.id && order2[1].id === t2.id, "answered tickets sit right under New ones");
    ok(order2[1].replies.at(-1).fromSupport === false && order2[1].replies.at(-1).body === "Got it, thanks!", "the team sees her answer, last");
    await T.deleteTicket(fresh.id, "lead@example.com");
    await T.markSupportSeen(t2.id);
    ok((await T.supportCounts()).repliedCount === 0, "an admin opening it clears that");
    await rejects(() => T.markSupportSeen("nope"), e => e.status === 404, "a bad id is not found");

    await T.updateTicket(t2.id, { status: "Resolved" }, "lead@example.com");
    const res = await T.agentReply(t2.id, { body: "Actually it stopped working" }, other);
    ok(res.status === "In review" && res.supportUnread, "answering on a resolved ticket reopens it");
    ok(await T.myUnreadCount("bea@example.com") === 0, "her own answer leaves her nothing unread");
    await T.updateTicket(t2.id, { priority: "Urgent", assignee: "Desk" }, "lead@example.com");
    ok(await T.myUnreadCount("bea@example.com") === 0, "priority or assignee changes don't ring the agent's bell");
    await rejects(() => T.agentReply(t2.id, { body: "x" }, {}), e => e.status === 401, "a message needs a signed-in person");

    /* ---- v177 (scan) ---- */
    const own = await T.createTicket(lead, { ...base, title: "Lead's own ticket" });
    const ownR = await T.supportReply(own.id, { body: "Note to self" }, lead);
    ok(ownR.self === true && !ownR.agentUnread && await T.myUnreadCount("lead@example.com") === 0,
       "v177: answering your OWN ticket from the Support Center lights no bell for you");
    const ownS = await T.updateTicket(own.id, { status: "Resolved" }, "lead@example.com");
    ok(ownS.statusChanged === false && !ownS.agentUnread, "v177: nor does resolving your own ticket (and no email is asked for)");
    const otherR = await T.supportReply(t2.id, { body: "For Bea" }, lead);
    ok(otherR.self === false && otherR.agentUnread, "someone else's ticket still lights their bell");
    const before60 = (await q("select count(*)::int n from office_ticket_replies where lower(author_email) = 'statusbot@example.com'"))[0].n;
    for (let k = 0; k < T.MAX_REPLIES_PER_DAY + 2; k++) await T.updateTicket(t2.id, { status: k % 2 ? "In review" : "Waiting on agent" }, "statusbot@example.com");
    const statusRows = (await q("select count(*)::int n from office_ticket_replies where lower(author_email) = 'statusbot@example.com'"))[0].n - before60;
    const r62 = await T.supportReply(t2.id, { body: "Still allowed" }, { email: "statusbot@example.com", displayName: "Bot" });
    ok(statusRows === T.MAX_REPLIES_PER_DAY + 2 && r62.id === t2.id, "v177: status changes don't use up the 60 messages a day");
    const nRep = async id => (await q("select count(*)::int n from office_ticket_replies where ticket_id = $1", [id]))[0].n;
    const was = await nRep(t2.id);
    failTxAt = 1;
    await rejects(() => T.supportReply(t2.id, { body: "half saved?" }, lead), e => /injected/.test(e.message), "a failure part-way through a reply...");
    ok(await nRep(t2.id) === was, "v177: ...saves nothing at all (the message and the ticket go together)");
    await T.deleteTicket(own.id, "lead@example.com");

    for (let k = 0; k < T.MAX_TICKETS_PER_DAY - 1; k++) await T.createTicket(agent, { ...base, title: `Ticket ${k}` });
    await rejects(() => T.createTicket(agent, base), e => e.status === 429, `a 21st ticket in one day is refused`);
    ok((await T.myTickets("bea@example.com")).length === 1, "and the cap is per person: someone else can still file");

    await T.deleteTicket(t1.id, "lead@example.com");
    ok(!(await T.allTickets()).some(t => t.id === t1.id), "a deleted ticket is gone");
    ok((await q("select count(*)::int n from office_ticket_replies where ticket_id = $1", [t1.id]))[0].n === 0, "v170: and so is its history");
    const log = await q("select action, count(*)::int n from office_changes where room = 'tickets' group by action order by action");
    ok(JSON.stringify(log) === JSON.stringify([{ action: "create", n: 23 }, { action: "delete", n: 3 }, { action: "update", n: 74 }]),
       "every ticket filed, changed and deleted is in the change log");
    await T.ensureTicketSchema();
  }

  /* ---- v179 (scan): limits under load, seen-by-id, imports and replaces at once */
  {
    const T = await import("../lib/tickets.js");
    T.__setSqlForTests(sql);
    const spam = { email: "spam@example.com", displayName: "Spam" };
    const base = { title: "Load", category: "MLS/login", priority: "Normal", details: "x" };
    const runs = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => T.createTicket(spam, { ...base, title: "Load " + i })));
    ok(runs.filter(r => r.status === "fulfilled").length === T.MAX_TICKETS_PER_DAY && runs.filter(r => r.status === "rejected").every(r => r.reason.status === 429),
       "v179: thirty tickets at once from one person: exactly the daily limit get in");
    const mineT = await T.myTickets("spam@example.com");
    const tA = mineT[0], tB = mineT[1];
    const lead = { email: "lead@example.com", displayName: "Lead" };
    await T.supportReply(tA.id, { body: "one" }, lead);
    await T.supportReply(tB.id, { body: "two" }, lead);
    await T.markMineSeen("spam@example.com", [tA.id]);
    const after = await T.myTickets("spam@example.com");
    ok(!after.find(t => t.id === tA.id).agentUnread && after.find(t => t.id === tB.id).agentUnread, "v179: 'seen' clears only the tickets that were shown");
    await q(`insert into office_ticket_replies (ticket_id, author_email, from_support, body) select $1, 'spam@example.com', false, 'r' || g from generate_series(1, $2::int) g`, [tA.id, T.MAX_REPLIES_PER_DAY - 2]);
    const rr = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => T.agentReply(tA.id, { body: "late " + i }, spam)));
    ok(rr.filter(r => r.status === "fulfilled").length === 2 && rr.filter(r => r.status === "rejected").every(r => r.reason.status === 429),
       "v179: replies at once can't slip past the daily limit either");
    const n = (await q("select count(*)::int n from office_ticket_replies where lower(author_email) = 'spam@example.com' and body <> ''"))[0].n;
    ok(n === T.MAX_REPLIES_PER_DAY, "v179: ...and the refused ones saved nothing");

    store.__setSqlForTests(sql);
    const { ALL_ROOMS, partsOf } = await import("../lib/office-rooms.js");
    const lists = ALL_ROOMS.flatMap(r => [r.list ? { slug: r.slug, list: r.list } : null, ...(partsOf(r) || []).map(p => ({ slug: p.slug, list: p.list }))]).filter(Boolean);
    let target = null;
    for (const l of lists) {
      if (l.list.files || !(l.list.seed && l.list.seed.from === "cikoffice")) continue;
      if (l.list.fields.some(f => f.required && f.key !== l.list.fields[0].key)) continue;
      if (!(await store.roomState(l.slug)).imported) { target = l; break; }
    }
    if (target) {
      const key = target.list.fields[0].key;
      const blankOf = f => (f.options && !f.allowOther && f.type === "select" ? (f.options[0] ?? "") : "");
      const one = n => ({ originId: "r" + n, fields: Object.fromEntries(target.list.fields.map(f => [f.key, f.key === key ? "Race item " + n : blankOf(f)])) });
      const tries = await Promise.allSettled([1, 2].map(k => importItems(target.slug, [one(k * 10), one(k * 10 + 1)], ME)));
      const okRuns = tries.filter(t => t.status === "fulfilled");
      const items = await listItems(target.slug);
      ok(okRuns.length === 1 && tries.filter(t => t.status === "rejected").every(t => t.reason.status === 409) && items.length === 2,
         `v179: two imports at once: one wins, the other is told 409 (${target.slug}; ${tries.map(t => t.status === "rejected" ? t.reason.message : "ok").join(" / ")})`);
    } else ok(false, "v179: no unimported list left to try two imports at once");

  }

  /* ---- v178 (scan): edits, moves and uploads at the same moment ------------- */
  {
    store.__setSqlForTests(sql);
    const R = "marketing";
    for (const n of ["One", "Two", "Three", "Four"]) await createItem(R, { name: `v178 ${n}` }, ME);
    const mine = (await listItems(R)).filter(i => /^v178 /.test(i.fields.name));
    const it = mine[0];
    const first = await updateItem(R, it.id, { ...it.fields, name: "v178 One (Ann)" }, "ann@example.com", { base: it.fields });
    ok(first.fields.name === "v178 One (Ann)", "v178: an edit from the card as it is saves");
    await rejects(() => updateItem(R, it.id, { ...it.fields, name: "v178 One (Bob)" }, "bob@example.com", { base: it.fields }),
      e => e instanceof OfficeInputError && e.status === 409, "v178: an edit started from an older version is refused, not saved over Ann's");
    ok((await listItems(R)).find(i => i.id === it.id).fields.name === "v178 One (Ann)", "v178: ...and Ann's change is still there");
    const cur = (await listItems(R)).find(i => i.id === it.id);
    await updateItem(R, it.id, { ...cur.fields, name: "v178 One (Bob)" }, "bob@example.com", { base: cur.fields });
    ok((await listItems(R)).find(i => i.id === it.id).fields.name === "v178 One (Bob)", "v178: saving again from the fresh version works");
    await updateItem(R, it.id, { ...cur.fields, name: "v178 One" }, ME);
    ok(true, "v178: an edit with no starting version (an old page) still saves");
    const logRow = (await q("select before->>'name' b from office_changes where room = $1 and item_id = $2 and action = 'update' order by id desc limit 1", [R, it.id]))[0];
    ok(logRow && logRow.b === "v178 One (Bob)", "v178: the change log's 'before' is the version actually replaced");
    await rejects(() => updateItem(R, "999999999", { name: "x" }, ME, { base: { name: "y" } }), e => e.status === 404, "v178: a missing card is still 'does not exist'");

    const order = async () => (await listItems(R)).map(i => i.id);
    const last = mine[3].id;
    const before = (await order()).indexOf(last);
    await Promise.all([moveItem(R, last, "up", ME), moveItem(R, last, "up", ME)]);
    ok((await order()).indexOf(last) === before - 2, "v178: two moves at once both count (neither undoes the other)");
    const pos = (await q("select position from office_items where room = $1", [R])).map(r => r.position);
    ok(new Set(pos).size === pos.length, "v178: and no two cards share a place");

  }

  /* ---- the schema is safe to create twice ---------------------------------- */
  store.__setSqlForTests(sql);
  await ensureOfficeSchema();
  ok(true, "creating the tables again on a new server instance is harmless");
} catch (e) {
  ok(false, "unexpected error: " + (e.stack || e));
} finally {
  await pool.end();
}

console.log(`\noffice-db: ${p} passed, ${f} failed`);
if (f) process.exit(1);
