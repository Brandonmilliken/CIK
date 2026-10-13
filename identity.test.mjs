/* identity.test.mjs — who gets in, and what they are allowed to be.
 *
 * auth.js is three small callbacks and the entire security model rests on them:
 * signIn decides whether a Google account may have a session at all, jwt decides
 * what ROLE that session carries, and session decides what reaches the app. A
 * wrong answer in the middle one is the difference between an agent and an
 * admin.
 *
 * The callbacks are pulled out of auth.js and run against a stub roster, so this
 * exercises the real code without a database or a Google round trip.
 *
 * THE BUG THIS SUITE WAS WRITTEN AROUND: the role was resolved once, at
 * sign-in, and then carried for the life of the session — thirty days, by JWT
 * default. So `update agents set role = 'leadership'` did nothing visible until
 * the person signed out and back in (with nothing on screen to say why), a
 * revoked role stayed usable for a month, and a one-second database blip at
 * sign-in silently demoted a broker until they noticed.
 */
import fs from "node:fs";

let p = 0, f = 0;
const ok = (c, m) => { c ? p++ : (f++, console.log("  FAIL:", m)); };

/* Pull the callbacks object out of auth.js and evaluate it with our own
   agentByEmail and authz functions injected. */
const SRC = fs.readFileSync("./auth.js", "utf8");
function block(start, fromParen = false) {
  const a = SRC.indexOf(start);
  if (a < 0) throw new Error(`${start} not found in auth.js`);
  /* For a function, the first "{" after the name is the PARAMETER
     destructuring — `async signIn({ profile })` — not the body. Matching from
     there returns "{ profile }" and every assertion about the body then fails
     for no reason at all. Start after the closing paren instead. */
  const from = fromParen ? SRC.indexOf(")", a) : a;
  let d = 0;
  for (let i = SRC.indexOf("{", from); i < SRC.length; i++) {
    if (SRC[i] === "{") d++;
    else if (SRC[i] === "}" && --d === 0) return SRC.slice(a, i + 1);
  }
  throw new Error(`${start} never closes`);
}
const callbacksSrc = block("callbacks: {").replace(/^callbacks:\s*/, "");

let roster = {};        // email -> agent row, or a thrower
let lookups = 0;
/* CIK: the first sign-in adds the person to the people list (ensureAgent in
   lib/db.js). The stub records every call; with ADD_ON_ENSURE set it also
   puts them on the roster, as the real insert would. */
let ensured = [];
let ADD_ON_ENSURE = false;
const ensureAgent = async (email, firstName, lastName) => {
  const key = String(email || "").toLowerCase();
  ensured.push({ email, firstName, lastName, rosterHadThem: !!roster[key] });
  if (roster[key] === "THROW") throw new Error("database unreachable");
  if (ADD_ON_ENSURE && !roster[key]) roster[key] = { email: key, sisu_agent_id: null, role: "agent", first_name: firstName, last_name: lastName, left_at: null };
  return true;
};
const agentByEmail = async (email) => {
  lookups++;
  const v = roster[String(email || "").toLowerCase()];
  if (v === "THROW") throw new Error("database unreachable");
  return v || null;
};

/* The real allow-list functions, so this is not testing a copy of them. */
const { isAllowedIdentity, allowedDomains, allowedEmails, effectiveRole, isSuperAdmin } = await import("./lib/authz.js");

const quiet = { warn() {}, log() {}, error() {} };
const cb = new Function(
  "agentByEmail", "ensureAgent", "isAllowedIdentity", "allowedDomains", "allowedEmails", "effectiveRole", "isSuperAdmin", "console",
  `return (${callbacksSrc});`
)(agentByEmail, ensureAgent, isAllowedIdentity, allowedDomains, allowedEmails, effectiveRole, isSuperAdmin, quiet);

process.env.ALLOWED_EMAIL_DOMAINS = "cashisking.com";
process.env.ALLOWED_EMAILS = "helper@example.org";

