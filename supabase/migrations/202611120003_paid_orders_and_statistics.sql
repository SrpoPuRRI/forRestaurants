-- Tenant-scoped open and paid orders, payment snapshots, and correction history.

create or replace function public.order_payment_arrays_valid(
  p_amounts numeric[],
  p_methods text[],
  p_modes text[],
  p_total numeric
)
returns boolean
language plpgsql immutable set search_path = '' as $$
declare i integer; v_sum numeric(12,2) := 0;
begin
  if coalesce(cardinality(p_amounts), 0) < 1
     or cardinality(p_amounts) > 10
     or cardinality(p_amounts) is distinct from cardinality(p_methods)
     or cardinality(p_amounts) is distinct from cardinality(p_modes) then
    return false;
  end if;
  for i in 1..cardinality(p_amounts) loop
    if p_amounts[i] is null
       or p_methods[i] is null
       or p_methods[i] not in ('cash','yape','plin','bank_transfer','card')
       or p_modes[i] is null
       or p_modes[i] not in ('manual','automatic') then
      return false;
    end if;
    v_sum := v_sum + p_amounts[i];
  end loop;
  return round(v_sum, 2) = round(p_total, 2);
end;
$$;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  location_id uuid not null,
  created_by uuid,
  operator_name_snapshot text not null,
  note text,
  status text not null default 'correct' check (status in ('correct','erroneous','closed_cashier')),
  total numeric(12,2) not null,
  -- Compatibility totals for the existing correction and print interfaces.
  amount_yape numeric(12,2) not null default 0,
  amount_cash numeric(12,2) not null default 0,
  payment_amounts numeric(12,2)[] not null,
  payment_method_keys text[] not null,
  payment_modes text[] not null,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (location_id, restaurant_id) references public.locations(id, restaurant_id) on delete restrict,
  foreign key (created_by, restaurant_id) references public.accounts(auth_user_id, restaurant_id) on delete set null (created_by),
  constraint order_operator_snapshot_not_blank check (btrim(operator_name_snapshot) <> ''),
  constraint order_payment_snapshot_valid check (
    public.order_payment_arrays_valid(payment_amounts, payment_method_keys, payment_modes, total)
  )
);
create index orders_restaurant_paid_at_idx on public.orders(restaurant_id, paid_at desc);
create index orders_location_paid_at_idx on public.orders(location_id, paid_at desc);
create index orders_status_paid_at_idx on public.orders(restaurant_id, status, paid_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null,
  product_id uuid,
  variant_id uuid,
  product_name_snapshot text not null,
  variant_name_snapshot text not null default '',
  line_kind text not null check (line_kind in ('product','income','expense')),
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null,
  line_total numeric(12,2) not null,
  amount_yape numeric(12,2) not null default 0,
  amount_cash numeric(12,2) not null default 0,
  payment_amounts numeric(12,2)[] not null,
  payment_method_keys text[] not null,
  payment_modes text[] not null,
  concept text,
  created_at timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (order_id, restaurant_id) references public.orders(id, restaurant_id) on delete restrict deferrable initially deferred,
  foreign key (product_id, restaurant_id) references public.products(id, restaurant_id) on delete restrict,
  foreign key (variant_id, restaurant_id) references public.variants(id, restaurant_id) on delete restrict,
  constraint order_item_payment_snapshot_valid check (
    public.order_payment_arrays_valid(payment_amounts, payment_method_keys, payment_modes, line_total)
  ),
  constraint order_item_special_shape check (
    (line_kind = 'product') or (quantity = 1 and variant_id is not null)
  )
);
create index order_items_restaurant_order_idx on public.order_items(restaurant_id, order_id, created_at);
create index order_items_product_idx on public.order_items(restaurant_id, product_id);

create table public.order_item_addons (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_item_id uuid not null,
  addon_id uuid,
  addon_name_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  foreign key (order_item_id, restaurant_id) references public.order_items(id, restaurant_id) on delete restrict,
  foreign key (addon_id, restaurant_id) references public.addons(id, restaurant_id) on delete restrict
);
create index order_item_addons_restaurant_item_idx on public.order_item_addons(restaurant_id, order_item_id);

