/* Leadership Settings (v131): change who is an admin or in leadership.
 * See lib/roles.js for every rule.
 *
 *   GET                                   leadership: everyone and their role, and recent changes
 *   POST { email, role }                  leadership, from Jarvis itself: change one person's role
 *   POST { email, role, add: true, firstName, lastName }   the same, adding someone not on the roster
 *   POST { email, left: true | false }    v180: mark someone added by hand as left, or bring them back
 *   POST { email, remove: true }          cik-v11: take someone marked as left off the list
 *   POST { clearHistory: true }           cik-v12: SUPER ADMINS ONLY, empty Recent changes
 *
 * Who is making the change always comes from the signed-in session.
 */
import { currentUser } from "../../../lib/session.js";
import { atLeast } from "../../../lib/authz.js";
import { sameOrigin } from "../../../lib/office-api.js";
import { listPeople, recentChanges, setRole, setLeft, removePerson, clearHistory, RoleError } from "../../../lib/roles.js";

export const dynamic = "force-dynamic";
const NOSTORE = { "Cache-Control": "private, no-store" };
const json = (b, s = 200) => Response.json(b, { status: s, headers: NOSTORE });
const MAX_BYTES = 1024;

async function body(req) {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") || "")) return null;
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) return null;
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return null;
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; }
}

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (!atLeast(user.role, "leadership")) return json({ error: "not found" }, 404);
  try { return json({ people: await listPeople(), changes: await recentChanges() }); }
  catch { return json({ error: "unavailable" }, 503); }
}

export async function POST(req) {
  const user = await currentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (!sameOrigin(req)) return json({ error: "Changes must come from Jarvis itself." }, 403);
  if (!atLeast(user.role, "leadership")) return json({ error: "not found" }, 404);
  /* v181 (scan): demo mode is for looking, not changing who can do what
     (those changes outlived it). */
  if (user.demo) return json({ error: "Role changes are off in demo mode." }, 403);
  const b = await body(req);
  if (b && b.clearHistory === true) {
    try {
      const out = await clearHistory({ actorEmail: user.email });
      return json({ ok: true, ...out, people: await listPeople(), changes: await recentChanges() });
    } catch (e) {
      if (e instanceof RoleError) return json({ error: e.message }, e.status);
      return json({ error: "That didn't go through. Nothing was changed." }, 503);
    }
  }
  if (b && typeof b.email === "string" && b.remove === true) {
    try {
      const out = await removePerson({ actorEmail: user.email, email: b.email });
      return json({ ok: true, ...out, people: await listPeople(), changes: await recentChanges() });
    } catch (e) {
      if (e instanceof RoleError) return json({ error: e.message }, e.status);
      return json({ error: "That didn't go through. Nothing was changed." }, 503);
    }
  }
  if (b && typeof b.email === "string" && typeof b.left === "boolean") {
    try {
      const out = await setLeft({ actorEmail: user.email, email: b.email, left: b.left });
      return json({ ok: true, ...out, people: await listPeople(), changes: await recentChanges() });
    } catch (e) {
      if (e instanceof RoleError) return json({ error: e.message }, e.status);
      return json({ error: "That didn't go through. Nothing was changed." }, 503);
    }
  }
  if (!b || typeof b.email !== "string" || typeof b.role !== "string") return json({ error: "send { email, role }" }, 400);
  try {
    const out = await setRole({
      actorEmail: user.email, email: b.email, role: b.role,
      add: b.add === true, firstName: typeof b.firstName === "string" ? b.firstName : "",
      lastName: typeof b.lastName === "string" ? b.lastName : "",
    });
    return json({ ok: true, ...out, people: await listPeople(), changes: await recentChanges() });
  } catch (e) {
    if (e instanceof RoleError) return json({ error: e.message }, e.status);
    return json({ error: "That didn't go through. Nothing was changed." }, 503);
  }
}
