-- Global role catalog, multi-role accounts, reusable work schedules, and attendance records.
-- Existing accounts and schedule assignments are migrated in place.

-- Preserve the current restaurant-scoped rows while replacing the public roles table.
drop policy if exists "roles scope read" on public.roles;
alter table public.roles rename to restaurant_roles_legacy;
alter table public.restaurant_roles_legacy rename constraint roles_pkey to restaurant_roles_legacy_pkey;
alter table public.restaurant_roles_legacy rename constraint roles_restaurant_id_key_key to restaurant_roles_legacy_restaurant_id_key_key;
alter table public.restaurant_roles_legacy rename constraint roles_id_restaurant_id_key to restaurant_roles_legacy_id_restaurant_id_key;

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

insert into public.roles(id, key, name, permissions, sort_order)
select distinct on (key) id, key, name, permissions, 100
from public.restaurant_roles_legacy
order by key, created_at, id
on conflict (key) do nothing;

insert into public.roles(key, name, permissions, sort_order) values
  ('admin', 'Administrador', '{"all":true}'::jsonb, 0),
  ('employee', 'Empleado', '{"all_available":true}'::jsonb, 1),
  ('cashier', 'Cajero', '{"orders":true,"payments":true}'::jsonb, 10),
  ('cook', 'Cocinero', '{"kitchen":true,"catalog_stock":true}'::jsonb, 20),
  ('waiter', 'Mesero', '{"salon":true}'::jsonb, 30),
  ('host', 'Portero', '{"salon":true}'::jsonb, 31),
  ('barista', 'Barista', '{"bar":true,"catalog_stock":true}'::jsonb, 40),
  ('bartender', 'Bartender', '{"bar":true,"catalog_stock":true}'::jsonb, 41),
  ('social_manager', 'Social Manager', '{"crm":true}'::jsonb, 50),
  ('courier', 'Repartidor', '{"delivery":true}'::jsonb, 60)
on conflict (key) do update set
  name = excluded.name,
  permissions = excluded.permissions,
  sort_order = excluded.sort_order;

alter table public.restaurants
  add column if not exists available_role_ids uuid[] not null default '{}';

alter table public.accounts
  add column if not exists role_ids uuid[] not null default '{}',
  add column if not exists schedule_ids uuid[] not null default '{}',
  add column if not exists assistance_id uuid,
  add column if not exists must_change_password boolean not null default false;

alter table public.accounts drop constraint if exists accounts_role_id_restaurant_id_fkey;
alter table public.restaurant_role_settings drop constraint if exists restaurant_role_settings_role_id_restaurant_id_fkey;

update public.accounts a
set role_ids = array(
  select r.id
  from public.restaurant_roles_legacy old_role
  join public.roles r on r.key = old_role.key
  where old_role.id = a.role_id
);

update public.accounts
set role_ids = array[(select id from public.roles where key = 'employee')]
where coalesce(cardinality(role_ids), 0) = 0;

update public.restaurant_role_settings setting
set role_id = global_role.id
from public.restaurant_roles_legacy old_role
join public.roles global_role on global_role.key = old_role.key
where setting.role_id = old_role.id;

alter table public.restaurant_role_settings
  add constraint restaurant_role_settings_role_id_fkey
  foreign key (role_id) references public.roles(id) on delete cascade;

-- Replace the old scalar-role helper before dropping accounts.role_id so existing
-- policies continue to resolve the new account model without an invalid dependency.
create or replace function public.current_role_key()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (
      select 1 from public.accounts a join public.roles role on role.id = any(a.role_ids)
      where a.auth_user_id = (select auth.uid()) and a.is_active and role.key = 'admin'
    ) then 'admin'
    when exists (
      select 1 from public.accounts a
      where a.auth_user_id = (select auth.uid()) and a.is_active
    ) then 'employee'
    else null
  end;
$$;

-- Schedules become reusable restaurant-owned blocks; accounts store their selected IDs.
drop policy if exists "account schedule self or admin" on public.account_schedules;
drop policy if exists "account schedules readable to platform operators" on public.account_schedules;
alter table public.account_schedules add column if not exists restaurant_id uuid;
update public.account_schedules schedule
set restaurant_id = account.restaurant_id
from public.accounts account
where account.auth_user_id = schedule.auth_user_id
  and schedule.restaurant_id is null;

update public.accounts account
set schedule_ids = coalesce((
  select array_agg(distinct canonical.id order by canonical.id)
  from public.account_schedules schedule
  cross join lateral (
    select duplicate.id
    from public.account_schedules duplicate
    where duplicate.restaurant_id = schedule.restaurant_id
      and duplicate.weekday = schedule.weekday
      and duplicate.starts_at = schedule.starts_at
      and duplicate.ends_at = schedule.ends_at
    order by duplicate.id
    limit 1
  ) canonical
  where schedule.auth_user_id = account.auth_user_id
), '{}');