create table public.order_correction_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null,
  corrected_by uuid,
  operator_name_snapshot text not null,
  reason text not null,
  corrected_at timestamptz not null default now(),
  unique (order_id),
  foreign key (order_id, restaurant_id) references public.orders(id, restaurant_id) on delete restrict,
  foreign key (corrected_by, restaurant_id) references public.accounts(auth_user_id, restaurant_id) on delete set null (corrected_by)
);

create table public.open_orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  location_id uuid not null,
  created_by uuid,
  operator_name_snapshot text not null,
  note text,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  status text not null default 'open' check (status in ('open','cancelled','paid')),
  revision integer not null default 1 check (revision > 0),
  paid_order_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (id, restaurant_id),
  unique (paid_order_id),
  foreign key (location_id, restaurant_id) references public.locations(id, restaurant_id) on delete restrict,
  foreign key (created_by, restaurant_id) references public.accounts(auth_user_id, restaurant_id) on delete set null (created_by),
  foreign key (paid_order_id, restaurant_id) references public.orders(id, restaurant_id) on delete restrict deferrable initially deferred,
  constraint open_order_paid_state_consistent check ((status = 'paid') = (paid_order_id is not null))
);
create index open_orders_active_idx on public.open_orders(restaurant_id, location_id, updated_at desc) where status = 'open';

create or replace function public.guard_paid_order_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Paid orders cannot be deleted'; end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'Paid order fields are immutable';
  end if;
  if old.status <> 'correct' or new.status <> 'erroneous'
     or not exists (select 1 from public.order_correction_events e where e.order_id = old.id and e.restaurant_id = old.restaurant_id) then
    raise exception 'Only an audited Correct to Erroneous transition is allowed';
  end if;
  return new;
end;
$$;
create trigger orders_immutable before update or delete on public.orders
for each row execute function public.guard_paid_order_mutation();

create or replace function public.reject_paid_order_detail_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Paid order details are immutable';
end;
$$;
create trigger order_items_immutable before update or delete on public.order_items
for each row execute function public.reject_paid_order_detail_mutation();
create trigger order_item_addons_immutable before update or delete on public.order_item_addons
for each row execute function public.reject_paid_order_detail_mutation();

create or replace function public.reject_order_correction_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Order correction events are append-only';
end;
$$;
create trigger order_correction_events_immutable before update or delete on public.order_correction_events
for each row execute function public.reject_order_correction_mutation();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_addons enable row level security;
alter table public.order_correction_events enable row level security;
alter table public.open_orders enable row level security;

create policy orders_read on public.orders for select to authenticated using (
  restaurant_id = (select public.current_restaurant_id())
  and ((select public.current_has_permission('statistics')) or (select public.current_has_permission('orders')))
);
create policy order_items_read on public.order_items for select to authenticated using (
  restaurant_id = (select public.current_restaurant_id())
  and ((select public.current_has_permission('statistics')) or (select public.current_has_permission('orders')))
);
create policy order_item_addons_read on public.order_item_addons for select to authenticated using (
  restaurant_id = (select public.current_restaurant_id())
  and ((select public.current_has_permission('statistics')) or (select public.current_has_permission('orders')))
);
create policy order_correction_events_read on public.order_correction_events for select to authenticated using (
  restaurant_id = (select public.current_restaurant_id())
  and ((select public.current_has_permission('statistics')) or (select public.current_has_permission('orders')))
);
create policy open_orders_read on public.open_orders for select to authenticated using (
  restaurant_id = (select public.current_restaurant_id())
  and (select public.current_has_permission('orders'))
);

grant select on public.orders, public.order_items, public.order_item_addons, public.order_correction_events, public.open_orders to authenticated;
revoke insert, update, delete on public.orders, public.order_items, public.order_item_addons, public.order_correction_events, public.open_orders from anon, authenticated;

-- Restaurants without payment configuration start with cash enabled. Existing choices are preserved.
insert into public.restaurant_payment_methods(restaurant_id, method_key, enabled, manual_enabled, automatic_enabled)
select r.id, 'cash', true, true, false
from public.restaurants r
where not exists (
  select 1 from public.restaurant_payment_methods pm where pm.restaurant_id = r.id
);

