/* Podio, read-only: the client, and turning one Podio item into one row.
 *
 * WHICH APPS. The six Cash Is King lead apps, the same six as Brandon's
 * "Kicked to Agent" report (agent_kicks.py). A lead starts in Hot Leads and is
 * copied onward as it moves (STF, LTF, No Response, Trash), and deals that get
 * an offer go to Elysium, which carries the deal dates and fees.
 *
 * HOW IT SIGNS IN. Podio "app authentication": one API key for the company
 * (PODIO_CLIENT_ID / PODIO_CLIENT_SECRET, from podio.com/settings/api) plus each
 * app's own token (app → wrench → Developer). An app token can only READ AND
 * WRITE THAT ONE APP, which is why this uses them rather than a person's
 * password: nobody's login sits in Vercel, and the key reaches nothing but these
 * six apps. This file only ever reads.
 *
 *   PODIO_APP_TOKENS = "30206037=abc...,30206102=def...,..."   (app id = token)
 *
 * FIELDS ARE FOUND BY LABEL, NEVER BY external_id. The same external_id means
 * different things in different apps here (LTF's "kicked-to-agent-date" is its
 * Agent Set field; "calculation" is the address in one app and the Zillow link
 * in another). Labels are trimmed and lower-cased, because several end in a
 * space ("Handed to ", "Closing Date "). Where one label is used twice (a text
 * "Closing Date " and a date "Closing Date "), the field TYPE picks.
 */

export const PODIO_API = () => (process.env.PODIO_API_BASE || "https://api.podio.com").replace(/\/+$/, "");

/* Elysium first: when the same lead sits in two apps (copied on, the old copy
   not yet gone), the deals app holds the deal dates and fees. */
export const LEAD_APPS = [
  { id: 30240944, name: "Elysium", slug: "elysium" },
  { id: 30206037, name: "Hot Leads", slug: "hot-leads" },
  { id: 30206102, name: "STF", slug: "stf" },
  { id: 30255544, name: "LTF", slug: "ltf" },
  { id: 30206099, name: "No Response", slug: "no-response" },
  { id: 30206101, name: "Trash", slug: "trash" },
];
export const ELYSIUM_ID = 30240944;
export const appName = id => (LEAD_APPS.find(a => a.id === Number(id)) || {}).name || String(id);

/* In-house: a lead handed to Jordan or Jacob stays with Cash Is King, so it is
   not a kick to an outside agent (Brandon, for agent_kicks.py). */
export const IN_HOUSE = ["jordan", "jacob"];

const SIGNED_STATUSES = ["offer signed", "offer assigned", "closed", "sold flip"];
const CLOSED_STATUSES = ["closed", "sold flip"];

/* ---------------------------------------------------------------- config */

/** Which apps have a token, and which are missing. Never throws. */
export function podioConfig(env = process.env) {
  const clientId = String(env.PODIO_CLIENT_ID || "").trim();
  const clientSecret = String(env.PODIO_CLIENT_SECRET || "").trim();
  const tokens = {};
  for (const part of String(env.PODIO_APP_TOKENS || "").split(/[,\s]+/)) {
    const m = /^(\d+)\s*[=:]\s*([A-Za-z0-9]+)$/.exec(part.trim());
    if (m) tokens[Number(m[1])] = m[2];
  }
  const apps = LEAD_APPS.filter(a => tokens[a.id]);
  const missing = LEAD_APPS.filter(a => !tokens[a.id]).map(a => a.name);
  return { ok: Boolean(clientId && clientSecret && apps.length), clientId, clientSecret, tokens, apps, missing,
           hasKey: Boolean(clientId && clientSecret) };
}

/* ---------------------------------------------------------------- client */

/* One access token per app, kept for the life of the server instance (Podio's
   last 8 hours; renewed 10 minutes early). */
const tokenCache = new Map();
export function __clearTokens() { tokenCache.clear(); }

export class PodioError extends Error {
  constructor(message, { status = 0, rateLimited = false } = {}) {
    super(message); this.status = status; this.rateLimited = rateLimited;
  }
}

