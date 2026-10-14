/* cik.test.mjs — CIK Office: what makes this copy of Jarvis Cash Is King's.
 *
 * This app started as a copy of Matin Real Estate's Jarvis (v181) with every
 * Matin-only room and integration taken out. These checks hold the seams of
 * that copy together:
 *   1. the browser's menu (lib/office-menu.js) is the server's room list
 *   2. the one-time import script sends each room exactly the fields it holds
 *   3. no Matin, MRE Office, Sisu or Sierra wording reaches a page
 *   4. who may sign in, and who the super admin is
 *   5. who may run a room's one-time copy
 *   6. the admin jobs route carries none of Jarvis's vendor jobs
 *   7. the old cikoffice.com addresses go to the new app
 */
import fs from "node:fs";
import { ROOM_GROUPS, ALL_ROOMS, partsOf, listTarget, roomBySlug, canImportRoom } from "./lib/office-rooms.js";
import { MENU } from "./lib/office-menu.js";
import { SUPER_ADMINS, isAllowedIdentity, isSuperAdmin } from "./lib/authz.js";
import cfg from "./next.config.mjs";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };

/* Comments out, line numbers kept. JSX comments ({/* ... *\/}) are block
   comments inside braces, so the block rule removes them too. A line comment
   is only taken where one can start (line start, or after space or
   punctuation), so "https://..." inside a string is left alone. */
const keepNl = m => m.replace(/[^\n]/g, "");
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, keepNl).replace(/(^|[\s;,(){}\[\]])\/\/.*$/gm, "$1");

/* ---- 1. the menu is the room list ------------------------------------------- */
{
  const want = ROOM_GROUPS.map(g => ({ label: g.label, rooms: g.rooms.map(r => [r.slug, r.label, r.minRole || null]) }));
  const got = MENU.map(g => ({ label: g.label, rooms: g.rooms.map(r => [r.slug, r.label, r.minRole || null]) }));
  ok(JSON.stringify(got.map(g => g.label)) === JSON.stringify(want.map(g => g.label)), "the menu has the same groups, in order");
  ok(JSON.stringify(got) === JSON.stringify(want), "and the same rooms in each: slug, label and who may see it, in order");
  ok(MENU.flatMap(g => g.rooms).length === 22 && ALL_ROOMS.length === 22, "22 rooms on both sides");
  ok(MENU.flatMap(g => g.rooms).every(r => Object.keys(r).every(k => ["slug", "label", "minRole", "blurb", "where"].includes(k))),
     "the menu carries nothing about a room beyond its name, address, who may see it and its one-line description");
  ok(MENU.flatMap(g => g.rooms).every(r => !("where" in r)), "and no room is marked as still somewhere else");
}

/* ---- 2. the import script matches the rooms it fills ------------------------ */
{
  const script = fs.readFileSync("scripts/office-import.browser.js", "utf8");
  const at = script.indexOf("const ROOMS = {");
  const end = script.indexOf("\n  };", at);
  ok(at > 0 && end > at, "the import script has its ROOMS list");
  /* A plain object literal: evaluated on its own, nothing else in the script runs. */
  const ROOMS = new Function(`return ${script.slice(at + "const ROOMS = ".length, end + 4).replace(/;\s*$/, "")};`)();
  const seeded = [...ALL_ROOMS, ...ALL_ROOMS.flatMap(partsOf)].filter(r => r.list?.seed?.from === "cikoffice");
  ok(seeded.length === 10 && Object.keys(ROOMS).length === 10, `ten lists are filled by the import (${seeded.length} rooms, ${Object.keys(ROOMS).length} in the script)`);
  for (const r of seeded) {
    const e = ROOMS[r.slug];
    ok(e && e.collection === r.list.seed.collection, `${r.slug}: the script copies it from ${r.list.seed.collection}`);
    ok(e && JSON.stringify(e.keys) === JSON.stringify(r.list.fields.map(x => x.key)), `${r.slug}: and sends exactly its fields, in its order`);
  }
  for (const slug of Object.keys(ROOMS)) {
    const t = listTarget(slug);
    ok(t && t.list?.seed?.from === "cikoffice", `${slug}: every room the script copies is one the import fills`);
  }
  ok(/const APP = "https:\/\/www\.cikoffice\.com";/.test(script) && !/mreoffice/i.test(script), "it posts to the new CIK app, and nothing in it points at MRE's");
}

