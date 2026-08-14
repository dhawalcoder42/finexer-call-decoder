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

alter table users enable row level security;
alter table calls enable row level security;

-- Small key/value table for app-wide saved data (like the generated FAQ
-- and the competitor switchers report).
create table if not exists app_state (
  key text primary key,
  value jsonb,
  updated_at bigint
);
alter table app_state enable row level security;
