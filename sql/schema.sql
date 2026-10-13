-- CIK Office (Jarvis for Cash Is King) schema. Run once against the Neon database:
--   psql "$DATABASE_URL" -f sql/schema.sql
-- (Neon's SQL Editor works too: paste this file and run it.)
--
-- Copied from Jarvis v181 with the Sisu and vendor-feed tables taken out.
-- Every other table (the office lists, tickets, role changes, settings,
-- announcement acknowledgements, sync records) creates itself the first time
-- it is used.

-- People. A row is added the first time someone signs in (as an agent), and
-- leadership sets roles from Leadership Settings.
create table if not exists agents (
  email                      text primary key,
  -- Jarvis's Sisu id. Always empty at Cash Is King; kept so the shared code
  -- (sign-in, Leadership Settings) works unchanged.
  sisu_agent_id              integer unique,
  first_name                 text,
  last_name                  text,
  status                     text,
  -- Never derived from the client, never sent by the browser. Defaults to the
  -- least privilege; someone has to deliberately promote a person.
  role                       text not null default 'agent'
                             check (role in ('agent','broker','admin','leadership')),
  synced_at                  timestamptz not null default now(),
  -- Set when someone has left the company (Leadership Settings).
  left_at                    timestamptz
);
alter table agents add column if not exists left_at timestamptz;

-- Cached figures that are not one row per person (the Podio dashboard will
-- keep its pulls here, step 4).
create table if not exists snapshots (
  key        text primary key,
  payload    jsonb not null,
  synced_at  timestamptz not null default now()
);

-- Who looked at whose data ("View as", leadership only).
create table if not exists view_as_log (
  id          bigserial primary key,
  actor_email text not null,
  target_email text not null,
  at          timestamptz not null default now()
);
