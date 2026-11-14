-- Needs are configured by the POS UI. Keep only its application-level allowlist;
-- the database must not block enabling/disabling an optional workspace.
alter table public.restaurants drop constraint if exists restaurants_needs_optional_only;

do $$
declare item record;
begin
  for item in
    select conname
    from pg_constraint
    where conrelid = 'public.restaurants'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%needs%'
  loop
    execute format('alter table public.restaurants drop constraint %I', item.conname);
  end loop;
end;
$$;

-- Upgrade stored legacy key after removing the old check. The update also fires
-- the account-role synchronization trigger; the explicit sync below is idempotent.
update public.restaurants
set needs = array(
  select distinct case need_key when 'receipts' then 'printing_systems' else need_key end
  from unnest(coalesce(needs, '{}'::text[])) as selected(need_key)
  order by 1
)
where 'receipts' = any(coalesce(needs, '{}'::text[]));

create or replace function public.restaurant_sync_available_roles(p_restaurant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  selected_needs text[];
  separate_bar boolean;
  allowed_role_ids uuid[];
  employee_role_id uuid;
begin
  select needs, kitchen_has_separate_bar into selected_needs, separate_bar
  from public.restaurants where id = p_restaurant_id;
  if not found then return; end if;
  select coalesce(array_agg(role.id order by role.sort_order, role.key), '{}')
  into allowed_role_ids from public.roles role
  where role.key in ('admin','employee')
     or (role.key = 'cashier' and coalesce(cardinality(array_remove(selected_needs, 'printing_systems')), 0) > 0)
     or (role.key = 'cook' and 'kitchen' = any(selected_needs))
     or (role.key in ('barista','bartender') and 'kitchen' = any(selected_needs) and separate_bar)
     or (role.key in ('waiter','host') and 'salon' = any(selected_needs))
     or (role.key = 'social_manager' and 'crm' = any(selected_needs))
     or (role.key = 'courier' and 'delivery' = any(selected_needs));
  update public.restaurants set available_role_ids = allowed_role_ids where id = p_restaurant_id;
  select id into employee_role_id from public.roles where key = 'employee';
  with valid_roles as (
    select account.auth_user_id,
      coalesce(array_agg(role.id order by role.sort_order, role.key)
        filter (where role.id is not null and role.id = any(allowed_role_ids)), '{}') as role_ids
    from public.accounts account
    left join lateral unnest(account.role_ids) assigned(role_id) on true
    left join public.roles role on role.id = assigned.role_id
    where account.restaurant_id = p_restaurant_id group by account.auth_user_id
  )
  update public.accounts account set role_ids = case
    when employee_role_id = any(valid_roles.role_ids) then array[employee_role_id]
    when cardinality(valid_roles.role_ids) = 0 then array[employee_role_id]
    else valid_roles.role_ids end
  from valid_roles where account.auth_user_id = valid_roles.auth_user_id
    and account.restaurant_id = p_restaurant_id
    and not (account.role_ids <@ allowed_role_ids);
end;
$$;
select public.restaurant_sync_available_roles(id) from public.restaurants;

create or replace function public.current_has_permission(p_permission_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.accounts a
    join public.restaurants restaurant on restaurant.id = a.restaurant_id
    join public.roles assigned on assigned.id = any(a.role_ids)
    where a.auth_user_id = (select auth.uid()) and a.is_active and restaurant.status = 'active'
      and assigned.id = any(restaurant.available_role_ids)
      and (
        assigned.key = 'admin'
        or (assigned.key = 'employee' and (
          exists (
            select 1 from public.roles enabled where enabled.id = any(restaurant.available_role_ids)
              and enabled.key not in ('admin','employee')
              and coalesce((enabled.permissions ->> p_permission_key)::boolean, false)
          )
          or (p_permission_key in ('orders','payments') and not exists (
            select 1 from unnest(coalesce(restaurant.needs, '{}'::text[])) as need(key)
            where need.key <> 'printing_systems'
          ))
        ))
        or (assigned.key not in ('admin','employee')
          and coalesce((assigned.permissions ->> p_permission_key)::boolean, false))
      )
  );
$$;

create or replace function public.create_restaurant_bundle(payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  restaurant_id uuid;
  initial_user_id uuid;
  admin_role_id uuid;
  selected_needs text[] := array(select jsonb_array_elements_text(coalesce(payload->'needs','[]'::jsonb)));
  initial_location jsonb := coalesce(payload->'initial_location', '{}'::jsonb);
begin
  if coalesce(trim(payload->>'name'), '') = '' then raise exception 'restaurant_name_required'; end if;
  if exists(select 1 from unnest(selected_needs) as selected(value)
    where value <> all(array['crm','kitchen','salon','delivery','printing_systems']::text[])) then
    raise exception 'invalid_optional_needs';
  end if;
  if cardinality(selected_needs) <> (select count(distinct value) from unnest(selected_needs) as selected(value)) then
    raise exception 'duplicate_optional_needs';
  end if;
  insert into public.restaurants(name,status,needs,logo_path)
  values(trim(payload->>'name'),'active',selected_needs,nullif(payload->>'logo_path','')) returning id into restaurant_id;
  perform public.restaurant_sync_available_roles(restaurant_id);
  insert into public.locations(restaurant_id,name,address,is_active)
  values(restaurant_id,coalesce(nullif(trim(initial_location->>'name'),''),'Sede principal'),nullif(trim(initial_location->>'address'),''),true);
  select id into admin_role_id from public.roles where key = 'admin';
  if admin_role_id is null then raise exception 'global_admin_role_missing'; end if;
  initial_user_id := (payload->>'initial_auth_user_id')::uuid;
  insert into public.accounts(auth_user_id,restaurant_id,role_ids,username,display_name)
  values(initial_user_id,restaurant_id,array[admin_role_id],lower(payload->>'initial_username'),payload->>'initial_display_name');
  return restaurant_id;
end;
$$;
revoke all on function public.create_restaurant_bundle(jsonb) from public, anon, authenticated;
grant execute on function public.create_restaurant_bundle(jsonb) to service_role;
