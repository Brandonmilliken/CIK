/* build181.test.mjs — v181 (2026-10-12): the deep scan, round 5 (twenty-five
 * reviewers). Database rules run for real in scripts/leases-db-check.mjs
 * (new), scripts/roles-db-check.mjs and scripts/tickets-db-check.mjs. The
 * dashboard, vendor, webhook and roster-sync parts did not come over. */
import fs from "node:fs";
import { register } from "node:module";
/* Route files import next/server and the session; these stand in for them so
   a route's own checks can be run. */
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(s, c, n) {
  if (s === "next/server") return { url: "data:text/javascript,export const after = () => {};", shortCircuit: true };
  if (/\\/lib\\/session\\.js$/.test(s)) return { url: "data:text/javascript,export const currentUser = async () => globalThis.__TEST_USER__ || null;", shortCircuit: true };
  return n(s, c);
}`));
process.env.DATABASE_URL ||= "postgresql://x:x@localhost.invalid/x";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const read = path => strip(fs.readFileSync(path, "utf8"));

/* ---- server: who sees what ---- */
const run = read("app/api/admin/run/route.js");
ok(/if \(mode === "navigate" && site && site !== "none"\)/.test(run), "admin jobs can't be run by following a link inside Jarvis");
ok(/ok: !\(result && result\.error\)/.test(run), "a job that failed says ok: false");
{
  const { GET, POST } = await import("./app/api/roles/route.js");
  globalThis.__TEST_USER__ = { email: "andy@cashisking.com", role: "agent" };
  ok((await GET()).status === 404, "Leadership Settings' list is not for an agent (run, not read)");
  globalThis.__TEST_USER__ = { email: "brandon@cashisking.com", role: "superadmin", demo: true };
  const demo = await POST(new Request("https://j.test/api/roles", { method: "POST", headers: { origin: "https://j.test", host: "j.test", "content-type": "application/json" }, body: JSON.stringify({ email: "a@b.co", role: "admin" }) }));
  ok(demo.status === 403 || demo.status === 404, "no role changes in demo mode");
  globalThis.__TEST_USER__ = null;
}
const roles = read("lib/roles.js");
ok(/async function actorRole\(actor\)/.test(roles) && /if \(found && add && found\.left_at\)/.test(roles) && /isAllowedIdentity\(who, true\)/.test(roles), "roles: a leaver can't act; Add for a leaver says Bring back; only addresses that can sign in");
const auth = read("auth.js");
ok(/agent\.left_at && !isSuperAdmin\(token\.email\)/.test(auth) && /sign-in REJECTED \(marked as left\)/.test(auth), "a super admin is never locked out; a leaver is told at sign-in");
ok(!/@/.test(read("lib/role-rank.js")) && /from "\.\.\/lib\/role-rank\.js"/.test(fs.readFileSync("app/side-menu.jsx", "utf8")) && /from "\.\/role-rank\.js"/.test(fs.readFileSync("lib/office-menu.js", "utf8")),
   "the browser's role helpers carry no one's address (the super-admin list stays on the server)");
{
  const { cleanUrl } = await import("./lib/office-fields.js");
  ok(cleanUrl("https://www.cikoffice.com//api/admin/run") === "" && cleanUrl("https://www.cikoffice.com/%2Fapi/x") === "" && cleanUrl("https://cikoffice.com/api/admin/run") === "" &&
     cleanUrl("https://www.cikoffice.com/apiary") !== "" && cleanUrl("https://www.cikoffice.com/office/vendors") !== "",
     "card links: Jarvis's API refused however it's spelled");
}
ok(/!canSeeRoom\(room, user\.role\)\) return json\(\{ error: "not found" \}, 404\)/.test(read("lib/office-api.js")), "a room you can't see answers Not found, even to a write");
ok(/i\.fields\?\.show !== "No"/.test(read("app/api/announcements/ack/route.js")), "only a showing announcement can be acknowledged");

/* ---- the rest ---- */
ok(/if \(!r\.ok\) unsynced\(false\)|if \(r\.ok\) unsynced\(false\)/.test(fs.readFileSync("app/side-menu.jsx", "utf8")) && /window\.addEventListener\("storage", onStorage\)/.test(fs.readFileSync("app/side-menu.jsx", "utf8")), "a theme picked in another tab shows here");
{
  const { ticketPayload } = await import("./lib/ticket-notify.js");
  const t = ticketPayload({ id: "1", title: "x", details: "see‮ fdp" + "a".repeat(4100), submittedBy: "a@b.co" }, "https://j.test");
  ok(!/‮/.test(t.details) && /continued in Jarvis/.test(t.details), "ticket emails: no hidden direction marks, and a cut says so");
}
ok(/order by id`;/.test(fs.readFileSync("lib/tickets.js", "utf8")), "ticket messages in the order they were saved");
const tui = fs.readFileSync("app/tickets.jsx", "utf8");
ok(tui.indexOf("const [keep, setKeep] = useState(null);") < tui.indexOf("const shown = only === \"All\""), "the Support Center's \"keep\" exists before the list uses it");
ok(/document\.getElementById\(`jx-tsum-\$\{t\.id\}`\)\?\.parentElement;\s*if \(det && det\.open\)/.test(tui), "a ticket hidden by a filter isn't marked seen");
ok(/draftKey=\{`agent:\$\{t\.id\}`\}/.test(tui) && /draftKey=\{`support:\$\{t\.id\}`\}/.test(tui), "drafts kept per room");
ok(/typed === form\.autoName \? auto : typed/.test(fs.readFileSync("app/office-list.jsx", "utf8")), "a second file pick renames the upload");
ok(/alter table agents add column if not exists left_at timestamptz/.test(fs.readFileSync("sql/schema.sql", "utf8")) && /left_at\s+timestamptz/.test(fs.readFileSync("sql/schema.sql", "utf8")), "a new database can fill its people list (left_at exists first)");
const css = fs.readFileSync("app/shell.css", "utf8");
ok(/\.jx-installcard #toastbox/.test(css) && /color-scheme: dark;/.test(css) && /\.jx-segs:not\(\.jx-segs2\) \.jx-seg:nth-child\(2\)/.test(css), "notices move off the install card; dark controls; theme buttons the same size");
ok(/padding-left: max\(18px, env\(safe-area-inset-left\)\)/.test(css), "a phone turned sideways keeps content clear of the notch");

console.log(`\nbuild181: ${p} passed, ${f} failed`);
if (f) process.exit(1);
