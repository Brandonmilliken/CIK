# CIK Office (Jarvis for Cash Is King)

Cash Is King's team intranet: the rooms that lived on CIK Office
(cikoffice.com, WordPress), moved onto Vercel. Next.js, Neon Postgres, Vercel
Blob, Google sign-in restricted to `@cashisking.com`.

It started as a copy of Jarvis (Matin Real Estate, `Brandonmilliken/Jarvis`
v181, 2026-10-13) with every Matin-only part taken out: Sisu, Sierra, Fello,
Relitix, Slack, Shilo, Trainual, Asana, Ask Matin AI, the MRE rooms and the
MRE dashboard. What came over unchanged is the room engine (lists, files,
edit, import), help tickets, announcements, Leadership Settings, search, the
display settings and the phone layout.

The two apps never share data. Podio belongs here; it never goes into Jarvis.

## Status

| Step | What | State |
|---|---|---|
| 1 | Look around CIK Office | Done 2026-10-13 (about 300 rows; no files to move) |
| 2 | Build the new home (this repo) | **v1** |
| 3 | Copy the rooms over (one-time import) | after the first deploy |
| 4 | Agent dashboard from Podio | next build |
| 5 | Move cikoffice.com to Vercel, turn WordPress off | last |

## First deploy

1. **Vercel → Add New → Project →** import `Brandonmilliken/CIK`. Framework
   Next.js, everything else default.
2. **Storage:** create a **Neon** database and a **Blob** store and connect
   both to the project (they fill in `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN`).
3. **Database tables:** Neon → SQL Editor → paste `sql/schema.sql` → Run.
   Everything else creates itself.
4. **Google sign-in:** Google Cloud Console → Credentials → create a new OAuth
   client (Web), or add to Jarvis's:
   - redirect URI `https://www.cikoffice.com/api/auth/callback/google`
   - JavaScript origin `https://www.cikoffice.com`
   - consent screen authorized domain `cikoffice.com` (verify it in Search
     Console under the same Google account first)
5. **Environment variables:** see `.env.example`. `AUTH_SECRET` must be new.
6. **Domain:** Vercel → Settings → Domains → add `www.cikoffice.com`, then
   change the `www` record at GoDaddy (cikoffice.com's DNS) to the CNAME
   Vercel shows. The bare `cikoffice.com` stays on WordPress until step 5.
7. **Redeploy** (`AUTH_URL` is read at build time).

## Who can sign in, and roles

- Anyone with a verified `@cashisking.com` Google account
  (`ALLOWED_EMAIL_DOMAINS`). The first sign-in adds them to the people list as
  an **agent**.
- **Super admin:** brandon@cashisking.com, always (`lib/authz.js`
  `SUPER_ADMINS`; a code change to alter).
- Leadership promotes people to **admin** or **leadership**, and marks people
  who have left, in Company → **Leadership Settings**. Every change is logged.

## The one-time import (step 3)

Run `scripts/office-import.browser.js` in a cikoffice.com tab that is signed
in to WordPress (the bare https://cikoffice.com), in a browser that is also signed in to www.cikoffice.com as
admin. It reads each room with WordPress's own session and posts it straight
here. Each room is copied once, all or nothing, and the script prints
`match: true` when the copy is exact. It only works once the app is live at
www.cikoffice.com (the sign-in cookie has to travel with the request).

## Rooms

`lib/office-rooms.js` is the side menu and every room's fields;
`lib/office-menu.js` is the browser's copy of the menu (a test keeps them in
step).

## Admin tools

`/api/admin/run?job=sync-log`, `?job=perf-probe`, `?job=ticket-email-test`
(type the address; links are refused).

## Tests

`npm test` runs every `*.test.mjs`. A suite that crashes is reported as not
run, never as zero.
