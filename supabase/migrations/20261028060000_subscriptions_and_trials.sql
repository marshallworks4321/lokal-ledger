create table if not exists public.account_subscriptions (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  trial_started_at timestamptz not null,
  trial_ends_at timestamptz not null,
  access_until timestamptz,
  plan_tier text check (plan_tier in ('single', 'multi')),
  billing_mode text check (billing_mode in ('manual', 'automatic')),
  paystack_customer_code text,
  paystack_subscription_code text,
  auto_renew boolean not null default false,
  updated_at timestamptz not null default now(),
  check (trial_ends_at > trial_started_at)
);

create table if not exists public.subscription_checkouts (
  reference text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  customer_email text not null,
  plan_tier text not null check (plan_tier in ('single', 'multi')),
  billing_mode text not null check (billing_mode in ('manual', 'automatic')),
  amount_kobo integer not null check (amount_kobo in (300000, 500000)),
  status text not null default 'pending' check (status in ('pending', 'completed')),
  created_at timestamptz not null default now()
);

create table if not exists public.subscription_payments (
  reference text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  amount_kobo integer not null check (amount_kobo in (300000, 500000)),
  plan_tier text not null check (plan_tier in ('single', 'multi')),
  billing_mode text not null check (billing_mode in ('manual', 'automatic')),
  paid_at timestamptz not null default now()
);

create table if not exists public.paystack_subscription_secrets (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  subscription_code text not null,
  email_token text not null,
  updated_at timestamptz not null default now()
);

grant all on public.account_subscriptions to service_role;
grant all on public.subscription_checkouts to service_role;
grant all on public.subscription_payments to service_role;
grant all on public.paystack_subscription_secrets to service_role;

alter table public.account_subscriptions enable row level security;
alter table public.subscription_checkouts enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.paystack_subscription_secrets enable row level security;

revoke all on public.account_subscriptions from public, anon, authenticated;
revoke all on public.subscription_checkouts from public, anon, authenticated;
revoke all on public.subscription_payments from public, anon, authenticated;
revoke all on public.paystack_subscription_secrets from public, anon, authenticated;

grant select on public.account_subscriptions to authenticated;
grant select on public.subscription_payments to authenticated;

create policy "Owners can read their subscription"
  on public.account_subscriptions for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "Owners can read their subscription payments"
  on public.subscription_payments for select to authenticated
  using (owner_id = (select auth.uid()));

insert into public.account_subscriptions (
  owner_id,
  trial_started_at,
  trial_ends_at
)
select distinct
  business.owner_id,
  now(),
  now() + interval '21 days'
from public.businesses as business
on conflict (owner_id) do nothing;

create or replace function public.get_my_subscription_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  subscription_row public.account_subscriptions%rowtype;
  owned_business_count integer;
  trial_active boolean;
  paid_active boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view subscription status.';
  end if;

  select count(*)::integer into owned_business_count
  from public.businesses
  where owner_id = auth.uid();

  select * into subscription_row
  from public.account_subscriptions
  where owner_id = auth.uid();

  if not found then
    return jsonb_build_object(
      'business_count', owned_business_count,
      'tier', case when owned_business_count > 1 then 'multi' else 'single' end,
      'trial_started_at', null,
      'trial_ends_at', null,
      'access_until', null,
      'trial_active', false,
      'paid_active', false,
      'access_active', owned_business_count = 0,
      'billing_mode', null,
      'auto_renew', false
    );
  end if;

  trial_active := subscription_row.trial_ends_at > now();
  paid_active := subscription_row.access_until is not null
    and subscription_row.access_until > now();

  return jsonb_build_object(
    'business_count', owned_business_count,
    'tier', case when owned_business_count > 1 then 'multi' else coalesce(subscription_row.plan_tier, 'single') end,
    'trial_started_at', subscription_row.trial_started_at,
    'trial_ends_at', subscription_row.trial_ends_at,
    'access_until', subscription_row.access_until,
    'trial_active', trial_active,
    'paid_active', paid_active,
    'access_active', trial_active or paid_active,
    'billing_mode', subscription_row.billing_mode,
    'auto_renew', subscription_row.auto_renew
  );
end;
$$;

revoke all on function public.get_my_subscription_status() from public, anon;
grant execute on function public.get_my_subscription_status() to authenticated;

create or replace function public.require_active_business_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_owner_id uuid;
  subscription_row public.account_subscriptions%rowtype;
  business_count integer;
  target_business_id uuid;
begin
  if tg_table_name = 'businesses' then
    if tg_op = 'DELETE' then
      business_owner_id := old.owner_id;
    else
      business_owner_id := new.owner_id;
    end if;

    if tg_op = 'INSERT' then
      if auth.uid() is null or business_owner_id <> auth.uid() then
        raise exception 'You can only create a business for your own account.';
      end if;

      insert into public.account_subscriptions (
        owner_id,
        trial_started_at,
        trial_ends_at
      )
      values (
        business_owner_id,
        now(),
        now() + interval '21 days'
      )
      on conflict (owner_id) do nothing;
    end if;
  else
    if tg_op = 'DELETE' then
      target_business_id := (to_jsonb(old)->>'business_id')::uuid;
    else
      target_business_id := (to_jsonb(new)->>'business_id')::uuid;
    end if;

    select owner_id into business_owner_id
    from public.businesses
    where id = target_business_id;

    if not found then
      raise exception 'Business not found.';
    end if;
  end if;

  select * into subscription_row
  from public.account_subscriptions
  where owner_id = business_owner_id
  for update;

  if not found or (
    subscription_row.trial_ends_at <= now()
    and (subscription_row.access_until is null or subscription_row.access_until <= now())
  ) then
    raise exception 'Your 21-day trial has ended. Subscribe to continue using full features.';
  end if;

  if tg_table_name = 'businesses' and tg_op = 'INSERT' then
    select count(*)::integer into business_count
    from public.businesses
    where owner_id = business_owner_id;

    if business_count >= 1
      and subscription_row.trial_ends_at <= now()
      and subscription_row.plan_tier <> 'multi' then
      raise exception 'A multi-business subscription is required to add another business.';
    end if;
  end if;

  if tg_table_name <> 'businesses' and tg_op = 'UPDATE' then
    if (to_jsonb(old)->>'business_id') is distinct from (to_jsonb(new)->>'business_id') then
      raise exception 'Records cannot be moved between businesses.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.require_active_business_subscription() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'businesses',
    'locations',
    'products',
    'customers',
    'transactions',
    'transaction_items',
    'transaction_payments',
    'stock_movements',
    'service_records',
    'service_jobs',
    'service_job_payments'
  ]
  loop
    execute format(
      'drop trigger if exists require_active_subscription on public.%I',
      table_name
    );
    execute format(
      'create trigger require_active_subscription before insert or update or delete on public.%I for each row execute function public.require_active_business_subscription()',
      table_name
    );
  end loop;
