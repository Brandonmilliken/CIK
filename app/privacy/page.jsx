import { LegalPage, H2, P, UL, LI, Note } from "../legal-shell.jsx";
import { CONTACT_EMAIL } from "../../lib/brand.js";

/* The root layout sets robots: noindex for the app. Allow these two pages to be
   indexed instead — Google's OAuth review fetches them, and a policy nobody can
   find is a policy that fails review. */
export const metadata = {
  title: "Privacy Policy — Jarvis",
  robots: { index: true, follow: true },
};

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="October 13, 2026"
      intro="Jarvis is a private, internal tool for the staff of Cash Is King. It is not a consumer product and is not open to the public. This page explains what Jarvis collects, why, and what happens to it."
    >
      <H2>Who this covers</H2>
      <P>
        <strong>Users</strong> are the Cash Is King staff who sign in. Jarvis also
        holds the company&rsquo;s own reference lists (vendors, offices, links)
        and the staff directory.
      </P>

      <H2>What Google gives us when you sign in</H2>
      <P>
        Jarvis uses Google Sign-In to establish who you are. It requests three
        basic scopes and nothing else: <code>openid</code>, <code>email</code>{" "}
        and <code>profile</code>. From these we receive your name, your email
        address, your Google account identifier and your profile picture.
      </P>
      <Note>
        Jarvis does not request access to your Gmail, Drive, Calendar, Contacts
        or any other Google service, and cannot read them. Signing in to Jarvis
        gives it your identity and nothing more.
      </Note>
      <P>
        Sign-in is limited to Cash Is King (@cashisking.com) and Matin Real Estate
        (@matinrealestate.com) accounts; any other
        address is refused. The first time you sign in, your name and email are
        added to Jarvis&rsquo;s list of people, so leadership can set your role.
      </P>

      <H2>Business information inside Jarvis</H2>
      <P>
        Jarvis does not gather information from the public. It holds what the
        company puts into it: vendor and partner contacts, the staff directory,
        company links and documents, announcements, and help tickets people file.
      </P>

      <H2>What we do not do</H2>
      <UL>
        <LI>We do not sell or rent personal information.</LI>
        <LI>We do not use Google user data, or any data in Jarvis, for advertising.</LI>
        <LI>We do not use it to build profiles for marketing to anyone outside the company.</LI>
        <LI>We do not run advertising trackers, analytics pixels or third-party cookies in Jarvis.</LI>
      </UL>
      <P>
        Jarvis sets the session cookie that keeps you signed in, the short-lived
        security cookies Google&rsquo;s sign-in flow requires, and, for
        leadership only, a cookie that remembers a &ldquo;Viewing as&rdquo; preview.
        Your display settings (theme, text size) are kept in your browser&rsquo;s
        own storage. Clearing cookies signs you out.
      </P>

      <H2>Where it is stored, and who can reach it</H2>
      <P>
        Jarvis runs on Vercel and stores its data in a Neon PostgreSQL database
        hosted in the United States; uploaded documents are kept in Vercel&rsquo;s
        file storage. Access is limited to signed-in users and to the small
        number of administrators who maintain the system.
      </P>

      <H2>How long it is kept</H2>
      <P>
        Lists stay until an admin changes or removes them. When someone leaves
        the company their access is revoked, and their user record is removed on
        request.
      </P>

      <H2>Service providers</H2>
      <P>
        Jarvis depends on Google (sign-in, and the web fonts the pages load),
        Vercel (hosting and file storage), Neon (database) and, if help-ticket
        emails are turned on, Zapier (sending them). Each processes data only to
        provide its service. We do not transfer Jarvis data to anyone else except
        where required by law.
      </P>

      <H2>Your choices</H2>
      <P>
        You can revoke Jarvis&rsquo;s access to your Google account at any time
        from your Google account permissions page; you will simply no longer be
        able to sign in. To ask what Jarvis holds about you, to correct it, or to
        have it removed, write to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "#d8b26a" }}>{CONTACT_EMAIL}</a>.
      </P>

      <H2>Children</H2>
      <P>
        Jarvis is a workplace tool. It is not directed to children and we do not
        knowingly collect information from anyone under 18.
      </P>

      <H2>Changes</H2>
      <P>
        If this policy changes in a way that affects what Jarvis collects or how
        it is used (for example, when it starts showing Podio data), we will
        update the date at the top of this page and notify users inside the app.
      </P>
    </LegalPage>
  );
}
