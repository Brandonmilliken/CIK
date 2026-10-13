/* v180 (scan): the menu, and nothing else, for the browser.
 *
 * The side menu and search box (browser code) imported lib/office-rooms.js
 * for the room names, which put EVERY room definition into the download
 * every signed-in person gets: the admin-only rooms’ contents included.
 * This holds only what the menu shows (name, address, who may see it, the
 * one-line description). office-rooms stays on the server.
 *
 * Kept in step with lib/office-rooms.js by build180.test.mjs: a room added
 * or renamed there and not here fails the tests. (v181: `where` is copied
 * too when a room isn't "jarvis", for the menu's "still in MRE Office" dot.)
 */
import { atLeast } from "./role-rank.js";   // v181: not authz.js (it carries the super-admin list)

export const MENU = [
  {
    "label": "Grow",
    "rooms": [
      {
        "slug": "training",
        "label": "Training Center",
        "blurb": "Quick links to the training resources the team relies on."
      },
      {
        "slug": "onboarding",
        "label": "Onboarding",
        "blurb": "The steps every new team member works through, phase by phase."
      },
      {
        "slug": "lead-generation",
        "label": "Lead Generation",
        "blurb": "Where Cash Is King's sellers come from, how to follow up, and what to say."
      },
      {
        "slug": "marketing",
        "label": "Marketing",
        "blurb": "On-brand assets, ready to download."
      },
      {
        "slug": "recruiting",
        "label": "Recruiting",
        "blurb": "Grow the team: job posts, interview forms and onboarding requests."
      }
    ]
  },
  {
    "label": "Operate",
    "rooms": [
      {
        "slug": "new-business",
        "label": "New Business",
        "blurb": "Turn-over sheets and submission forms for new deals and pending files: everything needed to open a new file."
      },
      {
        "slug": "transactions",
        "label": "Transactions",
        "blurb": "The first-48-hours checklist for every new contract, step by step."
      },
      {
        "slug": "open-houses",
        "label": "Open Houses",
        "blurb": "Schedule an open house, grab the sign-in sheet, and review the hosting playbook."
      },
      {
        "slug": "mls-coverage",
        "label": "MLS Coverage"
      },
      {
        "slug": "mls-info",
        "label": "MLS Info",
        "blurb": "The MLSs across Oregon and Washington, with support lines and login links."
      },
      {
        "slug": "gis",
        "label": "GIS",
        "blurb": "County and city mapping tools across Oregon and Washington: parcel lookups, tax lots and survey data."
      },
      {
        "slug": "vendors",
        "label": "Vendors",
        "blurb": "Vetted lenders, title and escrow, inspectors, contractors and more across Oregon and Washington."
      },
      {
        "slug": "help-ticket",
        "label": "Submit a Help Ticket",
        "blurb": "Tell us what's going on and the right person will follow up. It's logged under your account, so you can check its status anytime under My Tickets."
      },
      {
        "slug": "my-tickets",
        "label": "My Tickets",
        "blurb": "Everything you've submitted, and where it stands. Click a ticket for the full details. Only you and the support team can see these."
      },
      {
        "slug": "support",
        "label": "Support Center",
        "minRole": "admin",
        "blurb": "Every ticket submitted by the team, in one place: review, prioritize, and disposition each one as it's handled."
      }
    ]
  },
  {
    "label": "Company",
    "rooms": [
      {
        "slug": "company",
        "label": "Company",
        "blurb": "Who Cash Is King is, what we stand for, where we are, and who to go to."
      },
      {
        "slug": "tech-stack",
        "label": "Tech Stack",
        "blurb": "The CRM, phones, e-sign and other platforms the team runs on, with a quick link to each."
      },
      {
        "slug": "directory",
        "label": "Directory",
        "blurb": "Everyone at Cash Is King, with how to reach them."
      },
      {
        "slug": "resources",
        "label": "Resources",
        "blurb": "The internal resource library: company drives, trackers, audits and forms."
      },
      {
        "slug": "admin-links",
        "label": "Admin Links",
        "minRole": "admin",
        "blurb": "Quick access to the tools and dashboards admins need. Visible only to admins and leadership."
      },
      {
        "slug": "announcements",
        "label": "Announcements",
        "blurb": "News for the whole team. Announcements set to show appear at the top of everyone's home page, in the order below, and stay there until each person acknowledges them."
      },
      {
        "slug": "leadership-settings",
        "label": "Leadership Settings",
        "minRole": "leadership",
        "blurb": "Who is an admin or in leadership. Pick a new role for anyone and confirm it; every change is recorded below."
      }
    ]
  }
];

/** The menu groups and rooms this role may see. */
export function menuFor(role) {
  return MENU
    .map(g => ({ label: g.label, rooms: g.rooms.filter(r => canSeeRoom(r, role)) }))
    .filter(g => g.rooms.length);
}
export function roomBySlug(slug) {
  for (const g of MENU) for (const r of g.rooms) if (r.slug === slug) return { ...r, group: g.label };
  return null;
}
export function canSeeRoom(room, role) {
  return !room?.minRole || atLeast(role, room.minRole);
}