end;
$$;

create or replace function public.complete_subscription_checkout(
  target_reference text,
  target_owner_id uuid,
  verified_amount_kobo integer,
  verified_customer_code text,
  verified_subscription_code text,
  verified_email_token text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  checkout_row public.subscription_checkouts%rowtype;
  current_access_until timestamptz;
  inserted_reference text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the verified payment service can record subscription payments.';
  end if;

  select * into checkout_row
  from public.subscription_checkouts
  where reference = target_reference
    and owner_id = target_owner_id
  for update;

  if not found then
    raise exception 'Subscription checkout reference not found.';
  end if;
  if checkout_row.status = 'completed' then
    return false;
  end if;
  if checkout_row.amount_kobo <> verified_amount_kobo then
    raise exception 'Verified payment amount does not match the checkout.';
  end if;

  insert into public.subscription_payments (
    reference, owner_id, amount_kobo, plan_tier, billing_mode
  )
  values (
    checkout_row.reference,
    checkout_row.owner_id,
    checkout_row.amount_kobo,
    checkout_row.plan_tier,
    checkout_row.billing_mode
  )
  on conflict (reference) do nothing
  returning reference into inserted_reference;

  if inserted_reference is null then
    update public.subscription_checkouts
    set status = 'completed'
    where reference = target_reference;
    return false;
  end if;

  select access_until into current_access_until
  from public.account_subscriptions
  where owner_id = target_owner_id
  for update;

  update public.account_subscriptions
  set access_until = greatest(coalesce(current_access_until, now()), now()) + interval '30 days',
      plan_tier = checkout_row.plan_tier,
      billing_mode = checkout_row.billing_mode,
      paystack_customer_code = coalesce(nullif(verified_customer_code, ''), paystack_customer_code),
      paystack_subscription_code = coalesce(nullif(verified_subscription_code, ''), paystack_subscription_code),
      auto_renew = checkout_row.billing_mode = 'automatic'
        and nullif(verified_subscription_code, '') is not null
        and nullif(verified_email_token, '') is not null,
      updated_at = now()
  where owner_id = target_owner_id;

  if checkout_row.billing_mode = 'automatic'
    and nullif(verified_subscription_code, '') is not null
    and nullif(verified_email_token, '') is not null then
    insert into public.paystack_subscription_secrets (
      owner_id, subscription_code, email_token
    )
    values (
      target_owner_id, verified_subscription_code, verified_email_token
    )
    on conflict (owner_id) do update
      set subscription_code = excluded.subscription_code,
          email_token = excluded.email_token,
          updated_at = now();
  end if;

  update public.subscription_checkouts
  set status = 'completed'
  where reference = target_reference;

  return true;
end;
$$;

revoke all on function public.complete_subscription_checkout(
  text, uuid, integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.complete_subscription_checkout(
  text, uuid, integer, text, text, text
) to service_role;

create or replace function public.record_subscription_renewal(
  target_reference text,
  target_owner_id uuid,
  verified_amount_kobo integer,
  verified_customer_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription_row public.account_subscriptions%rowtype;
  expected_amount integer;
  inserted_reference text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the verified payment service can record subscription renewals.';
  end if;

  select * into subscription_row
  from public.account_subscriptions
  where owner_id = target_owner_id
  for update;

  if not found or subscription_row.billing_mode <> 'automatic' then
    raise exception 'No automatic subscription is associated with this payment.';
  end if;

  expected_amount := case subscription_row.plan_tier
    when 'single' then 300000
    when 'multi' then 500000
    else null
  end;
  if expected_amount is null or expected_amount <> verified_amount_kobo then
    raise exception 'Renewal amount does not match the active subscription plan.';
  end if;

  insert into public.subscription_payments (
    reference, owner_id, amount_kobo, plan_tier, billing_mode
  )
  values (
    target_reference,
    target_owner_id,
    verified_amount_kobo,
    subscription_row.plan_tier,
    'automatic'
  )
  on conflict (reference) do nothing
  returning reference into inserted_reference;

  if inserted_reference is null then
    return false;
  end if;

  update public.account_subscriptions
  set access_until = greatest(coalesce(access_until, now()), now()) + interval '30 days',
      paystack_customer_code = coalesce(nullif(verified_customer_code, ''), paystack_customer_code),
      auto_renew = true,
      updated_at = now()
  where owner_id = target_owner_id;

  return true;
end;
$$;

revoke all on function public.record_subscription_renewal(text, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.record_subscription_renewal(text, uuid, integer, text)
  to service_role;
