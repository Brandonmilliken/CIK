"use client";
/* A moved MRE Office list room: cards for everyone, edit controls for admins.
 *
 * The server decides who may edit (canEditRoom, checked again on every write).
 * `canEdit` here only decides whether the buttons are drawn. After every
 * change the server sends the whole list back and the page shows THAT, not
 * its own guess, so what you see is what is stored.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cleanUrl, validateFields, linkKind } from "../lib/office-fields.js";
import { emailsIn, stateFromTitle } from "../lib/directory.js";
import { fileSizeLabel, kindInfo } from "../lib/office-files.js";
import { CONTACTS_QR_PATH, CONTACTS_QR_SIZE } from "../lib/contacts-qr.js";

/* A room's aside may only link within Jarvis ("/", "/office/..."). It comes
   from our own code, not from anyone's input, but a rule that says so costs
   nothing and stops a later edit from turning it into an open redirect. */
const cleanLocal = h => (typeof h === "string" && /^\/(?!\/)[\w\-/#?=&.]*$/.test(h) ? h : "");

const blank = spec => Object.fromEntries(spec.map(f => [f.key, f.type === "choice" && !f.allowOther ? (f.options?.[0] ?? "") : ""]));

/* The small grey line under a card's title: another field (a GIS map's
   county), or the kind of link it is (Resources' Form / Drive / Doc). */
const subtitleOf = (list, fields) => {
  if (list.subtitle === "linkKind") return linkKind(fields.url);
  const v = list.subtitle ? (fields[list.subtitle] || "") : "";
  /* An agent's "title" in the team sheet is the state they are licensed in.
     That shows as a badge instead, so the card does not say "Oregon" twice.
     Only in a list that HAS that badge: a vendor's or an MLS's area of
     "Oregon" is the whole answer and must show. */
  return list.fields.some(f => f.key === "states") && stateFromTitle(v) ? "" : v;
};

/* A phone cell is free text in the sheet ("503-555-1234", "Cell: ... Office: ...").
   Dial the first ten-digit number in it and show the text as it was written. */
const telHref = v => {
  const m = String(v || "").match(/(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/);
  return m ? `tel:+1${m[1]}${m[2]}${m[3]}` : "";
};
/* v175: the same number, for a text message. Shown on a phone only (shell.css). */
const smsHref = v => telHref(v).replace(/^tel:/, "sms:");

export default function OfficeList({ slug, label, list, items: initial, canEdit, syncNote, section = false, headingId }) {
  const [items, setItems] = useState(initial);
  const router = useRouter();
  /* v179 (scan): the page refreshes itself every minute; take the new list
     (a new announcement, a changed card), except while something is being
     changed here. It used to be read once and never again. */
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) { firstSync.current = false; return; }
    if (form || busy || confirmId) return;
    setItems(initial);
  }, [initial]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);        // { id: string|null, values, errors }
  /* v181 (scan): the keyboard goes into the form when it opens, and back to
     the button that opened it (or "+ Add") when it closes; the buttons it
     was on disappear, and focus fell to the top of the page. */
  const formKey = form ? `${form.id || "new"}:${form.replace ? "r" : ""}` : null;
  const lastOpener = useRef(null);
  useEffect(() => {
    if (formKey) {
      lastOpener.current = formKey;
      setTimeout(() => document.getElementById(`jx-office-form-${slug}`)?.querySelector("input:not([type=hidden]), textarea, select")?.focus(), 0);
    } else if (lastOpener.current) {
      const k = lastOpener.current; lastOpener.current = null;
      const id = k.split(":")[0];
      setTimeout(() => (document.getElementById(`jx-edit-${slug}-${id}`) || document.getElementById(`jx-add-${slug}`))?.focus(), 0);
    }
  }, [formKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  /* v146: arriving from Jarvis search ("?q=..."), the room's search box starts filled in. */
  useEffect(() => {
    /* v178 (scan): only where there IS a search box. A list without one
       (a second list on the same page, say) was quietly filtered by words
       nobody could see or clear. */
    if (!list.search) return;
    try {
      const sp = new URLSearchParams(window.location.search);
      const v = sp.get("q");
      /* v180 (scan): only the list the result came from, when the link says. */
      const forList = sp.get("list");
      if (v && (!forList || forList === slug)) setQuery(v.slice(0, 80));
    } catch { /* no URL */ }
  }, [list.search]);
  const [only, setOnly] = useState(null);         // a group value, or null for All
  const [flagOnly, setFlagOnly] = useState(false); // e.g. Vendors' "Preferred only"
  const [tag, setTag] = useState(null);             // Past CE Classes' tag filter
  const [open, setOpen] = useState(() => new Set()); // ids of cards showing their full notes
  const noun = list.noun || "item";
  const titleKey = list.fields[0].key;
  const groupField = list.groupBy ? list.fields.find(f => f.key === list.groupBy) : null;
  /* The card title links to the room's link field, whatever it is called
     (Resources' "url", Vendors' "website"). */
  const linkKey = list.fields.find(f => f.type === "url")?.key || null;
  const flag = list.flag || null;
  const flagged = it => !!flag && it.fields[flag.key] === flag.value;
  /* Tags kept as one comma-separated line (Past CE Classes), as MRE Office did. */
  /* v180 (scan): each tag once per card, whatever its case. */
  const tagsOf = it => (list.tagField ? [...new Map(String(it.fields[list.tagField] || "").split(",").map(t => t.trim()).filter(Boolean).map(t => [t.toLowerCase(), t])).values()] : []);
  const allTags = useMemo(() => {
    const seen = new Map();
    for (const it of items) for (const t of tagsOf(it)) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    return [...seen.values()];
  }, [items, list.tagField]);
  /* A list of files (MLS Info's rule books): each card opens its file through
     Jarvis, which checks who is asking before it sends anything. */
  const holdsFiles = Boolean(list.files);
  /* A list that holds ONE file (Must Have Contacts' contact file) is replaced
     in place, never added to or deleted from here, so its address never changes. */
  const single = holdsFiles && Boolean(list.files.single);
  const kinds = holdsFiles ? (list.files.types || []).map(kindInfo) : [];
  const kindWord = kinds.map(k => k.label).join(" or ") || "file";
  const fileHref = it => (/^\d{1,18}$/.test(it.id) ? `/api/office/file/${it.id}` : "");

  /* Groups in the room's declared order (the order MRE Office showed them),
     then any value not in that list, so an item can never vanish because its
     group was not expected. */
  const groups = useMemo(() => {
    if (!groupField) return null;
    const known = groupField.options || [];
    const extra = [...new Set(items.map(i => i.fields[groupField.key]).filter(v => v && !known.includes(v)))];
    return [...known, ...extra].map(g => ({ key: g, items: items.filter(i => i.fields[groupField.key] === g) }))
      .filter(g => g.items.length);
  }, [items, groupField]);

  const q = list.search ? query.trim().toLowerCase() : "";
  /* v180 (scan): a search of 3 or more digits also matches phone numbers
     written with dashes, dots or brackets. */
  const qDigits = /^[\d\s().+-]+$/.test(q) ? q.replace(/\D/g, "") : "";
  const matches = it => !q || [it.fields[titleKey], subtitleOf(list, it.fields), ...list.fields
    .filter(f => f.type === "longtext" || f.type === "text" || f.type === "phone").map(f => it.fields[f.key])]
    .some(v => typeof v === "string" && (v.toLowerCase().includes(q) || (qDigits.length >= 3 && v.replace(/\D/g, "").includes(qDigits))));
  /* v178 (scan): a filter whose button has gone (the last Preferred vendor
     deleted, a tag no longer used, down to one group) no longer applies. It
     used to stay switched on with nothing on screen to switch it off. */
  const onlyOn = only && groups && groups.length > 1 && groups.some(g => g.key === only) ? only : null;
  const tagOn = tag && allTags.some(t => t.toLowerCase() === tag.toLowerCase()) ? tag : null;
  const flagOn = flagOnly && items.some(flagged);
  const passesOthers = it => matches(it) && (!flagOn || flagged(it))
    && (!tagOn || tagsOf(it).some(t => t.toLowerCase() === tagOn.toLowerCase()));
  const shown = items.filter(it => passesOthers(it) && (!onlyOn || it.fields[groupField?.key] === onlyOn));

  async function send(method, path, body) {
    setBusy(true); setNotice("");
    try {
      const res = await fetch(`/api/office/${slug}/items${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.status === 401) { location.href = `/signin?next=${encodeURIComponent(location.pathname + location.search)}`;   /* v181 (scan): and back again */ return null; }
      const data = await res.json().catch(() => ({}));
      /* v178: a 409 brings the list as it is now; show it. */
      if (Array.isArray(data.items)) setItems(data.items);
      /* v180 (scan): after a change, ask for the page again, so its newer
         answer lands last (a refresh read just BEFORE the change could
         otherwise arrive after it and put a deleted card back). */
      if (res.ok) { try { router.refresh(); } catch { /* not in the app router */ } }
      if (!res.ok) return { error: data.error || `That did not save (HTTP ${res.status}).`, errors: data.errors || {}, conflict: res.status === 409 || (res.status === 404 && method === "PATCH"), items: Array.isArray(data.items) ? data.items : null };
      return data;
    } catch {
      return { error: "Couldn't reach Jarvis. Check your connection and try again. Nothing was changed." };
    } finally {
      setBusy(false);
    }
  }

  async function upload(fields) {
    setBusy(true); setNotice("");
    try {
      const body = new FormData();
      body.set("name", fields[titleKey] || "");
      /* v179 (scan): the other fields too (a category, say). */
      for (const f of list.fields) if (f.key !== "name" && f.key !== titleKey && fields[f.key] != null) body.set(f.key, String(fields[f.key]));
      body.set("file", form.file);
      const res = await fetch(`/api/office/${slug}/files`, { method: "POST", body, credentials: "same-origin", cache: "no-store" });
      if (res.status === 401) { location.href = `/signin?next=${encodeURIComponent(location.pathname + location.search)}`;   /* v181 (scan): and back again */ return null; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data.error || `That did not upload (HTTP ${res.status}).`, errors: data.errors || {} };
      if (Array.isArray(data.items)) setItems(data.items);
      try { router.refresh(); } catch { /* not in the app router */ }
      return data;
    } catch {
      return { error: "Couldn't reach Jarvis. Check your connection and try again. Nothing was added." };
    } finally {
      setBusy(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    const v = validateFields(list.fields, form.values);
    const needsFile = holdsFiles && !form.id;
    const fileErr = needsFile && !form.file ? `Choose a ${kindWord} to upload.`
      : needsFile && form.file.size > list.files.maxBytes ? `That file is ${fileSizeLabel(form.file.size)}. The most a file can be is ${fileSizeLabel(list.files.maxBytes)}.`
      : "";
    if (!v.ok || fileErr) {
      const errs = { ...v.errors, ...(fileErr ? { file: fileErr } : {}) };
      setForm({ ...form, errors: errs });
      /* v181 (scan): said, and the keyboard taken to the first field to fix. */
      setNotice("Check the highlighted field" + (Object.keys(errs).length === 1 ? "." : "s."));
      setTimeout(() => { const el = document.getElementById(`jx-office-form-${slug}`)?.querySelector(`[aria-invalid="true"]`); if (el) el.focus(); }, 0);
      return;
    }
    /* v181 (scan): what was typed while saving is kept (the form closed and
       threw it away). */
    const sentValues = JSON.stringify(form.values);
    const r = needsFile ? await upload(v.fields) : form.id
      ? await send("PATCH", `/${form.id}`, { fields: v.fields, base: form.base || undefined })
      : await send("POST", "", { fields: v.fields });
    if (!r) return;
    /* v178: someone else saved first. What was typed stays in the form; the
       form now counts from their version, so a second Save is a deliberate
       "keep mine", never an accident. */
    if (r.error && r.conflict && form.id && Array.isArray(r.items)) {
      /* v180 (scan): only with the fresh list in hand can "deleted" be told
         apart from "changed" (a failed reload looked like a deletion). */
      const now = r.items.find(x => x.id === form.id);
      if (!now) { setForm(null); setNotice(`Someone else deleted this ${noun} while you were editing.`); return; }
      setForm(f => f && { ...f, base: now.fields, errors: {} });
      setNotice(`Someone else saved a change to this ${noun} while you were editing. Nothing of yours was saved yet. Save again to replace their version with yours, or Cancel to keep theirs.`);
      return;
    }
    /* v180 (scan): the form as it is now (typing went on during the save). */
    if (r.error) { setForm(f => f && { ...f, errors: r.errors || {} }); setNotice(r.error); return; }
    setNotice(form.replace ? `Replaced ${v.fields[titleKey]}. Its address is the same, so phones and the QR code get the new file.`
      : form.id ? `Saved ${v.fields[titleKey]}.` : `Added ${v.fields[titleKey]}.`);
    setForm(f => (f && JSON.stringify(f.values) !== sentValues && f.id
      ? { ...f, base: v.fields, errors: {} }      // still open, counting from what was just saved
      : null));
  }

  async function remove(it) {
    const r = await send("DELETE", `/${it.id}`);
    setConfirmId(null);
    if (r?.error) setNotice(r.error); else if (r) setNotice(`Deleted ${it.fields[titleKey]}.`);
  }

  async function move(it, dir) {
    const r = await send("PATCH", `/${it.id}`, { move: dir });
    if (r?.error) setNotice(r.error);
  }

  /* Is there an item to swap with, in the same group? Mirrors moveItem(). */
  function neighbour(it, step) {
    const same = x => !groupField || x.fields[groupField.key] === it.fields[groupField.key];
    for (let k = items.indexOf(it) + step; k >= 0 && k < items.length; k += step) if (same(items[k])) return true;
    return false;
  }

  function card(it) {
          if (form?.id === it.id) return <div key={it.id}>{formCard}</div>;
          const href = holdsFiles ? fileHref(it) : linkKey ? cleanUrl(it.fields[linkKey]) : "";
          const sub = holdsFiles
            ? [kindInfo(it.file?.type).label, fileSizeLabel(it.file?.size)].filter(Boolean).join(" · ")
            : subtitleOf(list, it.fields);
          const title = it.fields[titleKey] || "(untitled)";
          return (
            <article className="jx-cardi" key={it.id}>
              <h2>
                {href
                  ? <a href={href} target="_blank" rel="noopener noreferrer">{title} <span aria-hidden="true">↗</span><span className="jx-sr"> (opens in a new tab)</span></a>
                  : title}
              </h2>
              {sub && <p className="jx-sub">{sub}</p>}
              {flagged(it) && <span className="jx-badge jx-flag">{flag.badge}</span>}
              {tagsOf(it).length > 0 && (
                <div className="jx-tags">{tagsOf(it).map(t => <span className="jx-badge" key={t}>{t}</span>)}</div>
              )}
              {(list.details || []).map(d => {
                const v = it.fields[d.key];
                /* A detail that only repeats the title (RMLS's short name is RMLS) is left out. */
                if (!v || v === title) return null;
                const tel = d.phone ? telHref(v) : "";
                return (
                  <p className="jx-detail" key={d.key}>
                    {d.label && <span className="jx-dlabel">{d.label}</span>}
                    {tel ? <a href={tel}>{v}</a> : v}
                  </p>
                );
              })}
              {list.contact && (
                <div className="jx-contact">
                  {it.fields.states && <span className="jx-badge" title="Licensed in">{it.fields.states}</span>}
                  {[...new Set(emailsIn(it.fields.email))].map(e => (
                    /* Only a plain address becomes a mailto link, so a "?" or "&" in a
                       cell can never pre-fill someone's email for them. */
                    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e)
                      ? <a key={e} href={`mailto:${e}`} className="jx-cline jx-cmail">{e}</a>
                      : <span key={e} className="jx-cline">{e}</span>
                  ))}
                  {it.fields.phone && (telHref(it.fields.phone)
                    ? <>
                        <a href={telHref(it.fields.phone)} className="jx-cline jx-ccall">{it.fields.phone}</a>
                        <a href={smsHref(it.fields.phone)} className="jx-cline jx-ctext" aria-label={`Text ${title || it.fields.phone}`}>Text</a>
                      </>
                    : <span className="jx-cline">{it.fields.phone}</span>)}
                </div>
              )}
              {list.fields.filter(f => f.type === "longtext").map(f => {
                const text = it.fields[f.key];
                if (!text) return null;
                /* Long notes show their start and a See more, as MRE Office did.
                   Cut on a word boundary so a card never ends mid-word. */
                const long = list.collapse && [...text].length > list.collapse;
                const expanded = open.has(it.id);
                const head = long && !expanded
                  ? [...text].slice(0, list.collapse).join("").replace(/\s+\S*$/, "") + "…"
                  : text;
                return (
                  <div key={f.key}>
                    <p className="jx-desc" id={`jx-d-${it.id}-${f.key}`}>{head}</p>
                    {long && (
                      <button type="button" className="jx-more" aria-expanded={expanded}
                              aria-controls={`jx-d-${it.id}-${f.key}`}
                              onClick={() => setOpen(prev => { const n = new Set(prev); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n; })}>
                        {expanded ? "See less" : "See more"}
                      </button>
                    )}
                  </div>
                );
              })}
              {editing && (
                <div className="jx-tools">
                  {confirmId === it.id ? (
                    <>
                      <span className="jx-confirm">Delete {title}?</span>
                      <button type="button" className="jx-danger" onClick={() => remove(it)} disabled={busy}>Yes, delete</button>
                      <button type="button" className="jx-ghost" onClick={() => setConfirmId(null)} disabled={busy}>Keep it</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="jx-ghost" id={`jx-edit-${slug}-${it.id}`}
                              onClick={() => { setConfirmId(null); setForm({ id: it.id, base: it.fields, values: { ...blank(list.fields), ...it.fields }, errors: {} }); }}
                              disabled={busy}>Edit</button>
                      {single ? (
                        <button type="button" className="jx-ghost"
                                onClick={() => { setConfirmId(null); setForm({ id: null, replace: true, values: { ...blank(list.fields), ...it.fields }, errors: {} }); }}
                                disabled={busy}>Replace file</button>
                      ) : (
                        <>
                          {/* v180 (scan): no moving while filtered (it swapped with
                              a hidden card, so nothing visibly moved). */}
                          {!(q || flagOn || tagOn) && <>
                          <button type="button" className="jx-ghost" onClick={() => move(it, "up")} disabled={busy || !neighbour(it, -1)}
                                  aria-label={`Move ${title} up`}>↑</button>
                          <button type="button" className="jx-ghost" onClick={() => move(it, "down")} disabled={busy || !neighbour(it, 1)}
                                  aria-label={`Move ${title} down`}>↓</button>
                          </>}
                          <button type="button" className="jx-ghost jx-dangertext" onClick={() => setConfirmId(it.id)} disabled={busy}>Delete</button>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </article>
          );
  }

  const formCard = form && (
    <form id={`jx-office-form-${slug}`} className="jx-cardi jx-form" onSubmit={save} noValidate>
      <h2 className="jx-formtitle">{form.replace ? `Replace ${form.values[titleKey] || noun}` : form.id ? `Edit ${form.values[titleKey] || noun}` : `Add a ${noun}`}</h2>
      {form.replace && <p className="jx-opt">Choose the new file. It takes the old one&rsquo;s place at the same address, so the QR code and phones get it too.</p>}
      {!form.replace && list.fields.map(f => {
        const id = `jx-f-${slug.replace(/[^a-z0-9-]/g, "-")}-${f.key}`;
        const err = form.errors?.[f.key];
        const common = {
          id, value: form.values[f.key] ?? "", maxLength: f.max, "aria-invalid": err ? true : undefined,
          "aria-describedby": [err ? `${id}-err` : "", f.help ? `${id}-help` : ""].filter(Boolean).join(" ") || undefined,
          onChange: e => setForm({ ...form, values: { ...form.values, [f.key]: e.target.value } }),
        };
        return (
          <div className="jx-field" key={f.key}>
            <label htmlFor={id}>{f.label}{f.required ? "" : <span className="jx-opt"> (optional)</span>}</label>
            {f.type === "longtext"
              ? <textarea rows={4} {...common} />
              : f.type === "choice" && f.allowOther
              /* A list of suggestions, but a new category can still be typed. */
              ? <><input type="text" list={`${id}-list`} autoComplete="off" {...common} />
                  <datalist id={`${id}-list`}>{(f.options || []).map(o => <option key={o} value={o} />)}</datalist></>
              : f.type === "choice"
              ? <select {...common}>{(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}</select>
              : <input type={f.type === "url" ? "url" : "text"} inputMode={f.type === "url" ? "url" : undefined}
                       placeholder={f.type === "url" ? "https://" : undefined} {...common} />}
            {f.help && <div className="jx-opt" id={`${id}-help`}>{f.help}</div>}
            {err && <div className="jx-err" id={`${id}-err`}>{err}</div>}
          </div>
        );
      })}
      {holdsFiles && !form.id && (() => {
        const id = `jx-f-${slug.replace(/[^a-z0-9-]/g, "-")}-file`;
        const err = form.errors?.file;
        return (
          <div className="jx-field">
            <label htmlFor={id}>{kindWord} file <span className="jx-opt">(up to {fileSizeLabel(list.files.maxBytes)})</span></label>
            <input id={id} type="file" accept={kinds.map(k => k.accept).join(",")} aria-invalid={err ? true : undefined}
                   aria-describedby={err ? `${id}-err` : undefined}
                   onChange={e => {
                     const f = e.target.files?.[0] || null;
                     /* Start the name from the file's name, if none was typed yet.
                        v181 (scan): a name that came from the PREVIOUS file pick
                        follows the new file (a second pick kept the first one's
                        name, so documents went up under the wrong title). */
                     const auto = f ? f.name.replace(/\.(pdf|vcf|vcard)$/i, "").replace(/[_]+/g, " ").trim().slice(0, 200) : "";
                     const typed = form.values[titleKey];
                     const nm = !typed || typed === form.autoName ? auto : typed;
                     setForm({ ...form, file: f, autoName: auto, values: { ...form.values, [titleKey]: nm } });
                   }} />
            {err && <div className="jx-err" id={`${id}-err`}>{err}</div>}
          </div>
        );
      })()}
      {form.id && holdsFiles && <p className="jx-opt">{single ? "To change the file itself, choose Replace file." : "To replace the file itself, delete this one and add the new file."}</p>}
      <div className="jx-formbtns">
        <button type="submit" className="jx-btn jx-btnsm" disabled={busy}>{busy ? (holdsFiles && !form.id ? "Uploading…" : "Saving…") : "Save"}</button>
        <button type="button" className="jx-ghost" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
      </div>
    </form>
  );

  return (
    <>
      <div className={section ? "jx-roomhead jx-partrow" : "jx-roomhead"}>
        {section ? (
          <div>
            <h2 className="jx-parthead" id={headingId}>{label}</h2>
            {list.blurb && <p className="jx-blurb">{list.blurb}</p>}
          </div>
        ) : (
          <div>
            <p className="jx-kicker">{list.group}</p>
            <h1>{label}</h1>
            {list.blurb && <p className="jx-blurb">{list.blurb}</p>}
          </div>
        )}
        {canEdit && (
          <button type="button" className={editing ? "jx-btn jx-btnsm" : "jx-ghost"} aria-pressed={editing}
                  disabled={busy} onClick={() => { setEditing(e => !e); setForm(null); setConfirmId(null); setNotice(""); }}>
            {editing ? "Done editing" : section ? `Edit ${label}` : "Edit list"}
          </button>
        )}
      </div>

      {!section && (list.intro || []).length > 0 && (
        /* Fixed cards at the top of a room (Employee Benefits' broker and
           401(k)). They come from our own code, and their links still go
           through cleanUrl, the phone through telHref, the email through the
           same plain-address check as everywhere else. */
        <div className="jx-intro">
          {list.intro.map(c => (
            <section className="jx-card jx-introcard" key={c.heading} aria-label={c.heading}>
              <p className="jx-kicker">{c.heading}</p>
              {c.name && <p className="jx-introname">{c.name}</p>}
              {c.role && <p className="jx-introrole">{c.role}</p>}
              {c.org && <p className="jx-sub">{c.org}</p>}
              <div className="jx-contact">
                {c.phone && (telHref(c.phone)
                  ? <>
                      <a className="jx-cline jx-ccall" href={telHref(c.phone)}>{c.phone}</a>
                      <a className="jx-cline jx-ctext" href={smsHref(c.phone)} aria-label={`Text ${c.name || c.heading}`}>Text</a>
                    </>
                  : <span className="jx-cline">{c.phone}</span>)}
                {c.email && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(c.email) && <a className="jx-cline jx-cmail" href={`mailto:${c.email}`}>{c.email}</a>}
                {c.website && cleanUrl(c.website) && (
                  <a className="jx-cline" href={cleanUrl(c.website)} target="_blank" rel="noopener noreferrer">
                    {new URL(cleanUrl(c.website)).hostname}<span className="jx-sr"> (opens in a new tab)</span></a>
                )}
                {c.address && <span className="jx-cline">{c.address}</span>}
              </div>
              {c.qr && (
                /* MRE Office's QR code, drawn from lib/contacts-qr.js: it holds
                   the contact file's address, nothing else. Dark on a white
                   plate in both themes, so every phone camera can read it. */
                <svg className="jx-qr" viewBox={`-4 -4 ${CONTACTS_QR_SIZE + 8} ${CONTACTS_QR_SIZE + 8}`}
                     role="img" aria-label="QR code for the team contact file" shapeRendering="crispEdges">
                  <rect x="-4" y="-4" width={CONTACTS_QR_SIZE + 8} height={CONTACTS_QR_SIZE + 8} fill="#fff" />
                  <path d={CONTACTS_QR_PATH} fill="#000" />
                </svg>
              )}
              {(c.sections || []).map(x => (
                <div className="jx-introsec" key={x.title}>
                  <h3>{x.title}</h3>
                  {x.text && <p>{x.text}</p>}
                  {x.steps && <ol>{x.steps.map(t => <li key={t}>{t}</li>)}</ol>}
                </div>
              ))}
              {c.download && cleanLocal(c.download.href) && (
                <a className="jx-ghost jx-introbtn" href={cleanLocal(c.download.href)} download>{c.download.text}</a>
              )}
              {c.action && cleanUrl(c.action.href) && (
                <a className="jx-ghost jx-introbtn" href={cleanUrl(c.action.href)} target="_blank" rel="noopener noreferrer">
                  {c.action.text} <span aria-hidden="true">↗</span><span className="jx-sr"> (opens in a new tab)</span></a>
              )}
            </section>
          ))}
        </div>
      )}
      {!section && list.heading && <h2 className="jx-parthead">{list.heading}</h2>}

      <div className="jx-live" role="status" aria-live="polite">{notice}</div>

      {editing && !form && !(single && items.length > 0) && (
        <button type="button" className="jx-add" id={`jx-add-${slug}`} onClick={() => setForm({ id: null, values: blank(list.fields), errors: {} })}>
          + Add a {noun}
        </button>
      )}

      {(list.search || groups || flag || allTags.length > 0) && items.length > 0 && (
        <div className="jx-filters">
          {list.search && (
            <input type="search" className="jx-search" placeholder={list.search} value={query}
                   aria-label={list.search.replace(/…$/, "")} onChange={e => setQuery(e.target.value)} />
          )}
          {/* v175: one row on a phone that slides sideways; on a computer it
              is as before (display: contents). */}
          <div className="jx-chiprow">
          {groups && groups.length > 1 && (
            <div className="jx-chips" role="group" aria-label="Show">
              <button type="button" className="jx-chip" aria-pressed={!onlyOn} onClick={() => setOnly(null)}>All</button>
              {/* v178 (scan): each count is what that chip would show with the
                  search, tag and star filters as they are, not the group's total. */}
              {groups.map(g => (
                <button type="button" key={g.key} className="jx-chip" aria-pressed={onlyOn === g.key}
                        onClick={() => setOnly(onlyOn === g.key ? null : g.key)}>{g.key} · {g.items.filter(passesOthers).length}</button>
              ))}
            </div>
          )}
          {allTags.length > 0 && (
            <div className="jx-chips" role="group" aria-label="Tags">
              <button type="button" className="jx-chip" aria-pressed={!tagOn} onClick={() => setTag(null)}>All</button>
              {allTags.map(t => (
                <button type="button" key={t} className="jx-chip" aria-pressed={!!tagOn && tagOn.toLowerCase() === t.toLowerCase()} onClick={() => setTag(tagOn && tagOn.toLowerCase() === t.toLowerCase() ? null : t)}>{t}</button>
              ))}
            </div>
          )}
          {flag && items.some(flagged) && (
            <div className="jx-chips" role="group" aria-label="Filter">
              <button type="button" className="jx-chip jx-flagchip" aria-pressed={flagOn}
                      onClick={() => setFlagOnly(!flagOn)}>★ {flag.filter}</button>
            </div>
          )}
          </div>
          <span className="jx-count">{shown.length} {shown.length === 1 ? noun : (list.nounPlural || noun + "s")}</span>
        </div>
      )}

      {form && !form.id && <div className="jx-cards jx-formrow">{formCard}</div>}

      {groups ? groups.map(g => {
        const inGroup = g.items.filter(it => shown.includes(it));
        if (!inGroup.length) return null;
        return (
          <section key={g.key} className="jx-lgroup" aria-label={g.key}>
            <h2 className="jx-grouphead">{g.key} <span>· {inGroup.length}</span></h2>
            <div className="jx-cards">{inGroup.map(it => card(it))}</div>
          </section>
        );
      }) : (
        <div className="jx-cards">{shown.map(it => card(it))}</div>
      )}

      {list.aside && (
        <div className="jx-card jx-aside">
          <p>{list.aside.text}{" "}
            {list.aside.href && cleanLocal(list.aside.href) && <a href={cleanLocal(list.aside.href)}>{list.aside.linkText || "Open"}</a>}
          </p>
        </div>
      )}

      {items.length > 0 && shown.length === 0 && (
        <div className="jx-card"><p>{q ? <>Nothing matches &ldquo;{query}&rdquo;.</> : `No ${list.nounPlural || noun + "s"} match these filters.`}</p></div>
      )}

      {!items.length && !form && (
        <div className="jx-card"><p>No {list.nounPlural || noun + "s"} listed yet.{canEdit ? ` Choose ${section ? `Edit ${label}` : "Edit list"} to add the first one.` : ""}</p></div>
      )}

      {/* cik-v9 (Brandon, 2026-10-15): the "this list moved here from CIK
          Office" note is gone; the move is done and the old site redirects here. */}
      {list.readOnly && list.managedBy && (
        <p className="jx-note">
          This list comes from {list.managedBy} and stays in step with it on its own.
          To add, change or remove someone, change the sheet.
          {syncNote ? ` ${syncNote}` : ""}
        </p>
      )}
    </>
  );
}
