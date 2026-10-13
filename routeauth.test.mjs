/* routeauth.test.mjs — who can reach each endpoint, and with what.
 *
 * There is no auth middleware in this app. Every route does its own check, which
 * means a route added later can simply forget to — and nothing anywhere would
 * say so. This suite reads every route file on disk and insists each one carries
 * a check of some kind, so the omission is a failing test rather than a quiet
 * hole discovered by whoever finds the URL first.
 *
 * It also covers the specific way in that was open in Jarvis: /api/admin/run
 * skipped the admin check whenever JARVIS_DEMO_EMAIL was set, for the life of
 * the deployment. CIK Office's admin route has no demo bypass at all.
 * (Jarvis's cron, webhook and feed routes, and their checks, did not come
 * over.)
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

let p = 0, f = 0;
const ok = (c, m) => { c ? p++ : (f++, console.log("  FAIL:", m)); };

const API = "./app/api";
function routeFiles(dir = API, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) routeFiles(full, out);
    else if (/^route\.(js|jsx|ts)$/.test(e.name)) out.push(full);
  }
  return out;
}
const routes = routeFiles();
ok(routes.length >= 4, `found the API routes on disk (${routes.length})`);

/* Every route must authenticate somehow. CIK Office has two ways: a session
   (currentUser), or being the auth handler itself. (Jarvis's cron bearer and
   webhook secrets went with the routes that used them.) */
const AUTH_PATTERNS = [
  /currentUser\s*\(/,            // signed-in session
  /from ["'].*\/auth\.js["']/,   // the NextAuth handler
];
for (const gone of ["./app/api/cron", "./app/api/hooks", "./app/api/feed", "./app/api/shilo", "./app/api/answers"]) {
  ok(!fs.existsSync(gone), `${gone} is not here (no unauthenticated entry point came over with it)`);
}
for (const file of routes) {
  const src = fs.readFileSync(file, "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const guarded = AUTH_PATTERNS.some(re => re.test(code));
  ok(guarded, `${file} carries an authentication check of some kind`);
}

/* ---- /api/admin/run --------------------------------------------------- */
{
  const src = fs.readFileSync("./app/api/admin/run/route.js", "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ");

  ok(/if \(!user\)[\s\S]{0,120}401/.test(code), "an unauthenticated caller gets 401");
  ok(/atLeast\(user\.role, "admin"\)/.test(code), "the role check is admin-and-above");

  /* THE BYPASS. Jarvis kept one for an empty roster in demo mode; CIK Office
     has none, so nothing about demo mode may appear here at all. */
  ok(!/\.demo\b/.test(code) && !/rosterIsEmpty|bootstrap/.test(code),
     "demo mode never skips the role check (there is no bypass)");
  const head = code.slice(code.indexOf("export async function GET"), code.indexOf("switch (job)"));
  ok(/if \(!atLeast\(user\.role, "admin"\)\) \{\s*return Response\.json/.test(head),
     "the role check refuses outright, before any job is chosen");
  ok(/why:/.test(code), "a refusal says WHICH condition failed, not just 'forbidden'");
  /* From scan139 (v139): admin jobs are never started from another site. */
  ok(/const site = \(req\.headers\.get\("sec-fetch-site"\) \|\| ""\)\.toLowerCase\(\);\s*if \(site && site !== "same-origin" && site !== "none"\) \{/.test(code),
     "a job started by a link on another site is refused");
  ok(code.indexOf('get("sec-fetch-site")') > 0 && code.indexOf('get("sec-fetch-site")') < code.indexOf('searchParams.get("job")'),
     "and it is checked before any job is even read");
  ok(/no-store/.test(code), "refusals are not cached, so a fixed role takes effect at once");

  /* Fails closed. rosterIsEmpty (still in lib/db.js) touches the database; if
     that call fails it must answer "there IS a roster" rather than "empty",
     so nothing built on it can open on a database hiccup. The test is real:
     DATABASE_URL points at a host that does not resolve. */
  const { rosterIsEmpty } = await import("./lib/db.js");
  const answer = await rosterIsEmpty();
  ok(answer === false,
     "rosterIsEmpty fails CLOSED when the database cannot be reached");
}

/* ---- the page itself --------------------------------------------------- */
{
  const code = fs.readFileSync("./app/page.jsx", "utf8");
  ok(/const user = await currentUser\(\)/.test(code) && /redirect\([^;]*[`"]\/signin\?next=[^;]*: "\/signin"\)/.test(code),
     "the home page redirects an unauthenticated visitor to sign-in");
  ok(/force-dynamic/.test(code),
     "and is never statically cached, which would serve one person's page to another");
}

console.log(`\nrouteauth: ${p} passed, ${f} failed`);
if (f) process.exit(1);
