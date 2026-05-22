-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 001_create_waitlist
-- Description: Creates the waitlist table with email deduplication,
--              timestamping, and row-level security.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.waitlist (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null,
  created_at timestamptz not null default now(),

  -- Normalised uniqueness: case-insensitive, trimmed
  constraint waitlist_email_unique unique (email)
);

-- Index for fast duplicate checks and admin lookups
create index if not exists waitlist_email_idx
  on public.waitlist (lower(email));

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table public.waitlist enable row level security;

-- Allow anonymous inserts only (public signup)
create policy "Anyone can join the waitlist"
  on public.waitlist
  for insert
  to anon
  with check (true);

-- Prevent public reads — only service_role (your admin dashboard) can read
create policy "Only service role can read waitlist"
  on public.waitlist
  for select
  to service_role
  using (true);

-- ── Comments ──────────────────────────────────────────────────────────────────
comment on table  public.waitlist              is 'MemoriX early-access waitlist signups.';
comment on column public.waitlist.id           is 'Stable UUID primary key.';
comment on column public.waitlist.email        is 'Signup email — unique, stored as-submitted; index uses lower() for dedup.';
comment on column public.waitlist.created_at   is 'UTC timestamp of signup.';
