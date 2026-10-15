"use client";
/* Leadership Settings (v131): who is an admin or in leadership.
 * The page only offers what the server allows; every rule is checked again
 * on the server (lib/roles.js). */
import { useEffect, useMemo, useRef, useState } from "react";

const ROLE_LABEL = { agent: "Agent", admin: "Admin", leadership: "Leadership", superadmin: "Super admin", left: "Left the company" };
const CHOICES = ["agent", "admin", "leadership"];   // v135: broker retired
const WHAT = {
  agent: "Sees only their own numbers.",
  admin: "Also sees every deal under contract, the Support Center and the announcement record.",
  leadership: "Sees everything: the whole company, the team tables, “View as”, and this page.",
};
const andList = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
const when = d => {
  const t = new Date(d);
  return isNaN(t) ? "" : t.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
};

export default function RolesEditor({ initialPeople, initialChanges, me, superAdmins }) {
  const [people, setPeople] = useState(initialPeople || []);
  const [changes, setChanges] = useState(initialChanges || []);
  const [q, setQ] = useState("");
  const [show, setShow] = useState("all");
  const [pending, setPending] = useState(null);      // { email, name, from, to }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", role: "admin" });
  /* v179 (scan): take the page's own refresh, except mid-change.
     v180 (scan): and not for a few seconds after a save (a refresh read
     before the save could land after it and undo it on screen). */
  const firstSync = useRef(true);
  const savedAt = useRef(0);
  useEffect(() => {
    if (firstSync.current) { firstSync.current = false; return; }
    if (pending || adding || busy || Date.now() - savedAt.current < 5000) return;
    setPeople(initialPeople || []);
    setChanges(initialChanges || []);
  }, [initialPeople, initialChanges]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* v180 (scan): a role change waiting for "Yes" is dropped when a search or
     filter hides that person (it stayed set, invisibly, and held back every
     refresh until the search was cleared). */
  useEffect(() => {
    if (pending && !people.some(p => p.email === pending.email && !p.locked && !p.left
        && (show === "all" || p.role === show)
        && (!q.trim() || (p.name + " " + p.email).toLowerCase().includes(q.trim().toLowerCase())))) setPending(null);
  }, [q, show]);   // eslint-disable-line react-hooks/exhaustive-deps

  const supers = (superAdmins || []).map(e => (people.find(p => p.email === e) || {}).name || e);
  const counts = useMemo(() => {
    const c = { leadership: 0, admin: 0, agent: 0 };
    for (const p of people) if (!p.locked && !p.left && c[p.role] != null) c[p.role]++;
    return c;
  }, [people]);

  /* v140: people who have left the company (no longer in Sisu) are set aside below. */
  const gone = people.filter(p => p.left && !p.locked);
  const shown = people.filter(p => !p.locked && !p.left)
    .filter(p => show === "all" || p.role === show)
    .filter(p => !q.trim() || (p.name + " " + p.email).toLowerCase().includes(q.trim().toLowerCase()));

  async function send(bodyObj, okText) {
    setBusy(true); setNotice("");
    try {
      const res = await fetch("/api/roles", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyObj) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(d.error || "That didn't go through. Nothing was changed."); return false; }
      savedAt.current = Date.now();
      if (Array.isArray(d.people)) setPeople(d.people);
      if (Array.isArray(d.changes)) setChanges(d.changes);
      setNotice(d.changed === false ? "Nothing to change: that's already their role." : okText);
      return true;
    } catch {
      setNotice("Couldn't reach Jarvis. Nothing was changed.");
      return false;
    } finally { setBusy(false); }
  }

  async function confirm() {
    const p = pending; if (!p) return;
    if (p.leave) {
      const ok = await send({ email: p.email, left: true }, `${p.name} is marked as having left. They're signed out of Jarvis within about 15 minutes.`);
      if (ok) setPending(null);
      return;
    }
    const ok = await send({ email: p.email, role: p.to }, `${p.name} is now ${ROLE_LABEL[p.to]}. It takes effect the next time they load Jarvis (within about 15 minutes).`);
    if (ok) setPending(null);
  }

  async function addPerson(e) {
    e.preventDefault();
    const ok = await send({ ...form, add: true }, `${form.firstName} added as ${ROLE_LABEL[form.role]}.`);
    if (ok) { setForm({ firstName: "", lastName: "", email: "", role: "admin" }); setAdding(false); }
  }

  const chip = (k, label) => (
    <button type="button" className="jx-chip" aria-pressed={show === k} onClick={() => setShow(k)} key={k}>{label}</button>
  );

  return (
    <div className="jx-roles">
      {/* v142: there can be more than one super admin. Names come from the
          roster; an address not on it is shown as the address. */}
      <div className="jx-card jx-super">
        <p className="jx-kicker" style={{ marginBottom: 6 }}>{supers.length === 1 ? "Super admin" : "Super admins"}</p>
        <p><strong>{andList(supers)}</strong> {supers.length === 1 ? "is always the super admin" : "are always super admins"}: above leadership, with every permission in Jarvis.
          This can&rsquo;t be changed here, by anyone.</p>
      </div>

      <p className="jx-live" role="status" aria-live="polite">{notice}</p>

      <div className="jx-filters">
        <input className="jx-search" type="search" placeholder="Search name or email…" value={q}
               onChange={e => setQ(e.target.value)} aria-label="Search people" />
        <div className="jx-chips" role="group" aria-label="Show">
          {chip("all", `Everyone · ${people.filter(p => !p.locked && !p.left).length}`)}
          {chip("leadership", `Leadership · ${counts.leadership}`)}
          {chip("admin", `Admin · ${counts.admin}`)}
          {chip("agent", `Agent · ${counts.agent}`)}
        </div>
      </div>

      {!adding ? (
        <button type="button" className="jx-add" onClick={() => { setAdding(true); setNotice(""); }}>+ Add someone who hasn&rsquo;t signed in yet</button>
      ) : (
        <form className="jx-card jx-form jx-rolesadd" onSubmit={addPerson}>
          <p className="jx-formtitle"><strong>Add someone</strong></p>
          <p className="jx-sub">For someone who hasn&rsquo;t signed in yet. When they sign in with this email (@cashisking.com or @matinrealestate.com) they get the role you pick. (Anyone else is added as an agent the first time they sign in.)</p>
          <div className="jx-tpair">
            <div className="jx-field"><label htmlFor="ra-first">First name</label>
              <input id="ra-first" value={form.firstName} maxLength={60} required onChange={e => setForm({ ...form, firstName: e.target.value })} /></div>
            <div className="jx-field"><label htmlFor="ra-last">Last name <span className="jx-opt">(optional)</span></label>
              <input id="ra-last" value={form.lastName} maxLength={60} onChange={e => setForm({ ...form, lastName: e.target.value })} /></div>
          </div>
          <div className="jx-tpair">
            <div className="jx-field"><label htmlFor="ra-email">Email they sign in with</label>
              <input id="ra-email" type="email" value={form.email} maxLength={200} required onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div className="jx-field"><label htmlFor="ra-role">Role</label>
              <select id="ra-role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                {CHOICES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select></div>
          </div>
          <div className="jx-formbtns">
            <button className="jx-btn jx-btnsm" type="submit" disabled={busy}>{busy ? "Adding…" : "Add"}</button>
            <button className="jx-ghost" type="button" onClick={() => setAdding(false)} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}

      <ul className="jx-rolelist" aria-label="People and their roles">
        {shown.map(p => {
          const self = p.email === me;
          const asking = pending && pending.email === p.email;
          return (
            <li key={p.email} className={"jx-card jx-roleitem" + (asking ? " jx-roleask" : "")}>
              <div className="jx-rolewho">
                <span className="jx-ttitle">{p.name}</span>
                <span className="jx-sub">{p.email}</span>
              </div>
              {self ? (
                <span className="jx-badge">{ROLE_LABEL[p.role]} &middot; that&rsquo;s you</span>
              ) : (
                <label className="jx-rolepick">
                  <span className="jx-sr">Role for {p.name}</span>
                  <select value={asking && !pending.leave ? pending.to : p.role} disabled={busy}
                          onChange={e => {
                            const to = e.target.value;
                            setNotice("");
                            setPending(to === p.role ? null : { email: p.email, name: p.name, from: p.role, to });
                          }}>
                    {CHOICES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </label>
              )}
              {/* v180: someone added by hand can be marked as having left
                  (Sisu's team is handled by the nightly sync). */}
              {!self && p.staff && !asking && (
                <button type="button" className="jx-ghost jx-btnsm" disabled={busy}
                        onClick={() => { setNotice(""); setPending({ email: p.email, name: p.name, leave: true }); }}>
                  Mark as left<span className="jx-sr"> : {p.name}</span>
                </button>
              )}
              {asking && pending.leave && (
                <div className="jx-roleconfirm">
                  <p>Mark <strong>{p.name}</strong> as having left? They&rsquo;re signed out of Jarvis within about 15 minutes and can&rsquo;t sign in again until brought back.</p>
                  <div className="jx-formbtns">
                    <button className="jx-btn jx-btnsm" type="button" onClick={confirm} disabled={busy}>{busy ? "Saving…" : "Yes, mark as left"}</button>
                    <button className="jx-ghost" type="button" onClick={() => setPending(null)} disabled={busy}>Cancel</button>
                  </div>
                </div>
              )}
              {asking && !pending.leave && (
                <div className="jx-roleconfirm">
                  <p>Change <strong>{p.name}</strong> from {ROLE_LABEL[pending.from]} to <strong>{ROLE_LABEL[pending.to]}</strong>? {WHAT[pending.to]}</p>
                  <div className="jx-formbtns">
                    <button className="jx-btn jx-btnsm" type="button" onClick={confirm} disabled={busy}>{busy ? "Saving…" : "Yes, change it"}</button>
                    <button className="jx-ghost" type="button" onClick={() => setPending(null)} disabled={busy}>Cancel</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="jx-card"><p>Nobody matches.</p></li>}
      </ul>

      {gone.length > 0 && (
        <details className="jx-card jx-rolegone">
          <summary><strong>Left the company</strong> &middot; {gone.length}</summary>
          <p className="jx-sub">Marked as having left, so they can&rsquo;t sign in and are off the announcement record. Anyone here can be brought back.</p>
          <ul className="jx-acklist">
            {gone.map(p => (
              <li key={p.email}><span>{p.name}</span>
                <span className="jx-sub">since {when(p.left)}
                  {p.staff && (
                    <> &middot; <button type="button" className="jx-linkbtn" disabled={busy}
                      onClick={() => send({ email: p.email, left: false }, `${p.name} is back. They can sign in again.`)}>Bring back<span className="jx-sr"> {p.name}</span></button></>
                  )}
                </span></li>
            ))}
          </ul>
        </details>
      )}

      <section className="jx-part" aria-labelledby="jx-rolelog">
        <h2 className="jx-parthead" id="jx-rolelog">Recent changes</h2>
        {changes.length === 0 ? <div className="jx-card"><p>No changes yet.</p></div> : (
          <ul className="jx-acklist jx-card">
            {changes.map(c => (
              <li key={c.id}>
                <span><strong>{c.name}</strong>: {c.from ? ROLE_LABEL[c.from] || c.from : "added"} &rarr; {ROLE_LABEL[c.to] || c.to} <span className="jx-sub">by {c.by}</span></span>
                <span className="jx-sub">{when(c.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