async function appToken(appId, cfg, fetchImpl) {
  const hit = tokenCache.get(appId);
  if (hit && hit.until > Date.now()) return hit.token;
  const body = new URLSearchParams({
    grant_type: "app", app_id: String(appId), app_token: cfg.tokens[appId],
    client_id: cfg.clientId, client_secret: cfg.clientSecret,
  });
  const ask = path => fetchImpl(`${PODIO_API()}${path}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  /* Podio's current sign-in address, and its older one if this account still
     answers only there. */
  let r = await ask("/oauth/token/v2");
  if (r.status === 404) r = await ask("/oauth/token");
  if (!r.ok) {
    /* Podio's error text can echo what was sent; only the status goes in the log. */
    throw new PodioError(`Podio sign-in for ${appName(appId)} failed (${r.status})`, { status: r.status, rateLimited: r.status === 420 || r.status === 429 });
  }
  const j = await r.json();
  if (!j || !j.access_token) throw new PodioError(`Podio sign-in for ${appName(appId)} returned no token`);
  const life = Math.max(60, Number(j.expires_in) || 28800) * 1000;
  tokenCache.set(appId, { token: j.access_token, until: Date.now() + life - 600000 });
  return j.access_token;
}

/**
 * One page of an app's items: POST /item/app/{id}/filter/.
 * `body` is Podio's filter body ({limit, offset, sort_by, sort_desc, filters}).
 */
export async function filterItems(appId, body, { cfg = podioConfig(), fetchImpl = fetch, timeoutMs = 25000 } = {}) {
  const token = await appToken(appId, cfg, fetchImpl);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`${PODIO_API()}/item/app/${appId}/filter/`, {
      method: "POST",
      headers: { Authorization: `OAuth2 ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (r.status === 401) tokenCache.delete(appId);
    if (!r.ok) {
      throw new PodioError(`Podio ${appName(appId)} answered ${r.status}`, { status: r.status, rateLimited: r.status === 420 || r.status === 429 });
    }
    const j = await r.json();
    return { total: Number(j.total) || 0, filtered: Number(j.filtered ?? j.total) || 0, items: Array.isArray(j.items) ? j.items : [] };
  } finally {
    clearTimeout(t);
  }
}

/* ---------------------------------------------------------------- parsing */

const norm = s => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

/** Text with Podio's HTML taken out (and its entities decoded), one line. */
export function plain(s) {
  return String(s ?? "")
    .replace(/<br\s*\/?>/gi, " ").replace(/<\/p>/gi, " ").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();
}

