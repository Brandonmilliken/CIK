/* build172.test.mjs — v172: ticket update emails were dropped by Zapier.
 * Zapier ignores a message whose "id" it has already seen, and the new-ticket
 * email had used the ticket's number as its id. Every update now carries an
 * id of its own; the ticket's number goes as ticketId. */
import fs from "node:fs";
process.env.DATABASE_URL ||= "postgresql://test:test@localhost.invalid/test";
const N = await import("./lib/ticket-notify.js");
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };

const tk = { id: "2", title: "Fish tacos", status: "Waiting on agent", submittedBy: "pat@cashisking.com", submittedName: "Pat Boss",
             createdAt: "2026-10-08T21:19:05.781Z", updatedAt: "2026-10-08T21:20:26.810Z" };
const created = N.ticketPayload(tk), up = N.updatePayload(tk, "hi", { email: "a@cashisking.com" }), ar = N.agentReplyPayload(tk, "thanks");
ok(created.id === "2", "a new ticket still sends its number as its id (unchanged)");
ok(up.id !== created.id && ar.id !== created.id && up.id !== ar.id, "an update and an answer each have an id the new-ticket email didn't use");
ok(up.id === "2-update-" + Date.parse(tk.updatedAt) && ar.id === "2-agent-reply-" + Date.parse(tk.updatedAt), "made from the ticket, the kind, and when it changed");
const later = N.updatePayload({ ...tk, updatedAt: "2026-10-08T21:30:00.000Z" }, "again", { email: "a@cashisking.com" });
ok(later.id !== up.id, "so a second update on the same ticket is never mistaken for the first");
ok(up.ticketId === "2" && ar.ticketId === "2", "the ticket's number still travels, as ticketId");
ok(/^2-update-\d+$/.test(N.eventId({ id: "2" }, "update")), "no time on the ticket: it still gets a fresh id");

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ");
const rr = strip(fs.readFileSync("./app/api/tickets/[id]/reply/route.js", "utf8"));
const pr = strip(fs.readFileSync("./app/api/tickets/[id]/route.js", "utf8"));
ok(/if \(!r\.sent\) console\.error\(`ticket \$\{what\} email not sent:`, r\.status \? `Zapier answered \$\{r\.status\}` : r\.reason\)/.test(rr)
   && /if \(!r\.sent\) console\.error\("ticket status email not sent:"/.test(pr), "an email that doesn't go out is always logged, with why");

console.log(`\nbuild172: ${p} passed, ${f} failed`);
if (f) process.exit(1);
