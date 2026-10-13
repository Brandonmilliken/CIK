/* office-files.test.mjs — v89: files in an office room.
 *
 * The rules for what a file may be, where the one-time copy may fetch from,
 * how a room's second list is addressed, and the locks on the three file
 * routes. The SQL is run for real in scripts/office-db-check.mjs.
 *
 * CIK Office: no room holds files yet (CIK Office's lists were all links and
 * text), but the file machinery came over whole, ready for the first one, so
 * its rules are still checked here. Jarvis's file rooms (MLS rule books,
 * Listing SOP, Employee Benefits, Must Have Contacts and its QR code) did not
 * come over.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  isPdfBytes, fileSizeLabel, safeFileBase, blobPathFor, contentDisposition, isImportSource,
  originPathOf, fileProblem, downloadImportFile, sha256Hex, PDF, VCARD, isVcardBytes, kindOfBytes, kindInfo, legacyPath,
} from "./lib/office-files.js";
import { roomBySlug, listTarget, partsOf, canEditRoom, canImportRoom, canSeeRoom, menuFor, ALL_ROOMS } from "./lib/office-rooms.js";
import { validateFields } from "./lib/office-fields.js";

let p = 0, f = 0;
const ok = (c, m) => { c ? p++ : (f++, console.log("  FAIL:", m)); };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const read = path => strip(fs.readFileSync(path, "utf8"));
const bytes = s => new TextEncoder().encode(s);
const RULES = { types: [PDF], maxBytes: 4 * 1024 * 1024 };

/* ---- what a file is ---------------------------------------------------------- */
{
  ok(isPdfBytes(bytes("%PDF-1.7\n...")), "a PDF is recognised by its first bytes");
  ok(!isPdfBytes(bytes("<html>%PDF-")) && !isPdfBytes(bytes("%PDF")) && !isPdfBytes(null) && !isPdfBytes(new Uint8Array()),
     "a web page, a cut-off header, nothing and an empty file are not PDFs");
  ok(fileProblem(RULES, bytes("%PDF-1.4 hello")) === "", "a small PDF is fine");
  ok(/Only PDF/.test(fileProblem(RULES, bytes("<!doctype html><script>alert(1)</script>"))), "a web page renamed .pdf is refused");
  ok(/empty/.test(fileProblem(RULES, new Uint8Array())), "an empty file is refused");
  ok(/4 MB/.test(fileProblem(RULES, { length: 4 * 1024 * 1024 + 1, 0: 0x25 })), "a file over 4 MB is refused, and the message says the cap");
  ok(/does not hold files/.test(fileProblem(null, bytes("%PDF-1"))), "a list without files takes none");
  ok(fileSizeLabel(711 * 1024) === "711 KB" && fileSizeLabel(1537 * 1024) === "1.5 MB" && fileSizeLabel(4 * 1024 * 1024) === "4 MB" &&
     fileSizeLabel(12) === "12 B" && fileSizeLabel(-1) === "" && fileSizeLabel("x") === "", "sizes read the way people say them");
}