/** A dollar amount out of free text ("<p>27,000</p>", "$1,000", "27000.0000"). */
export function money(v) {
  if (v === null || v === undefined) return null;
  const t = plain(v).replace(/[$,\s]/g, "");
  const m = /^-?\d+(\.\d+)?/.exec(t);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/* The fields on an item, by normalised label; a label used twice keeps both. */
function index(item) {
  const by = new Map();
  for (const f of Array.isArray(item && item.fields) ? item.fields : []) {
    const k = norm(f.label);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(f);
  }
  return by;
}
function pick(by, label, types = null) {
  const list = by.get(norm(label)) || [];
  const hits = types ? list.filter(f => types.includes(f.type)) : list;
  return hits.find(f => Array.isArray(f.values) && f.values.length) || hits[0] || null;
}

function categoryText(by, label) {
  const f = pick(by, label, ["category"]);
  const v = f && f.values && f.values[0] && f.values[0].value;
  return v && typeof v === "object" ? plain(v.text) : "";
}
function textValue(by, label, types = ["text", "calculation"]) {
  const f = pick(by, label, types);
  const v = f && f.values && f.values[0];
  if (!v) return "";
  return plain(typeof v.value === "object" && v.value !== null ? (v.value.text ?? "") : v.value);
}
function numberValue(by, label) {
  const f = pick(by, label, ["money", "number", "calculation"]);
  const v = f && f.values && f.values[0];
  return v ? money(v.value) : null;
}

/** Podio's "YYYY-MM-DD HH:MM:SS" (UTC) as an ISO time, or null. */
export function utcIso(v) {
  if (!v) return null;
  const s = String(v).trim().replace(" ", "T");
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
  return isNaN(d) ? null : d.toISOString();
}

/** "YYYY-MM-DD" in Portland for a UTC "YYYY-MM-DD HH:MM:SS" (or ISO) time. */
export function laDate(utc) {
  if (!utc) return null;
  const d = new Date(String(utc).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(utc) ? "" : "Z"));
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/* A date field's day, in Portland. All-day values are already a calendar day;
   a value with a time is converted from UTC. */
function dateValue(by, label) {
  const f = pick(by, label, ["date"]);
  const v = f && f.values && f.values[0];
  if (!v) return null;
  if (v.start_time_utc || (v.start_time && v.start_utc)) return laDate(v.start_utc);
  const day = v.start_date || (typeof v.start === "string" ? v.start.slice(0, 10) : null);
  return /^\d{4}-\d{2}-\d{2}$/.test(day || "") ? day : null;
}

function phoneDigits(by) {
  const f = pick(by, "phone", ["phone"]);
  const v = f && f.values && f.values[0];
  const d = String(v ? v.value : "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

/* "null, null, null null" is what the address formula gives for an empty one. */
function cleanAddress(s) {
  const t = plain(s);
  return /^(null[\s,]*)+$/i.test(t) || !/[a-z0-9]/i.test(t.replace(/null/gi, "")) ? "" : t;
}

/**
 * The same lead in two apps (a copy made on the way to the next app, before the
 * old one is removed) must count once. Phone plus the start of the street
 * address; a seller with two properties is two deals.
 */
export function leadKey({ phone = "", name = "", address = "" }) {
  const addr = String(address).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 14);
  if (phone) return `p:${phone}|${addr}`;
  return `n:${String(name).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40)}|${addr}`;
}

/**
 * One Podio item → one row, with the dates the dashboard counts by worked out
 * here (so the SQL only ever compares dates).
 *
 *   signed_d  the Offer Signed Date (Elysium). Apps without that field: the
 *             Offer Modified date, if the lead has reached Offer Signed or later.
 *   sent_d    the Offer Sent Date, or Offer Modified for a lead at Offer Sent.
 *   closed_d  the Closing Date, for a lead whose status is Closed or Sold Flip.
 *   kicked_d  the Kicked To Agent Date, only for a lead handed to an OUTSIDE
 *             agent (not Jordan, not Jacob, not blank) — agent_kicks.py's rule.
 *   fee       WS Fee (Elysium), else Assignment Fee, else Gross Revenue.
 */
export function itemToRow(item, appId) {
  const by = index(item);
  const status = categoryText(by, "Status");
  const handed = categoryText(by, "Handed to");
  const name = plain(textValue(by, "Name") || item.title || "");
  const address = cleanAddress(textValue(by, "Property Address"));
  const phone = phoneDigits(by);

  const offerSigned = dateValue(by, "Offer Signed Date");
  const offerSent = dateValue(by, "Offer Sent Date");
  const offerModified = dateValue(by, "Offer Modified");
  const closing = dateValue(by, "Closing Date");
  const kicked = dateValue(by, "Kicked To Agent Date");
  const st = norm(status);

  let fee = null;
  for (const f of (by.get("ws fee") || [])) {
    const n = f.values && f.values[0] ? money(f.values[0].value) : null;
    if (n !== null && n !== 0) { fee = n; break; }
  }
  if (fee === null) fee = numberValue(by, "Assignment Fee (if closed)");
  if (fee === null) fee = money(textValue(by, "Gross Revenue", ["text", "number", "money", "calculation"])) ;

  const outside = handed !== "" && !IN_HOUSE.includes(norm(handed));

  return {
    item_id: Number(item.item_id),
    app_id: Number(appId),
    app_item_id: Number(item.app_item_id) || null,
    link: typeof item.link === "string" && /^https:\/\/podio\.com\//.test(item.link) ? item.link : null,
    name: name.slice(0, 160),
    address: address.slice(0, 200),
    lead_key: leadKey({ phone, name, address }),
    lead_owner: categoryText(by, "Lead Owner").slice(0, 60),
    status: status.slice(0, 60),
    handed_to: handed.slice(0, 60),
    jordan: categoryText(by, "Jordan").slice(0, 60),
    source: (categoryText(by, "Source") || textValue(by, "Source", ["text"])).slice(0, 60),
    lead_type: categoryText(by, "Lead Type").slice(0, 40),
    closed_type: categoryText(by, "Closed type").slice(0, 60),
    lead_d: dateValue(by, "Lead Date") || laDate(item.created_on),
    sent_d: offerSent || (st === "offer sent" ? offerModified : null),
    signed_d: offerSigned || (SIGNED_STATUSES.includes(st) ? offerModified : null),
    closed_d: CLOSED_STATUSES.includes(st) ? closing : null,
    closing_d: closing,
    kicked_d: outside ? kicked : null,
    is_kick: outside,
    agent_set_d: dateValue(by, "Agent Set"),
    agent_met_d: dateValue(by, "Agent Met"),
    agent_signed_d: dateValue(by, "Agent Signed"),
    agent_closed_d: dateValue(by, "Agent Closed Date") || dateValue(by, "Listing Closed"),
    fee,
    created_on: utcIso(item.created_on),
    edited_on: utcIso(item.last_event_on) || utcIso(item.created_on),
  };
}
