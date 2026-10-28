create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 1 and 160),
  normalized_name text generated always as (lower(trim(full_name))) stored,
  phone text check (phone is null or char_length(phone) <= 40),
  notes text not null default '' check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  unique (business_id, normalized_name),
  unique (id, business_id)
);

create table public.service_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  location_id uuid not null,
  customer_id uuid not null,
  title text not null check (char_length(trim(title)) between 2 and 120),
  description text not null default '' check (char_length(description) <= 1200),
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  completed_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (location_id, business_id)
    references public.locations (id, business_id) on delete cascade,
  foreign key (customer_id, business_id)
    references public.customers (id, business_id),
  check ((status = 'completed') = (completed_at is not null))
);

alter table public.transactions
  add column customer_id uuid;

alter table public.transactions
  add constraint transactions_customer_business_fk
  foreign key (customer_id, business_id)
  references public.customers (id, business_id)
  on delete no action;

create index service_records_business_due_idx
  on public.service_records (business_id, due_date)
  where status = 'pending';
create index service_records_customer_idx
  on public.service_records (customer_id, created_at desc);

create table public.smart_log_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count between 1 and 10)
);

insert into public.customers (business_id, full_name)
select distinct on (transaction_row.business_id, lower(trim(transaction_row.customer_name)))
  transaction_row.business_id,
  trim(transaction_row.customer_name)
from public.transactions as transaction_row
where transaction_row.kind = 'sale'
  and char_length(trim(coalesce(transaction_row.customer_name, ''))) > 0
order by
  transaction_row.business_id,
  lower(trim(transaction_row.customer_name)),
  transaction_row.created_at;

update public.transactions as transaction_row
set customer_id = customer.id
from public.customers as customer
where transaction_row.kind = 'sale'
  and customer.business_id = transaction_row.business_id
  and customer.normalized_name = lower(trim(transaction_row.customer_name));

alter table public.customers enable row level security;
alter table public.service_records enable row level security;
alter table public.smart_log_rate_limits enable row level security;

revoke all on public.customers from anon, authenticated;
revoke all on public.service_records from anon, authenticated;
revoke all on public.smart_log_rate_limits from anon, authenticated;
grant select, insert, update on public.customers to authenticated;
grant select, insert, update on public.service_records to authenticated;

create policy "Members can read customers"
  on public.customers for select to authenticated
  using (public.is_business_member(business_id));
create policy "Members can create customers"
  on public.customers for insert to authenticated
  with check (public.is_business_member(business_id));
create policy "Members can update customers"
  on public.customers for update to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

create policy "Members can read service records"
  on public.service_records for select to authenticated
  using (public.is_business_member(business_id));
create policy "Members can create service records"
  on public.service_records for insert to authenticated
  with check (
    public.is_business_member(business_id)
    and created_by = (select auth.uid())
  );
create policy "Members can update service records"
  on public.service_records for update to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

create function public.consume_smart_log_request()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  calling_user_id uuid := auth.uid();
  rate_limit_row public.smart_log_rate_limits%rowtype;
begin
  if calling_user_id is null then
    raise exception 'You must be signed in to use Smart Log.';
  end if;

  insert into public.smart_log_rate_limits (user_id, window_started_at, request_count)
  values (calling_user_id, statement_timestamp(), 1)
  on conflict (user_id) do nothing;

  select * into rate_limit_row
  from public.smart_log_rate_limits
  where user_id = calling_user_id
  for update;

  if rate_limit_row.window_started_at <= statement_timestamp() - interval '1 minute' then
    update public.smart_log_rate_limits
    set window_started_at = statement_timestamp(), request_count = 1
    where user_id = calling_user_id;
    return true;
  end if;

  if rate_limit_row.request_count >= 10 then
    return false;
  end if;

  update public.smart_log_rate_limits
  set request_count = request_count + 1
  where user_id = calling_user_id;
  return true;
end;
$$;

revoke all on function public.consume_smart_log_request() from public, anon;
grant execute on function public.consume_smart_log_request() to authenticated;

