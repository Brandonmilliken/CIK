/* The acknowledgement record (v127), in the Announcements room, for admins
 * and leadership: for every announcement, who acknowledged it and when, and
 * who has not yet. Read-only; people acknowledge from the home page.
 */
const when = d => {
  const t = new Date(d);
  return isNaN(t) ? "" : t.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
};

export default function AnnouncementAcks({ rows }) {
  return (
    <section className="jx-part" aria-labelledby="jx-acks-head">
      <h2 className="jx-parthead" id="jx-acks-head">Who has acknowledged</h2>
      <p className="jx-sub">Everyone who has pressed Got it on the home page, with when. Only admins and leadership see this.</p>
      {rows.length === 0 ? (
        <div className="jx-card"><p>No announcements yet.</p></div>
      ) : (
        <div className="jx-tlist">
          {rows.map(r => (
            <details className="jx-card jx-ticket" key={r.id}>
              <summary>
                <span className="jx-ttitle">{r.title}</span>
                <span className="jx-badge jx-tstat">{r.acks.length} acknowledged{r.notYetUnknown ? " · who hasn't couldn't be loaded" : r.notYet.length ? ` · ${r.notYet.length} not yet` : ""}</span>
              </summary>
              {r.hidden && <p className="jx-sub" style={{ marginTop: 8 }}>Not showing on the home page right now.</p>}
              {r.acks.length ? (
                <ul className="jx-acklist">
                  {r.acks.map((a, i) => (
                    <li key={i}><span>{a.name}</span><span className="jx-sub">{when(a.at)}</span></li>
                  ))}
                </ul>
              ) : <p className="jx-sub" style={{ marginTop: 8 }}>Nobody has acknowledged this yet.</p>}
              {r.notYet.length > 0 && (
                <>
                  <p className="jx-grouphead" style={{ marginTop: 14 }}>Not yet</p>
                  <p className="jx-desc">{r.notYet.join(", ")}</p>
                </>
              )}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
