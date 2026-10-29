create table public.owner_subscriptions (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  trial_started_at timestamptz not null,
  trial_ends_at timestamptz not null,
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'canceled')),
  plan_tier text check (plan_tier is null or plan_tier in ('single', 'multi')),
  next_payment_date timestamptz,
  cancel_at_period_end boolean not null default false,
  checkout_reference text unique,
  checkout_url text,
  checkout_started_at timestamptz,
  checkout_email text,
  pending_plan_tier text check (pending_plan_tier is null or pending_plan_tier in ('single', 'multi')),
  pending_plan_code text,
  paystack_customer_code text,
  paystack_subscription_code text unique,
  paystack_email_token text,
  last_payment_reference text,
  last_invoice_code text,
  last_invoice_due_date timestamptz,
  last_invoice_paid boolean not null default false,
  updated_at timestamptz not null default now(),
  check (trial_ends_at > trial_started_at)
);

alter table public.owner_subscriptions enable row level security;
revoke all on public.owner_subscriptions from public, anon, authenticated;

insert into public.owner_subscriptions (owner_id, trial_started_at, trial_ends_at, status)
select distinct business.owner_id,
       statement_timestamp(),
       statement_timestamp() + interval '21 days',
       'trialing'
from public.businesses as business
on conflict (owner_id) do nothing;

create function public.start_owner_trial_before_business_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trial_start timestamptz := statement_timestamp();
begin
  insert into public.owner_subscriptions (owner_id, trial_started_at, trial_ends_at, status)
  values (new.owner_id, trial_start, trial_start + interval '21 days', 'trialing')
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

revoke all on function public.start_owner_trial_before_business_insert() from public, anon, authenticated;

create trigger businesses_start_owner_trial
before insert on public.businesses
for each row execute function public.start_owner_trial_before_business_insert();

create function public.owner_subscription_is_active(target_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.owner_subscriptions as subscription
    where subscription.owner_id = target_owner_id
      and (
        (subscription.status = 'trialing' and subscription.trial_ends_at > statement_timestamp())
        or (subscription.status = 'active' and (
          subscription.next_payment_date is null
          or subscription.next_payment_date > statement_timestamp()
        ))
      )
  );
$$;

revoke all on function public.owner_subscription_is_active(uuid) from public, anon, authenticated;

create function public.current_user_has_active_subscription()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_members as membership
    join public.businesses as business on business.id = membership.business_id
    where membership.user_id = (select auth.uid())
      and public.owner_subscription_is_active(business.owner_id)
  ) and not exists (
    select 1
    from public.business_members as membership
    join public.businesses as business on business.id = membership.business_id
    where membership.user_id = (select auth.uid())
      and not public.owner_subscription_is_active(business.owner_id)
  );
$$;

revoke all on function public.current_user_has_active_subscription() from public, anon;
grant execute on function public.current_user_has_active_subscription() to authenticated;

