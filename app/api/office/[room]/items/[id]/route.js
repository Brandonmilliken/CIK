/* Change, move or delete one item in a moved MRE Office list.
 *   PATCH  { fields: {...} }      replace the item's fields
 *   PATCH  { move: "up"|"down" }  move it one place
 *   DELETE                        remove it
 * Admins and leadership only (see canEditRoom). Every one returns the whole list.
 */
import { currentUser } from "../../../../../../lib/session.js";
import { guardWrite, readJson, respondWithList, respondError } from "../../../../../../lib/office-api.js";
import { updateItem, moveItem, deleteItem, OfficeInputError } from "../../../../../../lib/office-store.js";
import { removeFiles } from "../../../../../../lib/office-blob.js";

export const dynamic = "force-dynamic";

export async function PATCH(req, { params }) {
  const { room: slug, id } = await params;
  const user = await currentUser();
  const room = guardWrite(req, user, slug);
  if (room instanceof Response) return room;
  try {
    const body = await readJson(req);
    if (body && typeof body.move === "string") {
      await moveItem(room.slug, id, body.move, user.email);
    } else if (body && body.fields && typeof body.fields === "object") {
      /* v178: `base` is the card as the editor first saw it (see updateItem). */
      await updateItem(room.slug, id, body.fields, user.email, { base: body.base && typeof body.base === "object" ? body.base : null });
    } else {
      throw new OfficeInputError("Nothing to change.");
    }
    return await respondWithList(room.slug);
  } catch (e) {
    return respondError(e, room.slug);
  }
}

export async function DELETE(req, { params }) {
  const { room: slug, id } = await params;
  const user = await currentUser();
  const room = guardWrite(req, user, slug);
  if (room instanceof Response) return room;
  try {
    const gone = await deleteItem(room.slug, id, user.email);
    /* A file item's file goes too, after its row. If the store is down, the
       card is still gone and the unused file is logged, not left on the page. */
    if (gone.pathname) await removeFiles([gone.pathname]);
    return await respondWithList(room.slug);
  } catch (e) {
    return respondError(e, room.slug);
  }
}
