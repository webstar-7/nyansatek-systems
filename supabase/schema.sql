-- ============================================================
-- nyansatek.systems — commerce & provisioning schema
--
-- You run two separate Supabase projects (free-tier limit):
--   Project A — nyansatek.shop's existing project (POS)
--   Project B — nyansatek-attendance's existing project (School)
--
-- Run the sections below in the project noted in each comment.
-- Do NOT run the whole file in both projects — each table only
-- belongs in one place.
-- ============================================================

-- ------------------------------------------------------------
-- RUN IN PROJECT A (POS / nyansatek.shop) ONLY.
-- provisioning_jobs is the storefront's own bookkeeping table —
-- it tracks every purchase regardless of which product was
-- bought, and lives here by convention (POS being the more
-- established project), not because jobs are POS-specific.
-- Tracks every purchase attempt end-to-end so the success page
-- can poll progress and so nothing is ever provisioned twice.
-- ------------------------------------------------------------
create table if not exists provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  product text not null,
  state text not null default 'verifying', -- verifying | seeding | notifying | complete | failed
  payload jsonb,
  result jsonb,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_provisioning_jobs_reference on provisioning_jobs(reference);

-- Keep updated_at fresh
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_provisioning_jobs_updated on provisioning_jobs;
create trigger trg_provisioning_jobs_updated
  before update on provisioning_jobs
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- ALSO RUN IN PROJECT A (POS / nyansatek.shop).
-- Example tenant tables for the POS product — you almost
-- certainly already have equivalents here from
-- tenant-onboarding-template.sql. Don't run this section blindly;
-- reconcile column names with what already exists, then update
-- netlify/functions/_provisioners/pos.js to match the real schema.
-- ------------------------------------------------------------
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  owner_name text,
  phone text,
  email text,
  location text,
  product text default 'pos',
  plan text,
  status text default 'active',
  username text unique,
  password_needs_reset boolean default true,
  temp_password text, -- replace with a hashed column in production
  created_at timestamptz default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null
);

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null
);

-- ------------------------------------------------------------
-- RUN IN PROJECT B (School / nyansatek-attendance) ONLY.
-- Example tenant tables for the School product — reconcile with
-- whatever schema nyansatek-attendance already uses, then update
-- netlify/functions/_provisioners/school.js to match.
-- ------------------------------------------------------------
create table if not exists schools (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  admin_name text,
  phone text,
  email text,
  location text,
  plan text,
  status text default 'active',
  username text unique,
  password_needs_reset boolean default true,
  temp_password text,
  created_at timestamptz default now()
);

create table if not exists terms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id) on delete cascade,
  name text not null
);

create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id) on delete cascade,
  name text not null
);

-- ------------------------------------------------------------
-- Row Level Security: lock all of this down from the client.
-- Only the service role key (used exclusively in Netlify
-- functions) should read/write these tables.
-- ------------------------------------------------------------
alter table provisioning_jobs enable row level security;
alter table businesses enable row level security;
alter table categories enable row level security;
alter table stores enable row level security;
alter table schools enable row level security;
alter table terms enable row level security;
alter table classes enable row level security;
-- No policies are added on purpose — with RLS on and zero
-- policies, only the service role key can touch these tables.
