-- Setter keeps only restaurants and the fixed optional-needs selection.
-- Configuration values live in typed restaurant/domain columns and are managed in the POS.

-- Preserve the useful attendance switches while removing the generic JSON configuration.
alter table public.restaurants
  add column if not exists attendance_check_in_self boolean not null default false,
  add column if not exists attendance_check_in_peer_at_location boolean not null default false,
  add column if not exists attendance_check_out_self boolean not null default false,
  add column if not exists attendance_check_out_peer_at_location boolean not null default false;

do $$
begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='restaurants' and column_name='configuration') then
    update public.restaurants set
      attendance_check_in_self = coalesce((configuration->>'attendance.check_in.self')::boolean, attendance_check_in_self),
      attendance_check_in_peer_at_location = coalesce((configuration->>'attendance.check_in.peer_at_location')::boolean, attendance_check_in_peer_at_location),
      attendance_check_out_self = coalesce((configuration->>'attendance.check_out.self')::boolean, attendance_check_out_self),
      attendance_check_out_peer_at_location = coalesce((configuration->>'attendance.check_out.peer_at_location')::boolean, attendance_check_out_peer_at_location);
  end if;
end $$;

-- Convert legacy fixed-tab keys into the closed optional-needs vocabulary.
update public.restaurants set needs = array(
  select distinct case value when 'dining' then 'salon' else value end
  from unnest(coalesce(needs,'{}'::text[])) as needs_item(value)
  where case value when 'dining' then 'salon' else value end = any(array['crm','kitchen','salon','delivery','receipts']::text[])
  order by 1
);

alter table public.restaurants drop constraint if exists restaurants_architecture_version_id_fkey;
alter table public.restaurants drop constraint if exists restaurants_architecture_id_architecture_version_fkey;
alter table public.restaurants drop constraint if exists restaurants_architecture_id_fkey;
alter table public.restaurants drop constraint if exists restaurants_needs_optional_only;
alter table public.restaurants add constraint restaurants_needs_optional_only
  check (needs <@ array['crm','kitchen','salon','delivery','receipts']::text[]);

drop function if exists public.setter_save_need(jsonb);
drop function if exists public.setter_delete_need(text);
drop function if exists public.setter_save_configuration(jsonb);
drop function if exists public.setter_delete_configuration(text);
drop function if exists public.setter_save_architecture_family(jsonb);
drop function if exists public.setter_create_architecture_version(jsonb);
drop function if exists public.setter_delete_architecture_family(text);
drop function if exists public.setter_change_restaurant_architecture(uuid,uuid);
drop function if exists public.setter_update_restaurant_configuration(uuid,jsonb);

drop table if exists public.architecture_configurations;
drop table if exists public.architecture_needs;
drop table if exists public.configuration_catalog;
drop table if exists public.architecture_versions;

alter table public.restaurants
  drop column if exists architecture_version_id,
  drop column if exists architecture_id,
  drop column if exists architecture_version,
  drop column if exists configuration,
  drop column if exists configuration_keys,
  drop column if exists kind,
  drop column if exists city;

drop table if exists public.architectures;
drop table if exists public.needs;

drop policy if exists "account schedules readable to platform operators" on public.account_schedules;
create policy "account schedules readable to platform operators" on public.account_schedules
  for select to authenticated using ((select public.is_platform_operator()));

create or replace function public.create_restaurant_bundle(payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  rid uuid;
  role_item jsonb;
  initial_uid uuid;
  selected_needs text[] := array(select jsonb_array_elements_text(coalesce(payload->'needs','[]'::jsonb)));
begin
  if coalesce(trim(payload->>'name'),'') = '' then raise exception 'restaurant_name_required'; end if;
  if exists(select 1 from unnest(selected_needs) as selected(value) where value <> all(array['crm','kitchen','salon','delivery','receipts']::text[])) then
    raise exception 'invalid_optional_needs';
  end if;
  if cardinality(selected_needs) <> (select count(distinct value) from unnest(selected_needs) as selected(value)) then raise exception 'duplicate_optional_needs'; end if;

  insert into public.restaurants(name,status,needs,logo_path)
  values(trim(payload->>'name'),'active',selected_needs,nullif(payload->>'logo_path','')) returning id into rid;
  for role_item in select value from jsonb_array_elements(coalesce(payload->'roles','[]'::jsonb)) loop
    insert into public.roles(restaurant_id,key,name,permissions)
    values(rid,role_item->>'key',role_item->>'name',coalesce(role_item->'permissions','{}'::jsonb));
  end loop;
  initial_uid := (payload->>'initial_auth_user_id')::uuid;
  insert into public.accounts(auth_user_id,restaurant_id,role_id,username,display_name)
  select initial_uid,rid,ro.id,lower(payload->>'initial_username'),payload->>'initial_display_name'
  from public.roles ro where ro.restaurant_id=rid and ro.key='admin';
  if not found then raise exception 'admin_role_required'; end if;
  return rid;
end; $$;
revoke all on function public.create_restaurant_bundle(jsonb) from public,anon,authenticated;
grant execute on function public.create_restaurant_bundle(jsonb) to service_role;
