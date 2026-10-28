grant select on public.service_job_payments to authenticated;

create policy "Members can read service job payments"
  on public.service_job_payments for select to authenticated
  using (public.is_business_member(business_id));

create function public.schedule_service_followup(
  target_business_id uuid,
  target_location_id uuid,
  customer text,
  customer_phone text,
  follow_up_title text,
  follow_up_description text,
  follow_up_due date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  follow_up_customer_id uuid;
  new_follow_up_id uuid;
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
  if char_length(trim(coalesce(follow_up_title, ''))) not between 2 and 120 then
    raise exception 'Enter a follow-up title between 2 and 120 characters.';
  end if;
  if char_length(coalesce(follow_up_description, '')) > 1200 then
    raise exception 'Follow-up notes must be 1,200 characters or fewer.';
  end if;
  if follow_up_due is null then
    raise exception 'Choose a follow-up date.';
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
  returning id into follow_up_customer_id;

  insert into public.service_records (
    business_id, location_id, customer_id, title, description,
    due_date, created_by
  )
  values (
    target_business_id,
    target_location_id,
    follow_up_customer_id,
    trim(follow_up_title),
    trim(coalesce(follow_up_description, '')),
    follow_up_due,
    auth.uid()
  )
  returning id into new_follow_up_id;

  return new_follow_up_id;
end;
$$;

revoke all on function public.schedule_service_followup(
  uuid, uuid, text, text, text, text, date
) from public, anon;
grant execute on function public.schedule_service_followup(
  uuid, uuid, text, text, text, text, date
) to authenticated;
