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
  line jsonb;
  product_row public.products%rowtype;
  line_product_id uuid;
  line_quantity integer;
  line_unit_price numeric(14, 2);
  line_total numeric(14, 2);
  line_total_sum numeric(14, 2) := 0;
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
  if transaction_type is null or transaction_type not in ('sale', 'restock') then
    raise exception 'Choose a valid transaction type.';
  end if;
  if transaction_total is null or transaction_total <= 0 then
    raise exception 'Enter a total amount greater than zero.';
  end if;
  if lines is null or jsonb_typeof(lines) <> 'array' then
    raise exception 'Add at least one product.';
  end if;
  if jsonb_array_length(lines) = 0 then
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

  for line in select value from jsonb_array_elements(lines)
  loop
    line_quantity := (line->>'quantity')::integer;
    line_unit_price := (line->>'unit_price')::numeric(14, 2);
    if line_quantity is null or line_quantity <= 0 or line_unit_price is null or line_unit_price < 0 then
      raise exception 'Product quantities must be positive and unit prices cannot be negative.';
    end if;
    line_total_sum := line_total_sum + line_quantity * line_unit_price;
  end loop;

  if line_total_sum <> transaction_total then
    raise exception 'Transaction total must equal the sum of its product line totals.';
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
