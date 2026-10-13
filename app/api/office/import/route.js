/* The one-time copy of a CIK Office room into this app.
 *
 * Called ONCE per room, from a signed-in admin's cikoffice.com tab. That
 * page reads the room with its own WordPress session and posts the items here,
 * so the data goes straight from CIK Office to the new app. It never passes through
 * a file, a chat, or anyone's clipboard, and every link keeps its exact query
 * string.
 *
 * Why a cross-origin endpoint is acceptable here, and how it is fenced:
 *   - only CIK Office (WordPress, at the bare https://cikoffice.com) may call
 *     it. Every other Origin, and a missing one, is refused
 *   - cikoffice.com and www.cikoffice.com (this app) are the same SITE, so
 *     the session cookie (SameSite=Lax) travels with the request. This is why
 *     the app must be live at www.cikoffice.com before the import runs. The
 *     caller must be signed in here as admin or leadership, exactly as for
 *     any other write
 *   - it only fills a room that is declared as importing AND has never been
 *     filled. Run twice, the second run is refused and changes nothing
 *   - all or nothing: one bad item and nothing is imported
 *   - it returns a fingerprint of what it stored, so the caller can prove the
 *     copy is exact
 *
 * FILES (v89). For a list that holds files ("mls-info~files"), each item says
 * where MRE Office serves its file. Jarvis downloads each one ITSELF, from
 * www.mreoffice.com's uploads folder only, checks it is a real PDF under the
 * cap, and keeps it in the private file store. Only then are the rows written.
 * If anything fails, every file this run stored is removed again, so a failed
 * run leaves nothing behind. The answer lists each stored file's SHA-256, and
 * the browser script checks them against its own copies.
 */
import { currentUser } from "../../../../lib/session.js";
import { listTarget, canImportRoom } from "../../../../lib/office-rooms.js";
import { importItems, roomState, OfficeInputError } from "../../../../lib/office-store.js";
import { downloadImportFile, blobPathFor, originPathOf } from "../../../../lib/office-files.js";
import { blobReady, storeFile, removeFiles } from "../../../../lib/office-blob.js";

export const dynamic = "force-dynamic";
/* Copying a room's files means downloading and storing each one. */
export const maxDuration = 60;
const MAX_IMPORT_FILES = 50;

/* Run fn over items, at most `limit` at once. Rejects on the first failure,
   after the ones already started have settled. */
async function eachLimited(items, limit, fn) {
  let next = 0, failure = null;
  const worker = async () => {
    while (next < items.length && !failure) {
      const i = next++;
      try { await fn(items[i], i); } catch (e) { failure ??= e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw failure;
}

const IMPORT_ORIGINS = ["https://cikoffice.com"];   // www.cikoffice.com is this app itself
const allowedOrigin = req => {
  const o = req.headers.get("origin");
  return IMPORT_ORIGINS.includes(o) ? o : null;
};
const MAX_IMPORT_BYTES = 256 * 1024;

function cors(req) {
  const origin = allowedOrigin(req);
  return origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin",
        "Cache-Control": "private, no-store",
      }
    : { "Vary": "Origin", "Cache-Control": "private, no-store" };
}

const reply = (req, body, status = 200) => Response.json(body, { status, headers: cors(req) });

export async function OPTIONS(req) {
  // The preflight carries no cookie and changes nothing. It only tells the
  // browser which single origin may make the real request.
  return new Response(null, { status: allowedOrigin(req) ? 204 : 403, headers: cors(req) });
}

export async function POST(req) {
  if (!allowedOrigin(req)) {
    return reply(req, { error: "The import can only be run from cikoffice.com." }, 403);
  }
  const user = await currentUser();
  if (!user) return reply(req, { error: "Sign in to the new CIK Office first, in this same browser." }, 401);

  if (!/^application\/json\b/i.test(req.headers.get("content-type") || "")) {
    return reply(req, { error: "Send JSON." }, 415);
  }
  if (Number(req.headers.get("content-length") || 0) > MAX_IMPORT_BYTES) {
    return reply(req, { error: "That is too much for one room." }, 413);
  }
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_IMPORT_BYTES) return reply(req, { error: "That is too much for one room." }, 413);
  let body;
  try { body = JSON.parse(new TextDecoder().decode(buf)); }
  catch { return reply(req, { error: "That was not valid JSON." }, 400); }

  const room = listTarget(typeof body?.room === "string" ? body.room : "");
  if (!room || room.where !== "jarvis" || !room.list) return reply(req, { error: "not found" }, 404);
  if (!canImportRoom(room, user.role)) {
    return reply(req, { error: "Only admins and leadership can import a room." }, 403);
  }

  let metas = null;
  try {
    if (room.list.files) {
      if (!blobReady()) return reply(req, { error: "The file store is not connected yet. Nothing was imported." }, 503);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length || items.length > MAX_IMPORT_FILES) {
        return reply(req, { error: `Send between 1 and ${MAX_IMPORT_FILES} files.` }, 400);
      }
      /* Refuse a second run BEFORE downloading anything. importItems checks
         again inside, which is the check that counts. */
      if ((await roomState(room.slug)).imported) {
        return reply(req, { error: `${room.label} has already been copied from CIK Office.` }, 409);
      }
      /* Download every file first, so one bad file stops the run before
         anything is stored. */
      /* Four at a time, so a room of two dozen scripts finishes well inside
         the time limit. The order is kept by index, not by who finished first. */
      const got = new Array(items.length);
      let bad = null;
      await eachLimited(items, 4, async (it, i) => {
        if (bad) return;
        try { got[i] = await downloadImportFile(it?.source, room.list.files); }
        catch (e) { bad ??= { index: i, originId: it?.originId, field: "source", error: e.message }; }
      });
      if (bad) return reply(req, { error: "Nothing was imported.", errors: { problems: [bad] } }, 400);
      metas = [];
      const folder = room.parent || room.slug;
      await eachLimited(items, 4, async (it, i) => {
        const pathname = await storeFile(blobPathFor(folder, it?.fields?.name, got[i].type), got[i].bytes, got[i].type);
        metas[i] = { pathname, size: got[i].bytes.length, sha256: got[i].sha256, type: got[i].type, originPath: originPathOf(it.source) };
      }).catch(e => { metas = metas.filter(Boolean); throw e; });
    }
    const result = await importItems(room.slug, body.items, user.email, metas);
    /* v179 (scan): saved: from here nothing removes these files, and a
       setting that fails to save is reported as just that. */
    metas = null;
    return reply(req, { ok: true, room: room.slug, ...result });
  } catch (e) {
    /* A failed run keeps none of the files it stored. */
    if (metas?.length) await removeFiles(metas.map(m => m.pathname));
    if (e instanceof OfficeInputError) return reply(req, { error: e.message, errors: e.errors }, e.status);
    console.error("office import failed:", e);
    return reply(req, { error: "The import failed. Nothing was imported." }, 500);
  }
}