delete from public.account_schedules schedule
using public.account_schedules duplicate
where schedule.restaurant_id = duplicate.restaurant_id
  and schedule.weekday = duplicate.weekday
  and schedule.starts_at = duplicate.starts_at
  and schedule.ends_at = duplicate.ends_at
  and schedule.id > duplicate.id;

alter table public.account_schedules
  drop constraint if exists account_schedules_auth_user_id_fkey,
  drop column if exists auth_user_id,
  alter column restaurant_id set not null,
  add constraint account_schedules_restaurant_id_fkey
    foreign key (restaurant_id) references public.restaurants(id) on delete cascade;

create unique index if not exists account_schedules_restaurant_block_uidx
  on public.account_schedules(restaurant_id, weekday, starts_at, ends_at);
create index if not exists account_schedules_restaurant_idx
  on public.account_schedules(restaurant_id);

alter table public.accounts drop column if exists role_id;
drop table public.restaurant_roles_legacy;

alter table public.roles enable row level security;
create policy "global role catalog read" on public.roles
  for select to authenticated using (true);
grant select on public.roles to authenticated;
grant select on public.roles to service_role;
revoke insert, update, delete on public.roles from anon, authenticated;

create or replace function public.current_role_key()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (
      select 1 from public.accounts a join public.roles role on role.id = any(a.role_ids)
      where a.auth_user_id = (select auth.uid()) and a.is_active and role.key = 'admin'
    ) then 'admin'
    when exists (
      select 1 from public.accounts a
      where a.auth_user_id = (select auth.uid()) and a.is_active
    ) then 'employee'
    else null
  end;
$$;

create or replace function public.current_has_role(p_role_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.accounts a
    join public.restaurants restaurant on restaurant.id = a.restaurant_id
    join public.roles assigned on assigned.id = any(a.role_ids)
    join public.roles wanted on wanted.key = p_role_key
    where a.auth_user_id = (select auth.uid())
      and a.is_active and restaurant.status = 'active'
      and (assigned.id = any(restaurant.available_role_ids))
      and (
        assigned.id = wanted.id
        or (assigned.key = 'employee' and wanted.key <> 'admin'
            and wanted.id = any(restaurant.available_role_ids))
      )
  );
$$;

create or replace function public.current_has_permission(p_permission_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.accounts a
    join public.restaurants restaurant on restaurant.id = a.restaurant_id
    join public.roles assigned on assigned.id = any(a.role_ids)
    where a.auth_user_id = (select auth.uid())
      and a.is_active and restaurant.status = 'active'
      and assigned.id = any(restaurant.available_role_ids)
      and (
        assigned.key = 'admin'
        or (
          assigned.key = 'employee'
          and exists (
            select 1 from public.roles enabled
            where enabled.id = any(restaurant.available_role_ids)
              and enabled.key not in ('admin', 'employee')
              and coalesce((enabled.permissions ->> p_permission_key)::boolean, false)
          )
        )
        or (
          assigned.key not in ('admin', 'employee')
          and coalesce((assigned.permissions ->> p_permission_key)::boolean, false)
        )
      )
  );
$$;

