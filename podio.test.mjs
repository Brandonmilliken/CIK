/* podio.test.mjs — cik-v5, the Podio agent dashboard.
 *
 * Items here are shaped like Podio's own API (fields with label, type and
 * values), built from what the real apps hold (2026-10-14): Hot Leads, and
 * Elysium with its deal dates and WS Fee.
 */
import fs from "node:fs";
import { itemToRow, podioConfig, leadKey, money, plain, laDate, LEAD_APPS, IN_HOUSE, filterItems, __clearTokens } from "./lib/podio.js";
import { periodRange, agentStage, podioLink, personFor, PERIODS } from "./lib/podio-dash.js";
import { syncPodio } from "./lib/podio-sync.js";

let p = 0, f = 0;
const ok = (c, m) => { c ? p++ : (f++, console.log("  FAIL:", m)); };

/* ---- Podio-shaped fields ------------------------------------------------ */
const cat = (label, text) => ({ label, type: "category", external_id: "x", values: [{ value: { id: 1, text } }] });
const txt = (label, value, type = "text") => ({ label, type, external_id: "x", values: [{ value }] });
const dt = (label, d, time = null) => ({ label, type: "date", external_id: "x", values: [time
  ? { start: `${d} ${time}`, start_date: d, start_time: time, start_utc: `${d} ${time}`, start_time_utc: time }
  : { start: `${d} 00:00:00`, start_date: d, start_time: null }] });
const mon = (label, v) => ({ label, type: "money", external_id: "x", values: [{ value: String(v), currency: "USD" }] });
const phone = v => ({ label: "Phone", type: "phone", external_id: "phone", values: [{ type: "work", value: v }] });

const elysiumClosed = {
  item_id: 3317557462, app_item_id: 591, title: "Susan Sutherby", created_on: "2026-07-20 22:38:41", last_event_on: "2026-10-01 18:00:00",
  link: "https://podio.com/cashiskingcom/cash-is-king/apps/elysium/items/591",
  fields: [
    txt("Name", "Susan Sutherby", "calculation"), phone("3605800723"),
    txt("Property Address", "760 Kalmia St, Kettle Falls, WA 99141", "calculation"),
    cat("Status", "Closed"), cat("Lead Owner", "Carrie"), cat("Closed type", "Novation"), cat("Source", "SWPL"),
    txt("Closing Date ", "9/25"), dt("Closing Date ", "2026-09-25"),
    dt("Offer Signed Date", "2026-07-20"), dt("Offer Modified", "2026-07-20", "22:37:25"),
    txt("WS Fee", "<p>27000</p>"), txt("WS Fee", ""), mon("Assignment Fee (if closed)", "5.0000"),
    dt("Lead Date", "2026-07-11", "14:35:00"),
  ],
};
const r1 = itemToRow(elysiumClosed, 30240944);
ok(r1.status === "Closed" && r1.lead_owner === "Carrie", "category fields read by label");
ok(r1.closed_d === "2026-09-25" && r1.closing_d === "2026-09-25", "a closed deal's day is its Closing Date (the DATE field, not the text one with the same label)");
ok(r1.fee === 27000, "fee is the WS Fee out of Podio's HTML, ahead of the Assignment Fee");
ok(r1.signed_d === "2026-07-20", "offer signed from the Offer Signed Date");
ok(r1.lead_d === "2026-07-11", "a timed date (14:35 UTC) is the Portland day");
ok(r1.lead_key === "p:3605800723|760kalmiastket", "the lead key is phone plus the start of the address");
ok(r1.created_on === "2026-07-20T22:38:41.000Z", "Podio times are stored as UTC");
ok(!r1.is_kick && r1.kicked_d === null, "not handed to anyone: not a kick");

