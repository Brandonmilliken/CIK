/* Authorization.
 *
 * Authentication says who someone is. This says what they may see, and it is
 * the part that carries the risk: the moment an agent can see their own income
 * they are one bug away from seeing everyone's.
 *
 * Two rules, both of which this file exists to enforce:
 *
 *   1. It runs SERVER-SIDE ONLY. If the filtering happens in the browser the
 *      data was already sent, and anyone can read it in the network tab.
 *   2. It is PER-FIELD, not per-record. A units leaderboard is public by
 *      design — it drives healthy competition and AgentOS publishes one. GCI
 *      and paid income are not. So the same leaderboard row is returned with
 *      different columns depending on who asked.
 *
 * Retrofitting field-level rules onto a record-level design is painful, which
 * is why this is here on day one rather than later.
 */


/**
 * One way to compare an email address, used everywhere an identity is matched.
 *
 * Lowercased AND trimmed. It was only lowercased, and the trim is not
 * hypothetical tidiness: agent_email on the deal board comes from Sisu, and a
 * stored " andy@matinrealestate.com" with one stray space did not match
 * andy@matinrealestate.com. The failure is quiet and in the shape nobody
 * checks — Andy's own deal simply is not on his board, brokers still see it,
 * and no error is raised anywhere.
 *
 * Null, undefined and non-strings collapse to "", which matches nothing. That
 * matters more than it looks: if "" matched "", every row with no owner
 * recorded would belong to every viewer with no email.
 */
