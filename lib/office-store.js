/* Storage for MRE Office rooms that have moved into Jarvis as plain lists.
 *
 * One table for every list room, keyed by room slug, with the item's fields as
 * jsonb. The field list lives in lib/office-rooms.js and is enforced by
 * lib/office-fields.js before anything is written, so the shape is ours even
 * though the column is jsonb. Moving the next list room is a declaration, not
 * a migration.
 *
 * THE FIRST COPY. A room with a seed (lib/seeds/<room>.js) is filled from it
 * the first time the room is read, exactly once. That is recorded in
 * office_seeds IN THE SAME TRANSACTION as the insert, so a half-finished seed
 * leaves no mark and runs again next time. That is the same rule as sync_runs:
 * success belongs to the run, not to whichever rows it got written before it
 * fell over. After that, deleting every item leaves the room empty; it does
 * not quietly refill it from a month-old copy.
 *
 * Every write is scoped by room AND id, so an id from another room cannot be
 * reached through this room's URL. Every write is logged in office_changes
 * with who did it and what the item looked like before and after.
 *
 * FILES (v89). A list can hold files (MLS Info's rule books). The file itself
 * lives in the private file store (lib/office-blob.js); its row here keeps the
 * item's fields as usual plus a `file` column: where it is kept, its size, its
 * SHA-256, its type, and the address MRE Office served it at. The pathname
 * never leaves the server. Pages see only size, type and hash.
 */
import { sql as defaultSql } from "./db.js";
import { listTarget } from "./office-rooms.js";
import { validateFields, fingerprint } from "./office-fields.js";

/* CIK: no built-in seeds (Jarvis had MRE's Tech Stack and Ask Matin AI's answers).
   Every CIK list is either filled by the one-time import or starts empty. */
const SEEDS = {};

/* A list is small and read by people, not machines. Well past anything a room
   will hold honestly, and short of what a runaway script could make of it. */
export const MAX_ITEMS_PER_ROOM = 500;

let sql = defaultSql;
/** Tests point this at a real Postgres. Nothing else calls it. */
export function __setSqlForTests(fn) { sql = fn; schemaReady = null; seededRooms.clear(); }