const hot = (over = {}) => ({
  item_id: 3381110825, app_item_id: 10186, title: "Antoinette Blair", created_on: "2026-10-14 21:10:48",
  fields: [
    txt("Name", "Antoinette Blair", "calculation"), phone("(254) 320-7600"),
    txt("Property Address", "333 NW 4th Ave, Portland, OR 97209", "calculation"),
    cat("Status", over.status || "Active"), cat("Lead Owner", "Mike"),
    ...(over.handed ? [cat("Handed to ", over.handed)] : []),
    ...(over.kicked ? [dt("Kicked To Agent Date ", over.kicked)] : []),
    ...(over.modified ? [dt("Offer Modified", over.modified)] : []),
    ...(over.agentMet ? [dt("Agent Met ", over.agentMet)] : []),
    cat("Source", "PL"), txt("Source", "PL text"),
  ],
});
const k = itemToRow(hot({ handed: "ANDY", kicked: "2026-10-06", agentMet: "2026-10-07" }), 30206037);
ok(k.is_kick && k.kicked_d === "2026-10-06", "handed to an outside agent with a date: a kick on that day");
ok(k.handed_to === "ANDY" && k.agent_met_d === "2026-10-07", "'Handed to ' and 'Agent Met ' found despite the trailing space");
ok(k.source === "PL", "the category Source wins over the text one");
for (const inHouse of ["JORDAN", "Jacob"]) {
  const r = itemToRow(hot({ handed: inHouse, kicked: "2026-10-06" }), 30206037);
  ok(!r.is_kick && r.kicked_d === null, `handed to ${inHouse} (in-house) is not a kick`);
}
ok(!itemToRow(hot({ kicked: "2026-10-06" }), 30206037).is_kick, "a Kicked date with nobody in 'Handed to' is not a kick");
ok(itemToRow(hot({ handed: "Erin" }), 30206037).is_kick && itemToRow(hot({ handed: "Erin" }), 30206037).kicked_d === null,
   "a kick with no date is still a kick (it shows under All time)");
ok(itemToRow(hot({ status: "Offer Signed", modified: "2026-10-07" }), 30206037).signed_d === "2026-10-07",
   "apps without an Offer Signed Date use Offer Modified once the lead is at Offer Signed");
ok(itemToRow(hot({ status: "Offer Sent", modified: "2026-10-07" }), 30206037).sent_d === "2026-10-07"
   && itemToRow(hot({ status: "Offer Sent", modified: "2026-10-07" }), 30206037).signed_d === null,
   "Offer Sent: counted as sent, not signed");
ok(itemToRow(hot({ status: "Active", modified: "2026-10-07" }), 30206037).signed_d === null, "an Active lead is not a signed offer");
ok(itemToRow(hot(), 30206037).lead_d === "2026-10-14", "no Lead Date: the day it was created (Portland)");
ok(itemToRow(hot(), 30206037).lead_key === itemToRow({ ...hot(), item_id: 1 }, 30206099).lead_key,
   "the same lead copied into another app has the same key");

const empty = itemToRow({ item_id: 5, title: "x", fields: [txt("Property Address", "null, null, null null", "calculation")] }, 30206101);
ok(empty.address === "", "the address formula's 'null, null, null null' is no address");
ok(empty.fee === null && empty.closed_d === null && empty.status === "", "an item with almost nothing in it still makes a row");
ok(itemToRow({ item_id: 6, title: "y", link: "javascript:alert(1)", fields: [] }, 30206101).link === null, "only podio.com links are kept");

/* ---- helpers ---- */
ok(money("<p><span>250,000</span></p>") === 250000 && money("$1,000.50") === 1000.5 && money("27000.0000") === 27000, "money reads Podio's text and money values");
ok(money("call me") === null && money(null) === null && money("") === null, "no number: null, never 0");
ok(plain("<p>a &amp; b</p><p>c</p>") === "a & b c", "HTML taken out of text");
ok(laDate("2026-10-15 05:30:00") === "2026-10-14", "05:30 UTC on the 15th is still the 14th in Portland");
ok(leadKey({ phone: "", name: "Mary Peck", address: "" }) === "n:marypeck|", "no phone: name and address");

/* ---- config ---- */
const cfg = podioConfig({ PODIO_CLIENT_ID: "cik", PODIO_CLIENT_SECRET: "s3", PODIO_APP_TOKENS: "30206037=aaa, 30240944:bbb ,junk,99=ccc" });
ok(cfg.ok && cfg.apps.map(a => a.id).join() === "30240944,30206037", "tokens are read as app=token (or app:token), unknown apps ignored, Elysium first");
ok(cfg.missing.includes("STF") && cfg.missing.length === 4, "it says which apps still need a token");
ok(!podioConfig({ PODIO_APP_TOKENS: "30206037=aaa" }).ok, "no API key: not configured");
ok(!podioConfig({}).ok && podioConfig({}).missing.length === 6, "nothing set: not configured, all six missing");
ok(LEAD_APPS.length === 6 && IN_HOUSE.join() === "jordan,jacob", "the six lead apps, and Jordan and Jacob in-house");