create or replace function public.restaurant_sync_available_roles(p_restaurant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare selected_needs text[]; separate_bar boolean; role_ids uuid[];
begin
  select needs, kitchen_has_separate_bar into selected_needs, separate_bar
  from public.restaurants where id = p_restaurant_id;
  if not found then return; end if;

  select coalesce(array_agg(role.id order by role.sort_order, role.key), '{}')
  into role_ids
  from public.roles role
  where role.key in ('admin', 'employee')
     or (role.key = 'cashier' and coalesce(cardinality(array_remove(selected_needs, 'receipts')), 0) > 0)
     or (role.key = 'cook' and 'kitchen' = any(selected_needs))
     or (role.key in ('barista', 'bartender') and 'kitchen' = any(selected_needs) and separate_bar)
     or (role.key in ('waiter', 'host') and 'salon' = any(selected_needs))
     or (role.key = 'social_manager' and 'crm' = any(selected_needs))
     or (role.key = 'courier' and 'delivery' = any(selected_needs));

  update public.restaurants set available_role_ids = role_ids where id = p_restaurant_id;
end;
$$;

create or replace function public.restaurant_sync_available_roles_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.restaurant_sync_available_roles(new.id);
  return new;
end;
$$;

drop trigger if exists restaurant_available_roles_sync on public.restaurants;
create trigger restaurant_available_roles_sync
after insert or update of needs, kitchen_has_separate_bar on public.restaurants
for each row execute function public.restaurant_sync_available_roles_trigger();

select public.restaurant_sync_available_roles(id) from public.restaurants;

create or replace function public.accounts_validate_roles()
returns trigger language plpgsql security definer set search_path = '' as $$
declare available uuid[];
begin
  select available_role_ids into available from public.restaurants where id = new.restaurant_id;
  if available is null then raise exception 'restaurant_not_found'; end if;
  if coalesce(cardinality(new.role_ids), 0) = 0 then raise exception 'account_requires_role'; end if;
  if cardinality(new.role_ids) <> (select count(distinct selected.role_id) from unnest(new.role_ids) as selected(role_id)) then
    raise exception 'duplicate_account_role';
  end if;
  if not (new.role_ids <@ available) then raise exception 'role_not_enabled_for_restaurant'; end if;
  if exists(select 1 from public.roles where key in ('admin','employee') and id = any(new.role_ids))
     and cardinality(new.role_ids) <> 1 then
    raise exception 'admin_and_employee_roles_are_exclusive';
  end if;
  if exists(
    select 1 from unnest(new.role_ids) as selected(role_id)
    where not exists(select 1 from public.roles role where role.id = selected.role_id)
  ) then
    raise exception 'account_role_not_found';
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_validate_roles on public.accounts;
create trigger accounts_validate_roles
before insert or update of role_ids, restaurant_id on public.accounts
for each row execute function public.accounts_validate_roles();

create or replace function public.accounts_validate_schedules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(cardinality(new.schedule_ids), 0) <> (
    select count(distinct schedule_id) from unnest(new.schedule_ids) as schedule_ids(schedule_id)
  ) then raise exception 'duplicate_account_schedule'; end if;
  if exists (
    select 1 from unnest(new.schedule_ids) as selected(schedule_id)
    where not exists (
      select 1 from public.account_schedules schedule
      where schedule.id = selected.schedule_id and schedule.restaurant_id = new.restaurant_id
    )
  ) then raise exception 'schedule_not_in_restaurant'; end if;
  return new;
end;
$$;

drop trigger if exists accounts_validate_schedules on public.accounts;
create trigger accounts_validate_schedules
before insert or update of schedule_ids, restaurant_id on public.accounts
for each row execute function public.accounts_validate_schedules();

drop policy if exists "account schedule self or admin" on public.account_schedules;
drop policy if exists "account schedules readable to platform operators" on public.account_schedules;
create policy "account schedules assigned or admin read" on public.account_schedules
  for select to authenticated using (
    restaurant_id = (select public.current_restaurant_id())
    and (
      (select public.current_role_key()) = 'admin'
      or exists (
        select 1 from public.accounts account
        where account.auth_user_id = (select auth.uid())
          and account.schedule_ids @> array[account_schedules.id]
      )
    )
    or (select public.is_platform_operator())
  );
revoke insert, update, delete on public.account_schedules from anon, authenticated;
grant select on public.account_schedules to authenticated;
grant all on public.account_schedules to service_role;

create table public.attendance_objects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

do $$
declare account_id uuid; object_id uuid;
begin
  for account_id in select auth_user_id from public.accounts where assistance_id is null loop
    insert into public.attendance_objects default values returning id into object_id;
    update public.accounts set assistance_id = object_id where auth_user_id = account_id;
  end loop;
end;
$$;

alter table public.accounts
  alter column assistance_id set not null,
  add constraint accounts_assistance_id_key unique (assistance_id),
  add constraint accounts_assistance_id_fkey foreign key (assistance_id)
    references public.attendance_objects(id) on delete restrict;

drop trigger if exists accounts_create_attendance_object on public.accounts;
create or replace function public.accounts_ensure_attendance_object()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assistance_id is null then
    insert into public.attendance_objects default values returning id into new.assistance_id;
  end if;
  return new;
end;
$$;
drop trigger if exists accounts_ensure_attendance_object on public.accounts;
create trigger accounts_ensure_attendance_object
before insert or update of assistance_id on public.accounts
for each row execute function public.accounts_ensure_attendance_object();

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  assistance_id uuid not null references public.attendance_objects(id) on delete restrict,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  event_type text not null check (event_type in ('check_in','check_out')),
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null,
  method text not null check (method in ('self','peer','admin','admin_correction')),
  correction_reason text,
  created_at timestamptz not null default now(),
  check ((method = 'admin_correction') = (correction_reason is not null))
);

create index attendance_records_restaurant_time_idx
  on public.attendance_records(restaurant_id, occurred_at desc);
