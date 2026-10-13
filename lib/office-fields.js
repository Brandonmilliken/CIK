/* What an item in a moved MRE Office list may contain.
 *
 * Pure: no database, no Next, nothing that cannot run in a browser. The same
 * function checks a form before it is sent AND checks the request when it
 * arrives, so the two can never disagree. The server's run is the one that counts.
 *
 * A room's fields are declared in lib/office-rooms.js, e.g.
 *   { key: "name", label: "Name", type: "text", required: true, max: 80 }
 * type is "text" (one line), "longtext" (keeps line breaks), "url", or
 * "choice" (one of a fixed `options` list, e.g. a category or a state; with
 * `allowOther: true` the list is only suggestions).
 */

/* A link we are willing to put in an href. Same rule as the dashboard's
   safeUrl(): control characters and whitespace are stripped FIRST, because
   browsers ignore a tab inside a scheme, so "java<TAB>script:" runs. Then an
   ALLOW-list of http and https. It is not a blocklist of javascript:, because
   data:, vbscript: and blob: do the same job. Returns "" for anything else. */
/** v181: is this path one of Jarvis's API addresses, however it's spelled? */
export function isApiPath(pathname) {
  let p = String(pathname || "");
  try { p = decodeURIComponent(p); } catch { /* keep as is */ }
  p = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  return /^\/api(\/|$)/i.test(p);
}
export function cleanUrl(u) {
  if (typeof u !== "string") return "";
  const raw = u.replace(/[\u0000- \u007f-\u009f]/g, "");
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (!parsed.hostname) return "";
    /* v180 (scan): never one of Jarvis's own API addresses. A card linking to
       an admin job ran it as whoever clicked (a leader, say). */
    /* v181 (scan): with repeated slashes and encoded slashes folded first
       ("//api/..." and "/%2Fapi/..." got through, and Next redirects them). */
    /* CIK: this app is served under cikoffice.com (and was copied from mreoffice.com). */
    if (/(^|\.)(cikoffice|mreoffice)\.com$/i.test(parsed.hostname) && isApiPath(parsed.pathname)) return "";
    return parsed.href;
  } catch { return ""; }
}

/* Characters that have no business in a list item: control characters, and
   the invisible direction overrides that can make text read differently from
   what it is. Line breaks and tabs survive in longtext only. */
/* v180 (scan): and the invisible ones (zero-width spaces and joiners, word
   joiner, byte-order mark, Arabic letter mark, tag characters), so a name of
   only those no longer counts as filled in. */
const CTRL_ONE_LINE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff\u{E0000}-\u{E007F}]/gu;
const CTRL_MULTI    = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff\u{E0000}-\u{E007F}]/gu;

/**
 * Check one item against a room's field list.
 * Returns { ok, fields, errors }. `fields` holds only declared keys, cleaned.
 * Anything not declared is dropped, never stored.
 */
export function validateFields(spec, input) {
  const fields = {};
  const errors = {};
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  for (const f of spec || []) {
    const raw = src[f.key];
    if (raw !== undefined && raw !== null && typeof raw !== "string") {
      errors[f.key] = `${f.label} must be text.`;
      continue;
    }
    let v = typeof raw === "string" ? raw : "";
    /* v180 (scan): half of an emoji (a lone surrogate) can't be stored; it
       failed the save with a 500 instead of saying which field. */
    if (typeof v.isWellFormed === "function" && !v.isWellFormed()) {
      errors[f.key] = `${f.label} contains a character that can't be saved.`;
      continue;
    }
    v = f.type === "longtext"
      ? v.replace(/\r\n?/g, "\n").replace(CTRL_MULTI, "").trim()
      : v.replace(CTRL_ONE_LINE, " ").replace(/\s+/g, " ").trim();

    if (!v) {
      if (f.required) errors[f.key] = `${f.label} is required.`;
      fields[f.key] = "";
      continue;
    }
    if (f.max && [...v].length > f.max) {
      errors[f.key] = `${f.label} can be at most ${f.max} characters.`;
      continue;
    }
    /* allowOther: the options are suggestions, not a fence. Vendors' categories
       work this way, so an admin can add a new kind of vendor without a code
       change. The value is still tidied, capped and required as declared. */
    if (f.type === "choice" && !f.allowOther && !(f.options || []).includes(v)) {
      errors[f.key] = `${f.label} must be one of: ${(f.options || []).join(", ")}.`;
      continue;
    }
    /* v180 (scan): a space inside a link was quietly dropped when the link
       was used ("My File.pdf" opened "MyFile.pdf"); refuse it instead. */
    if (f.type === "url" && /\s/.test(v)) {
      errors[f.key] = `${f.label} can't contain spaces.`;
      continue;
    }
    if (f.type === "url" && !cleanUrl(v)) {
      errors[f.key] = `${f.label} must be a web address starting with https:// or http://.`;
      continue;
    }
    fields[f.key] = v;
  }

  return { ok: Object.keys(errors).length === 0, fields, errors };
}

/* What kind of link a card is, in MRE Office's own words: Form, Drive, Doc,
   Issuu, Trainual, Map, Calendar, otherwise Link. Checked against every card in
   Resources (9), Recruiting (3), New Business (7) and Open Houses (3) on the live
   site on 2026-09-24, and it gave the same label for all 22. Derived from the
   address, not stored, so it cannot go stale. */
export function linkKind(u) {
  const href = cleanUrl(u);
  if (!href) return "";
  const x = new URL(href);
  const h = x.hostname.toLowerCase(), p = x.pathname.toLowerCase();
  if (h === "forms.gle" || h === "form.asana.com" || (h === "docs.google.com" && /^\/forms(\/|$)/.test(p))) return "Form";
  if (h === "drive.google.com") return "Drive";
  if (h === "docs.google.com" && /^\/document(\/|$)/.test(p)) return "Doc";
  if (h === "docs.google.com" && /^\/spreadsheets(\/|$)/.test(p)) return "Sheet";
  if (h === "docs.google.com" && /^\/presentation(\/|$)/.test(p)) return "Slides";
  if (/(^|\.)issuu\.com$/.test(h)) return "Issuu";
  if (/(^|\.)trainual\.com$/.test(h)) return "Trainual";
  if (/arcgis/.test(h) || /map/.test(h + p)) return "Map";
  if (/(^|\.)teamup\.com$/.test(h) || /calendar/.test(h)) return "Calendar";
  return "Link";
}

/* A fingerprint of a list's contents, in order: SHA-256 of the JSON of each
   item's declared fields, in the room's field order. The import computes it on
   both sides, in the browser from MRE Office's data and on the server from what
   it stored, so "the copy is exact" is a comparison, not a claim. Key order is
   fixed by the spec because jsonb re-orders keys. */
export async function fingerprint(spec, items) {
  const canon = JSON.stringify((items || []).map(i => spec.map(f => [f.key, (i && i[f.key]) ?? ""])));
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
