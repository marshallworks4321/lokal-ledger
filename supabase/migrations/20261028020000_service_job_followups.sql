drop function public.record_service_job(
  uuid, uuid, text, text, text, date, numeric, numeric, date
);

create function public.record_service_job(
  target_business_id uuid,
  target_location_id uuid,
  customer text,
  customer_phone text,
  service_title text,
  service_description text,
  service_date date,
  service_total numeric,
  paid_amount numeric,
  payment_due date,
  maintenance_due date
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
  if char_length(coalesce(customer_phone, '')) > 40 then
    raise exception 'Customer phone numbers must be 40 characters or fewer.';
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
  if maintenance_due is not null and maintenance_due < service_date then
    raise exception 'The maintenance follow-up date cannot be before the service date.';
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

  insert into public.customers as existing_customer (business_id, full_name, phone)
  values (
    target_business_id,
    trim(customer),
    nullif(trim(coalesce(customer_phone, '')), '')
  )
  on conflict (business_id, normalized_name)
  do update set
    full_name = excluded.full_name,
    phone = coalesce(excluded.phone, existing_customer.phone)
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

  if maintenance_due is not null then
    insert into public.service_records (
      business_id, location_id, customer_id, title, description,
      due_date, created_by
    )
    values (
      target_business_id,
      target_location_id,
      service_customer_id,
      left('Follow-up: ' || trim(service_title), 120),
      left(
        concat_ws(
          E'\n',
          'Follow-up after completed work: ' || trim(service_title),
          nullif(trim(coalesce(service_description, '')), '')
        ),
        1200
      ),
      maintenance_due,
      auth.uid()
    );
  end if;

  return new_service_job_id;
end;
$$;

revoke all on function public.record_service_job(
  uuid, uuid, text, text, text, text, date, numeric, numeric, date, date
) from public, anon;
grant execute on function public.record_service_job(
  uuid, uuid, text, text, text, text, date, numeric, numeric, date, date
) to authenticated;
