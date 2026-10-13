/* build171.test.mjs — v171: emails for ticket updates, through the same
 * Zapier hook as new tickets. The support team's update (or a new status)
 * emails the agent who filed it; the agent's answer emails the support list. */
import fs from "node:fs";
process.env.DATABASE_URL ||= "postgresql://test:test@localhost.invalid/test";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const read = path => strip(fs.readFileSync(path, "utf8"));
const lib = read("lib/tickets.js");

/* ---- the emails (through the same Zapier hook as new tickets) ---- */
const N = await import("./lib/ticket-notify.js");
const tk = { id: "7", title: "Lockbox won't sync", status: "Waiting on agent", submittedBy: "Leona@CashIsKing.com", submittedName: "Leona Mullen" };
const up = N.updatePayload(tk, "Reset it from Settings.\nTell me if that works.", { email: "Paris@CashIsKing.com", displayName: "Paris T" }, "https://j.test");
ok(up.event === "ticket.update" && up.ticketId === "7" && up.to === "leona@cashisking.com" && up.replyTo === "paris@cashisking.com", "an update goes to the agent who filed it; replying to the email reaches whoever wrote it");
ok(up.subject === "Update on your help ticket: Lockbox won't sync" && up.text.startsWith("Paris T replied to your help ticket.")
   && up.text.includes("Status: Waiting on agent") && up.text.includes("Reset it from Settings.\nTell me if that works.") && up.text.endsWith("in Jarvis: https://j.test/office/my-tickets"),
   "it says who replied, the status, the message, and links to My Tickets");
const st = N.updatePayload({ ...tk, status: "Resolved" }, "", { email: "x@cashisking.com" }, "https://j.test");
ok(st.subject === "Your help ticket is now Resolved: Lockbox won't sync" && st.text.startsWith("Your help ticket is now Resolved.") && !st.text.includes("undefined"), "a status change on its own says so");
const ar = N.agentReplyPayload({ ...tk, status: "In review" }, "Fixed, thanks!", "https://j.test");
ok(ar.event === "ticket.agent-reply" && !("to" in ar) && ar.submittedBy === tk.submittedBy && ar.subject === "Reply on help ticket: Lockbox won't sync"
   && ar.text.startsWith("Leona Mullen replied on their help ticket.") && ar.text.endsWith("Open the Support Center: https://j.test/office/support"),
   "an agent's answer goes to the support list (the Zap's own list; no address in it), and links to the Support Center");
let calls = [];
const fakeFetch = async (url, o) => { calls.push({ url, body: JSON.parse(o.body), redirect: o.redirect }); return { ok: true, status: 200 }; };
const HOOK = "https://hooks.zapier.com/hooks/catch/1/abc/";
let r = await N.notifyTicketUpdate(tk, "Hi", { email: "a@cashisking.com" }, { url: HOOK, fetchImpl: fakeFetch });
ok(r.sent && calls.length === 1 && calls[0].url === HOOK && calls[0].body.event === "ticket.update" && calls[0].redirect === "error", "it posts once to the hook");
r = await N.notifyTicketUpdate({ ...tk, submittedBy: "not an email" }, "Hi", {}, { url: HOOK, fetchImpl: fakeFetch });
ok(!r.sent && calls.length === 1, "no address on the ticket: nothing sent");
r = await N.notifyAgentReply(tk, "   ", { url: HOOK, fetchImpl: fakeFetch });
ok(!r.sent && calls.length === 1, "an empty answer: nothing sent");
r = await N.notifyAgentReply(tk, "ok", { url: null, fetchImpl: fakeFetch });
ok(!r.sent && calls.length === 1, "no hook set: nothing sent, nothing breaks");
r = await N.notifyAgentReply(tk, "ok", { url: HOOK, fetchImpl: async () => { throw new Error("down"); } });
ok(!r.sent && r.reason === "down", "Zapier down: it says so, never throws");

const rr = read("app/api/tickets/[id]/reply/route.js");
ok(/const t = await supportReply\([\s\S]*?emailLater\(\(\) => notifyTicketUpdate\(t, t\.savedBody, user\), "update"\)/.test(rr)
   && /const t = await agentReply\([\s\S]*?emailLater\(\(\) => notifyAgentReply\(t, t\.savedBody\), "agent reply"\)/.test(rr)
   && /function emailLater\(send, what\) \{\s*after\(/.test(rr), "both kinds of message email after the reply is answered, so Zapier never slows it");
const pr = read("app/api/tickets/[id]/route.js");
ok(/const t = await updateTicket\(id, body, user\.email\);\s*if \(t\.statusChanged\) \{\s*after\(async \(\) => \{\s*const r = await notifyTicketUpdate\(t, "", user\);/.test(pr), "Update status emails the agent only when the status really changed");
ok(/return Object\.assign\(after, \{ statusChanged: moved && !self \}\);/.test(lib), "which updateTicket reports (v177: not about your own ticket)");

console.log(`\nbuild171: ${p} passed, ${f} failed`);
if (f) process.exit(1);
