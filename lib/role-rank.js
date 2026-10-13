/* v181 (scan): the role ladder and the "Viewing as" preview rules, on their
 * own so the BROWSER can use them (the menu, the settings sheet) without
 * pulling in lib/authz.js, whose super-admin list was ending up in the code
 * every signed-in browser downloads. lib/authz.js re-exports these; on the
 * server, nothing changes. Nothing here may name a person.
 */
export const RANK = Object.freeze({ agent: 0, admin: 2, leadership: 3, superadmin: 4 });

export function atLeast(role, min) {
  return (RANK[role] ?? -1) >= (RANK[min] ?? 99);
}

/* v147 (Jordan, 2026-10-05): "Viewing as: Owner / Manager / Member".
   Leadership and the super admins can look at the whole of Jarvis the way a
   manager (admin) or a member (agent) sees it: the menu, the rooms, the
   dashboard and every answer from the server. It is a preview that can only
   ever LOWER what someone sees, never raise it, so the cookie it rides on
   needs no protecting: anyone who sets it by hand only hides things from
   themselves. "Owner" is simply no preview. */
export const PREVIEW_COOKIE = "jx_preview";
export const PREVIEW_ROLES = Object.freeze(["admin", "agent"]);
export function canPreviewRoles(role) {
  return atLeast(role, "leadership");
}
/** The role to show `realRole` as, or null for none (a bad, higher or equal ask is no preview). */
export function previewRoleFor(realRole, asked) {
  if (!canPreviewRoles(realRole) || !PREVIEW_ROLES.includes(asked)) return null;
  return (RANK[asked] ?? 99) < (RANK[realRole] ?? -1) ? asked : null;
}
