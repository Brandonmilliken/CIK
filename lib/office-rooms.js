/* The CIK Office rooms (Cash Is King), in the order the team already knows them.
 *
 * CIK Office (cikoffice.com, WordPress, an older copy of the MRE Command
 * Center plugin, "Beta 1.41.0") is being moved here. This app started as a
 * copy of Jarvis (jarvis.mreoffice.com, v181) with every Matin-only part
 * taken out. This list is the side menu.
 *
 *   where: "jarvis"  the room lives here. Its page is real and reads this
 *                    app's own data. (Every CIK room is "jarvis" from day one:
 *                    there is no half-moved state, because the whole of CIK
 *                    Office is about 300 rows.)
 *
 * `seed: { from: "cikoffice", collection }` means the room is filled ONCE by
 * the one-time import (scripts/office-import.browser.js, run in a signed-in
 * cikoffice.com tab). A room with no seed starts empty.
 *
 * What CIK Office held (inspected 2026-10-13): vendors 244, directory 13,
 * mls 13, gis 10, values 6, tech_stack 5, resources 4, nb_links 4,
 * oh_links 3, offices 2, mission and vision text, and nothing else. Its
 * other rooms were empty, and showed Matin's built-in sample text in their
 * place, so those rooms start empty here, for CIK's own content.
 *
 * `minRole` hides a room from anyone below that role. It is a menu decision,
 * not the security boundary: the room page checks the same rule on the server,
 * and anything a room reads must check it again in its own route.
 *
 * Keep lib/office-menu.js in step (a test checks).
 */
import { atLeast } from "./authz.js";

export const CIK_OFFICE_URL = "https://cikoffice.com/";

const link = (blurb, extra = {}) => ({
  blurb,
  noun: "link",
  editRole: "admin",
  subtitle: "linkKind",
  fields: [
    { key: "name", label: "Name", type: "text", required: true, max: 120 },
    { key: "url",  label: "Link", type: "url",  required: true, max: 1000 },
  ],
  ...extra,
});

/* ---------- Grow ---------- */

const TRAINING = link("Quick links to the training resources the team relies on.");

/* Onboarding: CIK Office's fields (Task, Phase, Detail). Its "Complete
   (yes/no)" box was one shared tick for the whole company, not per person,
   so it is left out. */
const ONBOARDING = {
  blurb: "The steps every new team member works through, phase by phase.",
  noun: "step",
  editRole: "admin",
  groupBy: "phase",
  fields: [
    { key: "name",        label: "Task",   type: "text",     required: true, max: 200 },
    { key: "phase",       label: "Phase",  type: "choice",   required: true, max: 60, allowOther: true,
      options: ["Before day one", "First week", "First 30 days", "First 90 days"] },
    { key: "url",         label: "Link",   type: "url",      max: 1000 },
    { key: "description", label: "Detail", type: "longtext", max: 2000 },
  ],
};

/* Lead Generation: CIK Office's three lists (lead sources, follow-up cadence,
   scripts), all empty there. Scripts are text here (CIK Office kept them as
   text, not PDFs). */
const LEAD_SOURCES = {
  blurb: "Where Cash Is King's sellers come from, how to follow up, and what to say.",
  heading: "Lead sources",
  noun: "lead source",
  editRole: "admin",
  details: [{ key: "volume", label: "Volume" }],
  fields: [
    { key: "name",        label: "Source",      type: "text",     required: true, max: 120 },
    { key: "url",         label: "Link",        type: "url",      max: 1000 },
    { key: "volume",      label: "Volume",      type: "text",     max: 120 },
    { key: "description", label: "Description", type: "longtext", max: 1000 },
  ],
};
const LEAD_CADENCE = {
  heading: "Follow-up cadence",
  noun: "step",
  editRole: "admin",
  fields: [
    { key: "name",        label: "When",       type: "text",     required: true, max: 120 },
    { key: "description", label: "What to do", type: "longtext", required: true, max: 1000 },
  ],
};
const LEAD_SCRIPTS = {
  heading: "Scripts",
  noun: "script",
  editRole: "admin",
  search: "Search scripts…",
  collapse: 320,
  fields: [
    { key: "name",        label: "Script name", type: "text",     required: true, max: 200 },
    { key: "description", label: "Script",      type: "longtext", required: true, max: 10000 },
  ],
};

