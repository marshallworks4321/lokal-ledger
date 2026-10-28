create or replace function public.create_business_with_location(
  business_name text,
  first_location_name text
)
returns table (business_id uuid, location_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_business_id uuid;
  new_location_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to create a business.';
  end if;
  if char_length(trim(coalesce(business_name, ''))) not between 2 and 100 then
    raise exception 'Business name must be between 2 and 100 characters.';
  end if;
  if char_length(trim(coalesce(first_location_name, ''))) not between 1 and 100 then
    raise exception 'Location name must be between 1 and 100 characters.';
  end if;

  insert into public.businesses (owner_id, name)
  values (auth.uid(), trim(business_name))
  returning id into new_business_id;

  insert into public.locations (business_id, name)
  values (new_business_id, trim(first_location_name))
  returning id into new_location_id;

  return query select new_business_id, new_location_id;
end;
$$;

revoke insert on public.businesses from authenticated;
revoke all on function public.create_business_with_location(text, text) from public, anon;
grant execute on function public.create_business_with_location(text, text) to authenticated;
