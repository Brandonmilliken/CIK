/* Jarvis search (v146, Jordan 2026-10-05: "I want the search function").
 *
 * One box at the top of every page (Ctrl+K or Cmd+K) finds:
 *   - pages (rooms) by name or description, done in the browser from the menu
 *   - items inside the list rooms: links, vendors, people in the directory,
 *     classes, meetings, scripts and so on, found here, in the database
 *
 * Only rooms the person may open are searched: canSeeRoom, the same check the
 * room pages use, so an agent never finds Admin Links or Admin Training.
 * Every field of an item is searched (name, notes, tags, phone, link), and
 * a match shows the item's name and the room it is in.
 */
import { sql as neonSql } from "./db.js";
import { ALL_ROOMS, canSeeRoom, partsOf } from "./office-rooms.js";

let sql = neonSql;
/** For scripts/search-db-check.mjs: the same query over a local Postgres. */
export function __setSqlForTests(f) { sql = f; }

/** The search words, tidied: 2 to 80 characters, or null. */
export function cleanQuery(q) {
  const s = typeof q === "string" ? q.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim() : "";
  return s.length >= 2 && s.length <= 80 ? s : null;
}

/** LIKE treats % and _ as wildcards; a search for "50%" means the characters. */
export const likeEscape = s => s.replace(/[\\%_]/g, m => "\\" + m);

/** Every list a person may search: each room's main list and its second lists. */
export function searchableLists(role) {
  const out = [];
  for (const room of ALL_ROOMS) {
    if (room.where !== "jarvis" || !canSeeRoom(room, role)) continue;
    if (room.list) out.push({ slug: room.slug, page: room.slug, label: room.label, list: room.list });
    for (const part of partsOf(room)) out.push({ slug: part.slug, page: room.slug, label: room.label, list: part.list });
  }
  return out;
}

/**
 * Items matching `q` in the lists `role` may see, best first: a match in the
 * item's name before a match anywhere else. At most `limit`.
 */
export async function searchItems(q, role, limit = 20) {
  const query = cleanQuery(q);
  if (!query) return [];
  const lists = searchableLists(role);
  if (!lists.length) return [];
  const bySlug = new Map(lists.map(l => [l.slug, l]));
  const pattern = "%" + likeEscape(query) + "%";
  /* v178 (scan): the 200-row cap used to be taken in room order BEFORE the
     title check, so a common word ("home", "loan") could fill it with rooms
     early in the alphabet, many of them link-only matches thrown away below,
     and a perfect title match in a later room never came back. Title
     matches now come first, and the cap is roomier. */
  const titleKeys = [...new Set(lists.map(l => l.list.fields?.[0]?.key || "name").concat(["name", "title"]))];
  const rows = await sql`
    select room, id, fields from office_items
    where room = any(${[...bySlug.keys()]}::text[])
      and exists (select 1 from jsonb_each_text(fields) e where e.value ilike ${pattern} escape '\\')
    order by (case when exists (select 1 from unnest(${titleKeys}::text[]) k where fields->>k ilike ${pattern} escape '\\') then 0 else 1 end),
             room, position, id
    limit 1000`;
  const lower = query.toLowerCase();
  const out = [];
  for (const r of rows) {
    const l = bySlug.get(r.room);
    if (!l) continue;
    const f = r.fields || {};
    const titleKey = l.list.fields?.[0]?.key || "name";
    const full = String(f[titleKey] || f.name || f.title || "");
    if (!full) continue;
    /* v180 (scan): matched on the whole title, cut only for showing. */
    const inTitle = full.toLowerCase().includes(lower);
    const title = full.length > 140 ? full.slice(0, 139) + "\u2026" : full;
    let where = "";
    if (!inTitle) {
      /* A match only inside a web address doesn't count: "vend" would
         otherwise find every vendor whose link has /vendors/ in it. */
      const hit = (l.list.fields || []).find(fd => fd.type !== "url" && typeof f[fd.key] === "string" && f[fd.key].toLowerCase().includes(lower));
      if (!hit) continue;
      where = hit.label;
    }
    out.push({ id: String(r.id), title, room: l.page, list: l.slug, roomLabel: l.label, where, rank: inTitle ? 0 : 1 });
  }
  out.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
  return out.slice(0, limit).map(({ rank, ...x }) => x);
}
