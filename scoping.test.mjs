/* scoping.test.mjs — try to see somebody else's clients.
 *
 * The In Contract board is the most sensitive thing this app holds: real client
 * names and real property addresses for every deal under contract. Two functions
 * stand between an agent and everyone else's — resolveTarget, which decides
 * WHOSE data a request is for, and scrubBoard, which removes the rows that are
 * not theirs.
 *
 * This suite is written from the other side: not "does it work for the ordinary
 * case" but "what could I send that gets me more than I should have". Case,
 * whitespace, nulls, arrays, prototype keys, near-miss addresses, missing
 * fields — every shape a request can take that a test written from the happy
 * path never sends.
 */
import { resolveTarget, scrubBoard, canViewAsOthers, canSeeOthersIncome, canSeeCompany, canSeeAllDeals,
         scrubLeaderboard, atLeast, isAllowedIdentity, effectiveRole, ROLES } from "./lib/authz.js";

let p = 0, f = 0;
const ok = (c, m) => { c ? p++ : (f++, console.log("  FAIL:", m)); };

const AGENT = { email: "andy@cashisking.com", role: "agent", sisu_agent_id: 11373 };
const BROKER = { email: "pat@cashisking.com", role: "leadership", sisu_agent_id: 1 };

/* ---- resolveTarget: whose data is this request for? -------------------- */
{
  ok(resolveTarget(AGENT, null).email === AGENT.email, "no ?agent= means your own data");
  ok(resolveTarget(AGENT, null).viewAs === false, "and that is not an impersonation");

  /* THE ATTEMPT. An agent asks for somebody else and must be given their own
     data — not an error, which would confirm the other account exists. */
  const r = resolveTarget(AGENT, "leona@cashisking.com");
  ok(r.email === AGENT.email, "an agent asking for another agent gets THEIR OWN data");
  ok(r.viewAs === false, "and it is not marked as a view-as");

  /* Case and whitespace. "ANDY@..." is the same person; "leona@..." with a
     capital is still not. */
  ok(resolveTarget(AGENT, "ANDY@CASHISKING.COM").viewAs === false,
     "your own address in any case is not an impersonation");
  ok(resolveTarget(AGENT, "LEONA@cashisking.com").email === AGENT.email,
     "case does not get an agent past the check");

  /* Broker and above may, and it is flagged so the server logs it. */
  const b = resolveTarget(BROKER, "andy@cashisking.com");
  ok(b.email === "andy@cashisking.com", "leadership may view another agent");
  ok(b.viewAs === true, "and it is flagged, which is what triggers the audit row");

  /* Role is a string from the database. Anything unexpected must read as less
     privilege, never more. */
  for (const role of [undefined, null, "", "Agent", "ADMIN", "superuser", "broker ", 0, 1, true, {}]) {
    const v = { email: AGENT.email, role };
    const got = resolveTarget(v, "leona@cashisking.com");
    ok(got.email === AGENT.email,
       `an unrecognised role (${JSON.stringify(role)}) does not grant view-as`);
  }

  /* A viewer with no email at all — a session that half-loaded. */
  ok(resolveTarget({ role: "agent" }, "leona@cashisking.com").email === null,
     "a viewer with no email resolves to nobody, not to the requested address");
  ok(resolveTarget(null, "leona@cashisking.com").email === null,
     "no viewer at all resolves to nobody");
  ok(resolveTarget(undefined, null).email === null, "and does not throw");
}

