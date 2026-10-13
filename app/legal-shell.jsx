/* Shared chrome for the two public legal pages.
 *
 * These pages sit OUTSIDE the sign-in gate on purpose: Google will not let the
 * OAuth consent screen go to production until it can reach a privacy policy and
 * terms of service anonymously, on the same domain as the app. So they must not
 * call currentUser(), must not touch the database, and must not import anything
 * that does — a page that needs DATABASE_URL to render is a page Google sees as
 * a 500. Keep them dependency-free.
 */

import { LOGO, COMPANY, CONTACT_EMAIL } from "../lib/brand.js";
const INK = "#f4f3f1";
const MUTED = "#8b8983";
const DIM = "#a3a09a";   // v179: 4.5:1 or better on black (was 4.06:1)
const GOLD = "#d8b26a";
const RULE = "#26262c";

export function LegalPage({ title, updated, intro, children }) {
  return (
    <main style={{
      minHeight: "100vh",
      background: "#000000",
      color: INK,
      fontFamily: "Inter, system-ui, -apple-system, sans-serif",
      padding: "56px 24px 96px",
      WebkitTextSizeAdjust: "100%",
    }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>

        <a href="/signin" style={{
          display: "inline-flex", alignItems: "center", gap: 10,
          textDecoration: "none", color: INK, marginBottom: 40,
        }}>
          {/* The Cash Is King logo (a static file, so this page still needs
              nothing else to render). */}
          <img src={LOGO} alt="" width={32} height={32} style={{
            display: "block", width: 32, height: 32, borderRadius: 8,
            background: "#fff", border: "1px solid rgba(255,255,255,.18)", objectFit: "contain",
          }} />
          <span style={{ fontSize: 15, fontWeight: 540 }}>Jarvis</span>
        </a>

        <h1 style={{ fontSize: 30, fontWeight: 540, margin: "0 0 10px", lineHeight: 1.2 }}>
          {title}
        </h1>
        <p style={{
          color: DIM, fontSize: 11, letterSpacing: ".14em",
          textTransform: "uppercase", margin: "0 0 30px",
        }}>
          Last updated {updated}
        </p>

        <p style={{ fontSize: 15.5, lineHeight: 1.75, color: MUTED, margin: "0 0 8px" }}>
          {intro}
        </p>

        {children}

        <hr style={{ border: 0, borderTop: `1px solid ${RULE}`, margin: "48px 0 20px" }} />
        <p style={{ fontSize: 13, lineHeight: 1.7, color: DIM, margin: 0 }}>
          This copy of Jarvis is operated by {COMPANY}. Questions about this page:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}
             style={{ color: GOLD, textDecoration: "none" }}>
            {CONTACT_EMAIL}
          </a>
        </p>
        <p style={{ fontSize: 13, color: DIM, margin: "14px 0 0" }}>
          <a href="/privacy" style={{ color: DIM }}>Privacy Policy</a>
          <span style={{ opacity: .4, padding: "0 9px" }}>·</span>
          <a href="/terms" style={{ color: DIM }}>Terms of Service</a>
          <span style={{ opacity: .4, padding: "0 9px" }}>·</span>
          <a href="/signin" style={{ color: DIM }}>Sign in</a>
        </p>
      </div>
    </main>
  );
}

export function H2({ children }) {
  return (
    <h2 style={{
      fontSize: 17, fontWeight: 560, margin: "38px 0 12px",
      letterSpacing: "-.01em", color: INK,
    }}>
      {children}
    </h2>
  );
}

export function P({ children }) {
  return (
    <p style={{ fontSize: 15, lineHeight: 1.75, color: MUTED, margin: "0 0 14px" }}>
      {children}
    </p>
  );
}

export function UL({ children }) {
  return (
    <ul style={{
      fontSize: 15, lineHeight: 1.75, color: MUTED,
      margin: "0 0 14px", paddingLeft: 20,
    }}>
      {children}
    </ul>
  );
}

export function LI({ children }) {
  return <li style={{ margin: "0 0 7px" }}>{children}</li>;
}

/** For the one thing on each page people actually need to notice. */
export function Note({ children }) {
  return (
    <p style={{
      fontSize: 14.5, lineHeight: 1.7, color: INK, margin: "0 0 14px",
      padding: "13px 16px", borderRadius: 9,
      border: `1px solid ${RULE}`, background: "#131318",
      borderLeft: `2px solid ${GOLD}`,
    }}>
      {children}
    </p>
  );
}
