"use client";
/* The Deals tab: the Podio agent dashboard (cik-v5).
 *
 * Numbers come from /api/podio/dashboard, which reads the database copy of
 * Podio and then brings that copy up to date in the background. While the
 * first load of all of Podio is still running, or an update has just been
 * started, this asks again every 25 seconds, so the page fills in by itself.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const usd = n => (n || n === 0)
  ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
  : "—";
const int = n => new Intl.NumberFormat("en-US").format(n || 0);
/* A tile is narrow: a million and up is shown short ($2.04M), the exact
   figure in its label for screen readers and on hover. */
const usdShort = n => Math.abs(n || 0) >= 1e6
  ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(n)
  : usd(n);

function day(ymd) {
  if (!ymd) return "";
  const d = new Date(ymd + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getUTCFullYear() === new Date().getFullYear() ? undefined : "numeric", timeZone: "UTC" });
}
function ago(iso) {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
}

function PodioLink({ href, name }) {
  if (!href) return null;
  return (
    <a className="jx-dash-open" href={href} target="_blank" rel="noopener noreferrer">
      Podio <span aria-hidden="true">↗</span><span className="jx-sr"> (opens {name} in Podio in a new tab)</span>
    </a>
  );
}

function Row({ title, sub, meta, right, link, name }) {
  return (
    <li className="jx-dash-row">
      <div className="jx-dash-rowmain">
        <p className="jx-dash-rowtitle">{title}</p>
        {sub && <p className="jx-dash-rowsub">{sub}</p>}
        {meta && <p className="jx-dash-rowmeta">{meta}</p>}
      </div>
      <div className="jx-dash-rowside">
        {right}
        <PodioLink href={link} name={name} />
      </div>
    </li>
  );
}

const STAGES = ["Offer Assigned", "Offer Signed", "Offer Sent", "Verbal Offer"];
const FIRST = 8;

/* A long list shows its first few, with a button for the rest. */
function Shown({ rows, render, label }) {
  const [all, setAll] = useState(false);
  const list = all ? rows : rows.slice(0, FIRST);
  return (
    <>
      <ul className="jx-dash-list">{list.map(render)}</ul>
      {rows.length > FIRST && (
        <button type="button" className="jx-ghost jx-btnsm jx-dash-more" aria-expanded={all} onClick={() => setAll(v => !v)}>
          {all ? "Show fewer" : `Show all ${rows.length} ${label}`}
        </button>
      )}
    </>
  );
}