/* ---- periods ---- */
const now = new Date("2026-10-14T19:00:00Z");   // noon in Portland
ok(JSON.stringify(PERIODS.map(x => x.key)) === JSON.stringify(["30d", "month", "lastmonth", "year", "all"]), "the five windows");
const r30 = periodRange("30d", now);
ok(r30.from === "2026-09-15" && r30.to === "2026-10-14", "last 30 days is today and the 29 before it");
ok(periodRange("month", now).from === "2026-10-01", "this month starts on the 1st");
const lm = periodRange("lastmonth", now);
ok(lm.from === "2026-09-01" && lm.to === "2026-09-30", "last month is all of September");
ok(periodRange("lastmonth", new Date("2026-01-10T19:00:00Z")).from === "2025-12-01", "last month in January is December of last year");
ok(periodRange("year", now).from === "2026-01-01" && periodRange("all", now).from === null, "this year, and all time (no limits)");
ok(periodRange("bogus", now).key === "30d", "an unknown window falls back to the last 30 days");
ok(periodRange("30d", new Date("2026-10-15T05:00:00Z")).to === "2026-10-14", "10pm on the 14th in Portland is still the 14th");

/* ---- dashboard helpers ---- */
ok(agentStage({ agent_signed_d: "2026-01-01", agent_met_d: "2025-12-01" }) === "Agent signed", "the furthest agent step wins");
ok(agentStage({ status: "Agent Set" }) === "Agent Set" && agentStage({ status: "Dead" }) === "Kicked", "otherwise the agent status, else 'Kicked'");
ok(podioLink({ app_id: 30206102, app_item_id: 42 }) === "https://podio.com/cashiskingcom/cash-is-king/apps/stf/items/42", "a link is built when Podio didn't give one");
ok(personFor("Mike Oltersdorf", ["Carrie", "Mike"]) === "Mike" && personFor("brandon@cashisking.com", ["Brandon"]) === null,
   "a signed-in person is matched to their Lead Owner name by first name");

/* ---- the client: sign-in, and only what it should send ---- */
{
  __clearTokens();
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/oauth/token/v2")) return { ok: true, status: 200, json: async () => ({ access_token: "tok1", expires_in: 28800 }) };
    return { ok: true, status: 200, json: async () => ({ total: 1, filtered: 1, items: [elysiumClosed] }) };
  };
  const res = await filterItems(30240944, { limit: 5 }, { cfg, fetchImpl: fake });
  await filterItems(30240944, { limit: 5 }, { cfg, fetchImpl: fake });
  ok(res.items.length === 1 && res.total === 1, "a page of items comes back");
  ok(calls.filter(c => c.url.endsWith("/oauth/token/v2")).length === 1, "the app token is asked for once and reused");
  const tokenBody = String(calls[0].init.body);
  ok(/grant_type=app/.test(tokenBody) && /app_id=30240944/.test(tokenBody) && /app_token=bbb/.test(tokenBody), "app authentication with that app's own token");
  ok(calls[1].init.method === "POST" && /\/item\/app\/30240944\/filter\/$/.test(calls[1].url) && calls[1].init.headers.Authorization === "OAuth2 tok1",
     "the filter call, signed with the token");
  ok(calls.every(c => c.init.method === "POST" && !/\/item\/\d+$/.test(c.url)), "it only ever reads (no item is changed)");
  let threw = null;
  try { await filterItems(30206037, {}, { cfg, fetchImpl: async () => ({ ok: false, status: 420, json: async () => ({}) }) }); } catch (e) { threw = e; }
  ok(threw && threw.rateLimited && !/aaa/.test(threw.message), "Podio's slow-down (420) is reported as such, without the token in the message");
}

/* ---- not configured: the sync does nothing ---- */
{
  const r = await syncPodio({ cfg: podioConfig({}), fetchImpl: () => { throw new Error("must not call Podio"); } });
  ok(r.configured === false && r.missing.length === 6, "without a key the sync stops before reaching Podio or the database");
}