/* ---- signIn: who may have a session at all ------------------------------ */
{
  const tryIn = (email, verified) => cb.signIn({ profile: { email, email_verified: verified } });

  ok(await tryIn("andy@cashisking.com", true) === true, "a company address signs in");
  ok(await tryIn("helper@example.org", true) === true, "a listed individual signs in");
  ok(await tryIn("someone@gmail.com", true) === false, "an outside address does not");

  /* Google's hd parameter only pre-filters the account chooser. An unverified
     address must be refused whatever domain it claims to be. */
  ok(await tryIn("andy@cashisking.com", false) === false,
     "an UNVERIFIED company address is refused");
  ok(await tryIn("andy@cashisking.com", undefined) === true,
     "an absent verified flag is allowed — only an explicit false is a refusal");

  ok(await cb.signIn({ profile: null }) === false, "no profile is refused");
  ok(await cb.signIn({}) === false, "no profile at all is refused, not crashed");

  for (const spoof of ["andy@cashisking.com.evil.com", "andy@notcashisking.com",
                       "andy@cashisking.co", "andy@.cashisking.com",
                       /* The one that mattered: split("@")[1] takes the SECOND
                          segment, so this read as cashisking.com while the
                          address belongs to evil.com. */
                       "andy@cashisking.com@evil.com",
                       "a@b@cashisking.com",
                       "@cashisking.com",          // no local part
                       "andy@"]) {                      // no domain
    ok(await tryIn(spoof, true) === false, `a malformed or look-alike address is refused: ${spoof}`);
  }
  /* An unusual but legal local part is NOT a spoof — the domain is what the
     allow-list is about, and Google verified it. */
  ok(await tryIn("andy+leads@cashisking.com", true) === true,
     "a plus-addressed company address still signs in");
  ok(await tryIn("first.last@cashisking.com", true) === true,
     "and a dotted one");
}

/* ---- jwt: what role the session carries --------------------------------- */
{
  roster = {
    "andy@cashisking.com":
      { sisu_agent_id: null, role: "agent", first_name: "Andy", last_name: "Wilcox" },
    "pat@cashisking.com":
      { sisu_agent_id: 1, role: "leadership", first_name: "Pat", last_name: "Boss" },
  };

  const t1 = await cb.jwt({ token: { email: "andy@cashisking.com" }, trigger: "signIn" });
  ok(t1.role === "agent", "an agent's role comes from the roster");
  ok(t1.sisuAgentId === null, "and no Sisu id (Cash Is King has none), null rather than undefined");
  ok(t1.displayName === "Andy Wilcox", "and their name");
  ok(typeof t1.rolesAt === "number", "and the resolution is stamped, so it can go stale");

  /* Staff with no Sisu record — marketing desk, TC. They sign in fine. */
  const t2 = await cb.jwt({ token: { email: "newhire@cashisking.com", name: "New Hire" },
                            trigger: "signIn" });
  ok(t2.role === "agent", "someone not on the roster gets the LEAST privilege");
  ok(t2.sisuAgentId === null, "and no agent id");
  ok(t2.displayName === "New Hire", "falling back to the Google name");

  /* THE PROMOTION. This is the exact command in DEPLOY.txt, and it used to do
     nothing until the person signed out and back in. */
  roster["andy@cashisking.com"].role = "leadership";
  const fresh = { ...t1, rolesAt: Date.now() - 20 * 60 * 1000 };   // 20 minutes old
  const t3 = await cb.jwt({ token: fresh });
  ok(t3.role === "leadership",
     "a role changed in the database reaches an existing session without a re-login");

  /* And the other direction, which matters more.
   *
   * Started from a token that EXPLICITLY carries leadership, rather than from
   * t3. On the old code t3 was never upgraded in the first place, so asserting
   * "it came back down to agent" passed there too — for the wrong reason, which
   * is the same as not testing it. */
  roster["andy@cashisking.com"].role = "agent";
  const wasPromoted = { email: "andy@cashisking.com", sisuAgentId: null,
                        role: "leadership", displayName: "Andy Wilcox",
                        rolesAt: Date.now() - 20 * 60 * 1000 };
  const t4 = await cb.jwt({ token: wasPromoted });
  ok(t4.role === "agent", "a REVOKED role stops working without waiting for a re-login");

  /* But not on every single request — that would be a database round trip per
     token refresh for a value that changes twice a year. */
  lookups = 0;
  const warm = { ...t4, rolesAt: Date.now() };
  await cb.jwt({ token: warm });
  await cb.jwt({ token: warm });
  ok(lookups === 0, "a freshly-resolved token is not looked up again on every refresh");

  /* An explicit session update always re-resolves, whatever the clock says. */
  lookups = 0;
  await cb.jwt({ token: { ...t4, rolesAt: Date.now() }, trigger: "update" });
  ok(lookups === 1, "an explicit session update re-resolves immediately");
}

