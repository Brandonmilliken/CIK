"use client";
/* The home page's moving parts: the Home / Deals tabs (the phone's bottom bar
 * switches them through the same "jarvis:tab" event Jarvis's dashboard
 * listens for), and "Got it" on each announcement. cik-v5: the Deals tab is
 * the Podio agent dashboard (app/deals.jsx). cik-v6: the tab is hidden
 * until Podio is connected (the `deals` prop, from app/page.jsx).
 */
import { useEffect, useState } from "react";
import { cleanUrl } from "../lib/office-fields.js";
import Deals from "./deals.jsx";

export default function Home({ initialTab, hello, today, company, announcements, acknowledged, quick, admin = false, deals = true }) {
  const [tab, setTab] = useState(deals && initialTab === "deals" ? "deals" : "home");
  const [open, setOpen] = useState(announcements);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState("");

  /* The bottom bar asks for a tab; this page answers, and says which one is
     showing so the bar can light it. */
  useEffect(() => {
    const on = e => { if (e.detail === "home" || (deals && e.detail === "deals")) setTab(e.detail); };
    window.addEventListener("jarvis:tab", on);
    return () => window.removeEventListener("jarvis:tab", on);
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("jarvis:tabchanged", { detail: tab }));
    try {
      const u = new URL(window.location.href);
      if (tab === "home") u.searchParams.delete("tab"); else u.searchParams.set("tab", tab);
      u.searchParams.delete("from"); /* the old-address redirect's marker (next.config.mjs) */
      window.history.replaceState(null, "", u.pathname + u.search);
    } catch { /* old browser: the address just doesn't follow */ }
  }, [tab]);

  async function gotIt(a) {
    setBusy(a.id); setNotice("");
    try {
      const r = await fetch("/api/announcements/ack", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setOpen(list => list.filter(x => x.id !== a.id));
      setNotice(`Marked "${a.title}" as read.`);
    } catch {
      setNotice("Couldn't save that just now. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div id="page" data-tab={tab}>
      <p className="jx-kicker">{company} &middot; {today}</p>
      <h1>{hello}</h1>

      {/* cik-v6: with the Podio dashboard on hold there is only Home, so no tabs. */}
      {deals && (
        <div className="jx-chips jx-hometabs tabbar" role="tablist" aria-label="Home sections" style={{ margin: "0 0 22px" }}>
          {[["home", "Home"], ["deals", "Deals"]].map(([v, label]) => (
            <button key={v} type="button" role="tab" className="jx-chip" data-v={v}
                    aria-selected={tab === v} aria-pressed={tab === v} onClick={() => setTab(v)}>{label}</button>
          ))}
        </div>
      )}

      <div className="jx-live" role="status" aria-live="polite">{notice}</div>

      {tab === "home" && (
        <>
          {open.length > 0 && (
            <section aria-label="Announcements" style={{ marginBottom: 28 }}>
              <h2 className="jx-parthead">Announcements</h2>
              <div className="jx-cards">
                {open.map(a => (
                  <article key={a.id} className="jx-card">
                    <p><strong>{a.title}</strong></p>
                    <p style={{ whiteSpace: "pre-line" }}>{a.message}</p>
                    {a.link && cleanUrl(a.link) && (
                      <p><a className="jx-cline" href={cleanUrl(a.link)} target="_blank" rel="noopener noreferrer">
                        Open the link <span aria-hidden="true">↗</span><span className="jx-sr"> (opens in a new tab)</span></a></p>
                    )}
                    <button type="button" className="jx-ghost" disabled={busy === a.id} onClick={() => gotIt(a)}>
                      {busy === a.id ? "Saving…" : "Got it"}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section aria-label="Quick links">
            <h2 className="jx-parthead">Jump to</h2>
            <div className="jx-cards">
              {quick.map(q => (
                <a key={q.href} href={q.href} className="jx-card" style={{ textDecoration: "none", display: "block" }}>
                  <p><strong>{q.label}</strong></p>
                  <p>{q.sub}</p>
                </a>
              ))}
            </div>
          </section>

          {acknowledged.length > 0 && (
            <details className="jx-card" style={{ marginTop: 28 }}>
              <summary><strong>Announcements you&rsquo;ve read</strong> &middot; {acknowledged.length}</summary>
              <ul className="jx-acklist">
                {acknowledged.map(a => <li key={a.id}><span>{a.title}</span></li>)}
              </ul>
            </details>
          )}
        </>
      )}

      {deals && tab === "deals" && <Deals admin={admin} />}
    </div>
  );
}