/* ---- scrubBoard: which rows come back? --------------------------------- */
{
  const row = (email) => ({ client_id: 1, agent_email: email,
                            first_name: "Real", last_name: "Client",
                            address_1: "1 Real St", trans_amt: 750000 });
  const board = [row("andy@cashisking.com"), row("leona@cashisking.com"),
                 row("amy@cashisking.com")];

  const mine = scrubBoard(board, AGENT);
  ok(mine.length === 1, "an agent sees only their own deals");
  ok(mine[0].agent_email === AGENT.email, "and it is the right one");

  ok(scrubBoard(board, BROKER).length === 3, "leadership sees the whole board");

  /* REMOVED, not redacted. A redacted row still carries the count and the
     price, which on a board this size is most of what is confidential. */
  const other = scrubBoard(board, AGENT).map(r => r.agent_email);
  ok(!other.includes("leona@cashisking.com"), "another agent's row is gone, not blanked");

  /* Case on the ROW side — the database stores what Sisu sent. */
  ok(scrubBoard([row("ANDY@CashIsKing.com")], AGENT).length === 1,
     "a row whose stored email differs in case is still matched to its owner");

  /* Near misses must NOT match. */
  for (const near of ["andy@cashisking.com.evil.com", "xandy@cashisking.com",
                      "andy@cashisking.co", " andy@cashisking.com",
                      "andy@cashisking.com ", "andy@CASHISKING.COM.attacker.net"]) {
    const got = scrubBoard([row(near)], AGENT);
    const shouldMatch = near.trim().toLowerCase() === AGENT.email;
    ok((got.length === 1) === shouldMatch,
       `a row for "${near}" ${shouldMatch ? "matches" : "does NOT match"} andy`);
  }

  /* Rows with no owner recorded. An unattributed deal must not fall to
     everyone — the safe default for "we do not know whose this is" is nobody. */
  for (const missing of [null, undefined, "", 0]) {
    ok(scrubBoard([row(missing)], AGENT).length === 0,
       `a row with agent_email ${JSON.stringify(missing)} is not shown to an agent`);
  }

  /* A viewer with no email. An empty string on both sides must not match. */
  ok(scrubBoard(board, { role: "agent" }).length === 0,
     "a viewer with no email sees nothing, rather than every unattributed row");
  ok(scrubBoard(board, { email: "", role: "agent" }).length === 0,
     "an empty viewer email sees nothing");
  ok(scrubBoard(board, null).length === 0, "no viewer sees nothing");

  /* Shapes that are not a list. */
  ok(scrubBoard(null, AGENT).length === 0 && scrubBoard(undefined, AGENT).length === 0 &&
     scrubBoard("rows", AGENT).length === 0 && scrubBoard({ 0: row("x") }, AGENT).length === 0,
     "anything that is not an array yields no rows, rather than throwing");

  /* Role strings that are not roles. */
  for (const role of [undefined, null, "", "Broker", "BROKER", "admin ", "leadership\\n", 99]) {
    ok(scrubBoard(board, { email: AGENT.email, role }).length <= 1,
       `an unrecognised role (${JSON.stringify(role)}) does not unlock the whole board`);
  }
}

/* ---- scrubLeaderboard: income on other people's rows -------------------- */
{
  const prodRow = (id) => ({ sisu_agent_id: id, first_name: "A", last_name: String(id),
                             units_closed: 10, gci: 250000, paid_income: 90000,
                             closed_volume: 4000000 });
  const rows = [prodRow(11373), prodRow(11106), prodRow(48921)];

  const asAgent = scrubLeaderboard(rows, AGENT);
  ok(asAgent.length === 3, "every agent still appears on the leaderboard");
  ok(asAgent[0].gci === 250000, "your own income stays on your own row");
  for (const r of asAgent.slice(1)) {
    ok(r.gci === undefined && r.paid_income === undefined && r.closed_volume === undefined,
       "income is stripped from other people's rows");
    ok(r.units_closed === 10, "units are NOT stripped — they are public by design");
  }

  ok(scrubLeaderboard(rows, BROKER).every(r => r.gci === 250000),
     "leadership sees income on every row");

  /* The match is on agent id, which arrives from Postgres as a string or a
     number depending on the driver and the column. Either must match. */
  const strId = scrubLeaderboard([{ ...prodRow("11373") }], { ...AGENT, sisu_agent_id: 11373 });
  ok(strId[0].gci === 250000, "a string agent id still matches its numeric owner");

  /* A viewer with no agent id must not match a row with no agent id. */
  const orphan = [{ sisu_agent_id: null, gci: 1, units_closed: 1 }];
  ok(scrubLeaderboard(orphan, { email: "x@y.com", role: "agent" })[0].gci === undefined,
     "a viewer with no agent id does not inherit an unattributed row's income");
}