/* ---- jwt: when the database is having a bad second ---------------------- */
{
  roster = { "andy@cashisking.com": "THROW" };

  /* First sign-in, lookup fails: least privilege, and the app still works. */
  const cold = await cb.jwt({ token: { email: "andy@cashisking.com", name: "Andy" },
                              trigger: "signIn" });
  ok(cold.role === "agent", "a failed lookup at sign-in gives the LEAST privilege");
  ok(cold.sisuAgentId === null, "and no agent id");
  ok(cold.role !== undefined, "and never leaves the role undefined, which nothing downstream checks");

  /* Already resolved, lookup fails on refresh: KEEP what we had. Demoting a
     broker mid-session because the database blinked is a worse answer than
     using a fifteen-minute-old one. */
  roster = { "pat@cashisking.com": "THROW" };
  const known = { email: "pat@cashisking.com", sisuAgentId: 1, role: "leadership",
                  displayName: "Pat Boss", rolesAt: Date.now() - 60 * 60 * 1000 };
  const after = await cb.jwt({ token: known });
  ok(after.role === "leadership",
     "a database blip does NOT demote an already-resolved session");
  ok(after.sisuAgentId === 1, "and does not lose their agent id");
  ok(after.rolesAt === known.rolesAt,
     "and does not stamp a failure as a success — it retries on the next refresh");
}

/* ---- CIK: the first sign-in adds the person to the people list ----------- */
{
  roster = {};
  ensured = [];
  ADD_ON_ENSURE = true;
  const t = await cb.jwt({ token: { email: "newbie@cashisking.com", name: "New Bie" }, trigger: "signIn",
                           profile: { given_name: "New", family_name: "Bie" } });
  ok(ensured.length === 1 && ensured[0].email === "newbie@cashisking.com" && ensured[0].firstName === "New" && ensured[0].lastName === "Bie",
     "a first sign-in adds them, with Google's first and last name");
  ok(roster["newbie@cashisking.com"] && t.role === "agent" && t.displayName === "New Bie",
     "and the lookup that follows finds them, as an agent");

  ensured = [];
  await cb.jwt({ token: { ...t, rolesAt: 0 } });
  await cb.jwt({ token: { ...t, rolesAt: Date.now() }, trigger: "update" });
  ok(ensured.length === 0, "a refresh or a session update never adds anyone (only a sign-in does)");

  roster["andy@cashisking.com"] = { email: "andy@cashisking.com", sisu_agent_id: null, role: "leadership", first_name: "Andy", last_name: "Wilcox", left_at: null };
  ensured = [];
  const again = await cb.jwt({ token: { email: "andy@cashisking.com" }, trigger: "signIn", profile: { given_name: "X", family_name: "Y" } });
  ok(ensured.length === 1 && again.role === "leadership" && again.displayName === "Andy Wilcox",
     "signing in again keeps the role and name already on file");

  ensured = [];
  ok(await cb.jwt({ token: { email: "someone@gmail.com" }, trigger: "signIn", profile: {} }) === null && ensured.length === 0,
     "an address that isn't allowed is never added");

  roster = { "flaky@cashisking.com": "THROW" };
  const flaky = await cb.jwt({ token: { email: "flaky@cashisking.com", name: "Flaky" }, trigger: "signIn" });
  ok(flaky && flaky.role === "agent", "if adding them fails, the sign-in still works, as an agent");
  ADD_ON_ENSURE = false;
  ok(/await ensureAgent\(token\.email, profile\?\.given_name \|\| "", profile\?\.family_name \|\| ""\)\.catch\(\(\) => \{\}\);/.test(SRC) &&
     SRC.indexOf("await ensureAgent(") < SRC.indexOf("await agentByEmail(token.email)"), "it is added before it is looked up");
}