const MARKETING = {
  blurb: "On-brand assets, ready to download.",
  heading: "Brand assets",
  noun: "brand asset",
  editRole: "admin",
  details: [{ key: "format", label: "Format" }],
  fields: [
    { key: "name",        label: "Asset",        type: "text",     required: true, max: 120 },
    { key: "format",      label: "Format",       type: "text",     max: 80 },
    { key: "description", label: "Description",  type: "longtext", max: 1000 },
    { key: "url",         label: "Download link", type: "url",     max: 1000 },
  ],
};

const RECRUITING = link("Grow the team: job posts, interview forms and onboarding requests.");

/* ---------- Operate ---------- */

const NEW_BUSINESS = link("Turn-over sheets and submission forms for new deals and pending files: everything needed to open a new file.",
  { seed: { from: "cikoffice", collection: "nb_links" } });
const OPEN_HOUSES = link("Schedule an open house, grab the sign-in sheet, and review the hosting playbook.",
  { seed: { from: "cikoffice", collection: "oh_links" } });

/* Transactions: CIK Office's "first 48 hours" checklist (Step, Detail). It was
   empty there (the page showed Matin's sample steps), so it starts empty. */
const TRANSACTIONS = {
  blurb: "The first-48-hours checklist for every new contract, step by step.",
  heading: "First 48 hours",
  noun: "step",
  editRole: "admin",
  fields: [
    { key: "name",        label: "Step",   type: "text",     required: true, max: 200 },
    { key: "description", label: "Detail", type: "longtext", max: 2000 },
  ],
};

/* MLS Info: CIK Office's fields. It had no membership or lockbox fields
   (Jarvis added those later), so the list is not grouped. */
const MLS_INFO = {
  blurb: "The MLSs across Oregon and Washington, with support lines and login links.",
  noun: "MLS",
  nounPlural: "MLSs",
  editRole: "admin",
  seed: { from: "cikoffice", collection: "mls" },
  subtitle: "area",
  contact: true,
  details: [
    { key: "abbr",        label: "Known as" },
    { key: "description" },
    { key: "support",     label: "Support", phone: true },
  ],
  fields: [
    { key: "name",        label: "Name",         type: "text",     required: true, max: 120 },
    { key: "abbr",        label: "Short name",   type: "text",     max: 20 },
    { key: "area",        label: "Coverage area", type: "text",    max: 200 },
    { key: "description", label: "Description",  type: "longtext", max: 1000 },
    { key: "support",     label: "Support desk", type: "text",     max: 120 },
    { key: "phone",       label: "Phone",        type: "text",     max: 80 },
    { key: "url",         label: "Login link",   type: "url",      max: 1000 },
  ],
};

const GIS = {
  blurb: "County and city mapping tools across Oregon and Washington: parcel lookups, tax lots and survey data.",
  noun: "map",
  editRole: "admin",
  seed: { from: "cikoffice", collection: "gis" },
  groupBy: "state",
  subtitle: "note",
  search: "Search county or city…",
  fields: [
    { key: "name",  label: "Name",  type: "text",   required: true, max: 120 },
    { key: "url",   label: "Link",  type: "url",    required: true, max: 1000 },
    { key: "state", label: "State", type: "choice", required: true, options: ["Oregon", "Washington"] },
    { key: "note",  label: "Note",  type: "text",   max: 120 },
  ],
};

/* Vendors: 244 in CIK Office (a copy of MRE's list, Brandon 2026-10-13, kept
   as CIK's own from here on). CIK Office also had tags (all empty) and a star
   rating (one vendor), which are left out, as Jarvis did. */