create or replace function public.record_paid_order(
  p_location_id uuid,
  p_note text,
  p_items jsonb,
  p_universalize boolean,
  p_universal_method text,
  p_yape_percent numeric
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_restaurant_id uuid := public.current_restaurant_id();
  v_role_key text := public.current_role_key();
  v_operator text;
  v_account_location uuid;
  v_order_id uuid := gen_random_uuid();
  v_item jsonb;
  v_addon_json jsonb;
  v_product public.products%rowtype;
  v_variant public.variants%rowtype;
  v_addon public.addons%rowtype;
  v_item_id uuid;
  v_quantity integer;
  v_addon_quantity integer;
  v_manual_amount numeric(12,2);
  v_unit_price numeric(12,2);
  v_line_total numeric(12,2);
  v_line_addons numeric(12,2);
  v_kind text;
  v_concept text;
  v_method text;
  v_line_methods text[];
  v_line_amounts numeric(12,2)[];
  v_line_modes text[];
  v_payment_methods text[] := '{}'::text[];
  v_payment_amounts numeric(12,2)[] := '{}'::numeric(12,2)[];
  v_payment_modes text[] := '{}'::text[];
  v_index integer;
  v_existing integer;
  v_yape_amount numeric(12,2);
  v_cash_amount numeric(12,2);
  v_total numeric(12,2) := 0;
  v_yape_total numeric(12,2) := 0;
  v_cash_total numeric(12,2) := 0;
  v_normal_cumulative numeric(12,2) := 0;
  v_normal_yape_allocated numeric(12,2) := 0;
  v_yape_target numeric(12,2);
  v_restaurant public.restaurants%rowtype;
begin
  if v_uid is null or v_restaurant_id is null then raise exception 'Authentication required'; end if;
  if not public.current_has_permission('payments') then raise exception 'Payment permission required'; end if;
  select a.display_name, a.location_id into v_operator, v_account_location
  from public.accounts a where a.auth_user_id = v_uid and a.restaurant_id = v_restaurant_id and a.is_active;
  if v_operator is null then raise exception 'Active account not found'; end if;
  select * into v_restaurant from public.restaurants r where r.id = v_restaurant_id and r.status = 'active';
  if not found then raise exception 'Restaurant is inactive'; end if;
  if not exists (select 1 from public.locations l where l.id = p_location_id and l.restaurant_id = v_restaurant_id and l.is_active) then raise exception 'Location unavailable'; end if;
  if v_role_key <> 'admin' and v_account_location is distinct from p_location_id then raise exception 'Location forbidden'; end if;
  if p_universalize is null then raise exception 'Payment mode is required'; end if;
  if p_universalize then
    if lower(coalesce(p_universal_method,'')) not in ('cash','yape','plin','bank_transfer','card') then raise exception 'Select a configured payment method'; end if;
    if not exists (
      select 1 from public.restaurant_payment_methods pm
      where pm.restaurant_id = v_restaurant_id and pm.method_key = lower(p_universal_method)
        and pm.enabled and pm.manual_enabled
    ) then raise exception 'Payment method is not enabled for manual payments'; end if;
  else
    if p_yape_percent is null or p_yape_percent < 0 or p_yape_percent > 100 then raise exception 'Invalid Yape percentage'; end if;
    if p_yape_percent > 0 and not exists (select 1 from public.restaurant_payment_methods pm where pm.restaurant_id=v_restaurant_id and pm.method_key='yape' and pm.enabled and pm.manual_enabled) then raise exception 'Yape is not enabled for manual payments'; end if;
    if p_yape_percent < 100 and not exists (select 1 from public.restaurant_payment_methods pm where pm.restaurant_id=v_restaurant_id and pm.method_key='cash' and pm.enabled and pm.manual_enabled) then raise exception 'Cash is not enabled for manual payments'; end if;
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Order must contain at least one item'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Order has too many lines'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_product from public.products p
    where p.id = (v_item->>'product_id')::uuid and p.restaurant_id = v_restaurant_id and p.is_active;
    if not found then raise exception 'Product unavailable'; end if;
    select * into v_variant from public.variants v
    where v.id = (v_item->>'variant_id')::uuid and v.restaurant_id = v_restaurant_id
      and v.product_id = v_product.id and v.is_active;
    if not found then raise exception 'Variant unavailable'; end if;
    if v_product.product_kind = 'standard' and not exists (
      select 1 from public.variant_locations vl
      where vl.restaurant_id = v_restaurant_id and vl.variant_id = v_variant.id
        and vl.location_id = p_location_id and vl.is_available
    ) then raise exception 'Variant unavailable at this location'; end if;
    v_quantity := coalesce((v_item->>'quantity')::integer, 1);
    if v_quantity < 1 or v_quantity > 10000 then raise exception 'Invalid item quantity'; end if;
    if jsonb_typeof(coalesce(v_item->'addons','[]'::jsonb)) is distinct from 'array' then raise exception 'Invalid addons'; end if;
    if jsonb_array_length(coalesce(v_item->'addons','[]'::jsonb)) > 50 then raise exception 'Too many addons'; end if;
    v_kind := v_product.product_kind;
    v_concept := nullif(btrim(v_item->>'concept'), '');
    v_line_addons := 0;
    if v_kind = 'standard' then
      if jsonb_array_length(coalesce(v_item->'addons','[]'::jsonb)) > 0 and not v_restaurant.catalog_addons_enabled then raise exception 'Addons are disabled for this restaurant'; end if;
      v_unit_price := v_variant.price;
      v_line_total := v_unit_price * v_quantity;
      for v_addon_json in select value from jsonb_array_elements(coalesce(v_item->'addons','[]'::jsonb)) loop
        v_addon_quantity := coalesce((v_addon_json->>'quantity')::integer,1);
        if v_addon_quantity < 1 or v_addon_quantity > 10000 then raise exception 'Invalid addon quantity'; end if;
        select a.* into v_addon from public.addons a
        join public.product_addons pa on pa.addon_id=a.id and pa.restaurant_id=a.restaurant_id
        where a.id=(v_addon_json->>'addon_id')::uuid and a.restaurant_id=v_restaurant_id
          and a.is_active and pa.product_id=v_product.id;
        if not found then raise exception 'Addon unavailable for this product'; end if;
        v_line_addons := v_line_addons + (v_addon.price * v_addon_quantity);
      end loop;
      v_line_total := v_line_total + v_line_addons;
      if p_universalize then
        v_line_methods := array[lower(p_universal_method)];
        v_line_amounts := array[v_line_total::numeric(12,2)];
        v_line_modes := array['manual']::text[];
      else
        v_normal_cumulative := v_normal_cumulative + v_line_total;
        v_yape_target := round(v_normal_cumulative * p_yape_percent / 100, 2);
        v_yape_amount := v_yape_target - v_normal_yape_allocated;
        v_normal_yape_allocated := v_yape_target;
        v_cash_amount := v_line_total - v_yape_amount;
        v_line_methods := '{}'::text[];
        v_line_amounts := '{}'::numeric(12,2)[];
        v_line_modes := '{}'::text[];
        if v_yape_amount <> 0 or v_line_total = 0 then
          v_line_methods := array_append(v_line_methods, 'yape');
          v_line_amounts := array_append(v_line_amounts, v_yape_amount);
          v_line_modes := array_append(v_line_modes, 'manual');
        end if;
        if v_cash_amount <> 0 then
          v_line_methods := array_append(v_line_methods, 'cash');
          v_line_amounts := array_append(v_line_amounts, v_cash_amount);
          v_line_modes := array_append(v_line_modes, 'manual');
        end if;
      end if;
    else
      if v_quantity <> 1 or jsonb_array_length(coalesce(v_item->'addons','[]'::jsonb)) <> 0 then raise exception 'Special money lines require quantity one and no addons'; end if;
      v_manual_amount := (v_item->>'manual_amount')::numeric(12,2);
      if v_manual_amount <= 0 or v_manual_amount <> round(v_manual_amount,2) then raise exception 'Special amount must be greater than zero with two decimals'; end if;
      v_unit_price := case when v_kind = 'income' then v_manual_amount else -v_manual_amount end;
      v_line_total := v_unit_price;
      v_method := lower(coalesce(nullif(v_item->>'payment_method',''), case when p_universalize then p_universal_method else null end, ''));
      if v_method not in ('cash','yape','plin','bank_transfer','card') or not exists (
        select 1 from public.restaurant_payment_methods pm
        where pm.restaurant_id=v_restaurant_id and pm.method_key=v_method and pm.enabled and pm.manual_enabled
      ) then raise exception 'Special line requires an enabled manual payment method'; end if;
      v_line_methods := array[v_method];
      v_line_amounts := array[v_line_total::numeric(12,2)];
      v_line_modes := array['manual']::text[];
    end if;
    if cardinality(v_line_methods) = 0 then raise exception 'No payment method was assigned to this line'; end if;
    if cardinality(v_payment_methods) = 0 then
      v_payment_methods := v_line_methods;
      v_payment_amounts := v_line_amounts;
      v_payment_modes := v_line_modes;
    else
      for v_index in 1..cardinality(v_line_methods) loop
        v_existing := array_position(v_payment_methods, v_line_methods[v_index]);
        if v_existing is null then
          v_payment_methods := array_append(v_payment_methods, v_line_methods[v_index]);
          v_payment_amounts := array_append(v_payment_amounts, v_line_amounts[v_index]);
          v_payment_modes := array_append(v_payment_modes, v_line_modes[v_index]);
        else
          v_payment_amounts[v_existing] := v_payment_amounts[v_existing] + v_line_amounts[v_index];
        end if;
      end loop;
    end if;
    if cardinality(v_payment_methods) > 10 then raise exception 'A payment can use at most ten method slots'; end if;
    for v_index in 1..cardinality(v_line_methods) loop
      if v_line_methods[v_index] = 'yape' then v_yape_total := v_yape_total + v_line_amounts[v_index]; end if;
      if v_line_methods[v_index] = 'cash' then v_cash_total := v_cash_total + v_line_amounts[v_index]; end if;
    end loop;
    v_total := v_total + v_line_total;
    insert into public.order_items(
      restaurant_id,order_id,product_id,variant_id,product_name_snapshot,variant_name_snapshot,
      line_kind,quantity,unit_price,line_total,amount_yape,amount_cash,
      payment_amounts,payment_method_keys,payment_modes,concept
    ) values (
      v_restaurant_id,v_order_id,v_product.id,v_variant.id,v_product.name,v_variant.name,
      case when v_kind='standard' then 'product' else v_kind end,v_quantity,v_unit_price,v_line_total,
      coalesce((select v_line_amounts[array_position(v_line_methods,'yape')] where 'yape'=any(v_line_methods)),0),
      coalesce((select v_line_amounts[array_position(v_line_methods,'cash')] where 'cash'=any(v_line_methods)),0),
      v_line_amounts,v_line_methods,v_line_modes,v_concept
    ) returning id into v_item_id;
    if v_kind = 'standard' then
      for v_addon_json in select value from jsonb_array_elements(coalesce(v_item->'addons','[]'::jsonb)) loop
        v_addon_quantity := coalesce((v_addon_json->>'quantity')::integer,1);
        select a.* into v_addon from public.addons a
        join public.product_addons pa on pa.addon_id=a.id and pa.restaurant_id=a.restaurant_id
        where a.id=(v_addon_json->>'addon_id')::uuid and a.restaurant_id=v_restaurant_id
          and a.is_active and pa.product_id=v_product.id;
        insert into public.order_item_addons(restaurant_id,order_item_id,addon_id,addon_name_snapshot,quantity,unit_price,line_total)
        values(v_restaurant_id,v_item_id,v_addon.id,v_addon.name,v_addon_quantity,v_addon.price,v_addon.price*v_addon_quantity);
      end loop;
    end if;
  end loop;

  if (v_restaurant.order_minimum_enabled and (v_role_key='admin' and v_restaurant.order_minimum_admin or v_role_key<>'admin' and v_restaurant.order_minimum_employees)
      and v_total < coalesce(v_restaurant.order_minimum_amount,0)) then raise exception 'Order total is below the configured minimum'; end if;
  if (v_restaurant.order_maximum_enabled and (v_role_key='admin' and v_restaurant.order_maximum_admin or v_role_key<>'admin' and v_restaurant.order_maximum_employees)
      and v_total > coalesce(v_restaurant.order_maximum_amount,999999999)) then raise exception 'Order total exceeds the configured maximum'; end if;

  insert into public.orders(
    id,restaurant_id,location_id,created_by,operator_name_snapshot,note,status,total,
    amount_yape,amount_cash,payment_amounts,payment_method_keys,payment_modes
  ) values (
    v_order_id,v_restaurant_id,p_location_id,v_uid,v_operator,nullif(btrim(p_note),''),'correct',v_total,
    v_yape_total,v_cash_total,v_payment_amounts,v_payment_methods,v_payment_modes
  );
  return jsonb_build_object('order_id',v_order_id,'total',v_total,'payment_amounts',v_payment_amounts,
    'payment_method_keys',v_payment_methods,'status','correct');
end;
$$;

create or replace function public.create_open_order(p_location_id uuid,p_note text default null,p_items jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_restaurant_id uuid:=public.current_restaurant_id(); v_uid uuid:=auth.uid(); v_name text; v_location uuid; v_id uuid;
begin
  if v_restaurant_id is null or v_uid is null or not public.current_has_permission('orders') then raise exception 'Order permission required'; end if;
  select display_name,location_id into v_name,v_location from public.accounts where auth_user_id=v_uid and restaurant_id=v_restaurant_id and is_active;
  if not found then raise exception 'Active account not found'; end if;
  if not exists(select 1 from public.locations where id=p_location_id and restaurant_id=v_restaurant_id and is_active) then raise exception 'Location unavailable'; end if;
  if public.current_role_key()<>'admin' and v_location is distinct from p_location_id then raise exception 'Location forbidden'; end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Open order must contain items'; end if;
  insert into public.open_orders(restaurant_id,location_id,created_by,operator_name_snapshot,note,items)
  values(v_restaurant_id,p_location_id,v_uid,v_name,nullif(btrim(p_note),''),p_items) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.list_open_orders(p_location_id uuid default null)
returns table(order_id uuid,location_id uuid,location_name text,operator_name text,note text,items jsonb,revision integer,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_restaurant_id uuid:=public.current_restaurant_id(); v_location uuid;
begin
  if v_restaurant_id is null or not public.current_has_permission('orders') then raise exception 'Order permission required'; end if;
  select location_id into v_location from public.accounts where auth_user_id=auth.uid() and restaurant_id=v_restaurant_id and is_active;
  if public.current_role_key()<>'admin' and (p_location_id is not null and p_location_id is distinct from v_location) then raise exception 'Location forbidden'; end if;
  return query select o.id,o.location_id,l.name,o.operator_name_snapshot,o.note,o.items,o.revision,o.created_at,o.updated_at
  from public.open_orders o join public.locations l on l.id=o.location_id and l.restaurant_id=o.restaurant_id
  where o.restaurant_id=v_restaurant_id and o.status='open'
    and (public.current_role_key()='admin' and (p_location_id is null or o.location_id=p_location_id)
      or public.current_role_key()<>'admin' and o.location_id=v_location)
  order by o.updated_at desc;
end;
$$;

create or replace function public.get_open_order_paid_today_count(p_location_id uuid default null)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare v_restaurant_id uuid:=public.current_restaurant_id(); v_location uuid;
begin
  if v_restaurant_id is null or not public.current_has_permission('orders') then raise exception 'Order permission required'; end if;
  select location_id into v_location from public.accounts where auth_user_id=auth.uid() and restaurant_id=v_restaurant_id and is_active;
  if public.current_role_key()<>'admin' and (p_location_id is not null and p_location_id is distinct from v_location) then raise exception 'Location forbidden'; end if;
  return (select count(*)::integer from public.orders o where o.restaurant_id=v_restaurant_id and o.status='correct'
    and (o.paid_at at time zone 'America/Lima')::date=(now() at time zone 'America/Lima')::date
    and (public.current_role_key()='admin' and (p_location_id is null or o.location_id=p_location_id)
      or public.current_role_key()<>'admin' and o.location_id=v_location));
end;
$$;

create or replace function public.update_open_order(p_order_id uuid,p_expected_revision integer,p_note text,p_items jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_restaurant_id uuid:=public.current_restaurant_id(); v_location uuid; v_order public.open_orders%rowtype;
begin
  if v_restaurant_id is null or not public.current_has_permission('orders') then raise exception 'Order permission required'; end if;
  select location_id into v_location from public.accounts where auth_user_id=auth.uid() and restaurant_id=v_restaurant_id and is_active;
  select * into v_order from public.open_orders where id=p_order_id and restaurant_id=v_restaurant_id for update;
  if not found or v_order.status<>'open' then raise exception using errcode='P0002',message='Open order is no longer available'; end if;
  if public.current_role_key()<>'admin' and v_location is distinct from v_order.location_id then raise exception 'Location forbidden'; end if;
  if v_order.revision<>p_expected_revision then raise exception using errcode='40001',message='Open order changed; reload the latest version'; end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Items must be an array'; end if;
  update public.open_orders set note=nullif(btrim(p_note),''),items=p_items,revision=revision+1,updated_at=now() where id=p_order_id;
  return v_order.revision+1;
end;
$$;

create or replace function public.cancel_open_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_restaurant_id uuid:=public.current_restaurant_id(); v_location uuid; v_order public.open_orders%rowtype;
begin
  if v_restaurant_id is null or not public.current_has_permission('orders') then raise exception 'Order permission required'; end if;
  select location_id into v_location from public.accounts where auth_user_id=auth.uid() and restaurant_id=v_restaurant_id and is_active;
  select * into v_order from public.open_orders where id=p_order_id and restaurant_id=v_restaurant_id for update;
  if not found or v_order.status<>'open' then raise exception using errcode='P0002',message='Open order is no longer available'; end if;
  if public.current_role_key()<>'admin' and v_location is distinct from v_order.location_id then raise exception 'Location forbidden'; end if;
  update public.open_orders set status='cancelled',revision=revision+1,updated_at=now(),closed_at=now() where id=p_order_id;
end;
$$;

create or replace function public.pay_open_order(p_order_id uuid,p_expected_revision integer,p_universalize boolean,p_universal_method text,p_yape_percent numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_restaurant_id uuid:=public.current_restaurant_id(); v_location uuid; v_order public.open_orders%rowtype; v_payment jsonb;
begin
  if v_restaurant_id is null or not public.current_has_permission('payments') then raise exception 'Payment permission required'; end if;
  select location_id into v_location from public.accounts where auth_user_id=auth.uid() and restaurant_id=v_restaurant_id and is_active;
  select * into v_order from public.open_orders where id=p_order_id and restaurant_id=v_restaurant_id for update;
  if not found or v_order.status<>'open' then raise exception using errcode='P0002',message='Open order is no longer available'; end if;
  if public.current_role_key()<>'admin' and v_location is distinct from v_order.location_id then raise exception 'Location forbidden'; end if;
  if v_order.revision<>p_expected_revision then raise exception using errcode='40001',message='Open order changed; reload the latest version'; end if;
  v_payment:=public.record_paid_order(v_order.location_id,v_order.note,v_order.items,p_universalize,p_universal_method,p_yape_percent);
  update public.open_orders set status='paid',paid_order_id=(v_payment->>'order_id')::uuid,revision=revision+1,updated_at=now(),closed_at=now() where id=p_order_id;
  return v_payment || jsonb_build_object('open_order_id',p_order_id,'status','paid');
end;
$$;

create or replace function public.correct_paid_order(p_order_id uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_restaurant_id uuid:=public.current_restaurant_id(); v_role text:=public.current_role_key(); v_order public.orders%rowtype; v_name text; v_loc uuid; v_allowed boolean:=false;
begin
  if v_restaurant_id is null or auth.uid() is null then raise exception 'Authentication required'; end if;
  select a.display_name,a.location_id into v_name,v_loc from public.accounts a where a.auth_user_id=auth.uid() and a.restaurant_id=v_restaurant_id and a.is_active;
  if not found then raise exception 'Active account not found'; end if;
  if v_role='admin' then
    select corrections_admin into v_allowed from public.restaurants where id=v_restaurant_id;
  else
    select coalesce(r.corrections_employees,false) and exists (
      select 1 from public.accounts a cross join lateral unnest(a.role_ids) assigned(role_id)
      join public.restaurant_role_settings rs on rs.restaurant_id=a.restaurant_id and rs.role_id=assigned.role_id and rs.corrections_allowed
      where a.auth_user_id=auth.uid() and a.restaurant_id=v_restaurant_id and a.is_active
    ) into v_allowed from public.restaurants r where r.id=v_restaurant_id;
  end if;
  if not coalesce(v_allowed,false) then raise exception 'Order correction is not enabled for this account'; end if;
  select * into v_order from public.orders where id=p_order_id and restaurant_id=v_restaurant_id for update;
  if not found or v_order.status<>'correct' then raise exception 'Order is unavailable or already corrected'; end if;
  if v_role<>'admin' and v_order.location_id is distinct from v_loc then raise exception 'Location forbidden'; end if;
  if (v_order.paid_at at time zone 'America/Lima')::date not between (now() at time zone 'America/Lima')::date-1 and (now() at time zone 'America/Lima')::date then raise exception 'Only today and yesterday can be corrected'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'A correction reason is required'; end if;
  insert into public.order_correction_events(restaurant_id,order_id,corrected_by,operator_name_snapshot,reason)
  values(v_restaurant_id,v_order.id,auth.uid(),v_name,btrim(p_reason));
  update public.orders set status='erroneous' where id=v_order.id;
  return jsonb_build_object('order_id',v_order.id,'excluded_amount',v_order.total,'status','erroneous');
end;
$$;

create or replace function public.get_correction_candidates(p_location_id uuid)
returns table(order_id uuid,paid_at timestamptz,total numeric,amount_yape numeric,amount_cash numeric,operator_name text,item_summary jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_restaurant_id uuid:=public.current_restaurant_id(); v_role text:=public.current_role_key(); v_loc uuid; v_allowed boolean:=false;
begin
  if v_restaurant_id is null or auth.uid() is null then raise exception 'Authentication required'; end if;
  select location_id into v_loc from public.accounts where auth_user_id=auth.uid() and restaurant_id=v_restaurant_id and is_active;
  if v_role='admin' then
    select corrections_admin into v_allowed from public.restaurants where id=v_restaurant_id;
  else
    select coalesce(r.corrections_employees,false) and exists (
      select 1 from public.accounts a cross join lateral unnest(a.role_ids) assigned(role_id)
      join public.restaurant_role_settings rs on rs.restaurant_id=a.restaurant_id and rs.role_id=assigned.role_id and rs.corrections_allowed
      where a.auth_user_id=auth.uid() and a.restaurant_id=v_restaurant_id and a.is_active
    ) into v_allowed from public.restaurants r where r.id=v_restaurant_id;
  end if;
  if not coalesce(v_allowed,false) then raise exception 'Order correction is not enabled for this account'; end if;
  if v_role<>'admin' and p_location_id is distinct from v_loc then raise exception 'Location forbidden'; end if;
  return query select o.id,o.paid_at,o.total,o.amount_yape,o.amount_cash,o.operator_name_snapshot,
    coalesce((select jsonb_agg(jsonb_build_object('name',i.product_name_snapshot,'variant',i.variant_name_snapshot,'quantity',i.quantity) order by i.created_at)
      from public.order_items i where i.order_id=o.id and i.restaurant_id=v_restaurant_id),'[]'::jsonb)
  from public.orders o where o.restaurant_id=v_restaurant_id and o.location_id=p_location_id and o.status='correct'
    and (o.paid_at at time zone 'America/Lima')::date between (now() at time zone 'America/Lima')::date-1 and (now() at time zone 'America/Lima')::date
  order by o.paid_at desc;
end;
$$;

revoke all on function public.record_paid_order(uuid,text,jsonb,boolean,text,numeric) from public,anon;
revoke all on function public.create_open_order(uuid,text,jsonb) from public,anon;
revoke all on function public.list_open_orders(uuid) from public,anon;
revoke all on function public.get_open_order_paid_today_count(uuid) from public,anon;
revoke all on function public.update_open_order(uuid,integer,text,jsonb) from public,anon;
revoke all on function public.cancel_open_order(uuid) from public,anon;
revoke all on function public.pay_open_order(uuid,integer,boolean,text,numeric) from public,anon;
revoke all on function public.correct_paid_order(uuid,text) from public,anon;
revoke all on function public.get_correction_candidates(uuid) from public,anon;
grant execute on function public.record_paid_order(uuid,text,jsonb,boolean,text,numeric) to authenticated;
grant execute on function public.create_open_order(uuid,text,jsonb) to authenticated;
grant execute on function public.list_open_orders(uuid) to authenticated;
grant execute on function public.get_open_order_paid_today_count(uuid) to authenticated;
grant execute on function public.update_open_order(uuid,integer,text,jsonb) to authenticated;
grant execute on function public.cancel_open_order(uuid) to authenticated;
grant execute on function public.pay_open_order(uuid,integer,boolean,text,numeric) to authenticated;
grant execute on function public.correct_paid_order(uuid,text) to authenticated;
grant execute on function public.get_correction_candidates(uuid) to authenticated;

notify pgrst, 'reload schema';
