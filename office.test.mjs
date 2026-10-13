/* The side menu and the CIK Office room pages.
 *
 * What has to stay true now CIK Office has moved into this app:
 *   - every room has exactly one address, and it never changes
 *   - every room page is behind sign-in and never cached, same as the home page
 *   - a room kept from a role is kept from them on the SERVER, not just the menu
 *   - the menu matches the CIK Office sidebar, so nobody has to relearn it
 */
import fs from "node:fs";
import { ROOM_GROUPS, ALL_ROOMS, roomBySlug, canSeeRoom, canEditRoom, menuFor, CIK_OFFICE_URL } from "./lib/office-rooms.js";
let p = 0, f = 0;
const ok = (c, m) => { c ? p++ : (f++, console.log("  FAIL:", m)); };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ---- the list ---------------------------------------------------------- */
{
  const slugs = ALL_ROOMS.map(r => r.slug);
  ok(new Set(slugs).size === slugs.length, "every room slug is unique");
  ok(slugs.every(s => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)), "every slug is a plain lowercase URL segment");
  ok(ALL_ROOMS.every(r => r.where === "office" || r.where === "jarvis"),
     "every room says where it lives, and only 'office' or 'jarvis'");
  ok(ALL_ROOMS.every(r => typeof r.label === "string" && r.label.trim()), "every room has a label");

  /* The CIK Office sidebar (lib/office-rooms.js, 2026-10-13). If a room is
     renamed or added there, this is where it has to be added here too. */
  const expected = {
    Grow: ["Training Center", "Onboarding", "Lead Generation", "Marketing", "Recruiting"],
    Operate: ["New Business", "Transactions", "Open Houses", "MLS Coverage", "MLS Info", "GIS", "Vendors",
              "Submit a Help Ticket", "My Tickets", "Support Center"],
    Company: ["Company", "Tech Stack", "Directory", "Resources", "Admin Links", "Announcements", "Leadership Settings"],
  };
  ok(JSON.stringify(ROOM_GROUPS.map(g => g.label)) === JSON.stringify(Object.keys(expected)),
     "the groups are Grow, Operate, Company, in that order");
  for (const g of ROOM_GROUPS) {
    ok(JSON.stringify(g.rooms.map(r => r.label)) === JSON.stringify(expected[g.label]),
       `${g.label} lists the same rooms as CIK Office, in the same order`);
  }
  ok(JSON.stringify(ALL_ROOMS.map(r => r.slug)) === JSON.stringify(["training", "onboarding", "lead-generation", "marketing", "recruiting",
     "new-business", "transactions", "open-houses", "mls-coverage", "mls-info", "gis", "vendors", "help-ticket", "my-tickets", "support",
     "company", "tech-stack", "directory", "resources", "admin-links", "announcements", "leadership-settings"]),
     "each room's address, in menu order");
  ok(ALL_ROOMS.length === 22, "22 rooms in all");
  ok(ALL_ROOMS.every(r => r.where === "jarvis"), "every CIK room lives here from day one (there is no half-moved state)");
  ok(CIK_OFFICE_URL === "https://cikoffice.com/", "a room waiting for its copy links to cikoffice.com");
}

/* ---- who sees what ----------------------------------------------------- */
{
  const admin = roomBySlug("admin-links");
  ok(admin && admin.minRole === "admin", "Admin Links is kept for admin and above");
  ok(!canSeeRoom(admin, "agent") && !canSeeRoom(admin, "broker"), "agents and brokers cannot open Admin Links");
  ok(canSeeRoom(admin, "admin") && canSeeRoom(admin, "leadership"), "admins and leadership can");
  ok(!canSeeRoom(admin, undefined) && !canSeeRoom(admin, "nonsense"), "an unknown role gets the least, not the most");
  ok(canSeeRoom(roomBySlug("vendors"), "agent"), "an ordinary room is open to every agent");

  const agentMenu = menuFor("agent").flatMap(g => g.rooms.map(r => r.slug));
  ok(!agentMenu.includes("admin-links"), "Admin Links is not in an agent's menu");
  ok(!agentMenu.includes("support"), "nor the Support Center, which shows every ticket (v94)");
  ok(agentMenu.includes("help-ticket") && agentMenu.includes("my-tickets"), "but every agent can submit a ticket and see their own");
  ok(agentMenu.length === 19, "an agent's menu has the other 19 rooms, Announcements included");
  ok(menuFor("admin").flatMap(g => g.rooms).length === 21, "an admin's has 21: all but Leadership Settings");
  ok(menuFor("leadership").flatMap(g => g.rooms).length === 22, "leadership sees all 22");
  ok(!agentMenu.includes("leadership-settings") && !menuFor("admin").flatMap(g => g.rooms.map(r => r.slug)).includes("leadership-settings"), "only leadership sees Leadership Settings");
  ok(roomBySlug("nope") === null && roomBySlug("") === null && roomBySlug(undefined) === null,
     "an unknown slug is not a room");
  ok(roomBySlug("__proto__") === null && roomBySlug("constructor") === null,
     "and neither is a property name every object has");
}