const VENDOR_CATEGORIES = [
  "Lenders", "Title/Escrow", "Home Inspectors", "Roofers", "Sewer Scope", "Septic", "Well Testing",
  "Photographers", "Videographers", "Drone", "Staging", "Contractors", "Handyman", "Landscapers",
  "Cleaners", "Insurance", "Property Management", "Plumbing", "Marine Services",
  "Asbestos/Environmental Testing", "Painters", "HVAC", "Junk Removal", "Crawl-Space",
  "Carpet Cleaners", "Movers", "Power Washing", "Electrician", "House Measurement", "Land Surveyor",
  "Pest Control", "Miscellaneous", "Chimney/Fireplace", "Foundation", "Mold", "GeoTech", "Radon",
  "Log Cabins", "Attorneys", "Estate Sales", "Trees", "Locksmith", "Manufactured Homes",
  "1031 Exchange Companies", "Home Warranty", "Short Sale Negotiator", "Signage",
];
const VENDORS = {
  blurb: "Vetted lenders, title and escrow, inspectors, contractors and more across Oregon and Washington.",
  noun: "vendor",
  editRole: "admin",
  seed: { from: "cikoffice", collection: "vendors" },
  groupBy: "category",
  subtitle: "area",
  contact: true,
  collapse: 240,
  flag: { key: "preferred", value: "yes", filter: "Preferred only", badge: "Preferred" },
  search: "Search vendors, areas or notes…",
  fields: [
    { key: "name",        label: "Name",        type: "text",     required: true, max: 120 },
    { key: "category",    label: "Category",    type: "choice",   required: true, max: 60,
      options: VENDOR_CATEGORIES, allowOther: true },
    { key: "area",        label: "Area served", type: "text",     max: 120 },
    { key: "phone",       label: "Phone",       type: "text",     max: 80 },
    { key: "email",       label: "Email",       type: "text",     max: 200 },
    { key: "website",     label: "Website",     type: "url",      max: 1000 },
    { key: "description", label: "Notes",       type: "longtext", max: 1000 },
    { key: "preferred",   label: "Preferred",   type: "choice",   options: ["no", "yes"] },
  ],
};

/* ---------- Company ---------- */

/* Company: who Cash Is King is. CIK Office kept the mission and vision as two
   text settings; they are written here as the room's fixed card (change them
   in this file). Then its values, its offices, who does what, and the
   escalation paths, each a list of its own. */
const COMPANY = {
  blurb: "Who Cash Is King is, what we stand for, where we are, and who to go to.",
  heading: "Our values",
  noun: "value",
  editRole: "leadership",
  seed: { from: "cikoffice", collection: "values" },
  intro: [
    { heading: "Who we are",
      sections: [
        { title: "Mission", text: "Creating wealth through real estate in the great northwest." },
        { title: "Vision",  text: "Set the example for knowledge, skills and mastery in the industry so our clients and colleagues define us as extraordinary." },
      ] },
  ],
  fields: [
    { key: "name",        label: "Value",       type: "text",     required: true, max: 120 },
    { key: "description", label: "Description", type: "longtext", max: 1000 },
  ],
};
const COMPANY_OFFICES = {
  heading: "Offices",
  noun: "office",
  editRole: "admin",
  seed: { from: "cikoffice", collection: "offices" },
  contact: true,
  details: [{ key: "address", label: "Address" }],
  fields: [
    { key: "name",    label: "Office",  type: "text", required: true, max: 120 },
    { key: "address", label: "Address", type: "text", max: 300 },
    { key: "phone",   label: "Phone",   type: "text", max: 80 },
  ],
};
const COMPANY_ROLES = {
  heading: "Who does what",
  noun: "person or desk",
  nounPlural: "people and desks",
  editRole: "admin",
  subtitle: "role",
  fields: [
    { key: "name",        label: "Person / desk",  type: "text",     required: true, max: 120 },
    { key: "role",        label: "Role",           type: "text",     max: 120 },
    { key: "description", label: "What they own",  type: "longtext", max: 1000 },
  ],
};
const COMPANY_ESCALATION = {
  heading: "Escalation paths",
  noun: "path",
  editRole: "admin",
  fields: [
    { key: "name",        label: "Topic",                       type: "text",     required: true, max: 120 },
    { key: "description", label: "Who to go to, in order",      type: "longtext", required: true, max: 1000 },
  ],
};

const TECH_STACK = {
  blurb: "The CRM, phones, e-sign and other platforms the team runs on, with a quick link to each.",
  noun: "tool",
  editRole: "admin",
  seed: { from: "cikoffice", collection: "tech_stack" },
  fields: [
    { key: "name",        label: "Tool",           type: "text",     required: true, max: 80 },
    { key: "url",         label: "Link",           type: "url",      max: 500 },
    { key: "description", label: "What it's for", type: "longtext", max: 1000 },
  ],
};

/* Directory: CIK Office's 13 people, typed in by hand there (no sheet), so
   admins keep it up to date here. Its groups are CIK's. */
