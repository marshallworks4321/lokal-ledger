create type public.business_role as enum ('owner', 'manager', 'staff');
create type public.transaction_kind as enum ('sale', 'restock');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  created_at timestamptz not null default now()
);

create table public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.business_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (business_id, name),
  unique (id, business_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  location_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 160),
  category text not null default 'Uncategorized',
  quantity integer not null default 0 check (quantity >= 0),
  unit_price numeric(14, 2) not null default 0 check (unit_price >= 0),
  created_at timestamptz not null default now(),
  unique (location_id, name),
  unique (id, business_id),
  foreign key (location_id, business_id)
    references public.locations (id, business_id) on delete cascade
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  location_id uuid not null,
  kind public.transaction_kind not null,
  customer_name text,
  total_amount numeric(14, 2) not null check (total_amount > 0),
  amount_paid numeric(14, 2) not null default 0
    check (amount_paid >= 0 and amount_paid <= total_amount),
  due_date date,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  check (kind = 'sale' or (customer_name is null and amount_paid = 0 and due_date is null)),
  foreign key (location_id, business_id)
    references public.locations (id, business_id) on delete cascade
);

create table public.transaction_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  product_id uuid not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  line_total numeric(14, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  foreign key (product_id, business_id)
    references public.products (id, business_id) on delete restrict
);

create table public.transaction_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  recorded_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  location_id uuid not null,
  product_id uuid not null,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  quantity_delta integer not null check (quantity_delta <> 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (location_id, business_id)
    references public.locations (id, business_id) on delete cascade,
  foreign key (product_id, business_id)
    references public.products (id, business_id) on delete restrict
);

create index business_members_user_id_idx on public.business_members (user_id);
create index locations_business_id_idx on public.locations (business_id);
create index products_business_location_idx on public.products (business_id, location_id);
create index transactions_business_created_at_idx on public.transactions (business_id, created_at desc);
create index transactions_open_credit_idx on public.transactions (business_id, due_date)
  where kind = 'sale' and amount_paid < total_amount;
create index transaction_items_transaction_id_idx on public.transaction_items (transaction_id);
create index transaction_payments_transaction_id_idx on public.transaction_payments (transaction_id);
create index stock_movements_product_created_at_idx on public.stock_movements (product_id, created_at desc);

create function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_members as member
    where member.business_id = target_business_id
      and member.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_business_member(uuid) from public, anon;
grant execute on function public.is_business_member(uuid) to authenticated;

create function public.add_business_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.business_members (business_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger businesses_add_owner_membership
after insert on public.businesses
for each row execute function public.add_business_owner_membership();

create function public.create_business_with_location(
  business_name text,
  first_location_name text
)
returns table (business_id uuid, location_id uuid)
language plpgsql
security invoker
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

create function public.record_transaction(
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
    business_id, location_id, kind, customer_name, total_amount,
    amount_paid, due_date, created_by
  )
  values (
    target_business_id,
    target_location_id,
    transaction_type,
    case when transaction_type = 'sale' then trim(customer) else null end,
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

create function public.record_payment(target_transaction_id uuid, payment_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_row public.transactions%rowtype;
  new_paid_total numeric(14, 2);
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to record a payment.';
  end if;
  if payment_amount is null or payment_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  select * into transaction_row
  from public.transactions as txn
  where txn.id = target_transaction_id
    and txn.kind = 'sale'
  for update;

  if not found or not public.is_business_member(transaction_row.business_id) then
    raise exception 'Sale not found or you do not have access.';
  end if;
  if transaction_row.amount_paid + payment_amount > transaction_row.total_amount then
    raise exception 'Payment exceeds the outstanding balance.';
  end if;

  new_paid_total := transaction_row.amount_paid + payment_amount;
  insert into public.transaction_payments (business_id, transaction_id, amount, recorded_by)
  values (transaction_row.business_id, transaction_row.id, payment_amount, auth.uid());

  update public.transactions
  set amount_paid = new_paid_total,
      due_date = case when new_paid_total = total_amount then null else due_date end
  where id = transaction_row.id;

  return new_paid_total;
end;
$$;

revoke all on function public.create_business_with_location(text, text) from public, anon;
revoke all on function public.record_transaction(uuid, uuid, public.transaction_kind, numeric, numeric, text, date, jsonb) from public, anon;
revoke all on function public.record_payment(uuid, numeric) from public, anon;
revoke all on function public.add_business_owner_membership() from public, anon, authenticated;
grant execute on function public.create_business_with_location(text, text) to authenticated;
grant execute on function public.record_transaction(uuid, uuid, public.transaction_kind, numeric, numeric, text, date, jsonb) to authenticated;
grant execute on function public.record_payment(uuid, numeric) to authenticated;

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.locations enable row level security;
alter table public.products enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_items enable row level security;
alter table public.transaction_payments enable row level security;
alter table public.stock_movements enable row level security;

revoke all on public.businesses from anon, authenticated;
revoke all on public.business_members from anon, authenticated;
revoke all on public.locations from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.transactions from anon, authenticated;
revoke all on public.transaction_items from anon, authenticated;
revoke all on public.transaction_payments from anon, authenticated;
revoke all on public.stock_movements from anon, authenticated;

grant select, insert, update, delete on public.businesses to authenticated;
grant select on public.business_members to authenticated;
grant select, insert, update, delete on public.locations to authenticated;
grant select, delete on public.products to authenticated;
grant insert (business_id, location_id, name, category, unit_price)
  on public.products to authenticated;
grant update (name, category, unit_price) on public.products to authenticated;
grant select on public.transactions to authenticated;
grant select on public.transaction_items to authenticated;
grant select on public.transaction_payments to authenticated;
grant select on public.stock_movements to authenticated;

create policy "Business members can read businesses"
  on public.businesses for select to authenticated
  using (public.is_business_member(id));
create policy "Authenticated users can create their own businesses"
  on public.businesses for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Business owners can update their businesses"
  on public.businesses for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "Business owners can delete their businesses"
  on public.businesses for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "Users can read their own memberships"
  on public.business_members for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Members can read locations"
  on public.locations for select to authenticated
  using (public.is_business_member(business_id));
create policy "Members can create locations"
  on public.locations for insert to authenticated
  with check (public.is_business_member(business_id));
create policy "Members can update locations"
  on public.locations for update to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));
create policy "Business owners can delete locations"
  on public.locations for delete to authenticated
  using (exists (
    select 1 from public.businesses as business
    where business.id = business_id and business.owner_id = (select auth.uid())
  ));

create policy "Members can read products"
  on public.products for select to authenticated
  using (public.is_business_member(business_id));
create policy "Members can create products"
  on public.products for insert to authenticated
  with check (public.is_business_member(business_id));
create policy "Members can update product details"
  on public.products for update to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));
create policy "Business owners can delete products"
  on public.products for delete to authenticated
  using (exists (
    select 1 from public.businesses as business
    where business.id = business_id and business.owner_id = (select auth.uid())
  ));

create policy "Members can read transactions"
  on public.transactions for select to authenticated
  using (public.is_business_member(business_id));
create policy "Members can read transaction items"
  on public.transaction_items for select to authenticated
  using (public.is_business_member(business_id));
create policy "Members can read transaction payments"
  on public.transaction_payments for select to authenticated
  using (public.is_business_member(business_id));
create policy "Members can read stock movements"
  on public.stock_movements for select to authenticated
  using (public.is_business_member(business_id));
