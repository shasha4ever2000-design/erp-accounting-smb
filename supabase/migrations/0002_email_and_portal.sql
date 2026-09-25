-- Emailing documents and the customer portal.
--
-- Run after 0001_init.sql, in the Supabase SQL Editor. Safe to re-run.
--
--   email_log     one row per email the send-email function sends. Members
--                 can read their company's rows; only the function writes.
--   portal_links  a secret link per customer. Opening it shows that customer
--                 their own invoices and balance, through the portal function,
--                 without signing in. Owners, admins and members create and
--                 revoke links; viewers can only see them.

create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sent_by uuid references auth.users(id) on delete set null,
  to_email text not null,
  subject text not null,
  doc_kind text not null default '',
  doc_ref text not null default '',
  status text not null default 'sent' check (status in ('sent', 'failed')),
  provider_id text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists email_log_company_time on public.email_log (company_id, created_at desc);

alter table public.email_log enable row level security;

drop policy if exists email_log_select on public.email_log;
create policy email_log_select on public.email_log for select
  using (public.company_role(company_id) is not null);
-- No insert/update/delete policy: only the function (service role) writes.

create table if not exists public.portal_links (
  token uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id text not null,
  customer_name text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_opened_at timestamptz
);
create index if not exists portal_links_customer on public.portal_links (company_id, customer_id);

alter table public.portal_links enable row level security;

drop policy if exists portal_links_select on public.portal_links;
create policy portal_links_select on public.portal_links for select
  using (public.company_role(company_id) is not null);

drop policy if exists portal_links_insert on public.portal_links;
create policy portal_links_insert on public.portal_links for insert
  with check (public.company_role(company_id) in ('owner', 'admin', 'member'));

-- Revoking is an update (revoked_at); links are never edited otherwise.
drop policy if exists portal_links_update on public.portal_links;
create policy portal_links_update on public.portal_links for update
  using (public.company_role(company_id) in ('owner', 'admin', 'member'))
  with check (public.company_role(company_id) in ('owner', 'admin', 'member'));

drop policy if exists portal_links_delete on public.portal_links;
create policy portal_links_delete on public.portal_links for delete
  using (public.company_role(company_id) in ('owner', 'admin'));

-- The portal function finds a customer's invoices by the customerId inside
-- the synced JSON; this keeps that lookup fast as the books grow.
create index if not exists records_customer on public.records (company_id, entity, (data->>'customerId'));