const DIRECTORY = {
  blurb: "Everyone at Cash Is King, with how to reach them.",
  noun: "person",
  nounPlural: "people",
  editRole: "admin",
  seed: { from: "cikoffice", collection: "directory" },
  groupBy: "group",
  subtitle: "title",
  contact: true,
  search: "Search name, title, email or phone…",
  fields: [
    { key: "name",           label: "Name",            type: "text",   required: true, max: 120 },
    { key: "title",          label: "Title",           type: "text",   max: 200 },
    { key: "email",          label: "Email",           type: "text",   max: 300 },
    { key: "phone",          label: "Phone",           type: "text",   max: 80 },
    { key: "secondaryPhone", label: "Second phone",    type: "text",   max: 80 },
    { key: "group",          label: "Group",           type: "choice", required: true, max: 60, allowOther: true,
      options: ["Leadership", "Acquisitions", "Outside Sales", "Support Staff", "Administrative Staff"] },
  ],
};

const RESOURCES = {
  blurb: "The internal resource library: company drives, trackers, audits and forms.",
  noun: "resource",
  editRole: "admin",
  seed: { from: "cikoffice", collection: "resources" },
  groupBy: "category",
  subtitle: "linkKind",
  search: "Search resources…",
  fields: [
    { key: "name",     label: "Name",     type: "text",   required: true, max: 120 },
    { key: "url",      label: "Link",     type: "url",    required: true, max: 1000 },
    { key: "category", label: "Category", type: "choice", required: true, max: 60, allowOther: true,
      options: ["Resources", "Independent Resources"] },
  ],
};

const ADMIN_LINKS = {
  blurb: "Quick access to the tools and dashboards admins need. Visible only to admins and leadership.",
  noun: "link",
  editRole: "admin",
  fields: [
    { key: "name",        label: "Name",        type: "text",     required: true, max: 120 },
    { key: "url",         label: "Link",        type: "url",      required: true, max: 1000 },
    { key: "description", label: "Description", type: "longtext", max: 1000 },
  ],
};

/* Company announcements: leadership posts here, and the ones set to show
   appear at the top of everyone's home page, in this list's order. CIK
   Office's "Company alerts" and "Today's priorities" were empty; this is
   where that kind of news goes now. */
const ANNOUNCEMENTS = {
  blurb: "News for the whole team. Announcements set to show appear at the top of everyone's home page, in the order below, and stay there until each person acknowledges them.",
  noun: "announcement",
  editRole: "leadership",
  fields: [
    { key: "title",   label: "Title",   type: "text",     required: true, max: 120 },
    { key: "message", label: "Message", type: "longtext", required: true, max: 2000 },
    { key: "link",    label: "Link",    type: "url",      max: 500,
      help: "Optional: a page to open for more, like a sign-up form or a flyer." },
    { key: "show",    label: "Show on the home page", type: "choice", required: true, options: ["Yes", "No"],
      help: "Choose No to keep it here without showing it." },
  ],
};