/* ---- the source: read-only, label-based, wired in ---- */
{
  const src = fs.readFileSync("lib/podio.js", "utf8");
  ok(!/method:\s*"(PUT|DELETE)"/.test(src) && !/\/item\/app\/\$\{appId\}\/"/.test(src), "lib/podio.js never writes to Podio");
  ok(!/external_id\s*===/.test(src), "fields are never chosen by external_id");
  const sync = fs.readFileSync("lib/podio-sync.js", "utf8");
  ok(/s\.inc_offset \+= page\.items\.length;[\s\S]{0,260}await saveState\(app\.id, s\);/.test(sync), "a changes pass saves its place after every page (a busy day can't wedge it)");
  ok(/SWEEP_PAGE - SWEEP_OVERLAP/.test(sync) && /const SWEEP_OVERLAP = 100;/.test(sync), "the removal sweep's pages overlap, so a moved lead can't make it remove a real one");
  ok(/timeoutMs: Math\.max\(3000, Math\.min\(25000, deadline - now\(\) - 3000\)\)/.test(sync), "each Podio call only gets what's left of the run's time");
  const ui = fs.readFileSync("app/deals.jsx", "utf8");
  ok(/if \(mine !== latest\.current\) return;/.test(ui), "the page only shows the answer to the newest choice");
  const refresh = fs.readFileSync("lib/refresh.js", "utf8");
  ok(/podio: \{ leaseSeconds: 75/.test(refresh) && /export async function refreshPodioIfStale/.test(refresh), "the Podio job is in the job list (leased, recorded, admin-runnable)");
  const route = fs.readFileSync("app/api/podio/dashboard/route.js", "utf8");
  ok(/if \(!user\) return Response\.json\(\{ error: "unauthenticated" \}, \{ status: 401/.test(route), "the dashboard API needs a signed-in person");
  ok(/after\(async \(\) => \{\s*const r = await refreshPodioIfStale\(\)/.test(route), "it refreshes Podio after answering, never before");
  ok(/no-store/.test(route), "and is never cached");
  ok(!/last_error\b[^?]*\?\s*status\.last_error/.test(route) && /didn't finish/.test(route), "a failed sync shows a plain message, not the raw error");
  const home = fs.readFileSync("app/home.jsx", "utf8");
  ok(/<Deals admin=\{admin\} \/>/.test(home) && !/coming next/.test(home), "the Deals tab is the dashboard now");
  /* cik-v6 (Brandon, 2026-10-15: Podio on hold): no Deals tab until Podio is connected. */
  const page = fs.readFileSync("app/page.jsx", "utf8");
  ok(/const dealsOn = podioConfig\(\)\.ok;/.test(page) && /dealsOn && String\(\(await searchParams\)\?\.tab/.test(page),
     "the home page knows whether Podio is connected, and /?tab=deals opens Home when it isn't");
  ok(/deals=\{dealsOn\}[\s\S]*deals=\{dealsOn\}/.test(page), "and tells both the menu and the page");
  ok(/\{deals && \(\s*<div className="jx-chips jx-hometabs tabbar"/.test(home) && /\{deals && tab === "deals" && <Deals/.test(home),
     "without Podio there are no Home / Deals tabs and no dashboard");
  ok(/useState\(deals && initialTab === "deals"/.test(home) && /\(deals && e\.detail === "deals"\)/.test(home), "and nothing can switch to Deals");
  const menu = fs.readFileSync("app/side-menu.jsx", "utf8");
  ok(/\{deals && <a href="\/\?tab=deals"/.test(menu) && /data-tabs=\{deals \? 4 : 3\}/.test(menu), "the phone's bottom bar drops Deals (Home, Search, Menu)");
  ok(/\.jx-tabbar\[data-tabs="3"\] \{ grid-template-columns: repeat\(3/.test(fs.readFileSync("app/shell.css", "utf8")), "and spreads its three buttons across");
  const room = fs.readFileSync("app/office/[room]/page.jsx", "utf8");
  ok((room.match(/deals=\{podioConfig\(\)\.ok\}/g) || []).length === 2, "rooms pass it to the menu too");
  ok(!/from ["'].*\/db\.js["']/.test(fs.readFileSync("lib/podio.js", "utf8")), "lib/podio.js (where the check lives) needs no database");
  const ex = fs.readFileSync(".env.example", "utf8");
  ok(/PODIO_CLIENT_ID=/.test(ex) && /PODIO_CLIENT_SECRET=/.test(ex) && /PODIO_APP_TOKENS=/.test(ex), ".env.example lists the three Podio settings");
}

console.log(`\npodio: ${p} passed, ${f} failed`);
if (f) process.exit(1);
