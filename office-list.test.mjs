/* CIK Office's list rooms (Tech Stack first, as in Jarvis).
 *
 * What has to hold:
 *   - an item can only ever contain the fields its room declares, cleaned
 *   - a link can only ever be http or https, however it is disguised
 *   - the one-time copy from CIK Office is exactly what CIK Office had
 *   - only admins and leadership can write, and only from Jarvis itself
 *   - every write is scoped to its room, so one room's URL cannot touch another's items
 *
 * The SQL itself is exercised against a real Postgres by
 * scripts/office-db-check.mjs, which needs a database and so is not in npm test.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { validateFields, cleanUrl, linkKind, fingerprint } from "./lib/office-fields.js";
import { roomBySlug, canEditRoom, ALL_ROOMS, partsOf } from "./lib/office-rooms.js";
let p = 0, f = 0;
const ok = (c, m) => { c ? p++ : (f++, console.log("  FAIL:", m)); };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const TS = roomBySlug("tech-stack");
const spec = TS.list.fields;

/* ---- links --------------------------------------------------------------- */
{
  ok(cleanUrl("https://skyslope.com/") === "https://skyslope.com/", "a plain https link survives");
  ok(cleanUrl("http://www.fello.ai") === "http://www.fello.ai/", "a plain http link survives");
  for (const bad of ["javascript:alert(1)", "java\tscript:alert(1)", " javascript:alert(1)",
                     "JAVASCRIPT:alert(1)", "data:text/html,<script>alert(1)</script>",
                     "vbscript:msgbox(1)", "//evil.example", "ftp://x.example", "https://", "", null, 42, {}]) {
    ok(cleanUrl(bad) === "", `refused as a link: ${JSON.stringify(bad)}`);
  }
  ok(cleanUrl("https://ex\u0000ample.com/") === "https://example.com/", "control characters are stripped before the check");
}

/* ---- fields -------------------------------------------------------------- */
{
  const good = validateFields(spec, { name: "  Sisu  ", url: "https://sisu.co/", description: "Line one\r\nLine two  " });
  ok(good.ok, "a normal item passes");
  ok(good.fields.name === "Sisu", "a name is trimmed");
  ok(good.fields.description === "Line one\nLine two", "a description keeps its line breaks and loses Windows returns");

  const extra = validateFields(spec, { name: "X", role: "leadership", __proto__: { a: 1 }, id: 99 });
  ok(extra.ok && Object.keys(extra.fields).sort().join() === "description,name,url",
     "keys a room does not declare are dropped, never stored");

  ok(!validateFields(spec, { name: "" }).ok, "a name is required");
  ok(!validateFields(spec, { name: "   " }).ok, "and whitespace is not a name");
  ok(!validateFields(spec, {}).ok && !validateFields(spec, null).ok && !validateFields(spec, "x").ok,
     "a missing or malformed body fails rather than saving an empty card");
  ok(validateFields(spec, { name: "X" }).ok, "link and description are optional");
  ok(!validateFields(spec, { name: "X", url: "javascript:alert(1)" }).ok, "a script link is refused at save time");
  ok(validateFields(spec, { name: "X", url: "javascript:alert(1)" }).errors.url, "and the error names the field");
  ok(!validateFields(spec, { name: ["X"] }).ok && !validateFields(spec, { name: { a: 1 } }).ok,
     "a field that is not text is refused rather than stringified");
  ok(!validateFields(spec, { name: "x".repeat(81) }).ok && validateFields(spec, { name: "x".repeat(80) }).ok,
     "a name is capped at 80 characters, and 80 is allowed");
  ok(validateFields(spec, { name: "🏠".repeat(80) }).ok,
     "the cap counts characters, not UTF-16 units, so 80 emoji is 80 and not 160");
  ok(!validateFields(spec, { name: "X", description: "y".repeat(1001) }).ok, "a description is capped at 1000");

  const sneaky = validateFields(spec, { name: "Safe‮exe.txt\u0007", description: "a\u0000b‮c\nd" });
  ok(sneaky.fields.name === "Safe exe.txt" && sneaky.fields.description === "abc\nd",
     "direction overrides and control characters are removed");
}

