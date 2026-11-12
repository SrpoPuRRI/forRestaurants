-- Require a primary location for each new restaurant and allow username reuse
-- after an account is deactivated, while keeping active usernames unique.

alter table public.accounts drop constraint if exists accounts_username_key;
create unique index if not exists accounts_active_username_uidx
  on public.accounts (lower(username)) where is_active;

insert into public.locations (restaurant_id, name, is_active)
select restaurant.id, 'Sede principal', true
from public.restaurants restaurant
where not exists (
  select 1 from public.locations location
  where location.restaurant_id = restaurant.id and location.is_active
);

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
    where value <> all(array['crm','kitchen','salon','delivery','receipts']::text[])) then
    raise exception 'invalid_optional_needs';
  end if;
  if cardinality(selected_needs) <> (select count(distinct value) from unnest(selected_needs) as selected(value)) then
    raise exception 'duplicate_optional_needs';
  end if;
  insert into public.restaurants(name,status,needs,logo_path)
  values(trim(payload->>'name'),'active',selected_needs,nullif(payload->>'logo_path',''))
  returning id into restaurant_id;
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
