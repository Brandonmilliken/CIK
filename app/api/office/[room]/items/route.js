/* Add an item to a moved MRE Office list.  POST { fields: {...} }
 * Admins and leadership only (see canEditRoom). Returns the whole list.
 */
import { currentUser } from "../../../../../lib/session.js";
import { guardWrite, readJson, respondWithList, respondError } from "../../../../../lib/office-api.js";
import { createItem } from "../../../../../lib/office-store.js";

export const dynamic = "force-dynamic";

export async function POST(req, { params }) {
  const { room: slug } = await params;
  const user = await currentUser();
  const room = guardWrite(req, user, slug);
  if (room instanceof Response) return room;
  try {
    const body = await readJson(req);
    const item = await createItem(room.slug, body?.fields, user.email);
    return await respondWithList(room.slug, { created: item.id });
  } catch (e) {
    return respondError(e);
  }
}