export default function Deals({ admin = false }) {
  const [period, setPeriod] = useState("30d");
  const [person, setPerson] = useState(null);      // null = let the server pick "me"
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sortBy, setSortBy] = useState("closed");
  const polls = useRef(0);
  const timer = useRef(null);
  const latest = useRef(0);      // only the newest request's answer is shown

  const load = useCallback(async (opts = {}) => {
    const p = opts.period ?? period;
    const who = opts.person !== undefined ? opts.person : person;
    const mine = ++latest.current;
    setBusy(true); setErr("");
    try {
      const q = new URLSearchParams({ period: p });
      if (who !== null) q.set("person", who || "all");
      const r = await fetch(`/api/podio/dashboard?${q}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (mine !== latest.current) return;          // a newer choice is on its way
      if (!r.ok) throw new Error(j.error || "The Deals numbers couldn't load just now.");
      setData(j);
      if (who === null) setPerson(j.person || "");
    } catch (e) {
      if (mine === latest.current) setErr(e.message || "The Deals numbers couldn't load just now.");
    } finally {
      if (mine === latest.current) setBusy(false);
    }
  }, [period, person]);

  useEffect(() => { load(); /* first view only */ // eslint-disable-line react-hooks/exhaustive-deps
  }, []);

  /* Ask again while Podio is still being loaded or an update is due. */
  useEffect(() => {
    clearTimeout(timer.current);
    const s = data && data.sync;
    if (!s || !s.configured) return;
    const stale = !s.lastSuccess || Date.now() - new Date(s.lastSuccess).getTime() > 10 * 60 * 1000;
    if (!s.loading && !stale) polls.current = 0;
    /* While Podio is loading, keep going; an update that's merely due gets a
       few tries (it may be waiting out a Podio error). */
    if (s.loading || (stale && polls.current < 12)) {
      timer.current = setTimeout(() => { polls.current += 1; load(); }, 25000);
    }
    return () => clearTimeout(timer.current);
  }, [data, load]);

  const choosePeriod = p => { setPeriod(p); load({ period: p }); };
  const choosePerson = p => { setPerson(p); load({ person: p }); };

  const s = data && data.sync;

  if (s && !s.configured) {
    return (
      <section aria-label="Deals" className="jx-card">
        <p><strong>The Podio dashboard is built and waiting for its Podio key.</strong></p>
        {admin ? (
          <p>
            Add PODIO_CLIENT_ID, PODIO_CLIENT_SECRET and PODIO_APP_TOKENS in Vercel (Settings → Environment
            Variables), then redeploy. {s.hasKey && s.missing && s.missing.length ? `Still missing a token for: ${s.missing.join(", ")}.` : ""}
          </p>
        ) : (
          <p>Your leads, deals and the team leaderboard will show here as soon as it&rsquo;s connected.</p>
        )}
        <a className="jx-btn" href="https://podio.com/cashiskingcom/cash-is-king" target="_blank" rel="noopener noreferrer">
          Open Podio <span aria-hidden="true">↗</span><span className="jx-sr"> (opens in a new tab)</span>
        </a>
      </section>
    );
  }

  const t = data && data.tiles;
  const board = data ? [...data.leaderboard].sort((a, b) =>
    sortBy === "fees" ? b.fees - a.fees || b.closed - a.closed
    : sortBy === "signed" ? b.signed - a.signed || b.closed - a.closed
    : b.closed - a.closed || b.fees - a.fees || b.signed - a.signed) : [];
  const who = data ? (data.person || "Everyone") : "";

  return (
    <div className="jx-dash" aria-busy={busy ? "true" : "false"}>
      <div className="jx-dash-controls">
        <div className="jx-chips" role="group" aria-label="Time window">
          {(data ? data.periods : [{ key: "30d", label: "Last 30 days" }]).map(p => (
            <button key={p.key} type="button" className="jx-chip" aria-pressed={period === p.key}
                    onClick={() => choosePeriod(p.key)}>{p.label}</button>
          ))}
        </div>
        <label className="jx-dash-who">
          <span>Showing</span>
          <select value={person ?? ""} onChange={e => choosePerson(e.target.value)} disabled={!data}>
            <option value="">Everyone</option>
            {(data ? data.people : []).map(n => <option key={n} value={n}>{n}{data.me === n ? " (you)" : ""}</option>)}
          </select>
        </label>
        <button type="button" className="jx-ghost jx-btnsm" onClick={() => load()} disabled={busy}>
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>

      <p className="jx-dash-status" role="status" aria-live="polite">
        {err ? <span className="jx-err">{err}</span>
          : !s ? "Loading Podio numbers…"
          : s.loading ? <>Loading Podio: {s.apps.map(a => `${a.app} ${int(a.loaded)}${a.total ? ` of ${int(a.total)}` : ""}`).join(" · ")}. Numbers fill in as it goes.</>
          : <>From Podio, updated {ago(s.lastSuccess)}{s.lastError ? ` · ${s.lastError}` : ""}</>}
      </p>

      {t && (
        <section aria-label={`${who}, ${data.period.label}`}>
          <h2 className="jx-parthead">{who} <span className="jx-dash-dim">· {data.period.label}</span></h2>
          <ul className="jx-dash-tiles">
            <li><span className="jx-dash-num">{int(t.newLeads)}</span><span className="jx-dash-lbl">New leads</span></li>
            <li><span className="jx-dash-num">{int(t.offersSent)}</span><span className="jx-dash-lbl">Offers sent</span></li>
            <li><span className="jx-dash-num">{int(t.offersSigned)}</span><span className="jx-dash-lbl">Offers signed</span></li>
            <li><span className="jx-dash-num">{int(t.closed)}</span><span className="jx-dash-lbl">Closed deals</span></li>
            <li title={usd(t.fees)}><span className="jx-dash-num" aria-hidden="true">{usdShort(t.fees)}</span><span className="jx-dash-lbl"><span className="jx-sr">{usd(t.fees)} </span>Fees on closed</span></li>
            <li><span className="jx-dash-num">{int(t.kicked)}</span><span className="jx-dash-lbl">Kicked to agents</span></li>
          </ul>
        </section>
      )}

      {data && (
        <section aria-label="Team leaderboard" className="jx-dash-sec">
          <div className="jx-dash-sechead">
            <h2 className="jx-parthead">Leaderboard <span className="jx-dash-dim">· {data.period.label}</span></h2>
            <div className="jx-chips" role="group" aria-label="Rank by">
              {[["closed", "Closed"], ["fees", "Fees"], ["signed", "Offers signed"]].map(([k, l]) => (
                <button key={k} type="button" className="jx-chip" aria-pressed={sortBy === k} onClick={() => setSortBy(k)}>{l}</button>
              ))}
            </div>
          </div>
          {board.length === 0 ? <p className="jx-dash-empty">No closed deals or signed offers in this window yet.</p> : (
            <div className="jx-dash-tablewrap">
              <table className="jx-dash-table">
                <thead><tr><th scope="col">#</th><th scope="col">Lead owner</th><th scope="col">Closed</th><th scope="col">Fees</th><th scope="col"><abbr title="Offers signed">Signed</abbr></th></tr></thead>
                <tbody>
                  {board.map((r, i) => (
                    <tr key={r.name} aria-current={data.person === r.name ? "true" : undefined}>
                      <td>{i + 1}</td>
                      <th scope="row"><button type="button" className="jx-dash-name" onClick={() => choosePerson(r.name)}>{r.name}</button></th>
                      <td>{int(r.closed)}</td><td>{usd(r.fees)}</td><td>{int(r.signed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {data && (
        <section aria-label="Deals in progress" className="jx-dash-sec">
          <h2 className="jx-parthead">In progress <span className="jx-dash-dim">· {int(t.inPipeline)} now</span></h2>
          {data.pipeline.length >= data.limit && <p className="jx-dash-empty">The latest {data.limit} are listed here; Podio has them all.</p>}
          {data.pipeline.length === 0 ? <p className="jx-dash-empty">Nothing at Verbal Offer, Offer Sent or Offer Signed right now.</p> : (
            STAGES.map(stage => {
              const rows = data.pipeline.filter(r => String(r.status).toLowerCase() === stage.toLowerCase());
              if (!rows.length) return null;
              return (
                <div key={stage} className="jx-dash-group">
                  <h3 className="jx-dash-grouphead">{stage} <span className="jx-dash-dim">· {rows.length}</span></h3>
                  <Shown rows={rows} label={stage.toLowerCase()} render={r => (
                      <Row key={r.id} name={r.name} link={r.link} title={r.name}
                           sub={r.address}
                           meta={[r.owner && `Owner: ${r.owner}`, r.handedTo && `With: ${r.handedTo}`, r.signed && `Signed ${day(r.signed)}`, !r.signed && r.sent && `Sent ${day(r.sent)}`, r.closing && `Closing ${day(r.closing)}`].filter(Boolean).join(" · ")} />
                    )} />
                </div>
              );
            })
          )}
        </section>
      )}

      {data && (
        <section aria-label="Closed deals" className="jx-dash-sec">
          <h2 className="jx-parthead">Closed <span className="jx-dash-dim">· {data.period.label}</span></h2>
          {data.closed.length === 0 ? <p className="jx-dash-empty">No closings in this window.</p> : (
            <Shown rows={data.closed} label="closings" render={r => (
                <Row key={r.id} name={r.name} link={r.link} title={r.name} sub={r.address}
                     meta={[day(r.date), r.owner && `Owner: ${r.owner}`, r.type].filter(Boolean).join(" · ")}
                     right={<span className="jx-dash-fee">{usd(r.fee)}</span>} />
              )} />
          )}
          {data.closed.length >= data.limit && <p className="jx-dash-empty">Showing the latest {data.limit}.</p>}
        </section>
      )}

      {data && (
        <section aria-label="Kicked to agents" className="jx-dash-sec">
          <h2 className="jx-parthead">Kicked to agents <span className="jx-dash-dim">· {data.period.label}</span></h2>
          {data.kicks.length === 0 ? <p className="jx-dash-empty">No leads handed to outside agents in this window.</p> : (
            <Shown rows={data.kicks} label="kicks" render={r => (
                <Row key={r.id} name={r.name} link={r.link} title={r.name} sub={r.address}
                     meta={[r.date ? day(r.date) : "Date not set", r.owner && `By: ${r.owner}`, r.to && `To: ${r.to}`].filter(Boolean).join(" · ")}
                     right={<span className="jx-badge">{r.stage}</span>} />
              )} />
          )}
          {data.kicks.length >= data.limit && <p className="jx-dash-empty">Showing the latest {data.limit}.</p>}
        </section>
      )}
    </div>
  );
}