/* ---- the copy from CIK Office -------------------------------------------- */
{
  /* Jarvis bundled MRE's Tech Stack as a seed file (lib/seeds). CIK Office's
     rooms are filled by the one-time import instead, from the live site, so
     there are no bundled seeds at all. */
  ok(TS.list.seed?.from === "cikoffice" && TS.list.seed.collection === "tech_stack", "the Tech Stack room is filled by the import, from CIK Office's tech_stack");
  ok(!fs.existsSync("./lib/seeds"), "no bundled seed files came over");
  const store = strip(fs.readFileSync("lib/office-store.js", "utf8"));
  ok(/const SEEDS = \{\};/.test(store), "and the store knows of none");
  const seeded = [...ALL_ROOMS, ...ALL_ROOMS.flatMap(partsOf)].filter(r => r.list?.seed);
  ok(seeded.length >= 10 && seeded.every(r => typeof r.list.seed === "object" && r.list.seed.from === "cikoffice" && /^[a-z_]{2,40}$/.test(r.list.seed.collection)),
     "every seed is the import's (a bare name would look for a seed file that isn't there, and mark the room done, empty)");
}

/* ---- who may write -------------------------------------------------------- */
{
  ok(TS.where === "jarvis", "Tech Stack has moved");
  ok(canEditRoom(TS, "admin") && canEditRoom(TS, "leadership"), "admins and leadership can edit it");
  ok(!canEditRoom(TS, "agent") && !canEditRoom(TS, "broker") && !canEditRoom(TS, undefined) && !canEditRoom(TS, "x"),
     "agents, brokers and unknown roles cannot");
  /* Any room not moved yet (none in CIK Office: every room is here from day one). */
  const waiting = ALL_ROOMS.find(r => r.where !== "jarvis");
  ok(!waiting || (!canEditRoom(waiting, "leadership") && !canEditRoom(waiting, "admin")),
     "a room that has not moved cannot be written to, by anyone");
  ok(!canEditRoom(null, "leadership"), "nor can a room that does not exist");
  ok(ALL_ROOMS.filter(r => r.where === "jarvis").every(r => (r.list && r.list.fields?.length) || (r.view && !r.list)),
     "every moved room declares what its items contain, or is a page of its own (the ticket rooms)");
  ok(spec[0].required, "the first field is required, since it is the card's title");
}

