/* The home page (CIK Office v1).
 *
 * Jarvis's home is its agent dashboard (assets/dashboard.html, fed by Sisu,
 * Sierra, Fello and Slack). None of those exist at Cash Is King, so that page
 * did not come over. In its place, for now:
 *   - the announcements this person hasn't acknowledged yet (leadership posts
 *     them in Company > Announcements), with a "Got it" on each
 *   - quick links into the rooms
 *   - a Deals tab (cik-v5): the Podio agent dashboard (app/deals.jsx): each
 *     person's numbers, deals in progress, closings, kicks to outside agents,
 *     and the team leaderboard. It loads its own data from /api/podio/dashboard.
 */
import { redirect } from "next/navigation";
import { currentUser } from "../lib/session.js";
import { listItems } from "../lib/office-store.js";
import { acksFor, splitAnnouncements } from "../lib/announcement-acks.js";
import { COMPANY } from "../lib/brand.js";
import { atLeast } from "../lib/authz.js";
import SideMenu from "./side-menu.jsx";
import Home from "./home.jsx";

export const dynamic = "force-dynamic";

/* The rooms people reach for most, in the order they'd look for them. */
const QUICK = [
  { href: "/office/directory",    label: "Directory",     sub: "Everyone at Cash Is King" },
  { href: "/office/vendors",      label: "Vendors",       sub: "Lenders, title, inspectors, contractors" },
  { href: "/office/new-business", label: "New Business",  sub: "Turn-over sheets and pending forms" },
  { href: "/office/resources",    label: "Resources",     sub: "Drives, trackers and audits" },
  { href: "/office/mls-info",     label: "MLS Info",      sub: "Support lines and logins" },
  { href: "/office/help-ticket",  label: "Get help",      sub: "Submit a help ticket" },
];

function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }).format(now));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function Page({ searchParams }) {
  const user = await currentUser();
  if (!user) {
    const tab = String((await searchParams)?.tab || "");
    redirect(/^[a-z]{2,20}$/.test(tab) ? `/signin?next=${encodeURIComponent("/?tab=" + tab)}` : "/signin");
  }

  /* A failure here hides the announcements, nothing else. */
  let ann = { current: [], acknowledged: [] };
  try {
    const [items, mine] = await Promise.all([listItems("announcements"), acksFor(user.email)]);
    ann = splitAnnouncements(items, mine);
  } catch (e) {
    console.error("home: announcements failed to load:", e);
  }

  const tab = String((await searchParams)?.tab || "") === "deals" ? "deals" : "home";
  const first = String(user.displayName || "").split(/\s+/)[0] || "";
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="jx-shell">
      <SideMenu role={user.role} realRole={user.realRole} preview={user.preview} />
      <main className="jx-main jx-room" id="jx-content" tabIndex={-1}>
        <div className="jx-roominner jx-wide">
          <Home
            initialTab={tab}
            hello={`${greeting()}${first && !first.includes("@") ? `, ${first}` : ""}`}
            today={today}
            company={COMPANY}
            announcements={ann.current}
            acknowledged={ann.acknowledged.map(a => ({ id: a.id, title: a.title, message: a.message, link: a.link }))}
            quick={QUICK}
            admin={atLeast(user.role, "admin")}
          />
        </div>
      </main>
    </div>
  );
}