/* ---- session: what reaches the app -------------------------------------- */
{
  const s = await cb.session({
    session: { user: {} },
    token: { email: "andy@cashisking.com", sisuAgentId: 11373,
             role: "leadership", displayName: "Andy Wilcox" },
  });
  ok(s.user.email === "andy@cashisking.com", "the email reaches the session");
  ok(s.user.role === "leadership", "so does the role");
  ok(s.user.sisuAgentId === 11373, "and the agent id");

  /* A token missing its fields must not produce a session with an undefined
     role: every check downstream is atLeast(role, ...), and atLeast(undefined)
     is false, but a missing field is easier to mis-handle than an explicit one. */
  const bare = await cb.session({ session: { user: {} }, token: { email: "x@y.com" } });
  ok(bare.user.role === "agent", "a token with no role yields the least privilege, explicitly");
  ok(bare.user.sisuAgentId === null, "and a null agent id rather than undefined");
  ok(bare.user.displayName === "x@y.com", "and falls back to the address for a name");
}

/* ---- the configuration around them -------------------------------------- */
{
  ok(/scope:\s*"openid email profile"/.test(SRC),
     "the Google scopes are identity only — no Gmail, no Drive");
  ok(!/gmail|drive|calendar/i.test(SRC.split("callbacks:")[0].replace(/\/\*[\s\S]*?\*\//g, "")),
     "and no other scope has crept into the provider config");
  ok(/strategy:\s*"jwt"/.test(SRC), "sessions are JWTs, which is why staleness mattered");
  ok(/pages:\s*\{[^}]*signIn:/.test(SRC), "a refused sign-in lands on our own page");

  /* The rejection log is how an admin tells a wrong account from a mis-typed
     allowlist. It must name the address AND the list it failed. */
  const signInSrc = block("async signIn(", true);
  ok(/attemptedEmail/.test(signInSrc), "a refusal logs the address that was tried");
  ok(/allowedDomains\(\)/.test(signInSrc) && /allowedEmails\(\)/.test(signInSrc),
     "and the allow-list it was measured against");
  ok(!/clientSecret|GOOGLE_CLIENT_SECRET/.test(signInSrc),
     "and never a secret");
}

/* ---- v177 (scan): leaving ends a session at the next check ------------- */
{
  roster["gone@cashisking.com"] = { email: "gone@cashisking.com", sisu_agent_id: 7, first_name: "Gone", last_name: "Agent", role: "leadership", left_at: "2026-10-01T00:00:00Z" };
  const stale = { email: "gone@cashisking.com", sisuAgentId: 7, role: "leadership", rolesAt: Date.now() - 60 * 60 * 1000 };
  ok(await cb.jwt({ token: stale }) === null, "someone the roster says has left is signed out at the next role check");
  const freshGone = { email: "gone@cashisking.com", sisuAgentId: 7, role: "leadership", rolesAt: Date.now() };
  ok((await cb.jwt({ token: freshGone }))?.email === "gone@cashisking.com", "not before it (one lookup per fifteen minutes, as before)");
  const outsider = { email: "someone@gmail.com", sisuAgentId: null, role: "agent", rolesAt: 0 };
  ok(await cb.jwt({ token: outsider }) === null, "an address no longer allowed (a domain taken off the list) is signed out too");
  roster["still@cashisking.com"] = { email: "still@cashisking.com", sisu_agent_id: 8, first_name: "Still", last_name: "Here", role: "agent", left_at: null };
  ok((await cb.jwt({ token: { email: "still@cashisking.com", rolesAt: 0 } }))?.role === "agent", "someone still here carries on as normal");
  roster["blip@cashisking.com"] = "THROW";
  const blip = { email: "blip@cashisking.com", sisuAgentId: 9, role: "broker", rolesAt: 0 };
  ok((await cb.jwt({ token: blip }))?.role === "broker", "a database hiccup still keeps the session (it isn't a departure)");
}

console.log(`\nidentity: ${p} passed, ${f} failed`);
if (f) process.exit(1);