export function normEmail(v) {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/* v135 (Brandon, 2026-10-01): "broker" is retired. It never gave anyone more
   than an agent had, so it was only confusing. Anyone still stored as a
   broker is treated as an agent (effectiveRole below), and it can no longer
   be picked. */
export const ROLES = ["agent", "admin", "leadership"];

/* THE SUPER ADMINS (from Jarvis v131). Brandon Milliken is always a super
   admin: above leadership, able to do everything leadership can, and never
   changeable from inside the app, not even by leadership. cik-v10 (Brandon,
   2026-10-15): Jordan Matin too, as in Jarvis, now that @matinrealestate.com
   can sign in here. It is decided
   here, by the verified sign-in email, and is never stored in the database
   (the agents table only accepts the stored roles above), so no edit to a
   role can take it away or hand it to anyone else. Adding or removing one
   is a code change. */
export const SUPER_ADMINS = Object.freeze(["brandon@cashisking.com", "jmatin@matinrealestate.com"]);
export function isSuperAdmin(email) {
  return SUPER_ADMINS.includes(typeof email === "string" ? email.trim().toLowerCase() : "");
}
/** The role that counts: "superadmin" for a super admin, otherwise the stored one. */
export function effectiveRole(email, role) {
  if (isSuperAdmin(email)) return "superadmin";
  return ROLES.includes(role) ? role : "agent";
}

/* v181: the ladder and the preview rules live in lib/role-rank.js (safe for
   the browser); re-exported here so every server import stays the same. */
import { RANK, atLeast, PREVIEW_COOKIE, PREVIEW_ROLES, canPreviewRoles, previewRoleFor } from "./role-rank.js";
export { atLeast, PREVIEW_COOKIE, PREVIEW_ROLES, canPreviewRoles, previewRoleFor };

/* WHO SEES WHOSE DATA (v99, Brandon's rule): "I only want leadership to be
   able to see other people's data." Everyone sees their OWN data. Two narrow
   exceptions, both his:
     - the leaderboard (names and closed units, never income) is for everyone
     - admins keep the whole deal board, to run transactions, but never anyone
       else's commission on it
   Brokers used to see everything; they now see what an agent sees. */

/** Income columns on OTHER people's rows. Your own are always yours to see. */
export function canSeeOthersIncome(role) {
  return atLeast(role, "leadership");
}

/** The leadership "view as" control, carried over from the prototype's selector. */
export function canViewAsOthers(role) {
  return atLeast(role, "leadership");
}

/** Company-wide figures, feeds with no agent on them, and everyone's leads. */
export function canSeeCompany(role) {
  return atLeast(role, "leadership");
}

/* The Sierra to-do card: a leadership preview in v102, on for every agent
   since v104 (Brandon: "turn on the card"). Each person gets only their own
   card; the team table is company data and stays leadership's. */
export const TODO_FOR_EVERYONE = true;
export function canSeeTodo(role) {
  return TODO_FOR_EVERYONE || atLeast(role, "leadership");
}

/** Every deal under contract, not just your own: admins (to run transactions) and leadership. */
export function canSeeAllDeals(role) {
  return atLeast(role, "admin");
}

const INCOME_FIELDS = ["gci", "paid_income", "closed_volume"];

/**
 * Strip income fields from rows that are not the viewer's own.
 *
 * Called on every leaderboard and roster response. `viewer` is the session's
 * agent row; rows are production rows joined to agents.
 */
export function scrubLeaderboard(rows, viewer) {
  const full = canSeeOthersIncome(viewer?.role);
  const mine = viewer?.sisu_agent_id;

  return rows.map((r) => {
    const isMine = mine != null && Number(r.sisu_agent_id) === Number(mine);
    if (full || isMine) return r;

    const out = { ...r };
    for (const f of INCOME_FIELDS) delete out[f];
    return out;
  });
}

/**
 * Which agent's data is this request actually for?
 *
 * Default: the signed-in person. Leadership may pass ?agent=<email> to
 * look at someone else — that is the "view as" feature — and every use of it is
 * written to view_as_log. Anyone else asking for another agent is
 * silently given their own data rather than an error, because an error message
 * confirms the other account exists.
 */
export function resolveTarget(viewer, requestedEmail) {
  if (!requestedEmail) return { email: viewer?.email || null, viewAs: false };

  const asked = normEmail(requestedEmail);
  const mine = normEmail(viewer?.email);
  /* Both sides normalised. Without the trim, a request for your own address
     with a stray space read as an impersonation of yourself — refused for an
     agent, and for a broker it wrote an audit row saying they viewed someone
     else's data when they had viewed their own. */
  if (mine && asked === mine) return { email: viewer.email, viewAs: false };

  if (canViewAsOthers(viewer?.role)) {
    return { email: requestedEmail, viewAs: true };
  }
  return { email: viewer?.email || null, viewAs: false };
}

/** Domains allowed to sign in at all. Set ALLOWED_EMAIL_DOMAINS as a CSV.
    cik-v8 (Brandon, 2026-10-15): Cash Is King and Matin Real Estate. */
export const DEFAULT_DOMAINS = "cashisking.com,matinrealestate.com";
export function allowedDomains() {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS || DEFAULT_DOMAINS;
  return raw.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
}

/** Individual addresses allowed in alongside the domains (CSV, optional). */
export function allowedEmails() {
  const raw = process.env.ALLOWED_EMAILS || "";
  return raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isAllowedIdentity(email, emailVerified) {
  if (!email) return false;
  // Google's `hd` param only pre-filters the account chooser. It is a
  // convenience, never a security control, so the real check happens here.
  if (emailVerified === false) return false;

  const addr = normEmail(email);
  if (!addr) return false;
  if (allowedEmails().includes(addr)) return true;

  /* EXACTLY ONE "@", and the domain is what follows it.
   *
   * This read `addr.split("@")[1]`, which takes the SECOND segment — so
   * "andy@matinrealestate.com@evil.com" split to
   * ["andy", "matinrealestate.com", "evil.com"] and the check happily approved
   * "matinrealestate.com" while the address actually belongs to evil.com.
   *
   * Google will not mint a verified address in that shape, so this was not a
   * live hole — but the allow-list is the one function in this app whose whole
   * job is to be suspicious, and "our upstream would never send that" is the
   * assumption every bypass is built on. An address with two @ signs is not a
   * near miss to be parsed generously; it is malformed, and malformed is a no. */
  const parts = addr.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;

  return allowedDomains().includes(domain);
}

/**
 * Scope the In Contract board to what this viewer may see.
 *
 * These rows are the most sensitive thing Jarvis holds — real client names and
 * real property addresses for every deal under contract. Your own are always
 * yours. Everyone's is admins (who run the transactions) and leadership.
 *
 * An agent's own rows come back whole. Everyone else's are REMOVED, not
 * redacted — a redacted row still tells you the count and the price, and on a
 * board this small that is most of what is confidential about it.
 *
 * An admin sees every deal, but the commission on a deal that is not their
 * own is removed: seeing the board is not seeing anyone's income.
 */
const DEAL_INCOME = ["gross_commission_amt", "gci"];
export function scrubBoard(rows, viewer) {
  const list = Array.isArray(rows) ? rows : [];
  const mine = normEmail(viewer?.email);
  if (canSeeOthersIncome(viewer?.role)) return list;
  if (canSeeAllDeals(viewer?.role)) {
    return list.map(r => {
      if (mine && normEmail(r.agent_email) === mine) return r;
      const out = { ...r };
      for (const f of DEAL_INCOME) delete out[f];
      return out;
    });
  }
  if (!mine) return [];
  return list.filter(r => normEmail(r.agent_email) === mine);
}
