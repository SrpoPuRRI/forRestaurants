-- Reinterpret legacy order minimum/maximum settings as statistics visibility only.
-- The old amount columns remain for compatibility and are cleared; they no longer gate payments.
update public.restaurants
set order_minimum_amount = null, order_maximum_amount = null
where order_minimum_amount is not null or order_maximum_amount is not null;

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