/* ---- names that can never reach a path or a header ---------------------------- */
{
  ok(safeFileBase("RMLS – Rules and Regulations") === "rmls-rules-and-regulations", "a real name becomes a tidy file name");
  ok(safeFileBase("../../etc/passwd") === "etc-passwd" && safeFileBase("") === "file" && safeFileBase("🙂") === "file",
     "dots, slashes and emoji cannot reach the store's path");
  ok(safeFileBase("Café Überprüfung") === "cafe-uberprufung", "accents are kept as their plain letters");
  ok(safeFileBase("x".repeat(200)).length <= 60, "and it is kept short");
  ok(blobPathFor("mls-info", "NWMLS Rules") === "office/mls-info/nwmls-rules.pdf", "files are kept under their room");
  ok(blobPathFor("../evil", "a") === "office/evil/a.pdf", "a room name cannot climb out of office/");
  const cd = contentDisposition('Rules"; filename="x.exe\r\nSet-Cookie: a=b');
  ok(!/[\r\n]/.test(cd) && /^inline; filename="rules-filename-x-exe-set-cookie-a-b\.pdf"; filename\*=UTF-8''/.test(cd),
     "a name cannot break out of the download header or add a header of its own");
  ok(!/[\s"';]/.test(cd.split("filename*=UTF-8''")[1]), "the full name is percent-encoded, with no quote, space or semicolon left");
  ok(contentDisposition("Flexmls – Rules").includes("Flexmls%20%E2%80%93%20Rules.pdf"), "the real name is still there for the browser to show");
}

/* ---- the one-time copy fetches from CIK Office's uploads folder ONLY ---------- */
{
  const good = "https://cikoffice.com/wp-content/uploads/2026/08/RMLS-Rules.pdf";
  ok(isImportSource(good), "a file in CIK Office's uploads folder may be copied");
  ok(!isImportSource("https://www.mreoffice.com/wp-content/uploads/2026/08/RMLS-Rules.pdf"), "a file in MRE Office's is not");
  for (const [u, why] of [
    ["http://cikoffice.com/wp-content/uploads/a.pdf", "plain http"],
    ["https://jarvis.cikoffice.com/wp-content/uploads/a.pdf", "another host"],
    ["https://cikoffice.com.evil.example/wp-content/uploads/a.pdf", "a look-alike host"],
    ["https://evil.example/?https://cikoffice.com/wp-content/uploads/a.pdf", "a host hidden in a query"],
    ["https://user:pw@cikoffice.com/wp-content/uploads/a.pdf", "a user name"],
    ["https://cikoffice.com:8443/wp-content/uploads/a.pdf", "a port"],
    ["https://cikoffice.com/wp-admin/admin-ajax.php", "outside the uploads folder"],
    ["https://cikoffice.com/wp-content/uploads/../../wp-config.php", "climbing out with .."],
    ["https://cikoffice.com/wp-content/uploads/%2e%2e/wp-config.php", "climbing out with encoded dots"],
    ["https://cikoffice.com/wp-content/uploads/a.pdf?x=1", "a query string"],
    ["https://cikoffice.com/wp-content/uploads/a.pdf#x", "a fragment"],
    ["javascript:alert(1)", "a script"], ["", "nothing"], [null, "not text"],
  ]) ok(!isImportSource(u), `a file address with ${why} is refused`);
  ok(originPathOf(good) === "/wp-content/uploads/2026/08/RMLS-Rules.pdf", "the old address is kept, to keep working after WordPress goes");
}

/* ---- downloading one file for the copy ------------------------------------------ */
{
  const pdf = bytes("%PDF-1.7 the rules");
  const resp = (status, body, headers = {}) => new Response(body, { status, headers });
  let calls = 0;
  const fake = r => async (url, opts) => { calls++; ok(opts?.redirect === "manual", "the copy never follows a redirect"); return r(); };
  const src = "https://cikoffice.com/wp-content/uploads/r.pdf";

  const got = await downloadImportFile(src, RULES, fake(() => resp(200, pdf)));
  ok(got.sha256 === createHash("sha256").update(pdf).digest("hex") && got.bytes.length === pdf.length, "a good file comes back with its SHA-256");
  const rejects = async (fn, re, m) => { try { await fn(); ok(false, m); } catch (e) { ok(re.test(e.message), `${m} (${e.message})`); } };
  await rejects(() => downloadImportFile(src, RULES, fake(() => resp(302, null, { location: "https://evil.example/x.pdf" }))), /302/, "a redirect is refused");
  await rejects(() => downloadImportFile(src, RULES, fake(() => resp(404, "no"))), /404/, "a missing file is refused");
  await rejects(() => downloadImportFile(src, RULES, fake(() => resp(200, "<html>login</html>"))), /Only PDF/, "a login page instead of a PDF is refused");
  await rejects(() => downloadImportFile(src, { ...RULES, maxBytes: 10 }, fake(() => resp(200, pdf, { "content-length": "999" }))),
                /over/, "a file that says it is too big is refused before it is read");
  await rejects(() => downloadImportFile(src, { ...RULES, maxBytes: 10 }, fake(() => resp(200, pdf))), /over/, "a file that turns out too big is refused while reading");
  const before = calls;
  await rejects(() => downloadImportFile("https://evil.example/wp-content/uploads/a.pdf", RULES, fake(() => resp(200, pdf))), /not a file address/,
                "an address outside CIK Office is refused");
  ok(calls === before, "and it is refused before anything is fetched");
  ok((await sha256Hex(pdf)) === got.sha256, "the page and the server hash the same way");
}

/* ---- MLS Info, and how a room's second list is addressed ------------------------- */
{
  const r = roomBySlug("mls-info");
  ok(r.where === "jarvis" && r.list.seed?.collection === "mls" && r.list.fields.map(x => x.key).join() === "name,abbr,area,description,support,phone,url",
     "MLS Info has moved, with CIK Office's seven fields");
  ok(!r.list.groupBy && !r.list.fields.some(x => x.key === "membership" || x.key === "lockbox"), "it is not grouped (CIK Office had no membership field)");
  ok(validateFields(r.list.fields, { name: "KCAR", url: "http://www.example.org/" }).ok,
     "an MLS login that is still plain http is kept, as CIK Office had it");
  ok(!validateFields(r.list.fields, { name: "X", url: "javascript:alert(1)" }).ok, "a login link cannot be a script");
  ok(partsOf(r).length === 0 && listTarget("mls-info~files") === null, "MLS Info has no rule-book list (CIK Office had none)");

  const t = listTarget("lead-generation~scripts");
  ok(t && t.slug === "lead-generation~scripts" && t.parent === "lead-generation" && t.where === "jarvis" && t.group === "Grow", "a second list is its own list inside its room");
  ok(listTarget("lead-generation~constructor") === null && listTarget("lead-generation~__proto__") === null && listTarget("lead-generation~toString") === null,
     "a key naming a built-in property is not a list");
  ok(listTarget("lead-generation~nope") === null && listTarget("vendors~files") === null && listTarget("lead-generation~scripts~x") === null &&
     listTarget("LEAD-GENERATION~scripts") === null && listTarget(42) === null, "an unknown part, room or shape is not a list");
  ok(listTarget("vendors") === roomBySlug("vendors"), "an ordinary room key still finds the room");
  ok(ALL_ROOMS.filter(x => partsOf(x).length).map(x => x.slug + ":" + partsOf(x).map(y => y.slug.split("~")[1]).join("+")).join() ===
     "lead-generation:cadence+scripts,company:offices+roles+escalation", "only Lead Generation and Company have second lists, in CIK Office's order");
  ok(canEditRoom(t, "admin") && canEditRoom(t, "leadership") && !canEditRoom(t, "broker") && !canEditRoom(t, "agent"),
     "admins and leadership can add and remove scripts; agents and brokers read them");
  ok(!canImportRoom(t, "admin"), "there is no copy to run for a list CIK Office had nothing in");
  ok(canSeeRoom(t, "agent"), "everyone signed in can open them");
  ok(!menuFor("admin").flatMap(g => g.rooms).some(x => x.slug.includes("~")), "a second list is never its own menu item");
  ok(ALL_ROOMS.every(x => !x.slug.includes("~")), "and no room's own slug has the separator in it");
  ok(/canSeeRoom\(room, user\.role\)/.test(read("app/api/office/file/[id]/route.js")), "the file route checks the room's own menu rule, so a link alone is not enough");
}

/* ---- what lists take files --------------------------------------------------- */
{
  const lists = ALL_ROOMS.flatMap(x => [x.list, ...Object.values(x.parts || {})]).filter(Boolean);
  ok(lists.length > 20 && lists.every(l => !l.files), "no CIK list holds files yet (CIK Office's were links and text)");
  ok(lists.every(l => !l.files?.public), "so nothing is public: the public old-address route did not come over");
  ok(!fs.existsSync("./app/wp-content") && !fs.existsSync("./public/wp-content"), "and neither did its folder");
}

/* ---- contact files: still told apart from anything else ------------------------- */
{
  const card = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Jane Doe\r\nTEL:503-555-0100\r\nEND:VCARD\r\n";
  const VR = { types: [VCARD], maxBytes: 1024 * 1024 };
  ok(isVcardBytes(bytes(card)) && isVcardBytes(bytes("\ufeff" + card + card)) && isVcardBytes(bytes(card.replace(/\r\n/g, "\n"))),
     "a contact file is recognised, with or without a byte-order mark, CRLF or LF, one card or many");
  ok(!isVcardBytes(bytes("<html>BEGIN:VCARD\nEND:VCARD")) && !isVcardBytes(bytes("BEGIN:VCARD\nFN:x\n")) && !isVcardBytes(new Uint8Array([0x42, 0xff, 0xfe, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
     "a web page, a cut-off card and non-UTF-8 bytes are not");
  ok(!isVcardBytes(bytes("BEGIN:VCARD\nFN:a\u0000b\nEND:VCARD")), "nor is text with a NUL byte in it");
  ok(fileProblem(VR, bytes(card)) === "" && kindOfBytes(VR, bytes(card)) === VCARD, "a contact file is fine in a list that takes them");
  ok(/Only contact files \(\.vcf\) can be added here/.test(fileProblem(VR, bytes("%PDF-1.4 hi"))), "a PDF is refused there, and says why");
  ok(/Only PDF/.test(fileProblem(RULES, bytes(card))) && kindOfBytes(RULES, bytes(card)) === null, "and a contact file is refused everywhere else");
  ok(blobPathFor("contacts", "TEAM CONTACTS VCF", VCARD) === "office/contacts/team-contacts-vcf.vcf", "it is stored as a .vcf");
  const cd = contentDisposition("TEAM CONTACTS VCF", VCARD, "team_contacts");
  ok(/^attachment; filename="team_contacts\.vcf"; filename\*=UTF-8''team_contacts\.vcf$/.test(cd), `it downloads under its fixed name, for the phone to import (${cd})`);
  ok(/^inline; filename="rmls\.pdf"/.test(contentDisposition("RMLS")), "while a PDF still opens in the browser");
  ok(kindInfo(VCARD).serveAs === "text/vcard; charset=utf-8" && kindInfo(PDF).serveAs === PDF && kindInfo("text/html").serveAs === PDF,
     "each kind has one fixed type; anything unknown is treated as a PDF, never as a web page");
  ok(legacyPath(["2026", "08", "contacts.vcf"]) === "/wp-content/uploads/2026/08/contacts.vcf", "an old address is rebuilt from its parts");
  ok([[".."], ["2026", ".."], ["a b"], ["a%2f"], ["a\\b"], [], null, ["x".repeat(121)], Array(9).fill("a"), ["<script>"]].every(x => legacyPath(x) === null),
     "a dot-dot, a space, an encoded slash, a backslash, nothing, or a too-long address is refused");
}

/* ---- the three routes, read as code ------------------------------------------------ */
{
  const dl = read("app/api/office/file/[id]/route.js");
  ok(/await currentUser\(\)/.test(dl) && /\/signin/.test(dl), "opening a file needs a signed-in person, and sends others to sign in");
  ok(/canSeeRoom\(room, user\.role\)/.test(dl) && /room\.where !== "jarvis"/.test(dl) && /!room\.list\?\.files/.test(dl),
     "and a file in a room they may not open is not found");
  ok(/"Content-Type": kindInfo\(item\.file\.type\)\.serveAs/.test(dl) && !/contentType/.test(dl),
     "the type sent is fixed by what the file is (checked when it was stored), never whatever the store says");
  ok(/"X-Content-Type-Options": "nosniff"/.test(dl) && /"Cache-Control": "private, no-cache"/.test(dl),
     "the browser may not guess the type, and no shared cache keeps a copy");
  ok(/contentDisposition\(item\.fields\?\.name, item\.file\.type, room\.list\.files\.downloadName \|\| null\)/.test(dl), "the file is named through contentDisposition only");
  ok(!/s-maxage|public,/.test(dl), "a private file is never cached on Vercel's edge for someone else");

  const up = read("app/api/office/[room]/files/route.js");
  ok(/await currentUser\(\)/.test(up) && /guardWrite\(req, user, slug\)/.test(up), "uploading goes through the same locks as every write");
  ok(/!room\.list\.files/.test(up), "and only into a list that holds files");
  ok(/content-length/.test(up) && up.indexOf("content-length") < up.indexOf("formData()"), "its size is checked before the upload is read");
  ok(/fileProblem\(room\.list\.files, bytes\)/.test(up), "and the real bytes are checked after");
  ok(/if \(stored\) await removeFiles\(\[stored\]\)/.test(up), "a file whose row fails to save is removed from the store again");

  const imp = read("app/api/office/import/route.js");
  ok(/listTarget\(/.test(imp) && /canImportRoom\(room, user\.role\)/.test(imp), "the copy finds a second list, with the same permission check");
  ok(/downloadImportFile\(it\?\.source, room\.list\.files\)/.test(imp), "files are downloaded by Jarvis, from the checked address");
  ok(imp.indexOf("roomState(room.slug)") < imp.indexOf("downloadImportFile("), "a second run is refused before anything is downloaded");
  ok(imp.indexOf("downloadImportFile(") < imp.indexOf("storeFile("), "every file is downloaded before any is stored");
  ok(/if \(metas\?\.length\) await removeFiles\(metas\.map\(m => m\.pathname\)\)/.test(imp), "a failed copy removes every file it stored");
  ok(/eachLimited\(items, 4,/.test(imp) && /got\[i\] = await downloadImportFile/.test(imp) && /metas\[i\] = \{/.test(imp),
     "files are copied four at a time, and each keeps its place in the list");
  ok(imp.indexOf("if (bad) return reply") < imp.indexOf("storeFile("), "still, every file is downloaded before any is stored");
  ok(/const folder = room\.parent \|\| room\.slug/.test(imp), "a room that is only files keeps them under its own name");

  const del = read("app/api/office/[room]/items/[id]/route.js");
  ok(del.indexOf("deleteItem(") < del.indexOf("removeFiles(") && /if \(gone\.pathname\)/.test(del),
     "deleting a file item removes its file, after its row");

  const store = read("lib/office-store.js");
  ok(/const shape = r =>/.test(store) && /fileSummary\(r\.file\)/.test(store) && !/pathname: String/.test(store),
     "what a page receives about a file is its size, type and hash, never where it is kept");
  ok(/if \(room\.list\.files\) throw new OfficeInputError\("Add a file with the upload form\."/.test(store), "a file item cannot be made without a file");

  const blob = read("lib/office-blob.js");
  ok(/access: "private"/.test(blob) && !/access: "public"/.test(blob), "files go into the store as private, only");
  ok(/addRandomSuffix: true/.test(blob), "two files with the same name never overwrite each other");

  const ui = read("app/office-list.jsx");
  ok(/!\(single && items\.length > 0\)/.test(ui) && /single \? \(/.test(ui), "the page offers Replace file, not Add or Delete, for a one-file list");
  ok(/room\.list\.files\.single \? \(await listItems\(room\.slug\)\)\[0\]/.test(up) && /replaceFileItem\(room\.slug, existing\.id, meta, user\.email\)/.test(up),
     "uploading to a one-file list replaces that file in place");
  ok(up.indexOf("replaceFileItem(") < up.indexOf("removeFiles([oldPathname])"), "and the old file is removed only after the row points at the new one");
  ok(/`\/api\/office\/file\/\$\{it\.id\}`/.test(ui) && /\/\^\\d\{1,18\}\$\/\.test\(it\.id\)/.test(ui),
     "a file card links to Jarvis's own file route, by a numeric id only");
  ok(/accept=\{kinds\.map\(k => k\.accept\)\.join\(","\)\}/.test(ui), "the upload box offers only the kinds the list allows");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  ok(/^\^2\./.test(pkg.dependencies["@vercel/blob"] || ""), "the Blob SDK is version 2, which has private stores");
}

console.log(`\noffice-files: ${p} passed, ${f} failed`);
if (f) process.exit(1);
