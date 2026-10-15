/* One CIK Office room.
 *
 * Every room in the side menu has a page here at /office/<slug>. A list room
 * renders its items from lib/office-store.js, with edit controls for admins.
 * A list filled by the one-time copy from CIK Office (WordPress) says so
 * until that copy has been made.
 *
 * Same gate as the dashboard: signed in, or off to /signin. And never cached,
 * because the menu depends on who is looking.
 */
import { notFound, redirect } from "next/navigation";
import { atLeast, SUPER_ADMINS } from "../../../lib/authz.js";
import { currentUser } from "../../../lib/session.js";
import { roomBySlug, partsOf, canSeeRoom, canEditRoom } from "../../../lib/office-rooms.js";
import { listItems, roomState } from "../../../lib/office-store.js";
import SideMenu from "../../side-menu.jsx";
import { podioConfig } from "../../../lib/podio.js";
import OfficeList from "../../office-list.jsx";
import { TicketForm, MyTickets, SupportCenter } from "../../tickets.jsx";
import MlsCoverage from "../../mls-coverage.jsx";
import AnnouncementAcks from "../../announcement-acks.jsx";
import RolesEditor from "../../roles-editor.jsx";
import { listPeople, recentChanges } from "../../../lib/roles.js";
import { acksByItem } from "../../../lib/announcement-acks.js";
import { allAgents } from "../../../lib/db.js";
import { myTickets, allTickets, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "../../../lib/tickets.js";

export const dynamic = "force-dynamic";

const pacific = d => new Date(d).toLocaleString("en-US", {
  timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
export async function generateMetadata({ params }) {
  const { room: slug } = await params;
  const room = roomBySlug(slug);
  return { title: room ? `${room.label} — Jarvis · Cash Is King` : "Jarvis · Cash Is King" };
}

export default async function RoomPage({ params, searchParams }) {
  const user = await currentUser();
  if (!user) {
    /* v180 (scan): back to this room after signing in.
       v181 (scan): with its ?list= and ?q= (a search result's filter). */
    const { room } = await params;
    let qs = "";
    try {
      const sp = await searchParams;
      const keep = new URLSearchParams();
      for (const k of ["list", "q"]) { const v = sp && sp[k]; if (typeof v === "string" && v.length <= 200) keep.set(k, v); }
      qs = keep.toString() ? "?" + keep.toString() : "";
    } catch { qs = ""; }
    redirect(/^[a-z0-9-]{1,60}$/.test(String(room || "")) ? `/signin?next=${encodeURIComponent("/office/" + room + qs)}` : "/signin");
  }

  const { room: slug } = await params;
  const room = roomBySlug(slug);
  // A room the viewer may not open looks exactly like one that does not exist.
  if (!room || !canSeeRoom(room, user.role)) notFound();

  /* The ticket rooms (v94) are pages of their own. My Tickets loads only the
     viewer's own tickets, by the session's email. The Support Center loads
     every ticket, and canSeeRoom above has already kept it to admins. */
  if (room.where === "jarvis" && room.view) {
    const head = { group: room.group, label: room.label, blurb: room.blurb };
    let body;
    try {
      body = room.view === "ticket-form"
        ? <TicketForm {...head} categories={TICKET_CATEGORIES} priorities={TICKET_PRIORITIES} />
        : room.view === "my-tickets"
        ? <MyTickets {...head} items={await myTickets(user.email)} />
        : room.view === "mls-coverage"
        ? <><p className="jx-kicker">{room.group}</p><MlsCoverage /></>   /* the map carries its own heading */
        : room.view === "roles"
        ? <><p className="jx-kicker">{room.group}</p><h1>{room.label}</h1><p className="jx-blurb" style={{ marginBottom: 18 }}>{room.blurb}</p>
            <RolesEditor initialPeople={await listPeople()} initialChanges={await recentChanges()}
                         me={String(user.email || "").toLowerCase()} superAdmins={[...SUPER_ADMINS]} /></>
        : room.view === "support"
        ? <SupportCenter {...head} items={await allTickets()} statuses={TICKET_STATUSES}
                         priorities={TICKET_PRIORITIES} categories={TICKET_CATEGORIES} />
        : null;
    } catch (e) {
      console.error(`office room ${room.slug} failed to load:`, e);
      body = (
        <>
          <p className="jx-kicker">{room.group}</p>
          <h1>{room.label}</h1>
          <div className="jx-card" role="alert"><p><strong>{room.label} couldn&rsquo;t load just now.</strong> Refresh the page to try again.</p></div>
        </>
      );
    }
    if (body === null) notFound();
    return (
      <div className="jx-shell">
        <SideMenu role={user.role} realRole={user.realRole} preview={user.preview} deals={podioConfig().ok} />
        <main className="jx-main jx-room" id="jx-content" tabIndex={-1}>
          <div className="jx-roominner jx-wide">{body}</div>
        </main>
      </div>
    );
  }

  if (room.where === "jarvis" && room.list) {
    let items = null, state = null;
    /* v127: the acknowledgement record, under the announcements. Admins and
       leadership; a failure hides just this part. */
    let ackRows = null;
    if (room.slug === "announcements" && atLeast(user.role, "admin")) {
      try {
        /* v179 (scan): the acknowledgements of THESE announcements, all of
           them (not "the newest 5000" of everything ever acknowledged). */
        /* v180 (scan): a roster that failed to load says so, rather than
           every announcement looking acknowledged by everyone. */
        const [anns, people] = await Promise.all([listItems("announcements"), allAgents().catch(() => null)]);
        const byItem = await acksByItem(anns.map(i => String(i.id)));
        ackRows = anns.map(i => {
          const f = i.fields || {};
          const acks = (byItem.get(String(i.id)) || []);
          const done = new Set(acks.map(a => String(a.email).toLowerCase()));
          return {
            id: String(i.id), title: String(f.title || "(untitled)"), hidden: f.show === "No",
            acks: acks.map(a => ({ name: a.name, at: a.at })),
            notYet: (people || []).filter(p => p.email && !done.has(String(p.email).toLowerCase()))
              .map(p => [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email)
              .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })),
            ...(people ? {} : { notYetUnknown: true }),
          };
        });
      } catch (e) { console.error("announcement acknowledgements failed to load:", e); }
    }
    /* A room's second lists (MLS Info's rule books), each loaded on its own,
       so one that fails to load does not take the rest of the room with it. */
    const parts = await Promise.all(partsOf(room).map(async p => {
      try {
        const st = await roomState(p.slug);
        return { p, state: st, items: st.imported ? await listItems(p.slug) : [] };
      } catch (e) {
        console.error(`office list ${p.slug} failed to load:`, e);
        return { p, state: null, items: null };
      }
    }));
    try {
      state = await roomState(room.slug);
      items = await listItems(room.slug);
    } catch (e) {
      console.error(`office room ${room.slug} failed to load:`, e);
    }
    return (
      <div className="jx-shell">
        <SideMenu role={user.role} realRole={user.realRole} preview={user.preview} deals={podioConfig().ok} />
        <main className="jx-main jx-room" id="jx-content" tabIndex={-1}>
          <div className="jx-roominner jx-wide">
            {items !== null && state && !state.imported ? (
              <>
                <p className="jx-kicker">{room.group}</p>
                <h1>{room.label}</h1>
                {/* cik-v9: no mention of the old CIK Office site (every room was
                    copied 2026-10-13; this only shows if one somehow wasn't). */}
                <div className="jx-card">
                  <p><strong>{room.label} isn&rsquo;t set up yet.</strong> Check back soon.</p>
                </div>
              </>
            ) : items === null ? (
              <>
                <p className="jx-kicker">{room.group}</p>
                <h1>{room.label}</h1>
                <div className="jx-card" role="alert">
                  <p><strong>{room.label} couldn&rsquo;t load just now.</strong> Nothing has been lost.
                    Refresh the page to try again.</p>
                </div>
              </>
            ) : (
              <>
                <OfficeList
                  slug={room.slug}
                  label={room.label}
                  list={{ ...room.list, group: room.group }}
                  items={items}
                  canEdit={canEditRoom(room, user.role)}
                />
                {ackRows && <AnnouncementAcks rows={ackRows} />}
                {parts.map(({ p, state: st, items: its }) => (
                  <section key={p.slug} className="jx-part" aria-labelledby={`jx-part-${p.slug.replace(/[^a-z0-9-]/g, "-")}`}>
                    {its === null || !st ? (
                      <>
                        <h2 className="jx-parthead" id={`jx-part-${p.slug.replace(/[^a-z0-9-]/g, "-")}`}>{p.list.heading}</h2>
                        <div className="jx-card" role="alert"><p>{p.list.heading} couldn&rsquo;t load just now. Refresh the page to try again.</p></div>
                      </>
                    ) : !st.imported ? (
                      <>
                        <h2 className="jx-parthead" id={`jx-part-${p.slug.replace(/[^a-z0-9-]/g, "-")}`}>{p.list.heading}</h2>
                        <div className="jx-card"><p>These aren&rsquo;t set up yet. Check back soon.</p></div>
                      </>
                    ) : (
                      <OfficeList
                        section
                        headingId={`jx-part-${p.slug.replace(/[^a-z0-9-]/g, "-")}`}
                        slug={p.slug}
                        label={p.list.heading}
                        list={p.list}
                        items={its}
                        canEdit={canEditRoom(p, user.role)}
                      />
                    )}
                  </section>
                ))}
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  notFound();
}
