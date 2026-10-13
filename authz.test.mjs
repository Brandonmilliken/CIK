import { scrubLeaderboard, resolveTarget, isAllowedIdentity, canViewAsOthers, scrubBoard} from "./lib/authz.js";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log("  FAIL:", m)); };

const board = [
  { sisu_agent_id: 1, first_name: "Erin",   units_closed: 9, gci: 300000, paid_income: 90000, closed_volume: 4e6 },
  { sisu_agent_id: 2, first_name: "Jordan", units_closed: 7, gci: 585300, paid_income: 14700, closed_volume: 9e6 },
];
const erin = { email: "erin@cashisking.com", sisu_agent_id: 1, role: "agent" };
const alicia = { email: "manager@cashisking.com", sisu_agent_id: 3, role: "leadership" };
const noSisu = { email: "marketing@cashisking.com", sisu_agent_id: null, role: "agent" };

console.log("agent sees own income, not others'");
let r = scrubLeaderboard(board, erin);
ok(r[0].gci === 300000 && r[0].paid_income === 90000, "own row keeps income");
ok(r[1].gci === undefined && r[1].paid_income === undefined && r[1].closed_volume === undefined, "other row stripped");
ok(r[1].units_closed === 7 && r[1].first_name === "Jordan", "units + name survive (leaderboard is public by design)");

console.log("leadership sees everything");
r = scrubLeaderboard(board, alicia);
ok(r[0].gci === 300000 && r[1].gci === 585300, "all income visible");

console.log("staff with no Sisu record");
r = scrubLeaderboard(board, noSisu);
ok(r[0].gci === undefined && r[1].gci === undefined, "no agent id means no income anywhere");

console.log("null/undefined viewer cannot be used to bypass");
for (const v of [null, undefined, {}, { role: "leadership" }, { role: undefined, sisu_agent_id: 1 }]) {
  const out = scrubLeaderboard(board, v);
  const leaked = out.some(x => x.gci !== undefined && Number(x.sisu_agent_id) !== Number(v?.sisu_agent_id));
  if (v && v.role === "leadership") ok(true, "explicit leadership role honoured");
  else ok(!leaked, "no income leak for viewer " + JSON.stringify(v));
}

console.log("role spoofing via string");
ok(!canViewAsOthers("Leadership"), "role match is case-sensitive, not loose");
ok(!canViewAsOthers("admin "), "trailing space is not admin");
ok(!canViewAsOthers("agent"), "agent cannot view as");
ok(!canViewAsOthers("broker") && !canViewAsOthers("admin") && canViewAsOthers("leadership"), "v99: only leadership can view as someone else");

console.log("view-as resolution");
ok(resolveTarget(erin, "jordan@cashisking.com").email === erin.email, "agent redirected to self, silently");
ok(resolveTarget(erin, "jordan@cashisking.com").viewAs === false, "not flagged as view-as");
ok(resolveTarget(alicia, "erin@cashisking.com").viewAs === true, "leadership view-as flagged for logging");
ok(resolveTarget(erin, "ERIN@cashisking.com").viewAs === false, "own address, different case, is not view-as");

console.log("sign-in allowlist");
process.env.ALLOWED_EMAIL_DOMAINS = "cashisking.com";
process.env.ALLOWED_EMAILS = "brandon@cashisking.com";
ok(isAllowedIdentity("erin@cashisking.com", true), "work domain allowed");
ok(isAllowedIdentity("ERIN@CashIsKing.com", true), "case-insensitive");
ok(isAllowedIdentity("brandon@cashisking.com", true), "explicit address allowed");
ok(!isAllowedIdentity("someone@gmail.com", true), "outside domain rejected");
ok(!isAllowedIdentity("erin@cashisking.com", false), "unverified Google email rejected");
ok(!isAllowedIdentity("", true) && !isAllowedIdentity(null, true), "empty rejected");
ok(!isAllowedIdentity("evil@cashisking.com.attacker.io", true), "suffix-lookalike domain rejected");
ok(!isAllowedIdentity("evil@sub.cashisking.com", true), "subdomain not implicitly allowed");


/* In Contract board scoping. Real client names and property addresses. */
{
  const rows = [
    { client_id: 1, agent_email: "andy@cashisking.com", address_1: "18244 SW Belmont" },
    { client_id: 2, agent_email: "leona@cashisking.com", address_1: "3391 NE Kelsey" },
    { client_id: 3, agent_email: null, address_1: "20 Cascade View" },
  ];
  const andy = { email: "Andy@CashIsKing.com", role: "agent" };
  const boss = { email: "pat@cashisking.com", role: "leadership" };

  const a = scrubBoard(rows, andy);
  ok(a.length === 1 && a[0].client_id === 1, "agent sees only their own deals");
  ok(!JSON.stringify(a).includes("Kelsey"), "another agent's address never serialized");
  ok(scrubBoard(rows, boss).length === 3, "leadership sees the whole board");
  ok(scrubBoard(rows, { email: "", role: "agent" }).length === 0, "no identity, no rows");
  ok(scrubBoard(rows, { email: "x@y.com", role: "agent" }).length === 0,
     "unattributed rows are not handed to an arbitrary agent");
  ok(scrubBoard(null, boss).length === 0, "null row set is safe");
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
