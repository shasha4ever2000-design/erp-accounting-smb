-- Online payments: customers pay an invoice by card from the portal or from
-- a link in the invoice email. Run after 0002_email_and_portal.sql, in the
-- Supabase SQL Editor. Safe to re-run. Setup: docs/ONLINE-PAYMENTS.md.
--
--   payment_settings  the company's payment provider and its secret key.
--                     No policies at all: only the `pay` function (service
--                     role) reads or writes it, so the key never reaches a
--                     browser — not even an owner's.
--   online_payments   one row per checkout. The `pay` function creates and
--                     confirms them (it asks the provider, never trusts what
--                     is posted to it). Members can read their company's rows;
--                     the app marks a row as applied once it has recorded the
--                     receipt in the books, and that is the only thing a
--                     member can change.

create table if not exists public.payment_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  provider text not null check (provider in ('moyasar', 'stripe')),
  secret_key text not null,
  key_hint text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.payment_settings enable row level security;
revoke all on public.payment_settings from anon, authenticated;

create table if not exists public.online_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id text not null,
  invoice_number text not null default '',
  customer_id text not null default '',
  provider text not null check (provider in ('moyasar', 'stripe')),
  provider_ref text,
  amount numeric(16, 3) not null,
  currency text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'expired', 'refunded')),
  checkout_url text,
  paid_amount numeric(16, 3),
  fee numeric(16, 3),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  applied_ref text
);
create index if not exists online_payments_open on public.online_payments (company_id, status, applied_at);
create index if not exists online_payments_invoice on public.online_payments (company_id, invoice_id);
create unique index if not exists online_payments_ref on public.online_payments (provider, provider_ref);

alter table public.online_payments enable row level security;

drop policy if exists online_payments_select on public.online_payments;
create policy online_payments_select on public.online_payments for select
  using (public.company_role(company_id) is not null);

-- Marking a payment as recorded in the books. Only the three "applied"
-- columns are writable (see the grants below): a device claims an unclaimed
-- row before recording it, so two devices can't both record the same
-- payment, and only the claimer can hand it back if recording fails.
drop policy if exists online_payments_apply on public.online_payments;
create policy online_payments_apply on public.online_payments for update
  using (public.company_role(company_id) in ('owner', 'admin', 'member') and (applied_at is null or applied_by = auth.uid()))
  with check (public.company_role(company_id) in ('owner', 'admin', 'member'));

revoke insert, update, delete on public.online_payments from anon, authenticated;
grant update (applied_at, applied_by, applied_ref) on public.online_payments to authenticated;
