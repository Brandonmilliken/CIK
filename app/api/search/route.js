/* Jarvis search (v146). See lib/search.js.
 *
 *   GET ?q=words     signed in: items in the rooms this person may open
 *
 * Read only. Who is asking, and so which rooms are searched, comes from the
 * signed-in session.
 */
import { currentUser } from "../../../lib/session.js";
import { searchItems, cleanQuery } from "../../../lib/search.js";

export const dynamic = "force-dynamic";
const NOSTORE = { "Cache-Control": "private, no-store" };
const json = (b, s = 200) => Response.json(b, { status: s, headers: NOSTORE });

export async function GET(req) {
  const user = await currentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  const q = cleanQuery(new URL(req.url).searchParams.get("q"));
  if (!q) return json({ items: [] });
  try { return json({ items: await searchItems(q, user.role) }); }
  catch { return json({ error: "Search isn't available right now." }, 503); }
}
