import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "../../auth.js";
import { LOGO, COMPANY } from "../../lib/brand.js";

export const dynamic = "force-dynamic";

/* Google's OAuth security cookie (the PKCE "code verifier") is set on whatever
   hostname the login STARTS on, but Google always returns to the one fixed
   redirect URI — the production host. Start on a deployment-specific URL like
   jarvis-7wuicl8o1-bm-illi.vercel.app and the cookie never travels, so the token
   exchange dies with "Invalid code verifier."
   Every Vercel deploy gets its own hostname, so this is easy to trip over and
   impossible to diagnose from the screen. Bounce to the canonical host first. */
function canonicalHost() {
  try { return new URL(process.env.AUTH_URL || "").host; } catch { return ""; }
}

/* v180 (scan): where to go after signing in (a ticket link, or a tab), so
   it isn't always the dashboard. Only a path on this site: one slash, then
   not a second slash or backslash, so it can't become "//evil.com". */
function safeNext(v) {
  const s = typeof v === "string" ? v : "";
  return s.length <= 300 && /^\/(?![/\\])[^\s]*$/.test(s) && !/^\/signin\b/.test(s) ? s : "";
}

export default async function SignIn({ searchParams }) {
  const params = await searchParams;
  const next = safeNext(params?.next);
  const canonical = canonicalHost();
  if (canonical) {
    const host = (await headers()).get("host");
    if (host && host !== canonical) redirect(`${process.env.AUTH_URL}/signin${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  }

  const code = params?.error;
  /* Distinguish the failures. Showing "use your company address" for every error
     is actively misleading: it sent an afternoon's debugging at the allowlist
     when the real fault was a hostname mismatch. */
  const failed = code
    ? (code === "AccessDenied"
        ? "That account can\u2019t sign in here. Use your @cashisking.com or @matinrealestate.com Google account."
        : "Sign-in didn\u2019t complete. Start again from this page rather than a bookmarked link \u2014 the login has to begin and end on the same address.")
    : null;
  return (
    <main style={{
      minHeight: "100vh", display: "grid", placeItems: "center",
      background: "#000000", color: "#f4f3f1",
      fontFamily: "Inter, system-ui, -apple-system, sans-serif", padding: 24,
    }}>
      <div style={{ maxWidth: 380, width: "100%", textAlign: "center" }}>
        <img src={LOGO} alt={COMPANY} width={56} height={56} style={{
          display: "block", width: 56, height: 56, borderRadius: 12, margin: "0 auto 20px",
          background: "#fff", border: "1px solid rgba(255,255,255,.18)", objectFit: "contain",
        }} />

        <h1 style={{ fontSize: 26, fontWeight: 540, margin: "0 0 6px" }}>Jarvis</h1>
        <p style={{ color: "#a3a09a", fontSize: 11, letterSpacing: ".14em",
                    textTransform: "uppercase", margin: "0 0 28px" }}>
          {COMPANY}
        </p>

        {failed && (
          <p style={{
            color: "#e0a4a4", fontSize: 13, lineHeight: 1.6, margin: "0 0 20px",
            padding: "11px 14px", borderRadius: 8,
            border: "1px solid rgba(224,164,164,0.3)", background: "rgba(224,164,164,0.08)",
          }}>
            {failed}
          </p>
        )}

        <form action={async () => { "use server"; await signIn("google", { redirectTo: next || "/" }); }}>
          <button type="submit" style={{
            width: "100%", padding: "13px 18px", borderRadius: 9, cursor: "pointer",
            border: "1px solid #33333b", background: "#111114", color: "#f4f3f1",
            fontSize: 14, fontWeight: 500, fontFamily: "inherit",
          }}>
            Continue with Google
          </button>
        </form>

        <p style={{ color: "#a3a09a", fontSize: 12, lineHeight: 1.6, margin: "22px 0 0" }}>
          For the Cash Is King and Matin Real Estate teams. Sign in with your @cashisking.com or
          @matinrealestate.com Google account.
        </p>

        {/* Reachable without signing in, by design — Google's consent screen
            review fetches both of these anonymously. */}
        <p style={{ color: "#a3a09a", fontSize: 12, margin: "18px 0 0" }}>
          <a href="/privacy" style={{ color: "#a3a09a" }}>Privacy Policy</a>
          <span style={{ opacity: .5, padding: "0 8px" }}>·</span>
          <a href="/terms" style={{ color: "#a3a09a" }}>Terms of Service</a>
        </p>
      </div>
    </main>
  );
}