let schemaReady = null;
export function ensureOfficeSchema() {
  /* Once per server instance. A failure clears it so the next request retries,
     instead of the instance caching "broken" for its whole life. */
  if (!schemaReady) {
    schemaReady = (async () => {
      /* v179 (scan): one quick look first. When everything is already there
         (always, after the first deploy), the seven DDL statements are
         skipped: each was a round trip on a new server's first request, and
         an ALTER takes the table's strongest lock even when it changes nothing. */
      const have = await sql`
        select to_regclass('office_changes') is not null and to_regclass('office_settings') is not null
           and to_regclass('office_seeds') is not null and to_regclass('office_items_origin') is not null
           and exists (select 1 from information_schema.columns where table_name = 'office_items' and column_name = 'file') as ok`;
      if (have[0] && have[0].ok) return;
      await sql`
        create table if not exists office_items (
          id          bigserial primary key,
          room        text not null,
          position    integer not null,
          fields      jsonb not null,
          origin_id   text,
          created_at  timestamptz not null default now(),
          updated_at  timestamptz not null default now(),
          updated_by  text
        )`;
      /* v89: a file item's details. Null for every ordinary item. */
      await sql`alter table office_items add column if not exists file jsonb`;
      await sql`create index if not exists office_items_room on office_items (room, position, id)`;
      await sql`create unique index if not exists office_items_origin
                  on office_items (room, origin_id) where origin_id is not null`;
      await sql`
        create table if not exists office_seeds (
          room        text primary key,
          item_count  integer not null,
          seeded_at   timestamptz not null default now()
        )`;
      await sql`
        create table if not exists office_settings (
          key         text primary key,
          value       text not null,
          updated_at  timestamptz not null default now(),
          updated_by  text
        )`;
      await sql`
        create table if not exists office_changes (
          id          bigserial primary key,
          room        text not null,
          item_id     bigint,
          action      text not null check (action in ('create','update','delete','move')),
          actor_email text not null,
          before      jsonb,
          after       jsonb,
          at          timestamptz not null default now()
        )`;
    })().catch(e => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

function listRoom(slug) {
  const room = listTarget(slug);
  if (!room || room.where !== "jarvis" || !room.list) throw new Error(`not a list room: ${slug}`);
  return room;
}

/* What a page may know about a file: never where it is kept. */
const fileSummary = f => (f && typeof f === "object"
  ? { size: Number(f.size) || 0, type: String(f.type || ""), sha256: String(f.sha256 || "") }
  : null);
const shape = r => (r.file
  ? { id: String(r.id), fields: r.fields || {}, file: fileSummary(r.file) }
  : { id: String(r.id), fields: r.fields || {} });

/* A file's details as the server keeps them. Checked before they are stored,
   so a row can never point anywhere but a pathname the store gave back. */
const META_PATH = /^office\/[a-z0-9-]{1,40}\/[A-Za-z0-9_-]{1,120}\.(pdf|vcf)$/;  // the store adds a mixed-case random suffix
const META_TYPES = new Set(["application/pdf", "text/vcard"]);
const EXT_OF = { "application/pdf": "pdf", "text/vcard": "vcf" };
function cleanMeta(m) {
  if (!m || typeof m !== "object") return null;
  const ok = typeof m.pathname === "string" && META_PATH.test(m.pathname) &&
    Number.isInteger(m.size) && m.size > 0 && typeof m.sha256 === "string" && /^[0-9a-f]{64}$/.test(m.sha256) &&
    META_TYPES.has(m.type) && m.pathname.endsWith("." + EXT_OF[m.type]) &&
    (m.originPath === undefined || (typeof m.originPath === "string" && m.originPath.length <= 300 && /^\/wp-content\/uploads\/[A-Za-z0-9_\-./]+$/.test(m.originPath) && !m.originPath.includes("..")));
  return ok ? { pathname: m.pathname, size: m.size, sha256: m.sha256, type: m.type, ...(m.originPath ? { originPath: m.originPath } : {}) } : null;
}

/* A room whose seed is { from: "cikoffice" } is filled by importItems(), run
   once from a signed-in CIK Office tab. Reading it before then must NOT mark it
   seeded, or the import would find it "already done" and refuse. */
const importsFromCikOffice = room => Boolean(room.list.seed && typeof room.list.seed === "object" && room.list.seed.from === "cikoffice");

/* v125: a room seeded once stays seeded, so this server instance stops asking. */
const seededRooms = new Set();
async function seedIfNeeded(room) {
  if (importsFromCikOffice(room)) return;
  if (seededRooms.has(room.slug)) return;
  const done = await sql`select 1 from office_seeds where room = ${room.slug}`;
  if (done.length) { seededRooms.add(room.slug); return; }

  const seed = room.list.seed ? SEEDS[room.list.seed] : null;
  const items = (seed?.items || []).map(i => ({ originId: i.originId, fields: i.fields }));

  await sql.transaction([
    sql`insert into office_seeds (room, item_count) values (${room.slug}, ${items.length})
        on conflict (room) do nothing`,
    sql`insert into office_items (room, position, fields, origin_id, updated_by)
        select ${room.slug}, (e.ord * 10)::int, e.v -> 'fields', e.v ->> 'originId', 'seed'
        from jsonb_array_elements(${JSON.stringify(items)}::jsonb) with ordinality as e(v, ord)
        on conflict (room, origin_id) where origin_id is not null do nothing`,
  ]);
}

/** Every item in a list room, in display order. Fills the room from its seed on first read. */
export async function listItems(slug) {
  const room = listRoom(slug);
  await ensureOfficeSchema();
  await seedIfNeeded(room);
  const rows = await sql`
    select id, fields, file from office_items
    where room = ${room.slug}
    order by position, id`;
  return rows.map(shape);
}

/** Has this room been filled yet? False only for an import room still waiting for its copy. */
export async function roomState(slug) {
  const room = listRoom(slug);
  if (!importsFromCikOffice(room)) return { imported: true };
  await ensureOfficeSchema();
  const rows = await sql`select item_count, seeded_at from office_seeds where room = ${room.slug}`;
  return rows.length
    ? { imported: true, count: rows[0].item_count, at: rows[0].seeded_at }
    : { imported: false };
}

const ORIGIN_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The one-time copy of a room from MRE Office.
 *
 * All or nothing, and exact or refused:
 *   - only for a room declared as importing from MRE Office, and only once
 *   - every item must pass the room's validation UNCHANGED. If cleaning an
 *     item would alter it (a stray space, a control character), the whole
 *     import is refused and the response names the item and field. It is not
 *     quietly tidied, because then "exact copy" would stop being true.
 *   - the "done" marker and the items go in one transaction, so a failure
 *     leaves the room waiting, not half full
 * Returns the fingerprint of what was stored, for the caller to compare with
 * the one it computed from MRE Office's side.
 */
export async function importItems(slug, input, actor, fileMetas = null) {
  const room = listRoom(slug);
  const holdsFiles = Boolean(room.list.files);
  if (!importsFromCikOffice(room)) throw new OfficeInputError(`${room.label} is not filled by an import.`, {}, 409);
  if (!Array.isArray(input) || !input.length) throw new OfficeInputError("Send the items to import.");
  if (input.length > MAX_ITEMS_PER_ROOM) throw new OfficeInputError(`At most ${MAX_ITEMS_PER_ROOM} items.`);

  const problems = [];
  const seen = new Set();
  const items = input.map((it, i) => {
    const originId = it?.originId;
    if (typeof originId !== "string" || !ORIGIN_ID.test(originId)) problems.push({ index: i, field: "originId", error: "missing or malformed" });
    else if (seen.has(originId)) problems.push({ index: i, field: "originId", error: "duplicate" });
    seen.add(originId);
    const v = validateFields(room.list.fields, it?.fields);
    for (const [field, error] of Object.entries(v.errors)) problems.push({ index: i, originId, field, error });
    for (const f of room.list.fields) {
      if (v.errors[f.key]) continue;
      const given = it?.fields?.[f.key] ?? "";
      if (given !== v.fields[f.key]) problems.push({ index: i, originId, field: f.key, error: "would be changed by cleaning" });
    }
    /* A file list's items each bring the file already put in the store by
       the import route, in the same order. An ordinary list brings none. */
    if (!holdsFiles) return { originId, fields: v.fields };
    const file = cleanMeta(Array.isArray(fileMetas) ? fileMetas[i] : null);
    if (!file) problems.push({ index: i, originId, field: "file", error: "missing or malformed" });
    return { originId, fields: v.fields, file };
  });
  if (!holdsFiles && fileMetas) problems.push({ index: 0, field: "file", error: "this list does not hold files" });
  /* v179 (scan): a one-file list imports exactly one (the page can't remove a second). */
  if (holdsFiles && room.list.files.single && input.length !== 1) problems.push({ index: 0, field: "file", error: "this list holds exactly one file" });
  if (holdsFiles && (!Array.isArray(fileMetas) || fileMetas.length !== input.length)) {
    problems.push({ index: 0, field: "file", error: "every item needs its file" });
  }
  if (problems.length) throw new OfficeInputError("Nothing was imported. These items need a look first.", { problems });

  await ensureOfficeSchema();
  const done = await sql`select 1 from office_seeds where room = ${room.slug}`;
  if (done.length) throw new OfficeInputError(`${room.label} has already been copied from CIK Office.`, {}, 409);

  /* v179 (scan): only the run that marks the room as copied writes its
     items. Two runs at once (a double click) both got here; the second's
     items all hit "do nothing", it reported success, and its whole set of
     stored files was left in the store with nothing pointing at them. Now
     the second is told 409, and the route removes its files. */
  const [seeded] = await sql.transaction([
    sql`insert into office_seeds (room, item_count) values (${room.slug}, ${items.length})
        on conflict (room) do nothing returning room`,
    sql`insert into office_items (room, position, fields, origin_id, updated_by, file)
        select ${room.slug}, (e.ord * 10)::int, e.v -> 'fields', e.v ->> 'originId', ${"import:" + actor}, e.v -> 'file'
        from jsonb_array_elements(${JSON.stringify(items)}::jsonb) with ordinality as e(v, ord)
        where exists (select 1 from office_seeds s where s.room = ${room.slug} and s.seeded_at = now())
        on conflict (room, origin_id) where origin_id is not null do nothing`,
    sql`insert into office_changes (room, item_id, action, actor_email, before, after)
        select ${room.slug}, id, 'create', ${actor}, null, fields
        from office_items where room = ${room.slug} and updated_by = ${"import:" + actor}
          and created_at = now()`,   /* now() is this transaction's start: only rows it inserted */
  ]);
  if (!seeded || !seeded.length) throw new OfficeInputError(`${room.label} has already been copied from CIK Office.`, {}, 409);

  /* v179 (scan): from here the import is saved. A failure reading it back
     must not look like "nothing was imported" (the route would then delete
     the files the new rows point at): it says so instead. */
  let stored;
  try { stored = await listItems(room.slug); }
  catch { return { imported: items.length, committed: true, unverified: true }; }
  return {
    committed: true,
    imported: stored.length,
    fingerprint: await fingerprint(room.list.fields, stored.map(i => i.fields)),
    /* For a file list, each stored file's SHA-256 in order, read back from
       the rows, so the caller can check every file against MRE Office's copy. */
    ...(holdsFiles ? { files: stored.map(i => i.file?.sha256 || "") } : {}),
  };
}

/* Small pieces of configuration a room needs, like the Directory's sheet
   address. Server-side only: nothing here is ever sent to a browser. */
export async function getSetting(key) {
  await ensureOfficeSchema();
  const rows = await sql`select value from office_settings where key = ${key}`;
  return rows[0]?.value ?? null;
}

export async function setSetting(key, value, actor) {
  await ensureOfficeSchema();
  await sql`
    insert into office_settings (key, value, updated_by) values (${key}, ${value}, ${actor})
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
}

/** Every stored item in a room with its id, for a sync to compare against. */
export async function roomRows(slug) {
  const room = listRoom(slug);
  await ensureOfficeSchema();
  const rows = await sql`select id, fields, file from office_items where room = ${room.slug} order by position, id`;
  return rows.map(shape);
}

/** The sql handle, for a sync that has to write several rooms' rows in one transaction. */
export function officeSql() { return sql; }

/* v179 (scan): the change log can never turn a saved change into an error.
   Written after the change, a failure here used to answer "Nothing was
   changed" for a change that was saved, and on an upload made the route
   delete the very file the card had just been pointed at. */
async function logChange(room, itemId, action, actor, before, after) {
  try { await writeLog(room, itemId, action, actor, before, after); }
  catch (e) { console.error("office change log failed:", String((e && e.message) || e).slice(0, 160)); }
}
async function writeLog(room, itemId, action, actor, before, after) {
  await sql`
    insert into office_changes (room, item_id, action, actor_email, before, after)
    values (${room}, ${itemId}, ${action}, ${actor},
            ${before === null ? null : JSON.stringify(before)}::jsonb,
            ${after === null ? null : JSON.stringify(after)}::jsonb)`;
}

const isId = id => typeof id === "string" && /^[1-9]\d{0,17}$/.test(id);

export class OfficeInputError extends Error {
  constructor(message, errors = {}, status = 400) { super(message); this.errors = errors; this.status = status; }
}

export async function createItem(slug, input, actor) {
  const room = listRoom(slug);
  if (room.list.files) throw new OfficeInputError("Add a file with the upload form.", {}, 400);
  const v = validateFields(room.list.fields, input);
  if (!v.ok) throw new OfficeInputError("Some fields need fixing.", v.errors);
  await ensureOfficeSchema();
  await seedIfNeeded(room);

  const count = await sql`select count(*)::int as n from office_items where room = ${room.slug}`;
  if ((count[0]?.n ?? 0) >= MAX_ITEMS_PER_ROOM) {
    throw new OfficeInputError(`This list already has ${MAX_ITEMS_PER_ROOM} items, which is the most it can hold.`);
  }
  /* v180 (scan): behind the same room lock as uploads and moves, so two adds
     at once can't share a place in the list or go past the limit. */
  const insert = sql`
    insert into office_items (room, position, fields, updated_by)
    select ${room.slug}, coalesce(max(position), 0) + 10, ${JSON.stringify(v.fields)}::jsonb, ${actor}
    from office_items where room = ${room.slug}
    having count(*) < ${MAX_ITEMS_PER_ROOM}::int
    returning id, fields`;
  const res = typeof sql.transaction === "function"
    ? await sql.transaction([sql`select pg_advisory_xact_lock(hashtext(${"office-room:" + room.slug}))`, insert])
    : [null, await insert];
  const rows = res[1] || [];
  if (!rows.length) throw new OfficeInputError(`This list already has ${MAX_ITEMS_PER_ROOM} items, which is the most it can hold.`, {}, 409);
  await logChange(room.slug, rows[0].id, "create", actor, null, v.fields);
  return shape(rows[0]);
}

/* v178 (scan): two people editing the same card. The second Save used to
   wipe the first person's change without a word (and the change log's
   "before" could be the wrong one). Now the browser sends the fields it
   started from (`base`); if the card has changed since, nothing is saved and
   the editor is told, with the list refreshed so they can see the change.
   The row is locked while it is compared and written, one statement. */
export const EDIT_CONFLICT = "Someone else changed this while you were editing, so your changes were not saved. The list now shows their version; open it again to make yours.";
export async function updateItem(slug, id, input, actor, { base = null } = {}) {
  const room = listRoom(slug);
  if (!isId(id)) throw new OfficeInputError("That item does not exist.", {}, 404);
  const v = validateFields(room.list.fields, input);
  if (!v.ok) throw new OfficeInputError("Some fields need fixing.", v.errors);
  await ensureOfficeSchema();

  const baseJson = base && typeof base === "object" && !Array.isArray(base) ? JSON.stringify(base) : null;
  const rows = await sql`
    with b as (select id, fields from office_items where room = ${room.slug} and id = ${id} for update)
    update office_items o
    set fields = ${JSON.stringify(v.fields)}::jsonb, updated_at = now(), updated_by = ${actor}
    from b
    where o.id = b.id and o.room = ${room.slug} and (${baseJson}::jsonb is null or b.fields = ${baseJson}::jsonb)
    returning o.id, o.fields, b.fields as before`;
  if (!rows.length) {
    const there = await sql`select 1 from office_items where room = ${room.slug} and id = ${id}`;
    if (there.length) throw new OfficeInputError(EDIT_CONFLICT, {}, 409);
    throw new OfficeInputError("That item does not exist.", {}, 404);
  }
  await logChange(room.slug, id, "update", actor, rows[0].before, v.fields);
  return shape(rows[0]);
}

/**
 * Add a file item: its fields, and the file the upload route has already put
 * in the store. If this throws, the route removes that file again.
 */
export async function addFileItem(slug, input, meta, actor) {
  const room = listRoom(slug);
  if (!room.list.files) throw new OfficeInputError("This list does not hold files.");
  const v = validateFields(room.list.fields, input);
  if (!v.ok) throw new OfficeInputError("Some fields need fixing.", v.errors);
  const file = cleanMeta(meta);
  if (!file) throw new Error("addFileItem: malformed file details");
  await ensureOfficeSchema();
  await seedIfNeeded(room);
  const count = await sql`select count(*)::int as n from office_items where room = ${room.slug}`;
  if ((count[0]?.n ?? 0) >= MAX_ITEMS_PER_ROOM) {
    throw new OfficeInputError(`This list already has ${MAX_ITEMS_PER_ROOM} items, which is the most it can hold.`);
  }
  /* A list that holds ONE file (Must Have Contacts' contact file) never gets
     a second: two rows at one old address would leave it answering neither. */
  if (room.list.files.single && (count[0]?.n ?? 0) >= 1) {
    throw new OfficeInputError("This list holds one file. Replace it instead of adding another.", {}, 409);
  }
  /* v178 (scan): two uploads at once both passed the count above. The insert
     now runs behind a lock on this room and only if the room is still under
     its limits (one file, for a one-file list), checked after the lock. */
  const single = Boolean(room.list.files.single);
  const limit = single ? 1 : MAX_ITEMS_PER_ROOM;
  const insert = sql`
    insert into office_items (room, position, fields, updated_by, file)
    select ${room.slug}, coalesce(max(position), 0) + 10, ${JSON.stringify(v.fields)}::jsonb, ${actor}, ${JSON.stringify(file)}::jsonb
    from office_items where room = ${room.slug}
    having count(*) < ${limit}::int
    returning id, fields, file`;
  const res = typeof sql.transaction === "function"
    ? await sql.transaction([sql`select pg_advisory_xact_lock(hashtext(${"office-room:" + room.slug}))`, insert])
    : [null, await insert];
  const rows = res[1] || [];
  if (!rows.length) {
    throw new OfficeInputError(single ? "This list holds one file. Replace it instead of adding another."
      : `This list already has ${MAX_ITEMS_PER_ROOM} items, which is the most it can hold.`, {}, 409);
  }
  await logChange(room.slug, rows[0].id, "create", actor, null, { ...v.fields, file: fileSummary(file) });
  return shape(rows[0]);
}

/**
 * Put a new file in place of an item's file, keeping the item, its name and
 * the old address it answers at (Must Have Contacts' contact file is replaced
 * every day, and phones find it at the same address). Returns the pathname
 * of the file it replaced, for the route to remove from the store.
 */
export async function replaceFileItem(slug, id, meta, actor) {
  const room = listRoom(slug);
  if (!room.list.files) throw new OfficeInputError("This list does not hold files.");
  if (!isId(id)) throw new OfficeInputError("That item does not exist.", {}, 404);
  await ensureOfficeSchema();
  const before = await sql`select id, fields, file from office_items where room = ${room.slug} and id = ${id}`;
  if (!before.length) throw new OfficeInputError("That item does not exist.", {}, 404);
  const old = cleanMeta(before[0].file);
  const file = cleanMeta({ ...meta, ...(old?.originPath ? { originPath: old.originPath } : {}) });
  if (!file) throw new Error("replaceFileItem: malformed file details");
  /* v179 (scan): the file being replaced is read in the same statement that
     replaces it, with the row locked. Two replaces at once (the daily
     automation and an admin) both read the same "old" file before, so the
     file from whichever lost stayed in the store with nothing pointing at it. */
  const { originPath: _o, ...fresh } = file;
  const rows = await sql`
    with b as (select id, file from office_items where room = ${room.slug} and id = ${id} for update)
    update office_items o
    set file = ${JSON.stringify(fresh)}::jsonb
               || case when b.file ? 'originPath' then jsonb_build_object('originPath', b.file -> 'originPath') else '{}'::jsonb end,
        updated_at = now(), updated_by = ${actor}
    from b where o.id = b.id and o.room = ${room.slug}
    returning o.id, o.fields, o.file, b.file as old_file`;
  if (!rows.length) throw new OfficeInputError("That item does not exist.", {}, 404);
  const replaced = cleanMeta(rows[0].old_file);
  const now = cleanMeta(rows[0].file) || file;
  await logChange(room.slug, id, "update", actor,
    { ...before[0].fields, file: fileSummary(replaced) }, { ...rows[0].fields, file: fileSummary(now) });
  return { item: shape(rows[0]), oldPathname: replaced && replaced.pathname !== now.pathname ? replaced.pathname : null };
}

/** The file item that MRE Office served at this old address, if any (for /wp-content/uploads/...). */
export async function fileByOriginPath(path) {
  if (typeof path !== "string" || !/^\/wp-content\/uploads\/[A-Za-z0-9_\-./]+$/.test(path) || path.includes("..") || path.length > 300) return null;
  await ensureOfficeSchema();
  const rows = await sql`
    select id, room, fields, file from office_items
    where file is not null and file ->> 'originPath' = ${path}
    order by id limit 2`;
  if (rows.length !== 1) return null;   // none, or (never expected) two: answer nothing rather than guess
  const file = cleanMeta(rows[0].file);
  return file ? { id: String(rows[0].id), room: rows[0].room, fields: rows[0].fields || {}, file } : null;
}

/** One file item, for the download route: its room key, name and where the file is kept. */
export async function fileItem(id) {
  if (!isId(id)) return null;
  await ensureOfficeSchema();
  const rows = await sql`select id, room, fields, file from office_items where id = ${id} and file is not null`;
  const r = rows[0];
  const file = r ? cleanMeta(r.file) : null;
  return r && file ? { id: String(r.id), room: r.room, fields: r.fields || {}, file } : null;
}

export async function deleteItem(slug, id, actor) {
  const room = listRoom(slug);
  if (!isId(id)) throw new OfficeInputError("That item does not exist.", {}, 404);
  await ensureOfficeSchema();
  const rows = await sql`
    delete from office_items where room = ${room.slug} and id = ${id}
    returning id, fields, file`;
  if (!rows.length) throw new OfficeInputError("That item does not exist.", {}, 404);
  const file = cleanMeta(rows[0].file);
  await logChange(room.slug, id, "delete", actor, file ? { ...rows[0].fields, file: fileSummary(file) } : rows[0].fields, null);
  /* The route removes the stored file AFTER the row is gone, so a failure
     there leaves an unused file in the store, never a card with no file. */
  return { id: String(rows[0].id), pathname: file?.pathname || null };
}

/**
 * Move one item up or down a place.
 * The whole room is renumbered 10, 20, 30... in one statement, rather than two
 * positions being swapped. A swap breaks on ties (two items at the same
 * position swap to the same position and nothing visibly moves), and a
 * renumber also heals any ties already there.
 */
export async function moveItem(slug, id, direction, actor, _tries = 0) {
  const room = listRoom(slug);
  if (!isId(id)) throw new OfficeInputError("That item does not exist.", {}, 404);
  if (direction !== "up" && direction !== "down") throw new OfficeInputError("Move up or down.");
  await ensureOfficeSchema();

  const rows = await sql`select id, fields from office_items where room = ${room.slug} order by position, id`;
  const ids = rows.map(r => String(r.id));
  const i = ids.indexOf(id);
  if (i < 0) throw new OfficeInputError("That item does not exist.", {}, 404);
  /* In a grouped room (Resources by category, GIS by state) "up" means up
     within its own group. Swapping with the neighbour from another group would
     change nothing anyone can see. */
  const g = room.list.groupBy;
  const sameGroup = k => !g || (rows[k].fields?.[g] ?? "") === (rows[i].fields?.[g] ?? "");
  let j = i;
  do { j += direction === "up" ? -1 : 1; } while (j >= 0 && j < ids.length && !sameGroup(j));
  if (j < 0 || j >= ids.length) return { moved: false };
  [ids[i], ids[j]] = [ids[j], ids[i]];

  const order = ids.map((x, k) => ({ id: Number(x), pos: (k + 1) * 10 }));
  /* v178 (scan): written only if the room is still in the order it was read
     in. Two quick moves (a double tap, or two admins) used to each renumber
     from the same old order, so one move was undone, and an item added in
     between kept a position that collided with the new numbering. If the
     order changed, this tries again from the fresh order (a few times). */
  const was = rows.map(r => String(r.id)).join(",");
  /* Behind a lock on this room, so the order check sees any move that
     finished a moment ago (one statement alone checks an older picture). */
  const renumber = sql`
    update office_items as o set position = v.pos
    from jsonb_to_recordset(${JSON.stringify(order)}::jsonb) as v(id bigint, pos int)
    where o.id = v.id and o.room = ${room.slug}
      and (select string_agg(id::text, ',' order by position, id) from office_items where room = ${room.slug}) = ${was}
    returning o.id`;
  const done = typeof sql.transaction === "function"
    ? (await sql.transaction([sql`select pg_advisory_xact_lock(hashtext(${"office-room:" + room.slug}))`, renumber]))[1] || []
    : await renumber;
  if (!done.length) {
    if ((_tries || 0) >= 3) throw new OfficeInputError("The list was changing as you moved that. Please try again.", {}, 409);
    return moveItem(slug, id, direction, actor, (_tries || 0) + 1);
  }
  await logChange(room.slug, id, "move", actor, { index: i }, { index: j });
  return { moved: true };
}
