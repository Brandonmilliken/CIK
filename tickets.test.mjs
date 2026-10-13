/* tickets.test.mjs — v94: the help-ticket rooms. (Past CE Classes did not
 * come over to CIK Office.)
 *
 * Who may see and change tickets, read from the code and the rules. The SQL
 * (my tickets vs everyone's, the daily cap, the change log) is run for real in
 * scripts/office-db-check.mjs.
 */
import fs from "node:fs";
import { validateFields } from "./lib/office-fields.js";
import { roomBySlug, canSeeRoom, canEditRoom, canImportRoom, menuFor } from "./lib/office-rooms.js";
/* lib/tickets.js reaches the database module, which wants an address even
   though these checks never query it. */
process.env.DATABASE_URL ||= "postgresql://test:test@localhost.invalid/test";
const { NEW_TICKET_FIELDS, UPDATE_FIELDS, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, MAX_TICKETS_PER_DAY } = await import("./lib/tickets.js");

let p = 0, f = 0;
const ok = (c, m) => { c ? p++ : (f++, console.log("  FAIL:", m)); };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const read = path => strip(fs.readFileSync(path, "utf8"));

/* ---- the rooms --------------------------------------------------------------- */
{
  const submit = roomBySlug("help-ticket"), mine = roomBySlug("my-tickets"), support = roomBySlug("support");
  ok(submit.where === "jarvis" && submit.view === "ticket-form" && !submit.minRole, "every agent can open Submit a Help Ticket");
  ok(mine.where === "jarvis" && mine.view === "my-tickets" && !mine.minRole, "and My Tickets");
  ok(support.where === "jarvis" && support.view === "support" && support.minRole === "admin", "the Support Center is admins and leadership only");
  ok(!canSeeRoom(support, "agent") && !canSeeRoom(support, "broker") && canSeeRoom(support, "admin") && canSeeRoom(support, "leadership"),
     "agents and brokers cannot open it");
  ok(!menuFor("agent").flatMap(g => g.rooms).some(r => r.slug === "support"), "so it is not in their menu");
  ok([submit, mine, support].every(r => !r.list && !canEditRoom(r, "leadership") && !canImportRoom(r, "leadership")),
     "none of them is a list, so the list routes and the copy cannot reach them");
  ok(submit.blurb.includes("My Tickets") && mine.blurb.includes("Only you and the support team"), "the pages say where to look, and who can see it");

}

/* ---- what a ticket may contain ------------------------------------------------ */
{
  ok(TICKET_CATEGORIES.length === 10 && TICKET_CATEGORIES[0] === "Tech support" && TICKET_CATEGORIES.includes("Lead/CRM issue"), "the nine categories CIK Office had (its copy of MRE's), plus JARVIS (v163)");
ok(TICKET_CATEGORIES[1] === "JARVIS", "v163: JARVIS, second, so the form still starts on Tech support");
  ok(TICKET_PRIORITIES.join() === "Low,Normal,High,Urgent", "its four priorities");
  ok(TICKET_STATUSES.join() === "New,In review,Waiting on agent,Resolved", "and its four statuses, in order");
  const good = { title: "Can't log into RMLS", category: "MLS/login", priority: "High", details: "It says my password expired.\nTried twice." };
  const v = validateFields(NEW_TICKET_FIELDS, good);
  ok(v.ok && v.fields.details.includes("\n"), "a normal ticket is fine, and its details keep their line breaks");
  ok(!validateFields(NEW_TICKET_FIELDS, { ...good, title: "   " }).ok, "a ticket needs a title");
  ok(!validateFields(NEW_TICKET_FIELDS, { ...good, category: "Pizza order" }).ok, "the category is one of the nine");
  ok(!validateFields(NEW_TICKET_FIELDS, { ...good, priority: "Critical!!" }).ok, "the priority is one of the four");
  ok(!validateFields(NEW_TICKET_FIELDS, { ...good, details: "x".repeat(5001) }).ok, "details are capped at 5,000 characters");
  const extra = validateFields(NEW_TICKET_FIELDS, { ...good, submittedBy: "boss@example.com", status: "Resolved" });
  ok(!("submittedBy" in extra.fields) && !("status" in extra.fields), "a form cannot set who sent it or mark it resolved");
  ok(!validateFields(UPDATE_FIELDS, { status: "Done", priority: "Normal", category: "Tech support" }).ok, "the support team's status is one of the four");
  ok(UPDATE_FIELDS.every(x => !["title", "details", "submittedBy"].includes(x.key)), "the support team cannot rewrite what someone asked");
  ok(MAX_TICKETS_PER_DAY === 20, "a person can send up to 20 tickets a day");
}