export const ROOM_GROUPS = [
  { label: "Grow", rooms: [
    { slug: "training",            label: "Training Center",      where: "jarvis", list: TRAINING },
    { slug: "onboarding",          label: "Onboarding",           where: "jarvis", list: ONBOARDING },
    { slug: "lead-generation",     label: "Lead Generation",      where: "jarvis", list: LEAD_SOURCES,
      parts: { cadence: LEAD_CADENCE, scripts: LEAD_SCRIPTS } },
    { slug: "marketing",           label: "Marketing",            where: "jarvis", list: MARKETING },
    { slug: "recruiting",          label: "Recruiting",           where: "jarvis", list: RECRUITING },
  ]},
  { label: "Operate", rooms: [
    { slug: "new-business",        label: "New Business",         where: "jarvis", list: NEW_BUSINESS },
    { slug: "transactions",        label: "Transactions",         where: "jarvis", list: TRANSACTIONS },
    { slug: "open-houses",         label: "Open Houses",          where: "jarvis", list: OPEN_HOUSES },
    { slug: "mls-coverage",        label: "MLS Coverage",         where: "jarvis", view: "mls-coverage" },
    { slug: "mls-info",            label: "MLS Info",             where: "jarvis", list: MLS_INFO },
    { slug: "gis",                 label: "GIS",                  where: "jarvis", list: GIS },
    { slug: "vendors",             label: "Vendors",              where: "jarvis", list: VENDORS },
    { slug: "help-ticket",         label: "Submit a Help Ticket", where: "jarvis", view: "ticket-form",
      blurb: "Tell us what's going on and the right person will follow up. It's logged under your account, so you can check its status anytime under My Tickets." },
    { slug: "my-tickets",          label: "My Tickets",           where: "jarvis", view: "my-tickets",
      blurb: "Everything you've submitted, and where it stands. Click a ticket for the full details. Only you and the support team can see these." },
    { slug: "support",             label: "Support Center",       where: "jarvis", view: "support", minRole: "admin",
      blurb: "Every ticket submitted by the team, in one place: review, prioritize, and disposition each one as it's handled." },
  ]},
  { label: "Company", rooms: [
    { slug: "company",             label: "Company",              where: "jarvis", list: COMPANY,
      parts: { offices: COMPANY_OFFICES, roles: COMPANY_ROLES, escalation: COMPANY_ESCALATION } },
    { slug: "tech-stack",          label: "Tech Stack",           where: "jarvis", list: TECH_STACK },
    { slug: "directory",           label: "Directory",            where: "jarvis", list: DIRECTORY },
    { slug: "resources",           label: "Resources",            where: "jarvis", list: RESOURCES },
    { slug: "admin-links",         label: "Admin Links",          where: "jarvis", minRole: "admin", list: ADMIN_LINKS },
    { slug: "announcements",       label: "Announcements",        where: "jarvis", list: ANNOUNCEMENTS },
    /* Who is an admin or in leadership. Brandon is always the super admin. */
    { slug: "leadership-settings", label: "Leadership Settings",  where: "jarvis", view: "roles", minRole: "leadership",
      blurb: "Who is an admin or in leadership. Pick a new role for anyone and confirm it; every change is recorded below." },
  ]},
];

export const ALL_ROOMS = ROOM_GROUPS.flatMap(g => g.rooms.map(r => ({ ...r, group: g.label })));

export function roomBySlug(slug) {
  return ALL_ROOMS.find(r => r.slug === slug) || null;
}

/* A room can hold a second list, like MLS Info's rule books. That list is
   stored, edited and imported on its own, under the key "<room>~<part>"
   ("mls-info~files"), and has the room's group, menu rule and state.
   listTarget() answers for either kind of key; roomBySlug() only for rooms. */
const PART_KEY = /^([a-z0-9-]{1,40})~([a-z]{1,20})$/;
export function listTarget(key) {
  if (typeof key !== "string") return null;
  const m = PART_KEY.exec(key);
  if (!m) return roomBySlug(key);
  const room = roomBySlug(m[1]);
  const part = room?.parts && Object.hasOwn(room.parts, m[2]) ? room.parts[m[2]] : null;
  if (!part) return null;
  return { ...room, slug: key, parent: room.slug, label: `${room.label}: ${part.heading || m[2]}`, list: part };
}

/** The second lists of a room, as listTarget() sees them. */
export function partsOf(room) {
  return Object.keys(room?.parts || {}).map(k => listTarget(`${room.slug}~${k}`)).filter(Boolean);
}

export function canSeeRoom(room, role) {
  return !room?.minRole || atLeast(role, room.minRole);
}

/* Who may add, change or delete items in a room. Only a room that has moved,
   is a list, and names a role. Everyone else reads. This is checked again by
   every write route on the server; the page only uses it to decide whether
   to show the edit buttons. */
export function canEditRoom(room, role) {
  return Boolean(room && room.where === "jarvis" && room.list && !room.list.readOnly &&
                 canSeeRoom(room, role) && atLeast(role, room.list.editRole || "admin"));
}

/* Who may run the one-time copy of a room from CIK Office: admins and
   leadership, for a list room that is filled by the import. Separate from
   canEditRoom so a read-only list could still get its first copy. */
export function canImportRoom(room, role) {
  return Boolean(room && room.where === "jarvis" && room.list &&
                 room.list.seed?.from === "cikoffice" &&
                 canSeeRoom(room, role) && atLeast(role, "admin"));
}

/* The menu as one viewer should see it: rooms they may not open are left out,
   and a group left with nothing is left out with them. */
export function menuFor(role) {
  return ROOM_GROUPS
    .map(g => ({ label: g.label, rooms: g.rooms.filter(r => canSeeRoom(r, role)) }))
    .filter(g => g.rooms.length);
}