/* ---- 3. no Matin wording on any page --------------------------------------- */
{
  /* The stripper itself, on a sample, so a broken one can't pass everything. */
  const sample = 'const a = "https://jarvis.example/x"; // Sisu\n<p>{/* Matin */}Hello</p>\n/* Sierra\n */ok();';
  const st = stripComments(sample);
  ok(st.includes("https://jarvis.example/x") && st.includes("<p>{}Hello</p>") && !/Sisu|Matin|Sierra/.test(st) && st.split("\n").length === sample.split("\n").length,
     "comments are removed (line, block and JSX), strings and line numbers are kept");

  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = `${d}/${e.name}`;
      if (e.isDirectory()) walk(full); else if (/\.(jsx|js)$/.test(e.name)) files.push(full);
    }
  })("app");
  ok(files.length >= 25 && files.includes("app/page.jsx") && files.includes("app/side-menu.jsx"), `every page and route file is read (${files.length})`);
  ok(stripComments(fs.readFileSync("app/page.jsx", "utf8")).includes("Everyone at Cash Is King"), "and what a page shows survives the stripping");
  const BAD = /\bMatin\b|MRE Office|mreoffice|\bSisu\b|\bSierra\b/i;
  const hits = [];
  for (const file of files) {
    stripComments(fs.readFileSync(file, "utf8")).split("\n").forEach((line, i) => { if (BAD.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
  ok(hits.length === 0, `no Matin, MRE Office, mreoffice, Sisu or Sierra outside comments in app/ (${hits.join(" | ")})`);
}

/* ---- 4. who may sign in ------------------------------------------------------ */
{
  const saved = { d: process.env.ALLOWED_EMAIL_DOMAINS, e: process.env.ALLOWED_EMAILS };
  delete process.env.ALLOWED_EMAIL_DOMAINS;
  delete process.env.ALLOWED_EMAILS;
  ok(JSON.stringify(SUPER_ADMINS) === JSON.stringify(["brandon@cashisking.com"]) && Object.isFrozen(SUPER_ADMINS), "the one super admin is Brandon, fixed");
  ok(!isSuperAdmin("jmatin@matinrealestate.com"), "Matin's super admin is not one here");
  ok(isAllowedIdentity("x@cashisking.com", true), "a verified Cash Is King address signs in (the default domain)");
  ok(isAllowedIdentity("X@CashIsKing.com", true), "in any case");
  ok(!isAllowedIdentity("x@matinrealestate.com", true), "a Matin address does not");
  ok(!isAllowedIdentity("x@cashisking.com", false), "an unverified one does not");
  ok(!isAllowedIdentity("a@cashisking.com@evil.com", true), "nor one whose real domain is somewhere else");
  ok(!isAllowedIdentity("a@cashisking.com.evil.com", true) && !isAllowedIdentity("a@sub.cashisking.com", true), "nor a look-alike or a subdomain");
  if (saved.d !== undefined) process.env.ALLOWED_EMAIL_DOMAINS = saved.d;
  if (saved.e !== undefined) process.env.ALLOWED_EMAILS = saved.e;
}

/* ---- 5. who may run a room's one-time copy ---------------------------------- */
{
  const vendors = roomBySlug("vendors"), offices = listTarget("company~offices"), training = roomBySlug("training");
  ok(vendors.list.seed?.from === "cikoffice" && canImportRoom(vendors, "admin") && canImportRoom(vendors, "leadership") && canImportRoom(vendors, "superadmin"),
     "admins and leadership can copy a room CIK Office filled");
  ok(!canImportRoom(vendors, "agent") && !canImportRoom(vendors, "broker") && !canImportRoom(vendors, undefined), "agents cannot");
  ok(canImportRoom(offices, "admin") && !canImportRoom(offices, "agent"), "the same for a second list (Company's offices)");
  ok(!training.list.seed && !canImportRoom(training, "admin") && !canImportRoom(training, "leadership"), "a room with no seed has no copy to run, for anyone");
  ok(!canImportRoom(roomBySlug("support"), "superadmin") && !canImportRoom(null, "admin"), "nor does a page that isn't a list, or no room at all");
}

/* ---- 6. the admin jobs route has none of Jarvis's vendor jobs ---------------- */
{
  /* Its header comment lists what was taken out, by name; the code must not
     mention any of them. */
  const code = stripComments(fs.readFileSync("app/api/admin/run/route.js", "utf8"));
  const named = ["sisu", "sierra", "relitix", "shilo", "trainual", "asana"].filter(w => new RegExp(w, "i").test(code));
  ok(named.length === 0, `no Sisu, Sierra, Relitix, Shilo, Trainual or Asana in the admin route's code (${named.join(", ")})`);
  ok(/const FIXED_JOBS = \["sync-log", "perf-probe", "ticket-email-test"\];/.test(code), "its own jobs are the sync log, the speed check and the ticket email test");
}

/* ---- 7. the old addresses ---------------------------------------------------- */
{
  const rules = await cfg.redirects();
  ok(rules.length === 1 && JSON.stringify(rules.map(r => r.has?.[0]?.value)) === JSON.stringify(["cikoffice.com"]),
     "only the bare cikoffice.com is redirected (www is the app)");
  ok(rules.every(r => r.has.length === 1 && r.has[0].type === "host"), "matched on the host, so www.cikoffice.com (the app) never is");
  ok(rules.every(r => r.destination === "https://www.cikoffice.com/?from=cikoffice" && r.permanent === false), "to the new home page, temporary (307)");
  /* cik-v4: browsers that remember WordPress's permanent www/ -> bare redirect
     would loop on plain "/"; an address with a query string is never remembered. */
  ok(rules.every(r => new URL(r.destination).search !== ""), "never to the plain www.cikoffice.com/ (old browsers loop on it)");
  for (const r of rules) {
    const src = r.source, re = new RegExp("^/" + src.slice(src.indexOf("(") + 1, src.lastIndexOf(")")) + "$");
    ok(src.startsWith("/:path(") && re.test("/") && re.test("/wp-admin/") && re.test("/office/vendors"), `${r.has[0].value}: every page is sent over`);
    ok(/wp-content\/uploads\//.test(src) && !re.test("/wp-content/uploads/2026/08/a.pdf") && re.test("/wp-content/themes/x.css"),
       `${r.has[0].value}: except old uploaded files, which stay where they are`);
  }
}

console.log(`\ncik: ${p} passed, ${f} failed`);
if (f) process.exit(1);
