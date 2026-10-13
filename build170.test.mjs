/* build170.test.mjs — v170: tickets are a conversation. The support team sends
 * an update back to the agent; it shows in My Tickets with a bell; the agent
 * can answer; the answer rings the Support Center's bell. The SQL (who can
 * answer on what, what lights which bell) runs for real in
 * scripts/office-db-check.mjs. */
import fs from "node:fs";
process.env.DATABASE_URL ||= "postgresql://test:test@localhost.invalid/test";
const T = await import("./lib/tickets.js");
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const read = path => strip(fs.readFileSync(path, "utf8"));

/* ---- the rules ---- */
ok(T.REPLY_FIELDS.length === 1 && T.REPLY_FIELDS[0].key === "body" && T.REPLY_FIELDS[0].required && T.REPLY_FIELDS[0].max === 5000, "a message is one required box, up to 5,000 characters");
ok(T.MAX_REPLIES_PER_DAY === 60, "up to 60 messages a person a day");
const lib = read("lib/tickets.js");
ok(/alter table office_tickets add column if not exists agent_unread boolean not null default false/.test(lib)
   && /alter table office_tickets add column if not exists support_unread boolean not null default false/.test(lib),
   "two new columns, safe to add to the live table");
ok(/ticket_id\s+bigint not null references office_tickets\(id\) on delete cascade/.test(lib), "a ticket's history goes when the ticket is deleted");
ok(/select \* from office_tickets where id = \$\{id\} and lower\(submitted_by\) = \$\{email\}/.test(lib), "an agent can only answer on a ticket they filed");
ok(/export async function agentReply[\s\S]*?const email = cleanEmail\(user\?\.email\)/.test(lib), "as the session's email");
ok(/update office_tickets set agent_unread = false where lower\(submitted_by\) = \$\{e\} and agent_unread/.test(lib), "My Tickets clears only the viewer's own updates");
ok(/agent_unread = \(o\.agent_unread or \(coalesce\(\$\{sent\("status"\)\}::text, b\.status\) <> b\.status and \$\{!self\}::boolean\)\)/.test(lib), "a new status from Update status rings the agent's bell too (v177: not your own ticket's)");

/* ---- the routes ---- */
const reply = read("app/api/tickets/[id]/reply/route.js");
ok(/sameOrigin\(req\)/.test(reply) && /await currentUser\(\)/.test(reply) && /readJson\(req\)/.test(reply), "a message checks the origin, the session and the size");
ok(/if \(body\?\.as === "support"\) \{[\s\S]*?canSeeRoom\(support, user\.role\)[\s\S]*?supportReply\(/.test(reply), "only admins can send as the support team");
ok(/agentReply\(id, \{ body: body\?\.body \}, user, \{ lastSeen: body\?\.lastReplyId \}\)/.test(reply) && /tickets: await listAfterSave\(\(\) => myTickets\(user\.email\)\)/.test(reply), "anyone else answers as themselves, and gets back only their own tickets");
const seen = read("app/api/tickets/seen/route.js");
ok(/if \(body\?\.mine === true\) return json\(\{ ok: true, cleared: await markMineSeen\(user\.email, Array\.isArray\(body\.ids\) \? body\.ids : null\) \}\)/.test(seen), "seen: your own, by your session");
ok(/canSeeRoom\(support, user\.role\)\) return json\(\{ error: "not found" \}, 404\)[\s\S]*?markSupportSeen/.test(seen), "seen on one ticket: admins only");

/* ---- the screens ---- */
const ui = read("app/tickets.jsx");
ok(/function Thread\(\{ t, side \}\)/.test(ui) && /<Thread t=\{t\} side="agent" \/>/.test(ui) && /<Thread t=\{t\} side="support" \/>/.test(ui), "both pages show the conversation");
ok(/send\("\/api\/tickets\/seen", "POST", \{ mine: true, ids: \[\.\.\.fresh\.current\] \}\)/.test(ui) && /open=\{isNew \|\| keepMine === t\.id \? true : undefined\}/.test(ui) && />New update</.test(ui), "My Tickets opens what's new, marks it, and tells the bell");
ok(/label="Reply to the support team"/.test(ui) && /Replying opens it again\./.test(ui), "the agent can answer, and is told a resolved ticket reopens");
ok(/>\s*Reply to agent<\/button>/.test(ui) && /\{ as: "support", body, lastReplyId: t\.replies\?\.at\(-1\)\?\.id, \.\.\.\(replying\.touched \? \{ status: replying\.status \} : \{\}\) \}/.test(ui) && /t\.status === "New" \? "In review" : t\.status/.test(ui),
   "the Support Center's Reply to agent sends the message and status (In review if it was New)");
ok(/>Agent replied</.test(ui) && /send\("\/api\/tickets\/seen", "POST", \{ id: t\.id, lastReplyId: t\.replies\?\.at\(-1\)\?\.id \}\)/.test(ui), "an agent's answer is marked, and opening it tells the bell");
ok(!/dangerouslySetInnerHTML/.test(ui), "messages are only ever shown as text");

const menu = read("app/side-menu.jsx");
ok(/export function bellLabel/.test(menu) && /"My Tickets: no new updates"/.test(menu), "the bell says what it counts");
ok(/nums = \{ mine: num\(d\.mine\), newCount: canSupport \? num\(d\.newCount\)/.test(menu), "an agent's bell counts only their own updates");

const css = fs.readFileSync("./app/shell.css", "utf8");
ok(/\.jx-tflag \{ color: #fff; background: #e0263c;/.test(css) && /\.jx-msg-sup \{ border-left: 3px solid var\(--jx-gold\); \}/.test(css), "red marks like the bell; the team's messages edged in gold");

console.log(`\nbuild170: ${p} passed, ${f} failed`);
if (f) process.exit(1);