create or replace function public.record_transaction(
  target_business_id uuid,
  target_location_id uuid,
  transaction_type public.transaction_kind,
  transaction_total numeric,
  paid_amount numeric,
  customer text,
  payment_due date,
  lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_transaction_id uuid;
  transaction_customer_id uuid;
  line jsonb;
  product_row public.products%rowtype;
  line_product_id uuid;
  line_quantity integer;
  line_unit_price numeric(14, 2);
  line_total numeric(14, 2);
  line_count integer;
  distinct_product_count integer;
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
  if transaction_type not in ('sale', 'restock') then
    raise exception 'Choose a valid transaction type.';
  end if;
  if transaction_total is null or transaction_total <= 0 then
    raise exception 'Enter a total amount greater than zero.';
  end if;
  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then
    raise exception 'Add at least one product.';
  end if;
  if transaction_type = 'sale' then
    if char_length(trim(coalesce(customer, ''))) = 0 then
      raise exception 'Customer name is required for a sale.';
    end if;
    if paid_amount is null or paid_amount < 0 or paid_amount > transaction_total then
      raise exception 'Amount paid must be between zero and the sale total.';
    end if;

    insert into public.customers (business_id, full_name)
    values (target_business_id, trim(customer))
    on conflict (business_id, normalized_name)
    do update set full_name = excluded.full_name
    returning id into transaction_customer_id;
  elsif coalesce(paid_amount, 0) <> 0 or payment_due is not null then
    raise exception 'Payment and due date fields are only valid for sales.';
  end if;

  select count(*), count(distinct value->>'product_id')
    into line_count, distinct_product_count
  from jsonb_array_elements(lines);
  if line_count <> distinct_product_count then
    raise exception 'Each product can only appear once in a transaction.';
  end if;

  insert into public.transactions (
    business_id, location_id, kind, customer_name, customer_id, total_amount,
    amount_paid, due_date, created_by
  )
  values (
    target_business_id,
    target_location_id,
    transaction_type,
    case when transaction_type = 'sale' then trim(customer) else null end,
    transaction_customer_id,
    transaction_total,
    case when transaction_type = 'sale' then paid_amount else 0 end,
    case when transaction_type = 'sale' and paid_amount < transaction_total
      then payment_due else null end,
    auth.uid()
  )
  returning id into new_transaction_id;

  for line in select value from jsonb_array_elements(lines)
  loop
    line_product_id := (line->>'product_id')::uuid;
    line_quantity := (line->>'quantity')::integer;
    line_unit_price := (line->>'unit_price')::numeric(14, 2);

    if line_quantity is null or line_quantity <= 0 or line_unit_price is null or line_unit_price < 0 then
      raise exception 'Product quantities must be positive and unit prices cannot be negative.';
    end if;

    select * into product_row
    from public.products as product
    where product.id = line_product_id
      and product.business_id = target_business_id
      and product.location_id = target_location_id
    for update;

    if not found then
      raise exception 'A selected product does not belong to this business location.';
    end if;
    if transaction_type = 'sale' and product_row.quantity < line_quantity then
      raise exception 'Insufficient stock for "%": % available, % requested.',
        product_row.name, product_row.quantity, line_quantity;
    end if;

    line_total := line_quantity * line_unit_price;
    insert into public.transaction_items (
      business_id, transaction_id, product_id, quantity, unit_price, line_total
    )
    values (
      target_business_id, new_transaction_id, line_product_id,
      line_quantity, line_unit_price, line_total
    );

    update public.products
    set quantity = quantity + case when transaction_type = 'sale' then -line_quantity else line_quantity end
    where id = line_product_id;

    insert into public.stock_movements (
      business_id, location_id, product_id, transaction_id,
      quantity_delta, unit_price, created_by
    )
    values (
      target_business_id, target_location_id, line_product_id,
      new_transaction_id,
      case when transaction_type = 'sale' then -line_quantity else line_quantity end,
      line_unit_price,
      auth.uid()
    );
  end loop;

  if transaction_type = 'sale' and paid_amount > 0 then
    insert into public.transaction_payments (business_id, transaction_id, amount, recorded_by)
    values (target_business_id, new_transaction_id, paid_amount, auth.uid());
  end if;

  return new_transaction_id;
end;
$$;

revoke all on function public.record_transaction(
  uuid, uuid, public.transaction_kind, numeric, numeric, text, date, jsonb
) from public, anon;
grant execute on function public.record_transaction(
  uuid, uuid, public.transaction_kind, numeric, numeric, text, date, jsonb
) to authenticated;