/* ---- the code, read ---------------------------------------------------------------- */
{
  const lib = read("lib/tickets.js");
  ok(/const email = cleanEmail\(user\?\.email\)/.test(lib) && /\$\{email\}, \$\{cleanName\(user, email\)\}, \$\{email\}\s/.test(lib),
     "a ticket is filed under the session's email, not anything in the form");
  ok(/where lower\(submitted_by\) = \$\{e\}/.test(lib), "My Tickets reads only the viewer's own tickets");
  ok(/interval '1 day'/.test(lib) && /429/.test(lib), "the daily cap is checked before a ticket is saved");
  ok((lib.match(/await log\(/g) || []).length === 5, "filing, changing, deleting and (v170) both kinds of message are all logged");

  const post = read("app/api/tickets/route.js");
  ok(/sameOrigin\(req\)/.test(post) && /await currentUser\(\)/.test(post) && /readJson\(req\)/.test(post) && /createTicket\(user, body\)/.test(post),
     "filing checks the origin, the session and the size, and passes the session's user");
  ok(/json\(\{ ok: true, ticket \}\)/.test(post) && !/allTickets|myTickets/.test(post), "and answers with only the new ticket");

  const one = read("app/api/tickets/[id]/route.js");
  ok(/sameOrigin\(req\)/.test(one) && /await currentUser\(\)/.test(one) && /canSeeRoom\(support, user\.role\)/.test(one),
     "changing a ticket checks the origin, the session, and the Support Center's own rule");
  ok((one.match(/const stop = guard\(req, user\)/g) || []).length === 2, "for both changing and deleting");

  const page = read("app/office/[room]/page.jsx");
  ok(/room\.view === "my-tickets"[\s\S]*?myTickets\(user\.email\)/.test(page), "the My Tickets page loads the viewer's own tickets by their session");
  ok(page.indexOf("canSeeRoom(room, user.role)") < page.indexOf("allTickets()"), "the Support Center page checks the viewer before loading every ticket");
  ok(!/allTickets|myTickets/.test(page.slice(page.indexOf('"ticket-form"'), page.indexOf('"my-tickets"'))), "Submit a Help Ticket loads no tickets at all");

  const ui = read("app/tickets.jsx");
  ok(/timeZone: "America\/Los_Angeles"/.test(ui), "dates read the same on the server and in the browser");
  ok(/PLAIN_EMAIL\.test\(t\.submittedBy\)/.test(ui), "the submitter's address is only a mailto link when it is a plain address");
  ok(!/dangerouslySetInnerHTML/.test(ui), "ticket text is only ever shown as text");
}


/* ---- v137: the help-ticket bell ---- */
{
  const strip2 = t => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const route = strip2(fs.readFileSync("./app/api/tickets/route.js", "utf8"));
  ok(/export async function GET\(\)/.test(route) && /if \(!user\) return json\(\{ error: "unauthenticated" \}, 401\)/.test(route)
     && /const mine = await myUnreadCount\(user\.email\);\s*if \(!canSeeRoom\(roomBySlug\("support"\), user\.role\)\) return json\(\{ mine \}\);/.test(route),
     "v170: everyone gets their own count; only whoever can open the Support Center gets the team's");
  ok(/return json\(\{ mine, \.\.\.\(await supportCounts\(\)\) \}\)/.test(route) && !/allTickets|myTickets/.test(route), "numbers only, never the tickets themselves");
  const lib = fs.readFileSync("./lib/tickets.js", "utf8");
  ok(/count\(\*\) filter \(where status = 'New'\)::int as new_n/.test(lib), "it counts tickets still New");
  const menu = strip2(fs.readFileSync("./app/side-menu.jsx", "utf8"));
  ok(/const canSupport = canSeeRoom\(roomBySlug\("support"\), role\);/.test(menu) && !/if \(!canSupport\) return;/.test(menu)
     && /\{bell\("jx-bell jx-bellbar"\)\}/.test(menu) && /\{bell\("jx-bell jx-belldesk"\)\}/.test(menu),
     "v170: everyone has a bell, on a phone and on a computer");
  ok(/\{n > 0 && <span className="jx-bellcount" aria-hidden="true">\{n > 99 \? "99\+" : n\}<\/span>\}/.test(menu), "the badge shows the number, only when there is one (99+ past 99)");
  ok(/\? "\/office\/support" : "\/office\/my-tickets"/.test(menu) && /<span className="jx-sr">\{label\}<\/span>/.test(menu), "it opens the Support Center or My Tickets, and says the count to a screen reader");
  ok(/setInterval\(\(\) => count\(false\), 60000\)/.test(menu) && /addEventListener\("jx:tickets", now\)/.test(menu), "it recounts every minute, and at once when a ticket changes");
  const tk = fs.readFileSync("./app/tickets.jsx", "utf8");
  ok(/if \(res\.ok && method !== "GET"\) \{ try \{ window\.dispatchEvent\(new Event\("jx:tickets"\)\)/.test(tk), "filing or changing a ticket tells the bell");
  const css = fs.readFileSync("./app/shell.css", "utf8");
  ok(/\.jx-bell\.jx-belldesk \{\s*display: inline-flex; position: fixed; top: 12px; right: 68px;/.test(css) && /\.jx-bellcount \{[^}]*background: #e0263c; color: #fff;/.test(css),
     "on a computer it sits in the top right corner beside the gear, with a red badge");
}
console.log(`\ntickets: ${p} passed, ${f} failed`);
if (f) process.exit(1);
