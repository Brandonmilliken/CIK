/* Open one file kept in a moved MRE Office room.   GET /api/office/file/<id>
 *
 * The file store is private, so this is the ONLY way to a file, and it checks,
 * right here next to the read (not in middleware):
 *   1. someone is signed in. If not, they are sent to sign in first
 *   2. the file belongs to a room that has moved, and this person may see it.
 *      A file in a room they may not open answers exactly like a missing one
 * Then the file is streamed with its type fixed by what it is (PDF, or a
 * contact file for Must Have Contacts; never whatever the store says), "nosniff", and
 * "private, no-cache", so a shared computer or proxy never keeps a copy for
 * someone else, while the browser can still reuse its own copy (304).
 */
import { currentUser } from "../../../../../lib/session.js";
import { listTarget, canSeeRoom } from "../../../../../lib/office-rooms.js";
import { fileItem } from "../../../../../lib/office-store.js";
import { readFile } from "../../../../../lib/office-blob.js";
import { contentDisposition, kindInfo } from "../../../../../lib/office-files.js";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain" } });

export async function GET(req, { params }) {
  const user = await currentUser();
  const { id } = await params;
  /* v181 (scan): back to the file after signing in. */
  if (!user) return Response.redirect(new URL(/^\d{1,18}$/.test(String(id || "")) ? `/signin?next=${encodeURIComponent("/api/office/file/" + id)}` : "/signin", req.url), 303);

  let item;
  try { item = await fileItem(id); }
  catch (e) { console.error("office file lookup failed:", e); return new Response("Jarvis couldn't find that file just now. Try again.", { status: 500 }); }
  const room = item ? listTarget(item.room) : null;
  if (!item || !room || room.where !== "jarvis" || !room.list?.files || !canSeeRoom(room, user.role)) return notFound();

  let got;
  try { got = await readFile(item.file.pathname, req.headers.get("if-none-match") || undefined); }
  catch (e) { console.error("office file read failed:", e?.message || e); return new Response("Jarvis couldn't open that file just now. Try again.", { status: 502 }); }
  if (!got) return notFound();

  const headers = {
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    ...(got.blob?.etag ? { ETag: got.blob.etag } : {}),
  };
  if (got.statusCode === 304) return new Response(null, { status: 304, headers });
  return new Response(got.stream, {
    headers: {
      ...headers,
      "Content-Type": kindInfo(item.file.type).serveAs,
      "Content-Disposition": contentDisposition(item.fields?.name, item.file.type, room.list.files.downloadName || null),
      ...(got.blob?.size ? { "Content-Length": String(got.blob.size) } : {}),
    },
  });
}
