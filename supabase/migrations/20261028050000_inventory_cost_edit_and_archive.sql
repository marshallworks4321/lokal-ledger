alter table public.products
  add column if not exists archived_at timestamptz;

create or replace function public.set_product_average_cost(
  target_product_id uuid,
  next_average_cost numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_row public.products%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to update product cost.';
  end if;
  if next_average_cost is null or next_average_cost < 0 then
    raise exception 'Enter a non-negative unit cost.';
  end if;

  select * into product_row
  from public.products
  where id = target_product_id
  for update;

  if not found or not public.is_business_member(product_row.business_id) then
    raise exception 'Product not found or you do not have access.';
  end if;
  if product_row.archived_at is not null then
    raise exception 'Restore this product before updating its cost.';
  end if;
  if next_average_cost > product_row.unit_price then
    raise exception 'The unit cost cannot be higher than the selling price. Update the selling price first.';
  end if;

  update public.products
  set average_cost = next_average_cost
  where id = target_product_id;
end;
$$;

revoke all on function public.set_product_average_cost(uuid, numeric) from public, anon;
grant execute on function public.set_product_average_cost(uuid, numeric) to authenticated;

create or replace function public.set_product_archived(
  target_product_id uuid,
  should_archive boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_row public.products%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to update inventory.';
  end if;
  if should_archive is null then
    raise exception 'Choose whether to archive or restore the product.';
  end if;

  select * into product_row
  from public.products
  where id = target_product_id
  for update;

  if not found or not public.is_business_member(product_row.business_id) then
    raise exception 'Product not found or you do not have access.';
  end if;

  if should_archive and product_row.quantity > 0 then
    raise exception 'Sell or otherwise clear the remaining stock before archiving this product.';
  end if;

  update public.products
  set archived_at = case
    when should_archive then now()
    else null
  end
  where id = target_product_id;
end;
$$;

revoke all on function public.set_product_archived(uuid, boolean) from public, anon;
grant execute on function public.set_product_archived(uuid, boolean) to authenticated;

create or replace function public.prevent_archived_product_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_archived boolean;
begin
  select archived_at is not null
  into product_archived
  from public.products
  where id = new.product_id
    and business_id = new.business_id;

  if not found or product_archived then
    raise exception 'This product is archived or unavailable. Restore it before recording a transaction.';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_archived_product_transaction() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'transaction_items_reject_archived_products'
      and tgrelid = 'public.transaction_items'::regclass
      and not tgisinternal
  ) then
    create trigger transaction_items_reject_archived_products
    before insert on public.transaction_items
    for each row execute function public.prevent_archived_product_transaction();
  end if;
end;
$$;
