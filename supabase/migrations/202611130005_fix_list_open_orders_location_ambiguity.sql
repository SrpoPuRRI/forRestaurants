-- Qualify account.location_id to avoid colliding with the RETURNS TABLE output
-- variable named location_id in list_open_orders.
create or replace function public.list_open_orders(p_location_id uuid default null)
returns table(
  order_id uuid,
  location_id uuid,
  location_name text,
  operator_name text,
  note text,
  items jsonb,
  revision integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_account_location uuid;
begin
  if v_restaurant_id is null or not public.current_has_permission('orders') then
    raise exception 'Order permission required';
  end if;

  select account.location_id
  into v_account_location
  from public.accounts account
  where account.auth_user_id = auth.uid()
    and account.restaurant_id = v_restaurant_id
    and account.is_active;

  if public.current_role_key() <> 'admin'
     and p_location_id is not null
     and p_location_id is distinct from v_account_location then
    raise exception 'Location forbidden';
  end if;

  return query
  select
    open_order.id,
    open_order.location_id,
    location.name,
    open_order.operator_name_snapshot,
    open_order.note,
    open_order.items,
    open_order.revision,
    open_order.created_at,
    open_order.updated_at
  from public.open_orders open_order
  join public.locations location
    on location.id = open_order.location_id
   and location.restaurant_id = open_order.restaurant_id
  where open_order.restaurant_id = v_restaurant_id
    and open_order.status = 'open'
    and (
      (public.current_role_key() = 'admin'
       and (p_location_id is null or open_order.location_id = p_location_id))
      or
      (public.current_role_key() <> 'admin'
       and open_order.location_id = v_account_location)
    )
  order by open_order.updated_at desc;
end;
$$;
