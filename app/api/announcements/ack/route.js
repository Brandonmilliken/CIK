/* Acknowledge an announcement (v127). See lib/announcement-acks.js.
 *
 *   POST { id }   any signed-in person, from Jarvis itself: "I've read this"
 *
 * WHO is always the signed-in session, never anything in the request, so no
 * one can acknowledge on someone else's behalf. The id must be a real
 * announcement in the Announcements room. There is no way to undo it here:
 * the record only grows.
 */
import { currentUser } from "../../../../lib/session.js";
import { sameOrigin } from "../../../../lib/office-api.js";
import { listItems } from "../../../../lib/office-store.js";
import { acknowledge } from "../../../../lib/announcement-acks.js";

export const dynamic = "force-dynamic";
const NOSTORE = { "Cache-Control": "private, no-store" };
const json = (b, s = 200) => Response.json(b, { status: s, headers: NOSTORE });
const MAX_BYTES = 512;

async function body(req) {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") || "")) return null;
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) return null;
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return null;
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; }
}

export async function POST(req) {
  const user = await currentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (!sameOrigin(req)) return json({ error: "Writes must come from Jarvis itself." }, 403);
  const b = await body(req);
  const id = b && typeof b.id === "string" && /^\d{1,18}$/.test(b.id) ? b.id : null;
  if (!id) return json({ error: "send { id }" }, 400);
  try {
    const items = await listItems("announcements");
    /* v181 (scan): only one that is showing (a hidden draft could be
       acknowledged ahead of time, and its banner then skipped). */
    if (!items.some(i => String(i.id) === id && i.fields?.show !== "No" && i.fields?.title)) return json({ error: "no such announcement" }, 404);
    const added = await acknowledge(id, user.email, user.displayName || user.email);
    return json({ ok: true, added });
  } catch {
    return json({ ok: false }, 503);
  }
}
