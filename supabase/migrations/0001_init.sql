-- ERP Accounting — cloud sync schema.
--
-- Design: one generic `records` table holds every synced entity (invoices,
-- customers, journal entries, ...) as a JSON blob, keyed by
-- (company_id, entity, record_id). This mirrors the shape the app already
-- uses locally (see exportData() in src/store.js) so the sync engine can
-- treat every entity uniformly instead of needing 40+ hand-rolled tables.
--
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / DROP...IF
-- EXISTS before CREATE), so pasting this again after a partial failure won't
-- error out on "already exists".
--
-- Run this whole file in the Supabase SQL Editor (Project → SQL Editor → New
-- query), then Run. It should complete with no errors.

create extension if not exists pgcrypto;

-- ── Profiles ───────────────────────────────────────────────────────────
-- auth.users isn't queryable by clients, so a public mirror (name + email
-- only, nothing sensitive) is what member/invite lists actually read from.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''))
    on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
-- (its select policy is defined further down, once company_members exists)

-- Backfill: harmless no-op on a fresh project (no auth.users yet); on a
-- project with pre-existing accounts, gives them a profile row too.
insert into public.profiles (id, email, name)
  select id, email, coalesce(raw_user_meta_data->>'name', '') from auth.users
  on conflict (id) do nothing;

-- ── Companies ──────────────────────────────────────────────────────────
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'New Company',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- ── Membership (multi-user, roles) ────────────────────────────────────
create table if not exists public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

-- ── Pending email invites ─────────────────────────────────────────────
create table if not exists public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member', 'viewer')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index if not exists company_invites_pending_unique
  on public.company_invites (company_id, lower(email))
  where accepted_at is null;

-- ── Synced records (every business entity, generically) ───────────────
create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  entity text not null,
  record_id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (company_id, entity, record_id)
);
create index if not exists records_sync_cursor on public.records (company_id, updated_at);

-- Always stamp updated_at server-side — never trust a client-supplied value,
-- so last-write-wins conflict resolution can't be gamed by clock skew.
create or replace function public.touch_records_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists records_touch_updated_at on public.records;
create trigger records_touch_updated_at
  before insert or update on public.records
  for each row execute function public.touch_records_updated_at();

-- ── Helper: current user's role in a company (null if not a member) ───
create or replace function public.company_role(target_company_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.company_members
  where company_id = target_company_id and user_id = auth.uid();
$$;

-- ── Create a company + make the creator its owner, atomically ─────────
-- SECURITY DEFINER sidesteps the chicken-and-egg problem where RLS would
-- otherwise require you to already be a member to see the row you're
-- inserting.
create or replace function public.create_company(company_name text)
returns public.companies language plpgsql security definer set search_path = public as $$
declare
  new_company public.companies;
begin
  insert into public.companies (name, created_by) values (coalesce(nullif(trim(company_name), ''), 'New Company'), auth.uid())
    returning * into new_company;
  insert into public.company_members (company_id, user_id, role) values (new_company.id, auth.uid(), 'owner');
  return new_company;
end;
$$;

-- ── Accept a pending invite by token ───────────────────────────────────
create or replace function public.accept_company_invite(invite_token uuid)
returns public.companies language plpgsql security definer set search_path = public as $$
declare
  inv public.company_invites;
  co public.companies;
  my_email text;
begin
  select email into my_email from auth.users where id = auth.uid();
  select * into inv from public.company_invites
    where token = invite_token and accepted_at is null
    and lower(email) = lower(my_email)
    limit 1;
  if inv is null then
    raise exception 'INVITE_NOT_FOUND_OR_EXPIRED';
  end if;
  insert into public.company_members (company_id, user_id, role) values (inv.company_id, auth.uid(), inv.role)
    on conflict (company_id, user_id) do update set role = excluded.role;
  update public.company_invites set accepted_at = now() where id = inv.id;
  select * into co from public.companies where id = inv.company_id;
  return co;
end;
$$;

-- ── Row-level security ──────────────────────────────────────────────────
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.company_invites enable row level security;
alter table public.records enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1 from public.company_members m1
      join public.company_members m2 on m1.company_id = m2.company_id
      where m1.user_id = auth.uid() and m2.user_id = public.profiles.id
    )
  );

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select
  using (public.company_role(id) is not null);

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update
  using (public.company_role(id) in ('owner', 'admin'));

-- Inserts go through create_company() (SECURITY DEFINER), not direct client inserts.
drop policy if exists companies_insert_none on public.companies;
create policy companies_insert_none on public.companies for insert
  with check (false);

drop policy if exists members_select on public.company_members;
create policy members_select on public.company_members for select
  using (public.company_role(company_id) is not null);

drop policy if exists members_manage on public.company_members;
create policy members_manage on public.company_members for all
  using (public.company_role(company_id) in ('owner', 'admin'))
  with check (public.company_role(company_id) in ('owner', 'admin'));

drop policy if exists invites_select on public.company_invites;
create policy invites_select on public.company_invites for select
  using (
    public.company_role(company_id) in ('owner', 'admin')
    or lower(email) = lower((select email from auth.users where id = auth.uid()))
  );

drop policy if exists invites_manage on public.company_invites;
create policy invites_manage on public.company_invites for insert
  with check (public.company_role(company_id) in ('owner', 'admin'));

drop policy if exists invites_delete on public.company_invites;
create policy invites_delete on public.company_invites for delete
  using (public.company_role(company_id) in ('owner', 'admin'));

drop policy if exists records_select on public.records;
create policy records_select on public.records for select
  using (public.company_role(company_id) is not null);

drop policy if exists records_write on public.records;
create policy records_write on public.records for insert
  with check (public.company_role(company_id) in ('owner', 'admin', 'member'));

drop policy if exists records_update on public.records;
create policy records_update on public.records for update
  using (public.company_role(company_id) in ('owner', 'admin', 'member'))
  with check (public.company_role(company_id) in ('owner', 'admin', 'member'));

drop policy if exists records_delete on public.records;
create policy records_delete on public.records for delete
  using (public.company_role(company_id) in ('owner', 'admin'));

-- ── Realtime (optional, lets other open devices/tabs learn about a push
-- immediately instead of waiting for the next poll) ───────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records'
  ) then
    alter publication supabase_realtime add table public.records;
  end if;
end;
$$;
