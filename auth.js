/* Google sign-in via Auth.js v5 (CIK Office, copied from Jarvis v181).
 *
 * WHO MAY SIGN IN (Brandon, 2026-10-13, and cik-v8 2026-10-15): anyone with
 * a verified @cashisking.com or @matinrealestate.com Google account
 * (ALLOWED_EMAIL_DOMAINS, default both). There is no Sisu roster at Cash Is King, so the people
 * list is built from sign-ins: the first time someone signs in they get a
 * row in `agents` as an agent, and leadership promotes them from Leadership
 * Settings. Marking someone as having left there locks them out.
 *
 * Scopes are `openid email profile` and nothing more. Jarvis does not need
 * Gmail or Drive to establish identity, and adding those scopes changes the
 * consent screen every agent has to read — so add them deliberately and
 * separately if server-side calendar data is ever wanted, not by accident here.
 */
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { agentByEmail, ensureAgent } from "./lib/db.js";
import { effectiveRole } from "./lib/authz.js";
import { isAllowedIdentity, allowedDomains, allowedEmails, isSuperAdmin } from "./lib/authz.js";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "openid email profile",
          // Pre-filters the account chooser to the work domain. A convenience
          // for the user, NOT a security control — the real gate is signIn below.
          // cik-v8: only when ONE domain may sign in. With two (Cash Is King
          // and Matin Real Estate), filtering to either would hide the other.
          hd: (allowedDomains().length === 1 && process.env.GOOGLE_HD) || undefined,
          prompt: "select_account",
        },
      },
    }),
  ],

  session: { strategy: "jwt" },

  callbacks: {
    async signIn({ profile }) {
      // profile.email_verified is Google asserting it actually owns the address.
      const ok = isAllowedIdentity(profile?.email, profile?.email_verified);
      if (!ok) {
        /* A rejection with no record of WHY is unusable: the screen can only say
           "that account can't sign in", and from outside there is no way to tell
           a wrong account from a mis-typed allowlist. This is the allowlist and
           the address that failed it — config, not secrets — so it belongs in
           the server log where an admin can read it. It never reaches the page. */
        /* v180 (scan): the allowed DOMAINS, and how many single addresses
           are allowed, not the addresses themselves (each rejected attempt
           printed every allowed person's email into the log). */
        console.warn("[auth] sign-in REJECTED", JSON.stringify({
          attemptedEmail: profile?.email ?? "(no email in Google profile)",
          emailVerified: profile?.email_verified ?? "(absent)",
          allowedDomains: allowedDomains(),
          allowedEmailCount: allowedEmails().length,
        }));
      } else {
        /* v181 (scan): someone marked as left is told so at sign-in (the
           session was refused later, silently, and the log said "allowed"). */
        const a = await agentByEmail(profile?.email).catch(() => null);
        if (a && a.left_at && !isSuperAdmin(profile?.email)) {
          console.warn("[auth] sign-in REJECTED (marked as left):", profile?.email);
          return false;
        }
        console.log("[auth] sign-in allowed:", profile?.email);
      }
      return ok;
    },

    async jwt({ token, trigger, profile }) {
      /* Resolve the Sisu agent, and RE-resolve it on a clock.
       *
       * This used to run only at sign-in, or once if the field was missing. The
       * token then carried that answer for the life of the session — which for
       * a JWT session is thirty days by default — and two things followed from
       * that, both bad:
       *
       *   A ROLE CHANGE DID NOT TAKE EFFECT. Promoting someone with
       *     update agents set role = 'leadership' where email = ...
       *   did nothing they could see until they signed out and back in, with no
       *   hint anywhere that this was why. That is the exact command in
       *   DEPLOY.txt for turning on "View as". Worse in the other direction: a
       *   role REVOKED stayed usable for up to a month.
       *
       *   A DATABASE BLIP AT SIGN-IN WAS PERMANENT. The catch below falls back
       *   to "agent" with no agent id, which is the right way to fail — but the
       *   wrong answer then got cached for a month, so one bad second at the
       *   moment of sign-in quietly demoted a broker until they noticed and
       *   re-logged-in.
       *
       * So the resolution is stamped, and anything older than JARVIS_ROLE_TTL_MS
       * (fifteen minutes by default) is looked up again. It is one indexed
       * lookup on a token refresh, and it means the database is the answer to
       * "what may this person see" rather than a copy taken at sign-in.
       */
      const TTL = Number(process.env.JARVIS_ROLE_TTL_MS || 15 * 60 * 1000);
      const stamped = Number(token.rolesAt) || 0;
      const stale = !Number.isFinite(stamped) || (Date.now() - stamped) > TTL;

      if (trigger === "signIn" || trigger === "signUp" || trigger === "update" ||
          token.sisuAgentId === undefined || stale) {
        /* v177 (scan): a session lasts thirty days, and who may sign in was
           only ever checked at sign-in. So someone who left the company, or
           whose address is taken off ALLOWED_EMAIL_DOMAINS / the allow-list,
           kept working for up to a month. Now, at this same fifteen-minute
           check, either one ends the session (returning null signs them out). */
        if (!isAllowedIdentity(token.email, true)) return null;
        let lookupFailed = false;
        /* CIK: first sign-in adds them to the people list, as an agent. It
           never changes an existing row (role, name or left_at). */
        if (trigger === "signIn" || trigger === "signUp") {
          await ensureAgent(token.email, profile?.given_name || "", profile?.family_name || "").catch(() => {});
        }
        const agent = await agentByEmail(token.email).catch(() => { lookupFailed = true; return null; });
        /* v181 (scan): never a super admin (a retired old address could lock
           them out, with nothing in Jarvis able to undo it). */
        if (agent && agent.left_at && !isSuperAdmin(token.email)) return null;
        /* v179 (scan): a lookup that WORKED and found no row (the person was
           removed from the roster outright) is not a hiccup: they're treated
           as an agent from now on, not left with the role they had. */
        if (!agent && !lookupFailed && token.sisuAgentId !== undefined) {
          token.sisuAgentId = null;
          token.role = effectiveRole(token.email, "agent");
          token.rolesAt = Date.now();
        }
        /* A failed lookup must not overwrite a good answer with a worse one.
           Falling back to "agent" is correct on first sign-in, when there is
           nothing to keep — but if we already resolved this person, a database
           hiccup should leave what we had and try again next time rather than
           demote them mid-session. */
        if (agent) {
          token.sisuAgentId = agent.sisu_agent_id ?? null;
          token.role = effectiveRole(token.email, agent.role ?? "agent");
          token.displayName = [agent.first_name, agent.last_name].filter(Boolean).join(" ")
            || token.name || token.email;
          token.rolesAt = Date.now();
        } else if (token.sisuAgentId === undefined || !lookupFailed) {
          // Never resolved (the lookup failed on the first try): least privilege.
          token.sisuAgentId = null;
          token.role = effectiveRole(token.email, "agent");
          token.displayName = token.name || token.email;
          token.rolesAt = Date.now();
        }
        // else: keep what we had, and come back to it on the next refresh.
      }
      return token;
    },

    async session({ session, token }) {
      session.user.email = token.email;
      session.user.sisuAgentId = token.sisuAgentId ?? null;
      session.user.role = effectiveRole(token.email, token.role ?? "agent");
      session.user.displayName = token.displayName ?? token.email;
      return session;
    },
  },

  pages: { signIn: "/signin", error: "/signin" },
});
