create table public.service_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  location_id uuid not null,
  customer_id uuid not null,
  title text not null check (char_length(trim(title)) between 2 and 160),
  description text not null default '' check (char_length(description) <= 1200),
  service_date date not null default current_date,
  total_amount numeric(14, 2) not null check (total_amount > 0),
  amount_paid numeric(14, 2) not null default 0
    check (amount_paid >= 0 and amount_paid <= total_amount),
  due_date date,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (location_id, business_id)
    references public.locations (id, business_id) on delete cascade,
  foreign key (customer_id, business_id)
    references public.customers (id, business_id)
);

create table public.service_job_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  service_job_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  recorded_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (service_job_id, business_id)
    references public.service_jobs (id, business_id) on delete cascade
);

create index service_jobs_business_date_idx
  on public.service_jobs (business_id, service_date desc);
create index service_jobs_open_balance_idx
  on public.service_jobs (business_id, due_date)
  where amount_paid < total_amount;
create index service_job_payments_job_idx
  on public.service_job_payments (service_job_id, created_at desc);

alter table public.service_jobs enable row level security;
alter table public.service_job_payments enable row level security;

revoke all on public.service_jobs from anon, authenticated;
revoke all on public.service_job_payments from anon, authenticated;
grant select on public.service_jobs to authenticated;

create policy "Members can read service jobs"
  on public.service_jobs for select to authenticated
  using (public.is_business_member(business_id));

create function public.record_service_job(
  target_business_id uuid,
  target_location_id uuid,
  customer text,
  service_title text,
  service_description text,
  service_date date,
  service_total numeric,
  paid_amount numeric,
  payment_due date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_service_job_id uuid;
  service_customer_id uuid;
begin
  if auth.uid() is null or not public.is_business_member(target_business_id) then
    raise exception 'You do not have access to this business.';
  end if;
  if not exists (
    select 1 from public.locations as location
    where location.id = target_location_id
      and location.business_id = target_business_id
  ) then
    raise exception 'The selected location does not belong to this business.';
  end if;
  if char_length(trim(coalesce(customer, ''))) not between 1 and 160 then
    raise exception 'Enter the customer name.';
  end if;
  if char_length(trim(coalesce(service_title, ''))) not between 2 and 160 then
    raise exception 'Enter a service description between 2 and 160 characters.';
  end if;
  if char_length(coalesce(service_description, '')) > 1200 then
    raise exception 'Service notes must be 1,200 characters or fewer.';
  end if;
  if service_date is null then
    raise exception 'Enter the date the service was provided.';
  end if;
  if service_total is null or service_total <= 0 then
    raise exception 'Enter a service fee greater than zero.';
  end if;
  if paid_amount is null or paid_amount < 0 or paid_amount > service_total then
    raise exception 'Amount paid must be between zero and the service fee.';
  end if;
  if paid_amount = service_total and payment_due is not null then
    payment_due := null;
  end if;

  insert into public.customers (business_id, full_name)
  values (target_business_id, trim(customer))
  on conflict (business_id, normalized_name)
  do update set full_name = excluded.full_name
  returning id into service_customer_id;

  insert into public.service_jobs (
    business_id, location_id, customer_id, title, description,
    service_date, total_amount, amount_paid, due_date, created_by
  )
  values (
    target_business_id, target_location_id, service_customer_id,
    trim(service_title), trim(coalesce(service_description, '')),
    service_date, service_total, paid_amount,
    case when paid_amount < service_total then payment_due else null end,
    auth.uid()
  )
  returning id into new_service_job_id;

  if paid_amount > 0 then
    insert into public.service_job_payments (business_id, service_job_id, amount, recorded_by)
    values (target_business_id, new_service_job_id, paid_amount, auth.uid());
  end if;

  return new_service_job_id;
end;
$$;

create function public.record_service_job_payment(
  target_service_job_id uuid,
  payment_amount numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  service_job_row public.service_jobs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to record a payment.';
  end if;
  if payment_amount is null or payment_amount <= 0 then
    raise exception 'Enter a payment amount greater than zero.';
  end if;

  select * into service_job_row
  from public.service_jobs
  where id = target_service_job_id
  for update;

  if not found or not public.is_business_member(service_job_row.business_id) then
    raise exception 'You do not have access to this service job.';
  end if;
  if payment_amount > service_job_row.total_amount - service_job_row.amount_paid then
    raise exception 'Payment exceeds the remaining service balance.';
  end if;

  update public.service_jobs
  set amount_paid = amount_paid + payment_amount,
      due_date = case
        when amount_paid + payment_amount = total_amount then null
        else due_date
      end
  where id = target_service_job_id;

  insert into public.service_job_payments (business_id, service_job_id, amount, recorded_by)
  values (service_job_row.business_id, target_service_job_id, payment_amount, auth.uid());
end;
$$;

revoke all on function public.record_service_job(
  uuid, uuid, text, text, text, date, numeric, numeric, date
) from public, anon;
grant execute on function public.record_service_job(
  uuid, uuid, text, text, text, date, numeric, numeric, date
) to authenticated;

revoke all on function public.record_service_job_payment(uuid, numeric) from public, anon;
grant execute on function public.record_service_job_payment(uuid, numeric) to authenticated;
