/* Who is asking.
 *
 * Normally: the verified Google session.
 *
 * DEMO MODE. Setting JARVIS_DEMO_EMAIL makes the app treat that address as the
 * signed-in user and skips Google entirely. It exists so the dashboard can be
 * shown on a real domain before the Workspace tenancy question is settled and
 * the OAuth client exists.
 *
 * It is a deliberate hole, so it is built to be a loud one:
 *   - It only happens if someone sets the variable by hand. Nothing turns it on
 *     by accident, and no default enables it.
 *   - The identity is a REAL agent row, so authorization still applies exactly
 *     as it will in production — this is not a bypass of the permission model,
 *     only of the login.
 *   - The page says so on screen, in a banner nobody can miss.
 *   - Deleting the variable restores Google sign-in with no other change.
 *
 * While it is set, Vercel Deployment Protection is the ONLY thing standing
 * between the open internet and real client data. Turn it on first.
 *
 * v147: "Viewing as" (lib/authz.js previewRoleFor). For leadership and the
 * super admins, a jx_preview cookie of "admin" or "agent" makes `role` that
 * lower role everywhere: every page and every API answer then treats them as
 * a manager or a member. `realRole` keeps what they really are, so the switch
 * itself (and leadership's "View as" an agent) never disappears.
 */
import { cookies } from "next/headers";
import { cache } from "react";
import { auth } from "../auth.js";
import { agentByEmail } from "./db.js";
import { effectiveRole, previewRoleFor, PREVIEW_COOKIE } from "./authz.js";

/** The preview asked for in this request's cookie, if any. Never throws. */
async function askedPreview() {
  try {
    const jar = await cookies();
    return jar.get(PREVIEW_COOKIE)?.value || null;
  } catch {
    return null;              // not inside a request (a script, a cron job): no preview
  }
}

/** Apply a preview to a signed-in user: only ever lower. */
export function withPreview(user, asked) {
  if (!user) return user;
  const preview = previewRoleFor(user.role, asked);
  return { ...user, realRole: user.role, role: preview || user.role, preview };
}

/* v179 (scan): once per request. The layout, the page and its parts each
   asked, and each ask can mean a database lookup for the role. */
export const currentUser = cache(async function currentUser() {
  const demo = (process.env.JARVIS_DEMO_EMAIL || "").trim().toLowerCase();

  if (demo) {
    const agent = await agentByEmail(demo).catch(() => null);
    return withPreview({
      email: demo,
      displayName: agent
        ? [agent.first_name, agent.last_name].filter(Boolean).join(" ") || demo
        : demo,
      // Fall back to the LEAST privilege if the roster has not synced yet, so a
      // typo'd address cannot accidentally hand someone the leadership view.
      role: effectiveRole(demo, agent?.role || "agent"),
      sisuAgentId: agent?.sisu_agent_id ?? null,
      demo: true,
    }, await askedPreview());
  }

  const s = await auth();
  if (!s?.user?.email) return null;
  return withPreview({
    email: s.user.email,
    displayName: s.user.displayName || s.user.email,
    role: s.user.role || "agent",
    sisuAgentId: s.user.sisuAgentId ?? null,
    demo: false,
  }, await askedPreview());
});

export function demoMode() {
  return Boolean((process.env.JARVIS_DEMO_EMAIL || "").trim());
}
