-- Required money-movement products, mandatory cash, and reason-free corrections.

create or replace function public.ensure_restaurant_required_products(p_restaurant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_name text;
  v_product_id uuid;
begin
  if not exists (select 1 from public.restaurants r where r.id = p_restaurant_id) then
    return;
  end if;

  foreach v_kind in array array['income','expense']::text[] loop
    v_name := case v_kind when 'income' then 'Ingreso' else 'Egreso' end;
    select p.id into v_product_id
    from public.products p
    where p.restaurant_id = p_restaurant_id and p.product_kind = v_kind;

    if v_product_id is null then
      insert into public.products(restaurant_id,name,product_kind,is_active)
      values(p_restaurant_id,v_name,v_kind,true)
      returning id into v_product_id;
    else
      update public.products set name = v_name, is_active = true, updated_at = now()
      where id = v_product_id;
    end if;

    insert into public.variants(restaurant_id,product_id,name,price,is_active)
    values(p_restaurant_id,v_product_id,'Monto variable',0,true)
    on conflict (product_id,name) do update
      set price = 0, is_active = true, updated_at = now();
  end loop;

  insert into public.restaurant_payment_methods(restaurant_id,method_key,enabled,manual_enabled,automatic_enabled)
  values(p_restaurant_id,'cash',true,true,false)
  on conflict (restaurant_id,method_key) do update
    set enabled = true, manual_enabled = true, automatic_enabled = false, updated_at = now();
end;
$$;
revoke all on function public.ensure_restaurant_required_products(uuid) from public, anon, authenticated;

create or replace function public.seed_restaurant_required_products()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_restaurant_required_products(new.id);
  return new;
end;
$$;

-- Fill missing required records before enforcing their invariants.
do $$
declare v_restaurant_id uuid;
begin
  for v_restaurant_id in select id from public.restaurants loop
    perform public.ensure_restaurant_required_products(v_restaurant_id);
  end loop;
end;
$$;

drop trigger if exists restaurants_seed_required_products on public.restaurants;
create trigger restaurants_seed_required_products
  after insert on public.restaurants
  for each row execute function public.seed_restaurant_required_products();

create or replace function public.protect_required_special_product()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.product_kind in ('income','expense') then
    if tg_op = 'DELETE' then
      if exists (select 1 from public.restaurants r where r.id = old.restaurant_id) then
        raise exception 'Required Ingreso and Egreso products cannot be deleted';
      end if;
      return old;
    end if;
    if new.product_kind is distinct from old.product_kind
       or new.is_active is distinct from true
       or new.name is distinct from (case old.product_kind when 'income' then 'Ingreso' else 'Egreso' end) then
      raise exception 'Required Ingreso and Egreso products cannot be renamed, deactivated, or retyped';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists products_protect_required_special on public.products;
create trigger products_protect_required_special
  before update or delete on public.products
  for each row execute function public.protect_required_special_product();

create or replace function public.protect_required_special_variant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_product public.products%rowtype;
begin
  select * into v_product from public.products p where p.id = old.product_id;
  if found and v_product.product_kind in ('income','expense') then
    if tg_op = 'DELETE' then
      if exists (select 1 from public.restaurants r where r.id = v_product.restaurant_id) then
        raise exception 'Required special product variants cannot be deleted';
      end if;
      return old;
    end if;
    if new.product_id is distinct from old.product_id
       or new.name is distinct from 'Monto variable'
       or new.price is distinct from 0::numeric
       or new.is_active is distinct from true then
      raise exception 'Required special product variant cannot be changed or deactivated';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists variants_protect_required_special on public.variants;
create trigger variants_protect_required_special
  before update or delete on public.variants
  for each row execute function public.protect_required_special_variant();

create or replace function public.enforce_cash_payment_method()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.method_key = 'cash' and new.method_key is distinct from 'cash' then
    raise exception 'Cash payment method is required and cannot be changed';
  end if;
  if tg_op = 'DELETE' and old.method_key = 'cash' then
    if exists (select 1 from public.restaurants r where r.id = old.restaurant_id) then
      raise exception 'Cash payment method is required and cannot be deleted';
    end if;
    return old;
  end if;
  if tg_op <> 'DELETE' and new.method_key = 'cash' then
    new.enabled := true;
    new.manual_enabled := true;
    new.automatic_enabled := false;
  end if;
  return new;
end;
$$;
drop trigger if exists restaurant_payment_methods_require_cash on public.restaurant_payment_methods;
create trigger restaurant_payment_methods_require_cash
  before insert or update or delete on public.restaurant_payment_methods
  for each row execute function public.enforce_cash_payment_method();

alter table public.order_correction_events alter column reason drop not null;

create or replace function public.correct_paid_order(p_order_id uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_role text := public.current_role_key();
  v_order public.orders%rowtype;
  v_name text;
  v_loc uuid;
  v_allowed boolean := false;
begin
  if v_restaurant_id is null or auth.uid() is null then raise exception 'Authentication required'; end if;
  select a.display_name,a.location_id into v_name,v_loc
  from public.accounts a
  where a.auth_user_id=auth.uid() and a.restaurant_id=v_restaurant_id and a.is_active;
  if not found then raise exception 'Active account not found'; end if;
  if v_role='admin' then
    select corrections_admin into v_allowed from public.restaurants where id=v_restaurant_id;
  else
    select coalesce(r.corrections_employees,false) and exists (
      select 1 from public.accounts a
      cross join lateral unnest(a.role_ids) assigned(role_id)
      join public.restaurant_role_settings rs on rs.restaurant_id=a.restaurant_id
        and rs.role_id=assigned.role_id and rs.corrections_allowed
      where a.auth_user_id=auth.uid() and a.restaurant_id=v_restaurant_id and a.is_active
    ) into v_allowed from public.restaurants r where r.id=v_restaurant_id;
  end if;
  if not coalesce(v_allowed,false) then raise exception 'Order correction is not enabled for this account'; end if;
  select * into v_order from public.orders
  where id=p_order_id and restaurant_id=v_restaurant_id for update;
  if not found or v_order.status<>'correct' then raise exception 'Order is unavailable or already corrected'; end if;
  if v_role<>'admin' and v_order.location_id is distinct from v_loc then raise exception 'Location forbidden'; end if;
  if (v_order.paid_at at time zone 'America/Lima')::date not between
      (now() at time zone 'America/Lima')::date-1 and (now() at time zone 'America/Lima')::date then
    raise exception 'Only today and yesterday can be corrected';
  end if;
  insert into public.order_correction_events(restaurant_id,order_id,corrected_by,operator_name_snapshot,reason)
  values(v_restaurant_id,v_order.id,auth.uid(),v_name,null);
  update public.orders set status='erroneous' where id=v_order.id;
  return jsonb_build_object('order_id',v_order.id,'excluded_amount',v_order.total,'status','erroneous');
end;
$$;
revoke all on function public.correct_paid_order(uuid,text) from public,anon;
grant execute on function public.correct_paid_order(uuid,text) to authenticated;

