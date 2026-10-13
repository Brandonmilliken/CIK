/* build156.test.mjs — v156 (Brandon, 2026-10-06): an email for every new
 * help ticket, sent by a Zap that Jarvis tells about the ticket. */
import fs from "node:fs";
import { ticketHookUrl, ticketPayload, notifyNewTicket } from "./lib/ticket-notify.js";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

ok(ticketHookUrl("https://hooks.zapier.com/hooks/catch/123/abc/") === "https://hooks.zapier.com/hooks/catch/123/abc/", "a Zapier catch hook is used");
ok([undefined, "", "  ", "http://hooks.zapier.com/x", "https://evil.example.com/hooks.zapier.com", "https://hooks.zapier.com.evil.io/x", "https://u:p@hooks.zapier.com/x", "not a url"].every(v => ticketHookUrl(v) === null),
   "anything else is ignored, so a typo can't send tickets elsewhere");

const t = { id: "42", title: "Printer\u0007 is down", category: "Tech", priority: "High", details: "x".repeat(5000), submittedBy: "andy@cashisking.com", submittedName: "Andy Wilcox", createdAt: "2026-10-06T17:00:00.000Z" };
const pl = ticketPayload(t, "https://jarvis.cikoffice.com");
ok(pl.event === "ticket.created" && pl.id === "42" && pl.category === "Tech" && pl.priority === "High" && pl.submittedName === "Andy Wilcox", "the ticket's fields, for the email");
ok(pl.title === "Printer is down" && pl.details.startsWith("x".repeat(4000)) && /continued in Jarvis/.test(pl.details) && pl.details.length < 4100, "cleaned and capped");
ok(pl.subject === "New help ticket: Printer is down" && /Andy Wilcox filed a help ticket in Jarvis\./.test(pl.text) && pl.link === "https://jarvis.cikoffice.com/office/support", "a ready-made subject, body and Support Center link");

let sent = null;
const r = await notifyNewTicket(t, { url: "https://hooks.zapier.com/hooks/catch/1/2/", fetchImpl: async (u, o) => { sent = { u, o }; return { ok: true, status: 200 }; } });
ok(r.sent && sent.o.method === "POST" && JSON.parse(sent.o.body).id === "42" && sent.o.redirect === "error", "one POST of the ticket to Zapier");
const none = await notifyNewTicket(t, { url: null, fetchImpl: async () => { throw new Error("must not be called"); } });
ok(!none.sent && /not set/.test(none.reason), "no hook set: nothing is sent, nothing breaks");
const down = await notifyNewTicket(t, { url: "https://hooks.zapier.com/x", fetchImpl: async () => { throw new Error("network down"); } });
ok(!down.sent && /network down/.test(down.reason), "Zapier down: the ticket is still filed (this never throws)");

const route = strip(fs.readFileSync("./app/api/tickets/route.js", "utf8"));
ok(/const ticket = await createTicket\(user, body\);\s*after\(async \(\) => \{\s*const r = await notifyNewTicket\(ticket\);/.test(route), "sent after the ticket is saved, after the reply");
const admin = strip(fs.readFileSync("./app/api/admin/run/route.js", "utf8"));
ok(/case "ticket-email-test": \{/.test(admin) && /TEST: please ignore/.test(admin), "an admin test that sends a sample marked as a test");
console.log(`\nbuild156: ${p} passed, ${f} failed`);
if (f) process.exit(1);
