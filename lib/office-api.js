/* The checks every write to a moved MRE Office room makes, in the order it
 * makes them. The route files call these; each route ALSO calls currentUser()
 * itself, so routeauth.test.mjs can see the session check in the file.
 */
import { listTarget, canEditRoom, canSeeRoom } from "./office-rooms.js";
import { OfficeInputError, listItems } from "./office-store.js";

export const NOSTORE = { "Cache-Control": "private, no-store" };
/* One item. Meeting notes can run to 10,000 characters, which is up to 40KB
   of UTF-8 in the worst case, so the cap sits above that. */
export const MAX_BODY_BYTES = 128 * 1024;   // v180: an edit carries the card twice (its fields and the version it started from)

const json = (body, status = 200) => Response.json(body, { status, headers: NOSTORE });

/* Same-origin only. The session cookie is SameSite=Lax, which already keeps a
   cross-site form POST from carrying it. This is the second lock on the same
   door: a write must say it came from this site, and must be JSON, which a
   plain HTML form cannot send. */
export function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let o;
  try { o = new URL(origin); } catch { return false; }
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || new URL(req.url).host;
  return o.host === host;
}

/* The size cap is checked BEFORE the body is read, then again in real bytes.
   That is the lesson from the webhook: a cap that runs after buffering caps
   nothing, and String.length counts UTF-16 units, not bytes. */
export async function readJson(req) {
  const type = req.headers.get("content-type") || "";
  if (!/^application\/json\b/i.test(type)) throw new OfficeInputError("Send JSON.", {}, 415);
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw new OfficeInputError("That is too much text for one item.", {}, 413);
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BODY_BYTES) throw new OfficeInputError("That is too much text for one item.", {}, 413);
  try { return JSON.parse(new TextDecoder().decode(buf)); }
  catch { throw new OfficeInputError("That request was not valid JSON.", {}, 400); }
}

/**
 * Everything short of the session check, for a write to `slug` by `user`.
 * Returns the room, or a Response to send back instead.
 */
export function guardWrite(req, user, slug) {
  if (!sameOrigin(req)) return json({ error: "Writes must come from Jarvis itself." }, 403);
  if (!user) return json({ error: "unauthenticated" }, 401);
  const room = listTarget(slug);
  /* A room the viewer cannot see, or that has not moved, is simply not here.
     Only after that does "you may look but not edit" get its own answer. */
  /* v181 (scan): including a room this person can't see (it said 403,
     which told an agent the admin rooms exist). */
  if (!room || room.where !== "jarvis" || !room.list || !canSeeRoom(room, user.role)) return json({ error: "not found" }, 404);
  if (!canEditRoom(room, user.role)) {
    return json({ error: "Only admins and leadership can change this list." }, 403);
  }
  return room;
}

/** After a write, send the whole list back, so the page shows what is actually stored. */
export async function respondWithList(slug, extra = {}) {
  /* v181 (scan): the change is already saved when this runs. A failure
     reading the list back must not say "nothing was changed" (they'd save
     it again, and get a duplicate); the page reloads the list instead. */
  let items = null;
  try { items = await listItems(slug); }
  catch (e) { console.error("list after save failed:", String((e && e.message) || e).slice(0, 200)); }
  return json({ ok: true, ...extra, items, ...(items ? {} : { reload: true }) });
}

export async function respondError(e, slug = null) {
  /* v178: a 409 (someone else changed it) also sends the list as it is now,
     so the page shows their change instead of the stale card. */
  /* v179: and a 404 (someone deleted it meanwhile), so the page drops it. */
  if (e instanceof OfficeInputError && (e.status === 409 || e.status === 404) && slug) {
    const items = await listItems(slug).catch(() => null);
    return json({ error: e.message, errors: e.errors, ...(items ? { items } : {}) }, e.status);
  }
  if (e instanceof OfficeInputError) return json({ error: e.message, errors: e.errors }, e.status);
  console.error("office write failed:", e);
  return json({ error: "Something went wrong saving that. Nothing was changed." }, 500);
}
