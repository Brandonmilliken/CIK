/* Settings that follow the person (v133). See lib/user-prefs.js.
 *
 *   GET                     signed in: { theme, collapsed, tab } (null when never set)
 *   POST { theme }          signed in, from Jarvis itself: save the theme
 *   POST { collapsed: [...] }   v141: save which dashboard sections are collapsed
 *   POST { tab }            v147: save the dashboard tab they are on
 *
 * Whose setting it is always comes from the signed-in session.
 */
import { currentUser } from "../../../lib/session.js";
import { sameOrigin } from "../../../lib/office-api.js";
import { getThemeOrThrow, setTheme, cleanTheme, setCollapsed, cleanCollapsed, setTab, cleanTab, getDashPrefs } from "../../../lib/user-prefs.js";

export const dynamic = "force-dynamic";
const NOSTORE = { "Cache-Control": "private, no-store" };
const json = (b, s = 200) => Response.json(b, { status: s, headers: NOSTORE });
const MAX_BYTES = 4096;

async function body(req) {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") || "")) return null;
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) return null;
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return null;
  /* v179 (scan): an object only; `"dark"` or `1` threw below (a 500). */
  try { const v = JSON.parse(new TextDecoder().decode(buf)); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  /* v179 (scan): a failed read is a 503, never "nothing saved" (the page
     would then save this browser's copy over the account's). */
  let theme, dash;
  try { [theme, dash] = await Promise.all([getThemeOrThrow(user.email), getDashPrefs(user.email)]); }
  catch { return json({ error: "Couldn't read your settings right now." }, 503); }
  if (dash === null) return json({ error: "Couldn't read your settings right now." }, 503);
  return json({ theme, collapsed: dash.collapsed, tab: dash.tab });
}

export async function POST(req) {
  const user = await currentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (!sameOrigin(req)) return json({ error: "Changes must come from Jarvis itself." }, 403);
  const b = await body(req);
  const theme = b && cleanTheme(b.theme);
  const collapsed = b && "collapsed" in b ? cleanCollapsed(b.collapsed) : null;
  const tab = b && cleanTab(b.tab);
  if (!theme && !collapsed && !tab) return json({ error: "send { theme: \"dark\" | \"light\" }, { collapsed: [section ids] } or { tab }" }, 400);
  try {
    const out = { ok: true };
    if (theme) out.theme = await setTheme(user.email, theme);
    if (collapsed) out.collapsed = await setCollapsed(user.email, collapsed);
    if (tab) out.tab = await setTab(user.email, tab);
    return json(out);
  } catch { return json({ error: "Couldn't save that right now." }, 503); }
}