create index attendance_records_object_time_idx
  on public.attendance_records(assistance_id, occurred_at desc);

alter table public.attendance_objects enable row level security;
alter table public.attendance_records enable row level security;

create policy "attendance objects own or admin read" on public.attendance_objects
  for select to authenticated using (
    exists (
      select 1 from public.accounts account
      where account.assistance_id = attendance_objects.id
        and account.restaurant_id = (select public.current_restaurant_id())
        and (account.auth_user_id = (select auth.uid()) or (select public.current_role_key()) = 'admin')
    )
  );
create policy "attendance records team read" on public.attendance_records
  for select to authenticated using (
    restaurant_id = (select public.current_restaurant_id())
    and (
      (select public.current_role_key()) = 'admin'
      or exists (
        select 1 from public.accounts account
        where account.auth_user_id = (select auth.uid())
          and account.assistance_id = attendance_records.assistance_id
      )
      or exists (
        select 1 from public.restaurants restaurant
        join public.accounts actor on actor.auth_user_id = (select auth.uid())
        where restaurant.id = attendance_records.restaurant_id
          and actor.restaurant_id = restaurant.id
          and actor.location_id = attendance_records.location_id
          and (restaurant.attendance_check_in_peer_at_location or restaurant.attendance_check_out_peer_at_location)
      )
    )
  );
grant select on public.attendance_objects, public.attendance_records to authenticated;
revoke insert, update, delete on public.attendance_objects, public.attendance_records from anon, authenticated;
grant all on public.attendance_objects, public.attendance_records to service_role;

