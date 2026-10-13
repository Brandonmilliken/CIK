/* acks.test.mjs — v127: acknowledging announcements. */
import fs from "node:fs";
import { splitAnnouncements } from "./lib/announcement-acks.js";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const items = [
  { id: "1", fields: { title: "Office closed Friday", message: "Lunch", show: "Yes" } },
  { id: "2", fields: { title: "New lockbox codes", show: "Yes" } },
  { id: "3", fields: { title: "Hidden one", show: "No" } },
  { id: "4", fields: { title: "Fourth", show: "Yes" } },
  { id: "5", fields: { title: "Fifth", show: "Yes" } },
  { id: "6", fields: { message: "no title" } },
];
{
  const { current, acknowledged } = splitAnnouncements(items, new Map());
  ok(current.map(a => a.id).join() === "1,2,4,5", "nothing acknowledged: the top shows every one set to show, in order");
  ok(acknowledged.length === 0, "and the box is empty");
  ok(current.every(a => !("acks" in a) && !("notYet" in a)), "no record for someone who is not an admin");
}
{
  const mine = new Map([["1", "2026-09-30T10:00:00Z"], ["2", "2026-09-30T12:00:00Z"]]);
  const { current, acknowledged } = splitAnnouncements(items, mine);
  ok(current.map(a => a.id).join() === "4,5", "acknowledged ones leave the top, and the next ones move up");
  ok(acknowledged.map(a => a.id).join() === "2,1" && acknowledged[0].ackedAt === "2026-09-30T12:00:00Z", "they go into the box, most recent first, with when");
}
{
  const byItem = new Map([["1", [{ email: "Andy@CashIsKing.com", name: "Andy Wilcox", at: "2026-09-30T10:00:00Z" }]]]);
  const roster = [{ email: "andy@cashisking.com", first_name: "Andy", last_name: "Wilcox" }, { email: "leona@cashisking.com", first_name: "Leona", last_name: "Park" }, { email: "bo@cashisking.com", first_name: "Bo", last_name: "Ames" }];
  const { current } = splitAnnouncements(items, new Map(), byItem, roster);
  const a1 = current.find(a => a.id === "1"), a2 = current.find(a => a.id === "2");
  ok(a1.acks.length === 1 && a1.acks[0].name === "Andy Wilcox" && !("email" in a1.acks[0]), "admins see who acknowledged, by name and time (no emails sent to the page)");
  ok(a1.notYet.join() === "Bo Ames,Leona Park", "and who has not yet, alphabetically");
  ok(a2.acks.length === 0 && a2.notYet.length === 3, "an announcement nobody has acknowledged lists everyone as not yet");
}
{
  const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), fields: { title: "A" + i } }));
  const mine = new Map(many.map((x, i) => [x.id, new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString()]));
  const { acknowledged } = splitAnnouncements(many, mine);
  ok(acknowledged.length === 20 && acknowledged[0].id === "30", "the box keeps the 20 most recent");
}

/* ---- the route ---- */
{
  const r = strip(fs.readFileSync("./app/api/announcements/ack/route.js", "utf8"));
  ok(/const user = await currentUser\(\)/.test(r) && /status: s|401/.test(r), "only a signed-in person can acknowledge");
  ok(/if \(!sameOrigin\(req\)\)/.test(r), "only from Jarvis itself");
  ok(/acknowledge\(id, user\.email, user\.displayName \|\| user\.email\)/.test(r) && !/b\.email|b\.name/.test(r), "always as the signed-in person, never a name or email from the request");
  ok(/items\.some\(i => String\(i\.id\) === id && i\.fields\?\.show !== "No" && i\.fields\?\.title\)/.test(r), "only a real announcement");
  ok(!/export async function (DELETE|PUT|PATCH)/.test(r), "and it can't be undone here: the record only grows");
  const lib = strip(fs.readFileSync("./lib/announcement-acks.js", "utf8"));
  ok(/on conflict \(item_id, email\) do nothing/.test(lib), "acknowledging twice keeps the first time");
}
/* ---- the home page (CIK: it replaces Jarvis's dashboard feed) ---- */
{
  const code = strip(fs.readFileSync("./app/page.jsx", "utf8"));
  ok(/acksFor\(user\.email\)/.test(code), "the top of the page follows whose page it is: the signed-in person's own acknowledgements");
  ok(/splitAnnouncements\(items, mine\)/.test(code) && !/splitAnnouncements\(items, mine, /.test(code), "the home page gets only this person's split, not the admin record");
  ok(/announcements=\{ann\.current\}/.test(code) && /acknowledged=\{ann\.acknowledged/.test(code), "the box is sent too");
  ok(/listItems\("announcements"\)/.test(code), "read from the Announcements room");
}
/* ---- the page ---- */
{
  const d = strip(fs.readFileSync("./app/home.jsx", "utf8"));
  ok(/fetch\("\/api\/announcements\/ack"/.test(d) && /method: "POST"/.test(d) && /JSON\.stringify\(\{ id: a\.id \}\)/.test(d), "each announcement's Got it posts only its id");
  ok(/onClick=\{\(\) => gotIt\(a\)\}/.test(d) && /disabled=\{busy === a\.id\}/.test(d), "each announcement has its own button, disabled while saving");
  ok(/if \(!r\.ok\) throw/.test(d) && d.indexOf("if (!r.ok) throw") < d.indexOf("setOpen(list => list.filter(x => x.id !== a.id))"),
     "it leaves the top only once the save succeeded");
  ok(/Couldn't save that just now/.test(d), "if saving fails it says so");
  ok(/Announcements you&rsquo;ve read/.test(d) && /acknowledged\.map\(a =>/.test(d), "acknowledged ones go into a box of their own");
  const room = fs.readFileSync("./app/office/[room]/page.jsx", "utf8");
  ok(/room\.slug === "announcements" && atLeast\(user\.role, "admin"\)/.test(room) && /<AnnouncementAcks rows=\{ackRows\} \/>/.test(room), "the Announcements room shows admins the full record");
}

/* ---- v136: no limit; they stay until acknowledged ---- */
{
  const many = Array.from({ length: 25 }, (_, i) => ({ id: String(i + 1), fields: { title: "A" + i, show: "Yes" } }));
  let r = splitAnnouncements(many, new Map());
  ok(r.current.length === 25 && r.current[0].id === "1" && r.current[24].id === "25", "25 unacknowledged announcements: all 25 at the top, in order");
  r = splitAnnouncements(many, new Map([["3", "2026-10-01T10:00:00Z"]]));
  ok(r.current.length === 24 && !r.current.some(a => a.id === "3") && r.acknowledged.map(a => a.id).join() === "3", "only acknowledging takes one away");
  const home = strip(fs.readFileSync("./app/home.jsx", "utf8"));
  ok(/useState\(announcements\)/.test(home) && /open\.map\(a =>/.test(home) && !/open\.slice\(/.test(home), "the home page shows every one it is sent");
  ok(!/\.slice\(0, 3\)\.map\(withAcks\)/.test(fs.readFileSync("./lib/announcement-acks.js", "utf8")), "no cap of three any more");
}
console.log(`\nacks: ${p} passed, ${f} failed`);
if (f) process.exit(1);
