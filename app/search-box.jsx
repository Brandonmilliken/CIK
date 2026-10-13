"use client";
/* Jarvis search (v146, Jordan 2026-10-05). Opened from the bar at the top of
 * every page, the magnifier on a phone, or Ctrl+K / Cmd+K anywhere.
 *
 * As you type it shows, in this order:
 *   - sections of the home page (only while you are on it)
 *   - pages (rooms) whose name or description matches, from your own menu,
 *     so a room you may not open never appears
 *   - items inside those rooms (vendors, people, links, classes, scripts...),
 *     from /api/search, which checks the same permissions on the server
 * Arrow keys move, Enter opens, Escape closes. An item opens its room with
 * that room's own search box already filled in.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { menuFor } from "../lib/office-menu.js";

const norm = s => String(s || "").toLowerCase();

export default function SearchBox({ open, onClose, role, onDashboard, sections }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const router = useRouter();

  const pages = useMemo(() => [
    { href: "/", label: "Agent Dashboard", group: "Workspace", blurb: "" },
    ...menuFor(role).flatMap(g => g.rooms.map(r => ({
      href: `/office/${r.slug}`, label: r.label, group: g.label, blurb: r.blurb || (r.list && r.list.blurb) || "",
    }))),
  ], [role]);

  useEffect(() => {
    if (!open) return;
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  /* Items from the server, a moment after typing stops. */
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) { setItems([]); setBusy(false); setFailed(false); return; }
    const ctl = new AbortController();
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { credentials: "same-origin", cache: "no-store", signal: ctl.signal });
        const d = r.ok ? await r.json() : null;
        /* v180 (scan): kept with the words they answer, so Enter never opens a
           result from the previous search while the new one is on its way. */
        setItems(Array.isArray(d?.items) ? d.items.map(x => ({ ...x, forTerm: term })) : []);
        setFailed(!r.ok);
      } catch (e) {
        if (e?.name !== "AbortError") { setItems([]); setFailed(true); }
      } finally { if (!ctl.signal.aborted) setBusy(false); }
    }, 160);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, open]);

  const results = useMemo(() => {
    const term = norm(q.trim());
    if (term.length < 1) return [];
    const out = [];
    if (onDashboard) {
      for (const s of sections || []) if (norm(s.t).includes(term)) out.push({ kind: "section", id: s.id, title: s.t, sub: "Home page section" });
    }
    const pg = pages.filter(p => norm(p.label).includes(term) || (term.length >= 3 && norm(p.blurb).includes(term)))
      .sort((a, b) => (norm(a.label).startsWith(term) ? 0 : 1) - (norm(b.label).startsWith(term) ? 0 : 1));
    for (const p of pg.slice(0, 8)) out.push({ kind: "page", href: p.href, title: p.label, sub: p.group });
    for (const it of items) {
      if (it.forTerm !== q.trim()) continue;
      /* v180 (scan): says which list on the page it came from, so only that
         list's search box is filled (others were filtered to nothing). */
      out.push({ kind: "item", href: `/office/${it.room}?${it.list ? `list=${encodeURIComponent(it.list)}&` : ""}q=${encodeURIComponent(it.title)}`, title: it.title,
        sub: it.roomLabel + (it.where ? ` · matched in ${it.where}` : "") });
    }
    return out;
  }, [q, items, pages, sections, onDashboard]);

  useEffect(() => { setActive(a => Math.max(0, Math.min(a, results.length - 1))); }, [results.length]);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-i="${active}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(r) {
    if (!r) return;
    /* v180 (scan): picking the page you're on keeps the keyboard where it was. */
    onClose(!(r.kind === "page" && typeof location !== "undefined" && r.href === location.pathname));
    setQ("");
    if (r.kind === "section") {
      if (onDashboard) {
        try { window.dispatchEvent(new CustomEvent("jarvis:open-section", { detail: r.id })); } catch { /* old browser */ }
        setTimeout(() => {
          const sec = document.getElementById(r.id);
          if (sec) sec.scrollIntoView({ block: "start" });
          const b = sec && sec.querySelector("h2 .secbtn");
          if (b) b.focus({ preventScroll: true });
        }, 60);
      } else {
        location.href = "/#" + r.id;
      }
      return;
    }
    /* The dashboard runs its own script, so leaving it is a real page load,
       as everywhere else; an item reloads its room with the search filled. */
    if (r.kind === "item" || onDashboard || r.href === "/") location.href = r.href;
    else router.push(r.href);
  }

  function onKey(e) {
    /* v180 (scan): keys used to finish typing in another script (Japanese,
       Chinese) belong to the keyboard, not to search. */
    if (e.nativeEvent && (e.nativeEvent.isComposing || e.keyCode === 229)) return;
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.max(0, Math.min(a + 1, results.length - 1))); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return; }
    if (e.key === "Enter") { e.preventDefault(); choose(results[active]); }
  }

  if (!open) return null;
  const term = q.trim();
  return (
    <div className="jx-searchwrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      {/* v181 (scan): Escape closes it from anywhere inside (only from the box before). */}
      <div className="jx-searchbox" role="dialog" aria-modal="true" aria-label="Search Jarvis"
           onKeyDown={e => { if (e.key === "Escape" && e.target !== inputRef.current && !(e.nativeEvent && e.nativeEvent.isComposing)) { e.preventDefault(); onClose(); } }}>
        <div className="jx-searchrow">
          <SearchIcon />
          <input ref={inputRef} className="jx-searchinput" type="text" value={q} maxLength={80}
                 placeholder="Search pages, vendors, people, links, classes…" aria-label="Search Jarvis"
                 role="combobox" aria-expanded={results.length > 0} aria-controls="jx-searchlist" aria-autocomplete="list"
                 aria-activedescendant={results.length ? `jx-sr-${active}` : undefined}
                 onChange={e => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} />
          <button type="button" className="jx-searchclose" onClick={() => onClose()}>Esc</button>
        </div>
        <ul id="jx-searchlist" className="jx-searchlist" role="listbox" aria-label="Results" ref={listRef}>
          {results.map((r, i) => (
            <li key={r.kind + (r.href || r.id) + i} id={`jx-sr-${i}`} data-i={i} role="option" aria-selected={i === active}
                className="jx-searchitem" onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); choose(r); }}>
              <span className="jx-searchkind" aria-hidden="true">{r.kind === "item" ? "•" : r.kind === "section" ? "#" : "→"}</span>
              <span className="jx-searchtext">
                <span className="jx-searchtitle">{r.title}</span>
                <span className="jx-searchsub">{r.sub}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="jx-searchnote" role="status" aria-live="polite">
          {term.length === 0 ? "Type to search every page you can open, and what's in them."
            : term.length < 2 ? "Keep typing…"
            : busy ? "Searching…"
            : failed ? "Search isn't available right now; pages are still listed."
            : results.length === 0 ? `Nothing matches “${term}”.`
            : `${results.length} result${results.length === 1 ? "" : "s"} · ↑ ↓ to move, Enter to open`}
        </p>
      </div>
    </div>
  );
}

export function SearchIcon() {
  return (
    <svg className="jx-searchicon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