/* ---- the write routes ------------------------------------------------------ */
{
  const files = ["app/api/office/[room]/items/route.js", "app/api/office/[room]/items/[id]/route.js"];
  for (const file of files) {
    const code = strip(fs.readFileSync(file, "utf8"));
    const handlers = [...code.matchAll(/export async function (GET|POST|PATCH|DELETE|PUT)\b/g)].map(m => m[1]);
    ok(handlers.length > 0, `${file} exports handlers`);
    ok(!handlers.includes("GET"), `${file} has no GET, so nothing changes on a link click or a prefetch`);
    const bodies = code.split(/export async function /).slice(1);
    for (const b of bodies) {
      const name = b.slice(0, b.indexOf("("));
      ok(/const user = await currentUser\(\)/.test(b), `${file} ${name} checks the session`);
      ok(/guardWrite\(req, user, slug\)/.test(b) && /if \(room instanceof Response\) return room;/.test(b),
         `${file} ${name} goes through guardWrite and stops when it refuses`);
      ok(b.indexOf("guardWrite(") < b.search(/(create|update|move|delete)Item\(/),
         `${file} ${name} is refused BEFORE anything is written`);
      ok(/user\.email/.test(b), `${file} ${name} records who made the change`);
    }
  }

  const api = strip(fs.readFileSync("lib/office-api.js", "utf8"));
  ok(/sameOrigin\(req\)/.test(api) && /if \(!origin\) return false/.test(api),
     "a write with no Origin header is refused, not waved through");
  ok(api.indexOf("sameOrigin(req)") < api.indexOf("canEditRoom("), "the origin is checked first");
  ok(/content-length/.test(api) && api.indexOf("content-length") < api.indexOf("arrayBuffer()"),
     "the size cap is checked before the body is read");
  ok(/byteLength > MAX_BODY_BYTES/.test(api), "and again in real bytes");
  ok(/application\\\/json/.test(api), "a write must be JSON, which a plain HTML form cannot send");
  const unexpected = api.slice(api.indexOf("console.error", api.indexOf("export async function respondError")));
  ok(/console\.error/.test(unexpected) && !/e\.message|String\(e/.test(unexpected.slice(0, unexpected.indexOf("}"))),
     "an unexpected error is logged, and its internals are not sent to the browser (only our own messages are)");
}

/* ---- the store ------------------------------------------------------------- */
{
  const code = strip(fs.readFileSync("lib/office-store.js", "utf8"));
  ok(!/sql\(\s*[`"']/.test(code) && !/\+\s*slug|\+\s*id\b/.test(code), "every query is a parameterised template");
  const writes = [...code.matchAll(/(update office_items[\s\S]*?where[^`]*|delete from office_items[^`]*)`/g)].map(m => m[1]);
  ok(writes.length >= 3, `found the writes (${writes.length})`);
  ok(writes.every(w => /o?\.?room = \$\{room\.slug\}/.test(w)), "every update and delete is scoped to its room");
  ok(/where room = \$\{room\.slug\} and id = \$\{id\}/.test(code), "and to the item, by both room and id");
  ok(/sql\.transaction\(\[[\s\S]*office_seeds[\s\S]*office_items[\s\S]*\]\)/.test(code),
     "the seed marker and the seeded items are written in one transaction");
  ok(/on conflict \(room, origin_id\) where origin_id is not null do nothing/.test(code),
     "a second seeding run cannot duplicate an item");
  ok(/order by position, id/.test(code), "the list has one stable order, even on ties");
  ok((code.match(/logChange\(/g) || []).length >= 5, "create, update, delete and move are all logged");
  ok(/MAX_ITEMS_PER_ROOM/.test(code) && /isId\(id\)/.test(code), "a room has a size limit, and ids are checked before use");
}

/* ---- the page -------------------------------------------------------------- */
{
  const ui = strip(fs.readFileSync("app/office-list.jsx", "utf8"));
  ok(/const href = holdsFiles \? fileHref\(it\) : linkKey \? cleanUrl\(it\.fields\[linkKey\]\) : ""/.test(ui), "a card's link goes through cleanUrl before it reaches an href");
  ok(!/dangerouslySetInnerHTML/.test(ui), "the list renders no raw HTML, so a description cannot carry markup");
  ok(/rel="noopener noreferrer"/.test(ui), "outside links do not hand the tool this page");
  ok(!/window\.confirm|confirm\(/.test(ui.replace(/confirmId|setConfirmId|jx-confirm/g, "")),
     "delete asks on the page, not with a browser dialog");
  ok(/setItems\(data\.items\)/.test(ui), "after a change the page shows the list the server sent back");
  ok(/aria-live="polite"/.test(ui), "saves and errors are announced to a screen reader");
  const page = strip(fs.readFileSync("app/office/[room]/page.jsx", "utf8"));
  ok(/canEditRoom\(room, user\.role\)/.test(page), "the page decides edit buttons from the same rule the server enforces");
  ok(/items === null/.test(page) && /couldn&rsquo;t load/.test(page), "a database failure shows a message, not a crash");
}

/* ---- v83: grouped rooms copied by the import ------------------------------ */
{
  const R = roomBySlug("resources"), G = roomBySlug("gis"), A = roomBySlug("admin-links");
  for (const [room, col] of [[R, "resources"], [G, "gis"]]) {
    ok(room.where === "jarvis" && room.list, `${room.label} has moved`);
    ok(room.list.seed?.from === "cikoffice" && room.list.seed.collection === col,
       `${room.label} is filled by the import, from CIK Office's ${col}`);
    ok(room.list.fields[0].key === "name" && room.list.fields[0].required, `${room.label}'s cards are titled by a required name`);
    ok(room.list.fields.find(f => f.key === "url")?.required, `${room.label}'s links are required, as every one in CIK Office has one`);
    if (room.list.groupBy) {
      const gf = room.list.fields.find(f => f.key === room.list.groupBy);
      ok(gf && gf.type === "choice" && gf.required && gf.options.length >= 2,
         `${room.label} groups by a required choice with its sections listed`);
    }
  }
  ok(JSON.stringify(R.list.fields.find(f => f.key === "category").options) === JSON.stringify(["Resources", "Independent Resources"]),
     "Resources' sections are in the order CIK Office shows them");
  ok(JSON.stringify(G.list.fields.find(f => f.key === "state").options) === JSON.stringify(["Oregon", "Washington"]),
     "GIS groups Oregon then Washington");
  ok(A.minRole === "admin" && !canEditRoom(A, "broker") && canEditRoom(A, "admin"),
     "Admin Links is still kept for admins, and only they can edit it");
  ok(!A.list.seed && A.list.fields.find(f => f.key === "url")?.required, "it starts empty (CIK Office had none), and every link it gets has an address");

  const gspec = G.list.fields;
  ok(validateFields(gspec, { name: "Clackamas", url: "https://cmap.clackamas.us/maps", state: "Oregon" }).ok, "a normal map passes");
  ok(!validateFields(gspec, { name: "X", url: "https://x.example/", state: "Idaho" }).ok, "a state outside the list is refused");
  ok(!validateFields(gspec, { name: "X", url: "https://x.example/", state: "oregon" }).ok, "and choices match exactly, not loosely");
  ok(!validateFields(gspec, { name: "X", url: "https://x.example/" }).ok, "a required choice cannot be left out");

  /* The labels the Resources room shows, for the kinds of address it holds. */
  const kinds = [
    ["https://docs.google.com/forms/d/e/abc/viewform", "Form"], ["https://forms.gle/abc", "Form"],
    ["https://drive.google.com/file/d/abc/view", "Drive"], ["https://docs.google.com/document/d/abc/edit", "Doc"],
    ["https://docs.google.com/spreadsheets/d/abc", "Sheet"], ["https://experience.arcgis.com/experience/abc", "Map"],
    ["https://someone.github.io/sales-map/", "Map"], ["https://teamup.com/ksbzjeywnxp2zzygxz", "Calendar"],
    ["https://podio.com/webforms/123/456", "Link"], ["javascript:alert(1)", ""], ["", ""],
  ];
  for (const [u, want] of kinds) ok(linkKind(u) === want, `linkKind(${u || '""'}) is ${want || "nothing"}`);

  const fp1 = await fingerprint(gspec, [{ name: "A", url: "https://a.example/", state: "Oregon", note: "" }]);
  const fp2 = await fingerprint(gspec, [{ state: "Oregon", note: "", url: "https://a.example/", name: "A" }]);
  const fp3 = await fingerprint(gspec, [{ name: "A ", url: "https://a.example/", state: "Oregon", note: "" }]);
  ok(/^[0-9a-f]{64}$/.test(fp1), "a fingerprint is a SHA-256");
  ok(fp1 === fp2, "it does not depend on the order an item's keys arrive in (jsonb re-orders them)");
  ok(fp1 !== fp3, "but one extra space changes it, which is the point");
  ok(fp1 !== await fingerprint(gspec, []), "an empty list has its own fingerprint");

  const imp = strip(fs.readFileSync("app/api/office/import/route.js", "utf8"));
  ok(/const IMPORT_ORIGINS = \["https:\/\/cikoffice\.com"\];/.test(imp) && /return IMPORT_ORIGINS\.includes\(o\) \? o : null;/.test(imp),
     "the import accepts exactly CIK Office's origin, the bare cikoffice.com (www is the app itself)");
  ok(!/Access-Control-Allow-Origin": "\*"/.test(imp) && (imp.match(/Allow-Origin": /g) || []).length === 1 &&
     /function cors\(req\) \{\s*const origin = allowedOrigin\(req\);\s*return origin\s*\?\s*\{\s*"Access-Control-Allow-Origin": origin,/.test(imp),
     "it never answers * and never echoes back whatever origin asked (only one of the two it allows)");
  const post = imp.slice(imp.indexOf("export async function POST"));
  ok(post.indexOf("!allowedOrigin(req)") > -1 && post.indexOf("!allowedOrigin(req)") < post.indexOf("currentUser()"),
     "POST refuses the wrong origin before doing anything else");
  ok(/const user = await currentUser\(\)/.test(post) && /if \(!user\)/.test(post), "it needs a Jarvis session");
  ok(post.indexOf("canImportRoom(") > -1 && post.indexOf("canImportRoom(") < post.indexOf("importItems("),
     "and admin or leadership, checked before anything is written");
  ok(/MAX_IMPORT_BYTES/.test(post) && post.indexOf("content-length") < post.indexOf("arrayBuffer()"),
     "its size cap is checked before the body is read");
  const opt = imp.slice(imp.indexOf("export async function OPTIONS"), imp.indexOf("export async function POST"));
  ok(!/currentUser|importItems|sql/.test(opt), "the preflight reads nothing and writes nothing");
  ok(!/export async function (GET|PATCH|DELETE|PUT)/.test(imp), "the import has no other methods");

  const store = strip(fs.readFileSync("lib/office-store.js", "utf8"));
  const ii = store.slice(store.indexOf("export async function importItems"), store.indexOf("async function logChange"));
  ok(/would be changed by cleaning/.test(ii), "an item that cleaning would alter is refused, not quietly tidied");
  ok(ii.indexOf("if (problems.length) throw") < ii.indexOf("sql.transaction"), "any problem stops the whole import before a write");
  ok(/already been copied/.test(ii) && ii.indexOf("already been copied") < ii.indexOf("sql.transaction"),
     "a second import is refused before it writes");
  ok(/sql\.transaction\(\[[\s\S]*office_seeds[\s\S]*office_items[\s\S]*office_changes[\s\S]*\]\)/.test(ii),
     "the marker, the items and the change log are one transaction");
  ok(/if \(importsFromCikOffice\(room\)\) return;/.test(store),
     "opening an import room before the import does not mark it done");

  const ui = strip(fs.readFileSync("app/office-list.jsx", "utf8"));
  ok(/\.\.\.extra\]/.test(ui), "an item whose group is not in the declared list still shows, in its own group");
  ok(/aria-pressed/.test(ui) && /type="search"/.test(ui), "the filter chips say which is on, and the search box is a search box");
  const pg = strip(fs.readFileSync("app/office/[room]/page.jsx", "utf8"));
  ok(/state && !state\.imported/.test(pg) && /is on its way from CIK Office/.test(pg) && /href=\{CIK_OFFICE_URL\}/.test(pg),
     "a room waiting for its copy says so and links to CIK Office, instead of looking empty");
}

/* ---- v84: rooms that start empty, and long text ----------------------------- */
{
  /* CIK Office had nothing in these (its pages showed Matin's sample text), so
     they start empty here, for CIK's own content. */
  for (const slug of ["training", "onboarding", "marketing", "recruiting", "transactions"]) {
    const r = roomBySlug(slug);
    ok(r.where === "jarvis" && r.list && !r.list.seed, `${r.label} has moved and starts empty`);
    ok(!r.minRole && canEditRoom(r, "admin") && !canEditRoom(r, "agent"), `${r.label} is open to everyone, edited by admins`);
  }
  const SC = (await import("./lib/office-rooms.js")).listTarget("lead-generation~scripts");
  ok(SC.list.fields.find(f => f.key === "description").max >= 10000,
     "a script can hold 10,000 characters");
  ok(validateFields(SC.list.fields, { name: "Seller first call", description: "x".repeat(10000) }).ok,
     "and 10,000 characters of script passes");
  ok(SC.list.collapse > 0 && SC.list.search, "long scripts collapse behind See more, and scripts can be searched");

  const api = fs.readFileSync("lib/office-api.js", "utf8");
  const cap = Number(/MAX_BODY_BYTES = (\d+) \* 1024/.exec(api)?.[1]) * 1024;
  ok(cap >= 4 * 10000 + 1024, `the write cap (${cap} bytes) fits 10,000 characters of script even at 4 bytes each`);

  /* The import script has its own copy of each room's field keys, because it runs
     in a browser tab where lib/ cannot be imported. If the two ever disagree,
     the import sends the wrong fields, so hold them together here. */
  const script = fs.readFileSync("scripts/office-import.browser.js", "utf8");
  const imported = [...ALL_ROOMS, ...ALL_ROOMS.flatMap(partsOf)].filter(r => r.list?.seed?.from === "cikoffice");
  ok(imported.length === 10, `ten lists are filled by the import (${imported.length})`);
  for (const r of imported) {
    const keys = r.list.fields.map(f => `"${f.key}"`).join(",\\s*");
    const re = new RegExp(`"${r.slug}":\\s*\\{\\s*collection:\\s*"${r.list.seed.collection}",\\s*keys:\\s*\\[${keys}\\]\\s*[,}]`);
    ok(re.test(script), `the import script sends ${r.label} with exactly the fields the room declares`);
  }

  const ui = strip(fs.readFileSync("app/office-list.jsx", "utf8"));
  ok(/aria-expanded=\{expanded\}/.test(ui) && /See more/.test(ui) && /See less/.test(ui),
     "See more says whether it is open, and closes again");
}

/* ---- v85: Recruiting, New Business, Open Houses ---------------------------- */
{
  for (const [slug, col] of [["recruiting", null], ["new-business", "nb_links"], ["open-houses", "oh_links"]]) {
    const r = roomBySlug(slug);
    ok(r.where === "jarvis" && (col ? r.list?.seed?.from === "cikoffice" && r.list.seed.collection === col : r.list && !r.list.seed),
       col ? `${r.label} has moved and is filled by the import from ${col}` : `${r.label} has moved and starts empty`);
    ok(r.list.subtitle === "linkKind", `${r.label}'s cards say what kind of link each is, as CIK Office's did`);
    ok(!r.minRole && canEditRoom(r, "admin") && !canEditRoom(r, "broker"), `${r.label} is open to everyone, edited by admins`);
  }
  /* The labels these rooms' cards show. */
  for (const [u, want] of [["https://form.asana.com/?k=abc&d=1", "Form"], ["https://issuu.com/matin/docs/career-book", "Issuu"],
                           ["https://app.trainual.com/abc", "Trainual"], ["https://docs.google.com/forms/d/e/x/viewform", "Form"],
                           ["https://drive.google.com/file/d/x/view", "Drive"], ["https://evilissuu.com/x", "Link"],
                           ["https://trainual.com.evil.example/x", "Link"]]) {
    ok(linkKind(u) === want, `linkKind(${u}) is ${want}`);
  }
  /* v180: the dashboard's Recruiting section is gone, so the note pointing to it is too. */
  ok(!roomBySlug("recruiting").list.aside, "Recruiting no longer points to a dashboard section that doesn't exist");
  const ui = strip(fs.readFileSync("app/office-list.jsx", "utf8"));
  ok(/cleanLocal\(list\.aside\.href\)/.test(ui), "an aside can only link within Jarvis");
  const cl = new Function(`return ${/const cleanLocal = (h => [^;]+);/.exec(fs.readFileSync("app/office-list.jsx", "utf8"))[1]}`)();
  ok(cl("/") === "/" && cl("/office/gis") === "/office/gis", "a Jarvis path is allowed");
  ok(cl("//evil.example") === "" && cl("https://evil.example") === "" && cl("javascript:alert(1)") === "" && cl("/\\evil") === "",
     "an outside address, a protocol-relative one and a script are not");
}

/* ---- v88: Vendors --------------------------------------------------------- */
{
  const r = roomBySlug("vendors");
  const L = r.list;
  ok(r.where === "jarvis" && L.seed?.from === "cikoffice" && L.seed.collection === "vendors",
     "Vendors has moved and is filled by the import from CIK Office's vendors");
  ok(!r.minRole && canEditRoom(r, "admin") && !canEditRoom(r, "broker") && !canEditRoom(r, "agent"),
     "Vendors is open to everyone and edited by admins only");
  ok(L.fields.map(x => x.key).join() === "name,category,area,phone,email,website,description,preferred",
     "Vendors keeps the eight fields CIK Office had that hold anything (tags and rating were left out)");
  const cat = L.fields.find(x => x.key === "category");
  ok(cat.options.length === 47 && new Set(cat.options).size === 47, "47 categories, CIK Office's copy of MRE's list, with no duplicates");
  ok(cat.allowOther === true, "a new category can be typed, so a vendor never has to be filed under the wrong one");
  ok(L.groupBy === "category" && L.contact === true && L.subtitle === "area", "cards are grouped by category and show area, email and phone");
  ok(L.flag?.key === "preferred" && L.flag.value === "yes" && /Preferred/.test(L.flag.filter), "there is a Preferred only filter");

  const good = { name: "Acme Roofing", category: "Roofers", area: "Portland", phone: "503-555-0100", email: "a@acme.example",
                 website: "https://acme.example/", description: "Fast quotes.", preferred: "yes" };
  let v = validateFields(L.fields, good);
  ok(v.ok && v.fields.category === "Roofers" && v.fields.preferred === "yes", "a normal vendor saves");
  v = validateFields(L.fields, { ...good, category: "Gutters" });
  ok(v.ok && v.fields.category === "Gutters", "a category not in the list is allowed");
  v = validateFields(L.fields, { ...good, category: "" });
  ok(!v.ok && v.errors.category, "but a category is still required");
  v = validateFields(L.fields, { ...good, category: "x".repeat(61) });
  ok(!v.ok && v.errors.category, "and kept to 60 characters");
  v = validateFields(L.fields, { ...good, preferred: "maybe" });
  ok(!v.ok && v.errors.preferred, "Preferred is only yes or no");
  v = validateFields(L.fields, { ...good, website: "javascript:alert(1)" });
  ok(!v.ok && v.errors.website, "a vendor website cannot be a script");
  /* A choice WITHOUT allowOther still only takes its own options. */
  const bn = roomBySlug("gis").list.fields.find(x => x.type === "choice" && !x.allowOther);
  ok(bn && !validateFields([{ ...bn, required: true }], { [bn.key]: "Not an option" }).ok, "other lists' choices are still strict");
  ok(!validateFields([{ key: "k", label: "K", type: "choice", options: ["a", "b"], required: true }], { k: "c" }).ok,
     "a plain choice field refuses a value outside its options");

  const ui = strip(fs.readFileSync("app/office-list.jsx", "utf8"));
  ok(/cleanUrl\(it\.fields\[linkKey\]\)/.test(ui) && /f\.type === "url"/.test(ui),
     "the card title links to the room's link field (a vendor's website), through cleanUrl");
  ok(/<datalist/.test(ui) && /f\.allowOther/.test(ui), "an open category is typed with suggestions, not picked from a fixed menu");
  ok(/flag\.badge/.test(ui) && /setFlagOnly/.test(ui) && /aria-pressed=\{flagOn\}/.test(ui),
     "Preferred vendors get a badge and a toggle that says whether it is on");
}

console.log(`\noffice-list: ${p} passed, ${f} failed`);
if (f) process.exit(1);
