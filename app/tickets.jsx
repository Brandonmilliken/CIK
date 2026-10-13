"use client";
/* The three help-ticket rooms (v94): Submit a Help Ticket, My Tickets, and the
 * Support Center. The server decides who may see and change what
 * (lib/tickets.js and app/api/tickets/**); these only draw it.
 *
 * v170: each ticket carries its conversation. The support team sends an
 * update back ("Reply to agent"); the agent sees it in My Tickets, marked
 * "New update", and can answer there; the answer shows in the Support
 * Center marked "Agent replied". Opening the page or the ticket is what
 * tells the bell it has been seen.
 *
 * Every date is shown in Pacific time on both the server and the browser, so
 * the page reads the same for everyone and never flickers while it loads.
 */
import { useEffect, useMemo, useRef, useState } from "react";

const when = iso => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
};
const statusClass = s => "jx-badge jx-tstat jx-tstat-" + String(s || "").toLowerCase().replace(/[^a-z]+/g, "-");
const PLAIN_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

async function send(url, method, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
    if (res.status === 401) { location.href = `/signin?next=${encodeURIComponent(location.pathname + location.search)}`;   /* v181 (scan): and back again */ return null; }
    const data = await res.json().catch(() => ({}));
    /* v137: a ticket was filed or changed, so the bell recounts now. */
    if (res.ok && method !== "GET") { try { window.dispatchEvent(new Event("jx:tickets")); } catch { /* old browser */ } }
    return res.ok ? data : { error: data.error || `That didn't go through (HTTP ${res.status}).`, errors: data.errors || {} };
  } catch {
    return { error: "Couldn't reach Jarvis. Check your connection and try again. Nothing was sent." };
  }
}

function Head({ group, label, blurb }) {
  return (
    <div className="jx-roomhead">
      <div>
        <p className="jx-kicker">{group}</p>
        <h1>{label}</h1>
        {blurb && <p className="jx-blurb">{blurb}</p>}
      </div>
    </div>
  );
}