create or replace function public.mark_attendance(
  p_staff_profile_id uuid,
  p_location_id uuid default null,
  p_event_type text default null,
  p_event_at timestamptz default null,
  p_correction_reason text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  actor public.accounts%rowtype;
  target public.accounts%rowtype;
  restaurant public.restaurants%rowtype;
  selected_location uuid;
  latest_type text;
  effective_type text;
  effective_time timestamptz := coalesce(p_event_at, now());
  record_method text;
  record_id uuid;
  is_admin boolean;
  is_self boolean;
  allowed boolean := false;
begin
  select * into actor from public.accounts where auth_user_id = actor_id and is_active;
  if not found then raise exception 'active_account_required'; end if;
  select * into restaurant from public.restaurants where id = actor.restaurant_id and status = 'active';
  if not found then raise exception 'active_restaurant_required'; end if;
  select * into target from public.accounts
    where auth_user_id = p_staff_profile_id and restaurant_id = actor.restaurant_id and is_active;
  if not found then raise exception 'attendance_account_not_found'; end if;

  is_admin := public.current_has_role('admin');
  is_self := actor.auth_user_id = target.auth_user_id;
  selected_location := coalesce(p_location_id, target.location_id);
  if selected_location is null or not exists (
    select 1 from public.locations where id = selected_location and restaurant_id = actor.restaurant_id and is_active
  ) then raise exception 'attendance_location_required'; end if;

  if p_event_at is not null and not is_admin then raise exception 'manual_attendance_requires_admin'; end if;
  if p_event_at is not null then
    if (effective_time at time zone 'America/Lima')::date < (now() at time zone 'America/Lima')::date - 1
       or (effective_time at time zone 'America/Lima')::date > (now() at time zone 'America/Lima')::date
       or effective_time > now() + interval '1 minute'
       or nullif(trim(coalesce(p_correction_reason,'')), '') is null then
      raise exception 'attendance_correction_must_be_today_or_yesterday_with_reason';
    end if;
    record_method := 'admin_correction';
  elsif is_admin then
    record_method := 'admin';
  elsif is_self then
    record_method := 'self';
  else
    record_method := 'peer';
  end if;

  if not is_admin then
    if is_self then
      allowed := case coalesce(p_event_type, 'check_in')
        when 'check_in' then restaurant.attendance_check_in_self
        when 'check_out' then restaurant.attendance_check_out_self
        else false end;
      if target.location_id is distinct from selected_location then raise exception 'attendance_location_mismatch'; end if;
    else
      allowed := actor.location_id is not null
        and actor.location_id = selected_location
        and target.location_id = selected_location
        and case coalesce(p_event_type, 'check_in')
          when 'check_in' then restaurant.attendance_check_in_peer_at_location
          when 'check_out' then restaurant.attendance_check_out_peer_at_location
          else false end;
    end if;
    if not allowed then raise exception 'attendance_permission_denied'; end if;
  end if;

  perform 1 from public.attendance_objects where id = target.assistance_id for update;
  select event_type into latest_type from public.attendance_records
    where assistance_id = target.assistance_id and restaurant_id = actor.restaurant_id
    order by occurred_at desc, recorded_at desc, id desc limit 1;
  effective_type := coalesce(p_event_type, case when latest_type = 'check_in' then 'check_out' else 'check_in' end);
  if effective_type not in ('check_in','check_out') then raise exception 'attendance_event_invalid'; end if;
  if latest_type is null and effective_type <> 'check_in' then raise exception 'attendance_check_in_required'; end if;
  if latest_type = 'check_in' and effective_type <> 'check_out' then raise exception 'attendance_check_out_required'; end if;
  if latest_type = 'check_out' and effective_type <> 'check_in' then raise exception 'attendance_check_in_required'; end if;

  insert into public.attendance_records(
    assistance_id, restaurant_id, location_id, event_type, occurred_at,
    recorded_at, recorded_by, method, correction_reason
  ) values (
    target.assistance_id, actor.restaurant_id, selected_location, effective_type,
    effective_time, now(), actor_id, record_method,
    case when record_method = 'admin_correction' then trim(p_correction_reason) else null end
  ) returning id into record_id;
  return record_id;
end;
$$;

revoke all on function public.mark_attendance(uuid,uuid,text,timestamptz,text) from public, anon;
grant execute on function public.mark_attendance(uuid,uuid,text,timestamptz,text) to authenticated;

create or replace function public.clear_own_password_change_requirement()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.accounts set must_change_password = false
  where auth_user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'active_account_required'; end if;
end;
$$;
revoke all on function public.clear_own_password_change_requirement() from public, anon;
grant execute on function public.clear_own_password_change_requirement() to authenticated;

drop policy if exists "account self or admin read" on public.accounts;
create policy "account team read" on public.accounts for select to authenticated
  using (
    (auth_user_id = (select auth.uid()))
    or (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = 'admin')
    or (restaurant_id = (select public.current_restaurant_id()) and is_active)
    or (select public.is_platform_operator())
  );

create or replace function public.workspace_can_edit_salon_map()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_has_role('admin')
    or public.current_has_role('employee')
    or (
      public.current_has_role('waiter')
      and exists(select 1 from public.restaurants where id = public.current_restaurant_id() and salon_waiter_map_edit)
    )
    or (
      public.current_has_role('host')
      and exists(select 1 from public.restaurants where id = public.current_restaurant_id() and salon_host_map_edit)
    );
$$;

create or replace function public.workspace_assert_actor(p_need text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare restaurant_id uuid := public.current_restaurant_id();
begin
  if restaurant_id is null or not coalesce(public.workspace_has_need(p_need), false) then
    raise exception 'workspace_not_enabled';
  end if;
  if not public.current_has_permission(p_need) then raise exception 'workspace_permission_denied'; end if;
  return restaurant_id;
end;
$$;

create or replace function public.set_catalog_stock_availability(p_entity text, p_entity_id uuid, p_is_available boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_restaurant_id uuid := public.current_restaurant_id(); affected integer;
begin
  if v_restaurant_id is null or not public.current_has_permission('catalog_stock') then
    raise exception 'catalog_stock_permission_denied';
  end if;
  if p_entity = 'product' then
    update public.products set is_active = p_is_available
      where id = p_entity_id and restaurant_id = v_restaurant_id;
  elsif p_entity = 'variant' then
    update public.variants set is_active = p_is_available
      where id = p_entity_id and restaurant_id = v_restaurant_id;
  elsif p_entity = 'addon' then
    update public.addons set is_active = p_is_available
      where id = p_entity_id and restaurant_id = v_restaurant_id;
  else
    raise exception 'catalog_stock_entity_invalid';
  end if;
  get diagnostics affected = row_count;
  if affected = 0 then raise exception 'catalog_stock_item_not_found'; end if;
end;
$$;

create or replace function public.create_restaurant_bundle(payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  restaurant_id uuid;
  initial_user_id uuid;
  admin_role_id uuid;
  selected_needs text[] := array(select jsonb_array_elements_text(coalesce(payload->'needs','[]'::jsonb)));
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
  select id into admin_role_id from public.roles where key = 'admin';
  initial_user_id := (payload->>'initial_auth_user_id')::uuid;
  insert into public.accounts(auth_user_id,restaurant_id,role_ids,username,display_name)
  values(initial_user_id,restaurant_id,array[admin_role_id],lower(payload->>'initial_username'),payload->>'initial_display_name');
  return restaurant_id;
end;
$$;
revoke all on function public.create_restaurant_bundle(jsonb) from public, anon, authenticated;
grant execute on function public.create_restaurant_bundle(jsonb) to service_role;