/* ---- the room page ----------------------------------------------------- */
{
  const code = strip(fs.readFileSync("./app/office/[room]/page.jsx", "utf8"));
  ok(/const user = await currentUser\(\)/.test(code) && /redirect\([^;]*[`"]\/signin\?next=[^;]*: "\/signin"\)/.test(code),
     "a room page sends an unauthenticated visitor to sign-in");
  ok(/force-dynamic/.test(code), "and is never statically cached");
  ok(/canSeeRoom\(room, user\.role\)/.test(code) && /notFound\(\)/.test(code),
     "a room kept from a role is refused on the server, not only hidden in the menu");
  ok(code.indexOf("currentUser()") < code.indexOf("canSeeRoom("),
     "and the viewer is known before that decision is made");
  ok(/await params/.test(code), "params is awaited (Next 15 hands it over as a promise)");
  ok(!/dangerouslySetInnerHTML/.test(code), "the room page renders no raw HTML");
}

/* ---- the menu ---------------------------------------------------------- */
{
  const menu = strip(fs.readFileSync("./app/side-menu.jsx", "utf8"));
  ok(/^"use client"/.test(fs.readFileSync("./app/side-menu.jsx", "utf8").trimStart()),
     "the menu is a client component (it opens and closes on a phone)");
  ok(/menuFor\(role\)/.test(menu), "the menu is built from menuFor, so it hides what the server refuses");
  ok(/aria-expanded/.test(menu) && /aria-controls="jx-side"/.test(menu), "the phone Menu button says whether it is open");
  ok(/aria-current/.test(menu), "the page you are on is marked for a screen reader");
  ok(/Escape/.test(menu), "Escape closes the menu");
  ok((menu.match(/target="_blank"/g) || []).length === (menu.match(/rel="noopener noreferrer"/g) || []).length, "any link out of Jarvis does not hand it this page");

  ok(/className="jx-closebtn"/.test(menu), "the open phone menu has its own Close button, inside it");
  ok(/closeRef\.current\?\.focus\(\)/.test(menu) && /btnRef\.current\?\.focus\(\)/.test(menu),
     "opening moves focus into the menu, and closing hands it back to the Menu button");

  const css = fs.readFileSync("./app/shell.css", "utf8");
  const selectors = [...strip(css).matchAll(/(^|})\s*([^{}@]+)\{/g)].map(m => m[2].trim())
    .flatMap(s => s.split(",").map(x => x.trim())).filter(s => s && !s.startsWith(":root") && !/^\d|^from|^to/.test(s));
  ok(selectors.length > 10 && selectors.every(s => /^\.jx-/.test(s)),
     "every rule in shell.css is scoped to a .jx- class, so none of it reaches outside the shell");
  ok(/visibility: hidden/.test(css), "the closed phone menu is hidden from Tab, not just slid off screen");
  ok(/\.jx-side, \.jx-side \*[^{]*\.jx-room \*\s*\{\s*box-sizing: border-box/.test(css),
     "the menu sizes its own boxes, so it is the same width beside the home page and on a room page");

  const page = strip(fs.readFileSync("./app/page.jsx", "utf8"));
  ok(/<SideMenu role=\{user\.role\} realRole=\{user\.realRole\} preview=\{user\.preview\} \/>/.test(page), "the home page renders the side menu");
  ok(/className="jx-main jx-room"/.test(page), "and sits in the main column beside it");
  ok(/\{link\("\/", "Dashboard"\)\}/.test(menu), "the menu's first link goes home");
}


console.log(`\noffice: ${p} passed, ${f} failed`);
if (f) process.exit(1);