/* ---- Submit a Help Ticket ---------------------------------------------------- */
export function TicketForm({ group, label, blurb, categories, priorities }) {
  const blank = { title: "", category: categories[0], priority: "Normal", details: "" };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const set = k => e => {
    setForm({ ...form, [k]: e.target.value });
    if (errors[k]) setErrors({ ...errors, [k]: undefined });   // the message goes once it is fixed
  };

  async function submit(e) {
    e.preventDefault();
    /* v181 (scan): the last "Ticket sent" card goes when a new one starts. */
    setSent(null);
    /* v181 (scan): the keyboard goes to the field to fix, and it is said. */
    if (!form.title.trim()) { setErrors({ title: "Say in a few words what the issue is." }); setNotice("Check the highlighted field."); setTimeout(() => document.getElementById("jx-t-title")?.focus(), 0); return; }
    setBusy(true); setNotice(""); setErrors({});
    const r = await send("/api/tickets", "POST", form);
    setBusy(false);
    if (!r) return;
    if (r.error) { setErrors(r.errors || {}); setNotice(r.error); return; }
    setSent(r.ticket); setForm(blank);
    /* v180 (scan): said through the live region that's already on the page
       (a status box that appears already filled in often isn't read out). */
    setNotice("Ticket sent.");
  }

  const err = k => errors[k] && <div className="jx-err" id={`jx-t-${k}-err`}>{errors[k]}</div>;
  const aria = k => (errors[k] ? { "aria-invalid": true, "aria-describedby": `jx-t-${k}-err` } : {});
  return (
    <>
      <Head group={group} label={label} blurb={blurb} />
      <div className="jx-live" role="status" aria-live="polite">{notice}</div>
      {sent && (
        <div className="jx-card jx-tsent" role="status">
          <p><strong>Ticket sent.</strong> &ldquo;{sent.title}&rdquo; is logged under your account.
            You can check where it stands anytime in <a href="/office/my-tickets">My Tickets</a>.</p>
        </div>
      )}
      <form className="jx-cardi jx-form jx-tform" onSubmit={submit} noValidate>
        <div className="jx-field">
          <label htmlFor="jx-t-title">What&rsquo;s the issue? *</label>
          <input id="jx-t-title" type="text" maxLength={200} placeholder="e.g. Can't log into RMLS"
                 value={form.title} onChange={set("title")} {...aria("title")} />
          {err("title")}
        </div>
        <div className="jx-tpair">
          <div className="jx-field">
            <label htmlFor="jx-t-category">Category</label>
            <select id="jx-t-category" value={form.category} onChange={set("category")} {...aria("category")}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {err("category")}
          </div>
          <div className="jx-field">
            <label htmlFor="jx-t-priority">Priority</label>
            <select id="jx-t-priority" value={form.priority} onChange={set("priority")} {...aria("priority")}>
              {priorities.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {err("priority")}
          </div>
        </div>
        <div className="jx-field">
          <label htmlFor="jx-t-details">Details <span className="jx-opt">(optional)</span></label>
          <textarea id="jx-t-details" rows={6} maxLength={5000} value={form.details} onChange={set("details")}
                    placeholder="Anything that would help — what you were doing, what happened, error messages, etc." {...aria("details")} />
          {err("details")}
        </div>
        <div className="jx-formbtns">
          <button type="submit" className="jx-btn jx-btnsm" disabled={busy}>{busy ? "Sending…" : "Submit ticket"}</button>
        </div>
      </form>
    </>
  );
}

function TicketMeta({ t }) {
  return (
    <p className="jx-sub">
      {[t.category, `${t.priority} priority`, when(t.createdAt)].filter(Boolean).join(" · ")}
    </p>
  );
}

/* ---- v170: the conversation on a ticket --------------------------------------- */
/* `side` is who is reading: "agent" (My Tickets) or "support" (Support Center). */
function Thread({ t, side }) {
  const replies = Array.isArray(t.replies) ? t.replies : [];
  if (!replies.length) return null;
  const who = r => r.fromSupport
    ? (side === "agent" ? `${r.authorName || "Support team"} · Support` : (r.authorName || r.authorEmail))
    : (side === "agent" ? "You" : (t.submittedName || t.submittedBy));
  return (
    <ol className="jx-thread" aria-label="Updates on this ticket">
      {replies.map(r => r.body ? (
        <li key={r.id} className={"jx-msg " + (r.fromSupport ? "jx-msg-sup" : "jx-msg-agent")}>
          <p className="jx-msghead"><strong>{who(r)}</strong><span>{when(r.at)}</span></p>
          <p className="jx-desc jx-msgbody">{r.body}</p>
          {r.statusTo && <p className="jx-msgstat">Status set to {r.statusTo}</p>}
        </li>
      ) : (
        <li key={r.id} className="jx-msgline">
          Status set to <strong>{r.statusTo}</strong>
          {side === "support" && (r.authorName || r.authorEmail) ? ` by ${r.authorName || r.authorEmail}` : ""} · {when(r.at)}
        </li>
      ))}
    </ol>
  );
}

/* A message box under a ticket. `children` go under the message (the
   Support Center's status picker). onSend answers true once it is sent, and
   the box empties. */
/* v180 (scan): what was typed is kept per ticket for as long as the page is
   open, so closing the box (another ticket's button, a filter, a refresh)
   no longer throws a half-written update away. Sent or cancelled clears it. */
const DRAFTS = new Map();
/* v181 (scan): drafts are kept per room too (My Tickets and the Support
   Center shared one, so an admin's support-voice draft filled their own
   agent reply box). */
function ReplyBox({ id, draftKey = id, label, placeholder, busy, onSend, onCancel, children, hint }) {
  const [text, setText] = useState(() => DRAFTS.get(draftKey) || "");
  const [err, setErr] = useState("");
  return (
    <form className="jx-tedit jx-treply" onSubmit={async e => {
      e.preventDefault();
      if (!text.trim()) { setErr("Write a message first."); document.getElementById(`jx-tr-${id}`)?.focus(); return; }
      setErr("");
      const okSent = await onSend(text);
      if (okSent) { setText(""); DRAFTS.delete(draftKey); }
    }}>
      <div className="jx-field">
        <label htmlFor={`jx-tr-${id}`}>{label}</label>
        <textarea id={`jx-tr-${id}`} rows={4} maxLength={5000} value={text} placeholder={placeholder}
                  onChange={e => { setText(e.target.value); DRAFTS.set(draftKey, e.target.value); if (err) setErr(""); }}
                  {...(err ? { "aria-invalid": true, "aria-describedby": `jx-tr-${id}-err` } : {})} />
        {err && <div className="jx-err" id={`jx-tr-${id}-err`}>{err}</div>}
      </div>
      {children}
      {hint && <p className="jx-note">{hint}</p>}
      <div className="jx-formbtns">
        <button type="submit" className="jx-btn jx-btnsm" disabled={busy}>{busy ? "Sending…" : "Send"}</button>
        {onCancel && <button type="button" className="jx-ghost" onClick={() => { DRAFTS.delete(draftKey); onCancel(); }} disabled={busy}>Cancel</button>}
      </div>
    </form>
  );
}

/* ---- My Tickets --------------------------------------------------------------- */
/* v181 (scan): a page refresh that was read BEFORE a save but arrived after
   it put the old ticket back. A ticket changed here more recently than the
   refreshed copy keeps the newer one; one deleted here stays gone. */
function mergeNewer(prev, next, gone) {
  const mine = new Map((prev || []).map(t => [t.id, t]));
  return (next || []).filter(t => !gone.has(t.id)).map(t => {
    const p = mine.get(t.id);
    return p && Date.parse(p.updatedAt || 0) > Date.parse(t.updatedAt || 0) ? p : t;
  });
}

export function MyTickets({ group, label, blurb, items: initial }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  /* v181 (scan): the ticket just answered stays open (it closed on Send when
     it had been opened as "New update"). */
  const [keepMine, setKeepMine] = useState(null);
  /* v170: what was new when the page opened stays marked for this visit,
     while the bell is told at once that it has been seen. */
  const fresh = useRef(new Set(initial.filter(t => t.agentUnread).map(t => t.id)));
  /* v179 (scan): says WHICH ones were shown, so an update that lands a
     moment later stays new. */
  useEffect(() => {
    if (fresh.current.size) send("/api/tickets/seen", "POST", { mine: true, ids: [...fresh.current] });
  }, []);
  /* v177 (scan): the page refreshes itself (every minute, or the bell tapped
     while already here). Take the new list, and anything newly updated is
     marked and told to the bell, like on first opening. */
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const news = initial.filter(t => t.agentUnread && !fresh.current.has(t.id));
    news.forEach(t => fresh.current.add(t.id));
    setItems(prev => mergeNewer(prev, initial, new Set()));
    const unread = initial.filter(t => t.agentUnread).map(t => t.id);
    if (unread.length) send("/api/tickets/seen", "POST", { mine: true, ids: unread });
  }, [initial]);

  async function answer(t, body) {
    setBusy(true); setNotice("");
    /* v181 (scan): with the newest message shown, so one that arrived while
       typing stays new. */
    const r = await send(`/api/tickets/${t.id}/reply`, "POST", { body, lastReplyId: t.replies?.at(-1)?.id });
    setBusy(false);
    if (!r) return false;
    if (r.error) { setNotice(r.error); return false; }
    if (Array.isArray(r.tickets)) setItems(r.tickets);
    fresh.current.delete(t.id);   // v180: answered, so no longer "New update"
    setKeepMine(t.id);
    setTimeout(() => document.getElementById(`jx-tmsum-${t.id}`)?.focus(), 0);
    setNotice(`Sent. The support team will see your message on “${t.title}”.`);
    return true;
  }

  return (
    <>
      <Head group={group} label={label} blurb={blurb} />
      {!items.length ? (
        <div className="jx-card">
          <p><strong>No tickets yet.</strong> Anything you submit will show up here so you can track its status.</p>
          <a className="jx-btn" href="/office/help-ticket">Submit a Help Ticket</a>
        </div>
      ) : (
        <div className="jx-tlist">
          <div className="jx-live" role="status" aria-live="polite">{notice}</div>
          {items.map(t => {
            const isNew = fresh.current.has(t.id);
            return (
              <details className={"jx-cardi jx-ticket" + (isNew ? " jx-tnew" : "")} key={t.id} open={isNew || keepMine === t.id ? true : undefined}
                       onToggle={e => { if (!e.currentTarget.open && keepMine === t.id) setKeepMine(null); }}>
                <summary id={`jx-tmsum-${t.id}`}>
                  <span className="jx-ttitle">{t.title}</span>
                  <span className="jx-tbadges">
                    {isNew && <span className="jx-badge jx-tflag">New update</span>}
                    <span className={statusClass(t.status)}>{t.status}</span>
                  </span>
                </summary>
                <TicketMeta t={t} />
                {t.assignee && <p className="jx-detail"><span className="jx-dlabel">Assigned to</span>{t.assignee}</p>}
                {t.details ? <p className="jx-desc">{t.details}</p> : <p className="jx-desc">No details were added.</p>}
                <Thread t={t} side="agent" />
                {t.updatedAt && t.updatedAt !== t.createdAt && <p className="jx-note">Last updated {when(t.updatedAt)}.</p>}
                <ReplyBox id={t.id} draftKey={`agent:${t.id}`} label="Reply to the support team" busy={busy}
                          placeholder="Answer a question, add a detail, or say it's sorted."
                          hint={t.status === "Resolved" ? "This ticket is resolved. Replying opens it again." : ""}
                          onSend={body => answer(t, body)} />
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ---- Support Center ------------------------------------------------------------ */
/* v181 (scan): the keyboard follows: into a form when it opens, back to the
   ticket's title when it closes (the button it was on had gone). */
const focusLater = id => setTimeout(() => document.getElementById(id)?.focus(), 0);
const focusSum = id => focusLater(`jx-tsum-${id}`);
export function SupportCenter({ group, label, blurb, items: initial, statuses, priorities, categories }) {
  const [items, setItems] = useState(initial);
  const [only, setOnly] = useState("All");
  const [editing, setEditing] = useState(null);   // { id, status, priority, category, assignee }
  const [replying, setReplying] = useState(null); // v170: { id, status }
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  /* v177 (scan): a ticket you just saved, answered or cancelled stays open,
     so you can see what you did. (v181: declared before `shown` uses it.) */
  const [keep, setKeep] = useState(null);
  const counts = useMemo(() => Object.fromEntries(statuses.map(s => [s, items.filter(t => t.status === s).length])), [items, statuses]);
  /* v180 (scan): the ticket being answered or changed stays in view even if
     its status moves out of the filter (it, and the half-typed reply, vanished). */
  /* v181 (scan): ...and the one just saved or answered (it vanished on Send
     under a status filter, taking the keyboard with it). */
  const shown = only === "All" ? items : items.filter(t => t.status === only || t.id === replying?.id || t.id === editing?.id || t.id === keep);
  /* v180 (scan): an admin's OWN tickets' updates are counted on the bell,
     which brings them here; so this page says where to read them. */
  const [mineNew, setMineNew] = useState(0);
  useEffect(() => {
    let off = false;
    fetch("/api/tickets", { credentials: "same-origin", cache: "no-store" })
      /* v181 (scan): back to 0 once they're read (the link stayed). */
      .then(r => (r.ok ? r.json() : null)).then(d => { if (!off && d) setMineNew(Math.max(0, Number(d.mine) || 0)); }).catch(() => {});
    return () => { off = true; };
  }, [initial]);
  const gone = useRef(new Set());

  async function act(method, t, body, done, path = "") {
    setBusy(true); setNotice("");
    const r = await send(`/api/tickets/${t.id}${path}`, method, body);
    setBusy(false);
    if (!r) return false;
    if (r.error) { setNotice(r.error); return false; }
    if (method === "DELETE") gone.current.add(t.id);
    if (Array.isArray(r.tickets)) setItems(r.tickets.filter(x => !gone.current.has(x.id)));
    setNotice(done);
    setKeep(method === "DELETE" ? null : t.id);
    setEditing(null); setConfirmId(null); setReplying(null);
    /* v180 (scan): the keyboard goes back to the ticket (the button it was on
       is gone); after a delete, to the notice (v181: it can take focus now). */
    setTimeout(() => { const el = document.getElementById(method === "DELETE" ? "jx-sc-live" : `jx-tsum-${t.id}`); if (el) el.focus(); }, 0);
    return true;
  }

  /* v170: opening a ticket the agent answered tells the bell it was seen.
     The "Agent replied" mark stays for this visit. */
  const seen = useRef(new Set());
  const answered = useRef(new Set(initial.filter(t => t.supportUnread).map(t => t.id)));
  /* v177 (scan): new tickets and answers arrive with the page's own refresh.
     Not while you're in the middle of changing or answering one. */
  const firstSC = useRef(true);
  /* v179 (scan): taken even while a form is open (forms keep their own
     state by ticket), only not mid-save. Skipping it while any form was open
     froze the page for good once that form was filtered out of view. A ticket
     the agent answered AGAIN can be marked seen again, and if it's the one
     open on screen, it is at once. */
  useEffect(() => {
    if (firstSC.current) { firstSC.current = false; return; }
    if (busy) return;
    initial.filter(t => t.supportUnread).forEach(t => {
      answered.current.add(t.id);
      seen.current.delete(t.id);
      /* v180: open on screen by any means (a click on its title too).
         v181 (scan): judged by the page itself: a ticket a filter had hidden
         was still "open" in a list, and marked seen for every admin. */
      const det = document.getElementById(`jx-tsum-${t.id}`)?.parentElement;
      if (det && det.open) { seen.current.add(t.id); send("/api/tickets/seen", "POST", { id: t.id, lastReplyId: t.replies?.at(-1)?.id }); }
    });
    setItems(prev => mergeNewer(prev, initial, gone.current));
  }, [initial]);   // eslint-disable-line react-hooks/exhaustive-deps
  function opened(t, isOpen) {
    if (!isOpen || !t.supportUnread || seen.current.has(t.id)) return;
    seen.current.add(t.id);
    /* v180: with the newest message shown, so a later one stays new. */
    send("/api/tickets/seen", "POST", { id: t.id, lastReplyId: t.replies?.at(-1)?.id });
  }

  return (
    <>
      <Head group={group} label={label} blurb={blurb} />
      {mineNew > 0 && <p className="jx-note"><a href="/office/my-tickets">{mineNew} update{mineNew === 1 ? "" : "s"} on your own ticket{mineNew === 1 ? "" : "s"}: open My Tickets</a></p>}
      <div className="jx-tcounts">
        {statuses.map(s => (
          <button type="button" key={s} className="jx-card jx-tcount" aria-pressed={only === s}
                  onClick={() => setOnly(only === s ? "All" : s)}>
            <span className="jx-tnum">{counts[s]}</span>
            <span className="jx-tlabel">{s}</span>
          </button>
        ))}
      </div>
      <div className="jx-filters">
        <div className="jx-chips" role="group" aria-label="Show">
          {["All", ...statuses].map(s => (
            <button type="button" key={s} className="jx-chip" aria-pressed={only === s} onClick={() => setOnly(s)}>{s}</button>
          ))}
        </div>
        <span className="jx-count">{shown.length} {shown.length === 1 ? "ticket" : "tickets"}</span>
      </div>
      <div className="jx-live" id="jx-sc-live" tabIndex={-1} role="status" aria-live="polite">{notice}</div>

      {!shown.length ? (
        <div className="jx-card">
          <p><strong>{items.length ? `No ${only.toLowerCase()} tickets.` : "No support tickets."}</strong>{" "}
            {items.length ? "" : "Submitted requests will appear here so you can track them from new to resolved."}</p>
        </div>
      ) : (
        <div className="jx-tlist">
          {shown.map(t => {
            const ed = editing?.id === t.id ? editing : null;
            const setE = k => e => setEditing({ ...ed, [k]: e.target.value });
            return (
              <details className={"jx-cardi jx-ticket" + (t.supportUnread ? " jx-tnew" : "")} key={t.id}
                       open={ed || confirmId === t.id || replying?.id === t.id || keep === t.id ? true : undefined}
                       onToggle={e => { opened(t, e.currentTarget.open); if (!e.currentTarget.open && keep === t.id) setKeep(null); }}>
                <summary id={`jx-tsum-${t.id}`}>
                  <span className="jx-ttitle">{t.title}</span>
                  <span className="jx-tbadges">
                    {(t.supportUnread || answered.current.has(t.id)) && t.replies?.at(-1)?.fromSupport === false &&
                      <span className="jx-badge jx-tflag">Agent replied</span>}
                    <span className={statusClass(t.status)}>{t.status}</span>
                  </span>
                </summary>
                <TicketMeta t={t} />
                <p className="jx-detail"><span className="jx-dlabel">From</span>
                  {t.submittedName ? `${t.submittedName} · ` : ""}
                  {PLAIN_EMAIL.test(t.submittedBy) ? <a href={`mailto:${t.submittedBy}`}>{t.submittedBy}</a> : t.submittedBy}
                </p>
                {t.assignee && <p className="jx-detail"><span className="jx-dlabel">Assigned to</span>{t.assignee}</p>}
                {t.details ? <p className="jx-desc">{t.details}</p> : <p className="jx-desc">No details were added.</p>}
                <Thread t={t} side="support" />

                {replying?.id === t.id ? (
                  <ReplyBox id={t.id} draftKey={`support:${t.id}`} label={`Update for ${t.submittedName || t.submittedBy}`} busy={busy}
                            placeholder="What's been done, what's next, or what you need from them."
                            hint="They'll see this in My Tickets, with a number on their bell."
                            onCancel={() => { setKeep(t.id); setReplying(null); focusSum(t.id); }}
                            onSend={body => act("POST", t, { as: "support", body, lastReplyId: t.replies?.at(-1)?.id, ...(replying.touched ? { status: replying.status } : {}) },
                                                `Sent to ${t.submittedName || t.submittedBy}.`, "/reply")}>
                    <div className="jx-field jx-tstatpick">
                      <label htmlFor={`jx-trs-${t.id}`}>Status</label>
                      <select id={`jx-trs-${t.id}`} value={replying.status} onChange={e => setReplying({ ...replying, status: e.target.value, touched: true })}>
                        {statuses.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  </ReplyBox>
                ) : ed ? (
                  <form className="jx-tedit" onSubmit={e => { e.preventDefault();
                    /* v179 (scan): only what was changed here. Sending all four
                       put back a status that had moved since the form opened
                       (an agent's reply), and emailed the agent about it. */
                    const changed = Object.fromEntries(["status", "priority", "category", "assignee"]
                      .filter(k => ed[k] !== ed.was[k]).map(k => [k, ed[k]]));
                    /* v180 (scan): nothing changed: nothing sent (it still
                       stamped "last updated" and logged a change). */
                    if (!Object.keys(changed).length) { setNotice("Nothing changed."); setKeep(t.id); setEditing(null); focusSum(t.id); return; }
                    act("PATCH", t, changed, `Saved “${t.title}”.`); }}>
                    <div className="jx-tpair">
                      <div className="jx-field"><label htmlFor={`jx-ts-${t.id}`}>Status</label>
                        <select id={`jx-ts-${t.id}`} value={ed.status} onChange={setE("status")}>{statuses.map(s => <option key={s}>{s}</option>)}</select></div>
                      <div className="jx-field"><label htmlFor={`jx-tp-${t.id}`}>Priority</label>
                        <select id={`jx-tp-${t.id}`} value={ed.priority} onChange={setE("priority")}>{priorities.map(s => <option key={s}>{s}</option>)}</select></div>
                    </div>
                    <div className="jx-tpair">
                      <div className="jx-field"><label htmlFor={`jx-tc-${t.id}`}>Category</label>
                        <select id={`jx-tc-${t.id}`} value={ed.category} onChange={setE("category")}>{categories.map(s => <option key={s}>{s}</option>)}</select></div>
                      <div className="jx-field"><label htmlFor={`jx-ta-${t.id}`}>Assigned to <span className="jx-opt">(optional)</span></label>
                        <input id={`jx-ta-${t.id}`} type="text" maxLength={120} value={ed.assignee} onChange={setE("assignee")} /></div>
                    </div>
                    <div className="jx-formbtns">
                      <button type="submit" className="jx-btn jx-btnsm" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
                      <button type="button" className="jx-ghost" onClick={() => { setKeep(t.id); setEditing(null); focusSum(t.id); }} disabled={busy}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div className="jx-tools">
                    {confirmId === t.id ? (
                      <>
                        <span className="jx-confirm">Delete this ticket?</span>
                        <button type="button" className="jx-danger" disabled={busy} onClick={() => act("DELETE", t, null, `Deleted “${t.title}”.`)}>Yes, delete</button>
                        <button type="button" id={`jx-tkeep-${t.id}`} className="jx-ghost" disabled={busy} onClick={() => { setKeep(t.id); setConfirmId(null); focusSum(t.id); }}>Keep it</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="jx-btn jx-btnsm" disabled={busy}
                                onClick={() => { setConfirmId(null); setEditing(null); setReplying({ id: t.id, status: t.status === "New" ? "In review" : t.status }); focusLater(`jx-tr-${t.id}`); }}>
                          Reply to agent</button>
                        <button type="button" className="jx-ghost" disabled={busy}
                                onClick={() => { setConfirmId(null); setReplying(null); setEditing({ id: t.id, status: t.status, priority: t.priority, category: t.category, assignee: t.assignee, was: { status: t.status, priority: t.priority, category: t.category, assignee: t.assignee } }); focusLater(`jx-ts-${t.id}`); }}>
                          Update status</button>
                        <button type="button" className="jx-ghost jx-dangertext" disabled={busy} onClick={() => { setEditing(null); setReplying(null); setConfirmId(t.id); focusLater(`jx-tkeep-${t.id}`); }}>Delete</button>
                      </>
                    )}
                  </div>
                )}
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}
