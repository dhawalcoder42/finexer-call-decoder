-- Run this once in the Supabase SQL editor (Supabase dashboard -> SQL Editor -> New query).

create table if not exists users (
  email text primary key,
  name text default '',
  role text not null default 'writer',
  pass_salt text,
  pass_hash text,
  created_at bigint,
  added_by text
);

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  transcript text,
  status text not null default 'queued',
  insights jsonb,
  error_msg text,
  uploaded_by text,
  uploaded_at bigint,
  processed_at bigint,
  processing_at bigint
);

create index if not exists calls_uploaded_at_idx on calls (uploaded_at);

-- Row level security stays on; only the service role key (used by the app's
-- backend functions, never sent to the browser) can read or write these
-- tables, so no extra policies are needed.
alter table users enable row level security;
alter table calls enable row level security;