create function public.get_business_subscription_summary(target_business_id uuid)
returns table (
  business_id uuid,
  owner_id uuid,
  status text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  plan_tier text,
  next_payment_date timestamptz,
  cancel_at_period_end boolean,
  branch_count bigint,
  has_access boolean,
  can_manage boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_owner_id uuid;
begin
  if auth.uid() is null or not public.is_business_member(target_business_id) then
    raise exception 'You do not have access to this business.';
  end if;

  select business.owner_id into target_owner_id
  from public.businesses as business
  where business.id = target_business_id;

  if target_owner_id is null then
    raise exception 'Business not found.';
  end if;

  return query
  select
    target_business_id,
    subscription.owner_id,
    subscription.status,
    subscription.trial_started_at,
    subscription.trial_ends_at,
    subscription.plan_tier,
    subscription.next_payment_date,
    subscription.cancel_at_period_end,
    (
      select count(*)
      from public.locations as location
      join public.businesses as owned_business on owned_business.id = location.business_id
      where owned_business.owner_id = target_owner_id
    ),
    public.owner_subscription_is_active(target_owner_id),
    target_owner_id = (select auth.uid())
  from public.owner_subscriptions as subscription
  where subscription.owner_id = target_owner_id;
end;
$$;

revoke all on function public.get_business_subscription_summary(uuid) from public, anon;
grant execute on function public.get_business_subscription_summary(uuid) to authenticated;

create function public.reserve_owner_subscription_checkout(
  target_owner_id uuid,
  target_reference text,
  target_started_at timestamptz,
  target_email text,
  target_plan_tier text,
  target_plan_code text,
  target_expected_branch_count bigint,
  target_previous_reference text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_subscription public.owner_subscriptions%rowtype;
  actual_branch_count bigint;
  expected_plan_tier text;
begin
  if target_owner_id is null
     or target_reference is null
     or target_started_at is null
     or target_email is null
     or target_plan_code is null
     or target_plan_tier is null
     or target_plan_tier not in ('single', 'multi') then
    return false;
  end if;

  select * into current_subscription
  from public.owner_subscriptions as subscription
  where subscription.owner_id = target_owner_id
  for update;

  if not found then
    return false;
  end if;
  if target_previous_reference is null then
    if current_subscription.checkout_reference is not null then
      return false;
    end if;
  elsif current_subscription.checkout_reference is distinct from target_previous_reference then
    return false;
  end if;

  if current_subscription.status = 'trialing' then
    if current_subscription.trial_ends_at > statement_timestamp() then
      return false;
    end if;
  elsif current_subscription.status = 'active' then
    if not current_subscription.cancel_at_period_end
       or current_subscription.next_payment_date is null
       or current_subscription.next_payment_date > statement_timestamp() then
      return false;
    end if;
  elsif current_subscription.status <> 'canceled' then
    return false;
  end if;

  select count(*) into actual_branch_count
  from public.locations as location
  join public.businesses as business on business.id = location.business_id
  where business.owner_id = target_owner_id;

  expected_plan_tier := case when actual_branch_count = 1 then 'single' else 'multi' end;
  if actual_branch_count < 1
     or target_expected_branch_count is null
     or actual_branch_count <> target_expected_branch_count
     or expected_plan_tier <> target_plan_tier then
    return false;
  end if;

  update public.owner_subscriptions
  set checkout_reference = target_reference,
      checkout_url = null,
      checkout_started_at = target_started_at,
      checkout_email = lower(target_email),
      pending_plan_tier = target_plan_tier,
      pending_plan_code = target_plan_code,
      paystack_customer_code = case
        when current_subscription.status = 'active' then null
        else paystack_customer_code
      end,
      paystack_subscription_code = case
        when current_subscription.status = 'active' then null
        else paystack_subscription_code
      end,
      paystack_email_token = case
        when current_subscription.status = 'active' then null
        else paystack_email_token
      end,
      next_payment_date = case
        when current_subscription.status = 'canceled' then null
        else next_payment_date
      end,
      updated_at = target_started_at
  where owner_id = target_owner_id;

  return true;
end;
$$;

revoke all on function public.reserve_owner_subscription_checkout(uuid, text, timestamptz, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.reserve_owner_subscription_checkout(uuid, text, timestamptz, text, text, text, bigint, text) to service_role;

create function public.record_paystack_invoice_status(
  target_subscription_code text,
  target_invoice_code text,
  target_due_date timestamptz,
  target_paid boolean,
  target_next_payment_date timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_owner_id uuid;
  previous_due_date timestamptz;
  previous_paid boolean;
begin
  if target_subscription_code is null or target_due_date is null or target_paid is null then
    return false;
  end if;

  select subscription.owner_id,
         subscription.last_invoice_due_date,
         subscription.last_invoice_paid
  into matched_owner_id, previous_due_date, previous_paid
  from public.owner_subscriptions as subscription
  where subscription.paystack_subscription_code = target_subscription_code
  for update;

  if matched_owner_id is null then
    return false;
  end if;

  if previous_due_date is not null and target_due_date < previous_due_date then
    return false;
  end if;
  if previous_due_date = target_due_date and previous_paid and not target_paid then
    return false;
  end if;

  update public.owner_subscriptions
  set status = case when target_paid then 'active' else 'past_due' end,
      last_invoice_code = target_invoice_code,
      last_invoice_due_date = target_due_date,
      last_invoice_paid = target_paid,
      next_payment_date = coalesce(target_next_payment_date, next_payment_date),
      updated_at = statement_timestamp()
  where owner_id = matched_owner_id
    and paystack_subscription_code = target_subscription_code;

  return true;
end;
$$;

revoke all on function public.record_paystack_invoice_status(text, text, timestamptz, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.record_paystack_invoice_status(text, text, timestamptz, boolean, timestamptz) to service_role;

create function public.enforce_active_subscription_for_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_business_id uuid;
  target_owner_id uuid;
  source_business_id uuid;
  source_owner_id uuid;
  current_plan_tier text;
  current_pending_plan_tier text;
  current_checkout_reference text;
  current_cancel_at_period_end boolean;
  current_next_payment_date timestamptz;
  existing_branch_count bigint;
begin
  if auth.uid() is null then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'An authenticated user or service role is required for this change.';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op = 'DELETE' then
    target_business_id := nullif(to_jsonb(old)->>'business_id', '')::uuid;
  else
    target_business_id := nullif(to_jsonb(new)->>'business_id', '')::uuid;
  end if;
  if target_business_id is null then
    raise exception 'A business is required for this change.';
  end if;

  select business.owner_id into target_owner_id
  from public.businesses as business
  where business.id = target_business_id;

  if target_owner_id is null and tg_op = 'DELETE' then
    return old;
  end if;
  if target_owner_id is null or not public.owner_subscription_is_active(target_owner_id) then
    raise exception 'This account trial has ended. The business owner must subscribe before making changes.';
  end if;

  if tg_op = 'UPDATE' then
    source_business_id := nullif(to_jsonb(old)->>'business_id', '')::uuid;
    if source_business_id is distinct from target_business_id then
      select business.owner_id into source_owner_id
      from public.businesses as business
      where business.id = source_business_id;

      if source_owner_id is null or not public.owner_subscription_is_active(source_owner_id) then
        raise exception 'The source business trial has ended. The source owner must subscribe before moving this record.';
      end if;
    end if;
  end if;

  if tg_table_name = 'locations' and tg_op in ('INSERT', 'DELETE') then
    perform 1
    from public.owner_subscriptions as subscription
    where subscription.owner_id = target_owner_id
    for update;

    select subscription.plan_tier,
           subscription.pending_plan_tier,
           subscription.checkout_reference,
           subscription.cancel_at_period_end,
           subscription.next_payment_date
    into current_plan_tier,
         current_pending_plan_tier,
         current_checkout_reference,
         current_cancel_at_period_end,
         current_next_payment_date
    from public.owner_subscriptions as subscription
    where subscription.owner_id = target_owner_id;

    if tg_op = 'INSERT' and current_plan_tier = 'single' then
      select count(*) into existing_branch_count
      from public.locations as location
      join public.businesses as business on business.id = location.business_id
      where business.owner_id = target_owner_id;

      if existing_branch_count >= 1 then
        raise exception 'The one-branch plan includes one location. The owner must move to the multi-branch plan before adding another location.';
      end if;
    end if;

    if tg_op = 'INSERT' and current_checkout_reference is not null and current_pending_plan_tier = 'single' then
      select count(*) into existing_branch_count
      from public.locations as location
      join public.businesses as business on business.id = location.business_id
      where business.owner_id = target_owner_id;

      if existing_branch_count >= 1 then
        raise exception 'A one-branch checkout is already pending. Finish that checkout before adding another location.';
      end if;
    end if;

    if tg_op = 'DELETE' then
      if current_checkout_reference is not null then
        raise exception 'A subscription checkout is pending. Finish or reconcile it before deleting a location.';
      end if;

      if current_plan_tier is not null
         and (not coalesce(current_cancel_at_period_end, false) or current_next_payment_date is null) then
        select count(*) into existing_branch_count
        from public.locations as location
        join public.businesses as business on business.id = location.business_id
        where business.owner_id = target_owner_id;

        if current_plan_tier = 'single' and existing_branch_count <= 1 then
          raise exception 'The active one-branch subscription requires one registered location. Cancel renewal before deleting its last location.';
        end if;
        if current_plan_tier = 'multi' and existing_branch_count <= 2 then
          raise exception 'The active multi-branch subscription requires at least two locations. Cancel renewal before reducing below two.';
        end if;
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_active_subscription_for_write() from public, anon, authenticated;

do $$
declare
  target_table record;
begin
  for target_table in
    select distinct table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'business_id'
  loop
    execute format('drop trigger if exists enforce_active_subscription_write on public.%I', target_table.table_name);
    execute format(
      'create trigger enforce_active_subscription_write before insert or update or delete on public.%I for each row execute function public.enforce_active_subscription_for_write()',
      target_table.table_name
    );
  end loop;
end;
$$;

create function public.enforce_active_subscription_for_business_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  billing public.owner_subscriptions%rowtype;
  total_branch_count bigint;
  branches_in_business bigint;
  remaining_branch_count bigint;
  other_business_count bigint;
  minimum_branch_count bigint;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'An authenticated user or service role is required for this change.';
  end if;
  if tg_op = 'DELETE' then
    if auth.uid() is null then
      return old;
    end if;
    if auth.uid() <> old.owner_id then
      raise exception 'Only the business owner can delete this business.';
    end if;

    select * into billing
    from public.owner_subscriptions as subscription
    where subscription.owner_id = old.owner_id
    for update;
    if not found then
      raise exception 'The business subscription record is missing.';
    end if;
    if billing.checkout_reference is not null then
      raise exception 'A subscription checkout is pending. Finish or reconcile it before deleting this business.';
    end if;

    if not public.owner_subscription_is_active(old.owner_id) then
      if billing.status = 'canceled'
         and billing.paystack_subscription_code is null
         and billing.paystack_email_token is null then
        return old;
      end if;
      raise exception 'This account trial has ended. The business owner must subscribe or finish cancellation before deleting this business.';
    end if;

    select count(*) into total_branch_count
    from public.locations as location
    join public.businesses as business on business.id = location.business_id
    where business.owner_id = old.owner_id;

    select count(*) into branches_in_business
    from public.locations as location
    where location.business_id = old.id;

    remaining_branch_count := total_branch_count - branches_in_business;

    select count(*) into other_business_count
    from public.businesses as business
    where business.owner_id = old.owner_id
      and business.id <> old.id;

    if other_business_count = 0
       and (billing.status in ('active', 'past_due')
         or billing.paystack_subscription_code is not null
         or billing.paystack_email_token is not null) then
      raise exception 'Cancel the Paystack subscription and wait for the paid period to end before deleting the final business.';
    end if;

    if billing.status = 'active'
       and billing.plan_tier is not null
       and (not billing.cancel_at_period_end
         or billing.next_payment_date is null
         or billing.next_payment_date <= statement_timestamp()) then
      minimum_branch_count := case when billing.plan_tier = 'single' then 1 else 2 end;
      if remaining_branch_count < minimum_branch_count then
        raise exception 'This deletion would reduce branches below the active subscription tier. Cancel renewal before reducing the branch count.';
      end if;
    end if;
    return old;
  end if;

  if auth.uid() is not null and not public.owner_subscription_is_active(old.owner_id) then
    raise exception 'This account trial has ended. The business owner must subscribe before making changes.';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_active_subscription_for_business_update() from public, anon, authenticated;

create trigger enforce_active_subscription_business_update
before update or delete on public.businesses
for each row execute function public.enforce_active_subscription_for_business_update();