/* ---- who is allowed in at all ------------------------------------------ */
{
  process.env.ALLOWED_EMAIL_DOMAINS = "cashisking.com";
  process.env.ALLOWED_EMAILS = "brandon@cashisking.com";

  ok(isAllowedIdentity("andy@cashisking.com", true), "a company address is allowed");
  ok(isAllowedIdentity("brandon@cashisking.com", true), "a listed individual is allowed");
  ok(!isAllowedIdentity("someone@gmail.com", true), "an outside address is refused");

  /* Google's `hd` param only pre-filters the chooser — an unverified email must
     never be trusted, whatever domain it claims. */
  ok(!isAllowedIdentity("andy@cashisking.com", false), "an unverified email is refused");
  ok(!isAllowedIdentity("", true) && !isAllowedIdentity(null, true),
     "no address is refused");

  /* Domain look-alikes. The check must be on the domain, not on "contains". */
  for (const bad of ["andy@cashisking.com.evil.com", "andy@notcashisking.com",
                     "andy@cashisking.co", "andy@evil.com?cashisking.com"]) {
    ok(!isAllowedIdentity(bad, true), `a look-alike domain is refused: ${bad}`);
  }
  ok(isAllowedIdentity("ANDY@CASHISKING.COM", true), "case does not matter for a real one");
}

/* ---- the rank order itself --------------------------------------------- */
{
  ok(atLeast("leadership", "admin") && atLeast("admin", "agent") && !atLeast("agent", "admin") && !atLeast("admin", "leadership"),
     "the rank order is agent < admin < leadership");
  /* v135: broker is retired. Someone still stored as one is an agent. */
  ok(effectiveRole("andy@cashisking.com", "broker") === "agent" && !ROLES.includes("broker"), "a stored broker counts as an agent, and broker can't be picked");
  ok(!atLeast("broker", "agent") && !atLeast("admin", "broker"), "broker is not a rank any more");
  ok(!atLeast("nonsense", "agent"), "an unknown role outranks nothing — not even agent");
  ok(!canViewAsOthers("agent") && !canSeeOthersIncome("agent"),
     "an agent can neither view as others nor see their income");
}

/* ---- v99: only leadership sees other people's data ---------------------- */
{
  for (const role of ["agent", "admin"]) {
    ok(!canViewAsOthers(role), `${role}: cannot view as someone else`);
    ok(!canSeeOthersIncome(role), `${role}: cannot see anyone else's income`);
    ok(!canSeeCompany(role), `${role}: gets no company-wide figures`);
  }
  ok(canViewAsOthers("leadership") && canSeeOthersIncome("leadership") && canSeeCompany("leadership"), "leadership sees it all");
  ok(!canSeeAllDeals("agent") && canSeeAllDeals("admin") && canSeeAllDeals("leadership"),
     "every deal under contract: admins (to run transactions) and leadership only");

  const deals = [
    { client_id: 1, agent_email: "andy@cashisking.com", gross_commission_amt: 30000 },
    { client_id: 2, agent_email: "leona@cashisking.com", gross_commission_amt: 20000 },
  ];
  const asAgent = scrubBoard(deals, { email: "andy@cashisking.com", role: "agent" });
  ok(asAgent.length === 1 && asAgent[0].client_id === 1, "an agent sees only their own deals");
  const asAdmin = scrubBoard(deals, { email: "paris@cashisking.com", role: "admin" });
  ok(asAdmin.length === 2, "an admin sees every deal");
  ok(asAdmin.every(r => !("gross_commission_amt" in r) && !("gci" in r)), "but no one else's commission on it");
  const adminOwn = scrubBoard(deals, { email: "andy@cashisking.com", role: "admin" });
  ok(adminOwn.find(r => r.client_id === 1).gross_commission_amt === 30000 && !("gross_commission_amt" in adminOwn.find(r => r.client_id === 2)),
     "an admin's own deal keeps its commission; the rest do not");
  ok(deals[1].gross_commission_amt === 20000, "scrubbing copies rows; it never edits the source");
  ok(scrubBoard(deals, { email: "x@y.com", role: "leadership" }).every(r => r.gross_commission_amt), "leadership keeps every commission");

  const rows = [{ sisu_agent_id: 1, gci: 5, closed_volume: 6, paid_income: 7, units_closed: 3 },
                { sisu_agent_id: 2, gci: 8, closed_volume: 9, paid_income: 1, units_closed: 2 }];
  for (const role of ["agent", "admin"]) {
    const out = scrubLeaderboard(rows, { role, sisu_agent_id: 1 });
    ok(out[0].gci === 5 && out[1].gci === undefined && out[1].units_closed === 2,
       `${role}: the leaderboard keeps names and units for everyone, income only on their own row`);
  }
  const target = resolveTarget({ email: "andy@cashisking.com", role: "agent" }, "leona@cashisking.com");
  ok(target.email === "andy@cashisking.com" && !target.viewAs, "an agent asking for someone else just gets their own");
}

console.log(`\nscoping: ${p} passed, ${f} failed`);
if (f) process.exit(1);
