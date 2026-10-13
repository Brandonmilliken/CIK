import { LegalPage, H2, P, UL, LI, Note } from "../legal-shell.jsx";

export const metadata = {
  title: "Terms of Service — Jarvis",
  robots: { index: true, follow: true },
};

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="October 13, 2026"
      intro="Jarvis is a private internal system operated by Cash Is King. These terms apply to everyone who signs in. If you do not agree to them, do not use Jarvis."
    >
      <H2>Who may use Jarvis</H2>
      <P>
        Jarvis is for current staff and authorized contractors of Cash Is King.
        Access is tied to your company Google account, and may be changed or
        withdrawn at any time. It ends when your relationship with the company
        ends.
      </P>
      <P>
        Your account is yours alone. Do not share it, do not sign in on behalf of
        someone else, and tell an administrator promptly if you believe someone
        else has used it.
      </P>

      <H2>Confidentiality</H2>
      <Note>
        Jarvis contains company contacts, staff details and internal business
        information. Treat all of it as confidential company information, subject
        to the same duties you already owe the company and its clients.
      </Note>
      <P>
        Do not export, copy, screenshot, forward or otherwise remove information
        from Jarvis except as needed to do your job for the company. Do not
        take it with you if you leave. Do not use client contact information from
        Jarvis for any purpose the client did not engage the company for,
        including outside business ventures or personal marketing.
      </P>

      <H2>Accuracy of the figures</H2>
      <Note>
        The numbers in Jarvis are for internal reference and are not an official
        statement of your compensation. Podio and the company&rsquo;s accounting
        records are the source of truth for anything that determines what you are
        paid.
      </Note>
      <P>
        Jarvis displays data pulled from other systems on a schedule, so figures
        can lag, and a vendor outage or a change on their side can cause a value
        to be stale, missing or wrong. If a number looks incorrect, report it
        rather than relying on it. Nothing shown in Jarvis creates an entitlement
        to a commission, a split or a payment, and no figure here overrides your
        written agreement with the company.
      </P>

      <H2>Acceptable use</H2>
      <UL>
        <LI>Use Jarvis only for legitimate company business.</LI>
        <LI>Do not attempt to access data belonging to another agent that Jarvis has not made available to you, or to work around its access controls.</LI>
        <LI>Do not probe, scan, overload or reverse-engineer the system, or connect automated tools to it without permission.</LI>
        <LI>Do not enter anything into Jarvis that is unlawful, harassing, or that you do not have the right to share.</LI>
        <LI>Follow all applicable real estate, fair housing, licensing and privacy laws in how you use what you find here.</LI>
      </UL>

      <H2>Availability</H2>
      <P>
        Jarvis is provided as-is, without warranty of any kind. It depends on
        third-party services that can fail or change without notice, and it may
        be unavailable, interrupted or modified at any time. It is a convenience
        layer over the company&rsquo;s systems, not a system of record, and it
        is not a substitute for Podio, the transaction file or the
        company&rsquo;s accounting.
      </P>
      <P>
        To the fullest extent permitted by law, Cash Is King is not liable
        for any indirect, incidental or consequential loss arising from use of
        Jarvis, or from reliance on a figure it displayed.
      </P>

      <H2>Changes to Jarvis and to these terms</H2>
      <P>
        Features may be added, changed or removed as the company&rsquo;s needs
        change. If these terms are updated, the date at the top of this page will
        change and users will be notified inside the app. Continuing to use
        Jarvis after that means you accept the revised terms.
      </P>

      <H2>Governing law</H2>
      <P>
        These terms are governed by the laws of the State of Oregon, without
        regard to its conflict of law rules. Any dispute arising from them is
        subject to the courts located in Multnomah County, Oregon.
      </P>
    </LegalPage>
  );
}
