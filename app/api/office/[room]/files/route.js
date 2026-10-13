/* Add a file to a moved MRE Office list that holds files (MLS Info's rule books).
 *   POST multipart/form-data: name (text), file (a PDF)
 * Admins and leadership only (see canEditRoom). Returns the whole list.
 *
 * The same locks as every other write (same origin, signed in, allowed to
 * edit this list), with two differences because a file is not JSON:
 *   - the body is a form upload, capped by its declared size BEFORE it is read
 *     and by its real size after
 *   - the file must really be a kind the list allows (its bytes, not its
 *     name): a PDF, or a contact file for Must Have Contacts, under the cap
 * A list that holds ONE file (Must Have Contacts' contact file) replaces that
 * file in place: same item, same old address, so every phone and the QR code
 * keep finding it. Only the newly stored file is new; the old one is removed
 * after the row points at the new one.
 * The file goes into the private store first and the row second. If the row
 * cannot be written, the file is removed again.
 */
import { currentUser } from "../../../../../lib/session.js";
import { guardWrite, respondWithList, respondError, NOSTORE } from "../../../../../lib/office-api.js";
import { addFileItem, replaceFileItem, listItems, OfficeInputError } from "../../../../../lib/office-store.js";
import { fileProblem, blobPathFor, sha256Hex, kindOfBytes, fileSizeLabel } from "../../../../../lib/office-files.js";
import { blobReady, storeFile, removeFiles } from "../../../../../lib/office-blob.js";

export const dynamic = "force-dynamic";

/* Room for the form's own framing on top of the largest file allowed. */
const FORM_OVERHEAD = 64 * 1024;
const json = (body, status) => Response.json(body, { status, headers: NOSTORE });

export async function POST(req, { params }) {
  const { room: slug } = await params;
  const user = await currentUser();
  const room = guardWrite(req, user, slug);
  if (room instanceof Response) return room;
  if (!room.list.files) return json({ error: "This list does not hold files." }, 404);

  const cap = room.list.files.maxBytes;
  if (!/^multipart\/form-data\b/i.test(req.headers.get("content-type") || "")) {
    return json({ error: "Send the file as a form upload." }, 415);
  }
  if (Number(req.headers.get("content-length") || 0) > cap + FORM_OVERHEAD) {
    return json({ error: `That file is too big. The most a file can be is ${fileSizeLabel(cap)}.` }, 413);
  }
  if (!blobReady()) return json({ error: "Jarvis's file store is not connected yet, so files can't be added." }, 503);

  let stored = null;
  try {
    let form;
    try { form = await req.formData(); }
    catch { throw new OfficeInputError("That upload could not be read. Try again.", {}, 400); }
    const file = form.get("file");
    const name = form.get("name");
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      throw new OfficeInputError("Choose a file to upload.", { file: "Choose a file to upload." });
    }
    if (typeof name !== "string") throw new OfficeInputError("Give the file a name.", { name: "Name is required." });
    if (file.size > cap) throw new OfficeInputError("That file is too big.", { file: fileProblem(room.list.files, { length: file.size }) });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const problem = fileProblem(room.list.files, bytes);
    if (problem) throw new OfficeInputError(problem, { file: problem });

    const type = kindOfBytes(room.list.files, bytes);
    const existing = room.list.files.single ? (await listItems(room.slug))[0] : null;
    const pathname = await storeFile(blobPathFor(room.parent || room.slug, existing?.fields?.name || name, type), bytes, type);
    stored = pathname;
    const meta = { pathname, size: bytes.length, sha256: await sha256Hex(bytes), type };
    if (existing) {
      const { item, oldPathname } = await replaceFileItem(room.slug, existing.id, meta, user.email);
      stored = null;      // the card points at it now: never removed below
      if (oldPathname) await removeFiles([oldPathname]);
      return await respondWithList(room.slug, { replaced: item.id });
    }
    /* v179 (scan): every field the list declares, not only the name. Listing
       SOP and Approved scripts require a category, and with only the name
       sent every upload there was refused ("Category is required"). */
    const input = { name };
    for (const f of room.list.fields || []) {
      if (f.key === "name") continue;
      const v = form.get(f.key);
      if (typeof v === "string") input[f.key] = v;
    }
    const item = await addFileItem(room.slug, input,
      { ...meta, ...(room.list.files.publicPath ? { originPath: room.list.files.publicPath } : {}) }, user.email);
    stored = null;
    return await respondWithList(room.slug, { created: item.id });
  } catch (e) {
    if (stored) await removeFiles([stored]);
    return respondError(e);
  }
}
