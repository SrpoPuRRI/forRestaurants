-- Separate stable architecture families from immutable, restaurant-selectable versions.
alter table public.restaurants
  add column if not exists configuration_keys text[] not null default '{}';

alter table public.architectures
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

alter table public.needs
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

create table public.architecture_versions (
  id uuid primary key default gen_random_uuid(),
  architecture_id text not null references public.architectures(id) on delete cascade,
  version integer not null check (version > 0),
  label text not null,
  description text not null default '',
  role_templates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (architecture_id, version)
);

insert into public.architecture_versions(architecture_id,version,label,description,role_templates)
select id,version,'Versión '||version,description,role_templates from public.architectures;

create table public.architecture_needs (
  architecture_version_id uuid not null references public.architecture_versions(id) on delete cascade,
  need_key text not null references public.needs(key) on update cascade on delete restrict,
  created_at timestamptz not null default now(),
  primary key (architecture_version_id,need_key)
);

insert into public.architecture_needs(architecture_version_id,need_key)
select v.id,f.key from public.architecture_versions v
join public.architectures a on a.id=v.architecture_id
cross join lateral unnest(a.allowed_features) as f(key)
join public.needs n on n.key=f.key
on conflict do nothing;

create table public.configuration_catalog (
  key text primary key check (key ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  label text not null,
  area text not null default 'general',
  value_type text not null check (value_type in ('boolean','text','number','select','json')),
  options jsonb not null default '[]'::jsonb,
  default_value jsonb not null default 'null'::jsonb,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.architecture_configurations (
  architecture_version_id uuid not null references public.architecture_versions(id) on delete cascade,
  configuration_key text not null references public.configuration_catalog(key) on update cascade on delete cascade,
  default_value jsonb,
  created_at timestamptz not null default now(),
  primary key (architecture_version_id,configuration_key)
);

insert into public.configuration_catalog(key,label,area,value_type,default_value,description) values
 ('attendance.check_in.self','Empleado marca su propia entrada','attendance','boolean','false','Permite a una cuenta registrar su propia entrada.'),
 ('attendance.check_in.peer_at_location','Compañero marca entrada','attendance','boolean','false','Permite a un compañero de la misma sede marcar la entrada.'),
 ('attendance.check_out.self','Empleado marca su propia salida','attendance','boolean','false','Permite a una cuenta registrar su propia salida.'),
 ('attendance.check_out.peer_at_location','Compañero marca salida','attendance','boolean','false','Permite a un compañero de la misma sede marcar la salida.')
on conflict (key) do nothing;

insert into public.architecture_configurations(architecture_version_id,configuration_key)
select v.id,c.key from public.architecture_versions v
join public.architectures a on a.id=v.architecture_id
cross join public.configuration_catalog c
where c.key like 'attendance.%' and 'accounts'=any(a.allowed_features)
on conflict do nothing;

alter table public.restaurants
  add column architecture_version_id uuid;

update public.restaurants r set architecture_version_id=v.id
from public.architecture_versions v
where v.architecture_id=r.architecture_id and v.version=r.architecture_version;

update public.restaurants r
set configuration=coalesce((select jsonb_object_agg(ac.configuration_key,coalesce(ac.default_value,c.default_value))
  from public.architecture_configurations ac join public.configuration_catalog c on c.key=ac.configuration_key
  where ac.architecture_version_id=r.architecture_version_id),'{}'::jsonb) || coalesce(r.configuration,'{}'::jsonb),
  configuration_keys=array(select ac.configuration_key from public.architecture_configurations ac
    where ac.architecture_version_id=r.architecture_version_id order by ac.configuration_key)
where r.architecture_version_id is not null;

alter table public.restaurants
  drop constraint if exists restaurants_architecture_id_architecture_version_fkey,
  drop constraint if exists restaurants_architecture_id_fkey,
  drop column if exists architecture_id,
  drop column if exists architecture_version,
  drop column if exists kind,
  drop column if exists city,
  alter column architecture_version_id set not null,
  add constraint restaurants_architecture_version_id_fkey foreign key (architecture_version_id) references public.architecture_versions(id);

alter table public.architectures
  drop constraint if exists architectures_id_version_key,
  drop column if exists version,
  drop column if exists role_templates,
  drop column if exists allowed_features;

create index architecture_versions_family_idx on public.architecture_versions(architecture_id,version desc);
create index architecture_needs_need_key_idx on public.architecture_needs(need_key);
create index architecture_configurations_key_idx on public.architecture_configurations(configuration_key);
create index restaurants_configuration_keys_gin on public.restaurants using gin(configuration_keys);

alter table public.architecture_versions enable row level security;
alter table public.architecture_needs enable row level security;
alter table public.configuration_catalog enable row level security;
alter table public.architecture_configurations enable row level security;
create policy "architecture versions readable to authenticated" on public.architecture_versions for select to authenticated using (true);
create policy "architecture needs readable to authenticated" on public.architecture_needs for select to authenticated using (true);
create policy "configuration catalog readable to authenticated" on public.configuration_catalog for select to authenticated using (true);
create policy "architecture configurations readable to authenticated" on public.architecture_configurations for select to authenticated using (true);
grant select on public.architecture_versions,public.architecture_needs,public.configuration_catalog,public.architecture_configurations to authenticated;
revoke insert,update,delete on public.architecture_versions,public.architecture_needs,public.configuration_catalog,public.architecture_configurations from anon,authenticated;

create or replace function public.create_restaurant_bundle(payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  rid uuid;
  role_item jsonb;
  initial_uid uuid;
  version_uid uuid := (payload->>'architecture_version_id')::uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'service_role_required'; end if;
  if not exists(select 1 from public.architecture_versions where id=version_uid) then raise exception 'unknown_architecture_version'; end if;
  insert into public.restaurants(name,status,architecture_version_id,needs,configuration,configuration_keys,logo_path)
  values(payload->>'name','active',version_uid,array(select jsonb_array_elements_text(coalesce(payload->'needs','[]'::jsonb))),
    coalesce(payload->'configuration','{}'::jsonb),array(select jsonb_object_keys(coalesce(payload->'configuration','{}'::jsonb))),nullif(payload->>'logo_path','')) returning id into rid;
  for role_item in select value from jsonb_array_elements(coalesce(payload->'roles','[]'::jsonb)) loop
    insert into public.roles(restaurant_id,key,name,permissions) values(rid,role_item->>'key',role_item->>'name',coalesce(role_item->'permissions','{}'::jsonb));
  end loop;
  initial_uid := (payload->>'initial_auth_user_id')::uuid;
  insert into public.accounts(auth_user_id,restaurant_id,role_id,username,display_name)
  select initial_uid,rid,ro.id,lower(payload->>'initial_username'),payload->>'initial_display_name'
  from public.roles ro where ro.restaurant_id=rid and ro.key='admin';
  if not found then raise exception 'architecture_missing_admin_role'; end if;
  return rid;
end; $$;
revoke all on function public.create_restaurant_bundle(jsonb) from public,anon,authenticated;
grant execute on function public.create_restaurant_bundle(jsonb) to service_role;

create or replace function public.setter_save_need(payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare k text := payload->>'key';
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'service_role_required'; end if;
  if k !~ '^[a-z][a-z0-9_-]{1,49}$' or coalesce(trim(payload->>'label'),'')='' then raise exception 'invalid_need'; end if;
  insert into public.needs(key,label,description,is_active,updated_at) values(k,trim(payload->>'label'),coalesce(payload->>'description',''),coalesce((payload->>'is_active')::boolean,true),now())
  on conflict(key) do update set label=excluded.label,description=excluded.description,is_active=excluded.is_active,updated_at=now();
end; $$;

create or replace function public.setter_delete_need(need_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'service_role_required'; end if;
  if exists(select 1 from public.architecture_needs where architecture_needs.need_key=setter_delete_need.need_key)
    or exists(select 1 from public.restaurants where setter_delete_need.need_key=any(restaurants.needs)) then raise exception 'need_is_in_use'; end if;
  delete from public.needs where key=setter_delete_need.need_key;
  if not found then raise exception 'need_not_found'; end if;
end; $$;

create or replace function public.setter_save_configuration(payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare k text := payload->>'key';
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'service_role_required'; end if;
  if k !~ '^[a-z][a-z0-9_.-]{1,99}$' or coalesce(trim(payload->>'label'),'')='' then raise exception 'invalid_configuration'; end if;
  if payload->>'value_type' not in ('boolean','text','number','select','json') then raise exception 'invalid_configuration_type'; end if;
  if jsonb_typeof(coalesce(payload->'options','[]'::jsonb))<>'array' then raise exception 'configuration_options_must_be_array'; end if;
  if jsonb_typeof(coalesce(payload->'default_value','null'::jsonb))<>'null' and (
    (payload->>'value_type'='boolean' and jsonb_typeof(payload->'default_value')<>'boolean')
    or (payload->>'value_type' in ('text','select') and jsonb_typeof(payload->'default_value')<>'string')
    or (payload->>'value_type'='number' and jsonb_typeof(payload->'default_value')<>'number')) then raise exception 'invalid_configuration_default'; end if;
  if payload->>'value_type'='select' and jsonb_typeof(coalesce(payload->'default_value','null'::jsonb))<>'null'
    and not exists(select 1 from jsonb_array_elements(coalesce(payload->'options','[]'::jsonb)) as option_item(value)
      where option_item.value=payload->'default_value' or option_item.value->'value'=payload->'default_value') then raise exception 'configuration_default_not_in_options'; end if;
  if exists(select 1 from public.configuration_catalog old where old.key=k and (old.value_type<>(payload->>'value_type') or old.options<>coalesce(payload->'options','[]'::jsonb))
    and (exists(select 1 from public.architecture_configurations ac where ac.configuration_key=k)
      or exists(select 1 from public.restaurants r where r.configuration_keys @> array[k]::text[]))) then raise exception 'configuration_schema_in_use'; end if;
  insert into public.configuration_catalog(key,label,area,value_type,options,default_value,description,is_active,updated_at)
  values(k,trim(payload->>'label'),coalesce(nullif(payload->>'area',''),'general'),payload->>'value_type',coalesce(payload->'options','[]'::jsonb),coalesce(payload->'default_value','null'::jsonb),coalesce(payload->>'description',''),coalesce((payload->>'is_active')::boolean,true),now())
  on conflict(key) do update set label=excluded.label,area=excluded.area,value_type=excluded.value_type,options=excluded.options,default_value=excluded.default_value,description=excluded.description,is_active=excluded.is_active,updated_at=now();
end; $$;

create or replace function public.setter_delete_configuration(configuration_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'service_role_required'; end if;
  if exists(select 1 from public.architecture_configurations where architecture_configurations.configuration_key=setter_delete_configuration.configuration_key)
    or exists(select 1 from public.restaurants where configuration_keys @> array[setter_delete_configuration.configuration_key]::text[])
    or exists(select 1 from public.restaurants where configuration ? setter_delete_configuration.configuration_key) then raise exception 'configuration_is_in_use'; end if;
  delete from public.configuration_catalog where key=setter_delete_configuration.configuration_key;
  if not found then raise exception 'configuration_not_found'; end if;
end; $$;

create or replace function public.setter_save_architecture_family(payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare family_id text := payload->>'id';
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'service_role_required'; end if;
  if family_id !~ '^[a-z][a-z0-9_-]{1,49}$' or coalesce(trim(payload->>'name'),'')='' then raise exception 'invalid_architecture'; end if;
  insert into public.architectures(id,name,description,is_active,updated_at) values(family_id,trim(payload->>'name'),coalesce(payload->>'description',''),coalesce((payload->>'is_active')::boolean,true),now())
  on conflict(id) do update set name=excluded.name,description=excluded.description,is_active=excluded.is_active,updated_at=now();
end; $$;

create or replace function public.setter_create_architecture_version(payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  family_id text := payload->>'architecture_id';
  new_version integer;
  version_uid uuid;
  need_keys text[] := array(select jsonb_array_elements_text(coalesce(payload->'needs','[]'::jsonb)));
  role_values jsonb := coalesce(payload->'roles','[]'::jsonb);
  config_values jsonb := coalesce(payload->'configurations','[]'::jsonb);
  item jsonb;
  config_type text;
  config_options jsonb;
  item_type text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'service_role_required'; end if;
  if not exists(select 1 from public.architectures where id=family_id) or coalesce(trim(payload->>'label'),'')='' or jsonb_typeof(role_values)<>'array' or jsonb_typeof(config_values)<>'array' then raise exception 'invalid_architecture_version'; end if;
  if not ('accounts'=any(need_keys)) then raise exception 'architecture_requires_accounts'; end if;
  if exists(select 1 from unnest(need_keys) selected(key) join public.needs n on n.key=selected.key where not n.is_active) then raise exception 'architecture_cannot_include_inactive_need'; end if;
  if not exists(select 1 from jsonb_array_elements(role_values) as role_item(value) where value->>'key'='admin' and coalesce(value->>'name','')<>'') then raise exception 'architecture_missing_admin_role'; end if;
  if exists(select 1 from jsonb_array_elements(role_values) as role_item(value) where coalesce(value->>'key','') !~ '^[a-z][a-z0-9_-]{1,49}$' or coalesce(trim(value->>'name'),'')='' or jsonb_typeof(coalesce(value->'permissions','{}'::jsonb))<>'object') then raise exception 'invalid_architecture_role'; end if;
  if (select count(*) from jsonb_array_elements(role_values))<>(select count(distinct value->>'key') from jsonb_array_elements(role_values) as role_item(value)) then raise exception 'duplicate_architecture_role_key'; end if;
  select coalesce(max(version),0)+1 into new_version from public.architecture_versions where architecture_id=family_id;
  insert into public.architecture_versions(architecture_id,version,label,description,role_templates)
  values(family_id,new_version,trim(payload->>'label'),coalesce(payload->>'description',''),role_values) returning id into version_uid;
  insert into public.architecture_needs(architecture_version_id,need_key) select version_uid,unnest(need_keys);
  for item in select value from jsonb_array_elements(config_values) loop
    select value_type,options into config_type,config_options from public.configuration_catalog where key=item->>'key' and is_active;
    if config_type is null then raise exception 'unknown_or_inactive_configuration'; end if;
    if item->'default_value' is not null and jsonb_typeof(item->'default_value')<>'null' then
      item_type:=jsonb_typeof(item->'default_value');
      if (config_type='boolean' and item_type<>'boolean') or (config_type='text' and item_type<>'string') or (config_type='number' and item_type<>'number')
        or (config_type='select' and not exists(select 1 from jsonb_array_elements(config_options) as option_item(value) where option_item.value=item->'default_value' or option_item.value->'value'=item->'default_value')) then raise exception 'invalid_architecture_configuration_default'; end if;
    end if;
    insert into public.architecture_configurations(architecture_version_id,configuration_key,default_value) values(version_uid,item->>'key',item->'default_value');
  end loop;
  return version_uid;
end; $$;

create or replace function public.setter_delete_architecture_family(architecture_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'service_role_required'; end if;
  if exists(select 1 from public.restaurants r join public.architecture_versions v on v.id=r.architecture_version_id where v.architecture_id=architecture_key) then raise exception 'architecture_is_in_use'; end if;
  delete from public.architectures where id=architecture_key;
  if not found then raise exception 'architecture_not_found'; end if;
end; $$;

create or replace function public.setter_change_restaurant_architecture(target_restaurant uuid,target_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_needs text[];
  current_config jsonb;
  new_needs text[];
  new_keys text[];
  new_roles jsonb;
  default_config jsonb;
  retained_config jsonb;
  role_item jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'service_role_required'; end if;
  select needs,configuration into current_needs,current_config from public.restaurants where id=target_restaurant for update;
  if not found then raise exception 'restaurant_not_found'; end if;
  select coalesce(array_agg(need_key),'{}') into new_needs from public.architecture_needs where architecture_version_id=target_version;
  if not ('accounts'=any(new_needs)) or not (current_needs <@ new_needs) then raise exception 'new_architecture_version_does_not_support_restaurant_needs'; end if;
  select role_templates into new_roles from public.architecture_versions where id=target_version;
  if new_roles is null then raise exception 'architecture_version_not_found'; end if;
  if exists(select 1 from public.accounts ac join public.roles r on r.id=ac.role_id where ac.restaurant_id=target_restaurant and not exists(select 1 from jsonb_array_elements(new_roles) as role_item(value) where value->>'key'=r.key)) then raise exception 'accounts_use_roles_missing_from_new_version'; end if;
  select coalesce(array_agg(configuration_key),'{}') into new_keys from public.architecture_configurations where architecture_version_id=target_version;
  select coalesce(jsonb_object_agg(ac.configuration_key,coalesce(ac.default_value,c.default_value)),'{}'::jsonb) into default_config
    from public.architecture_configurations ac join public.configuration_catalog c on c.key=ac.configuration_key where ac.architecture_version_id=target_version;
  select coalesce(jsonb_object_agg(entry.key,entry.value),'{}'::jsonb) into retained_config from jsonb_each(coalesce(current_config,'{}'::jsonb)) entry where entry.key=any(new_keys);
  for role_item in select value from jsonb_array_elements(new_roles) loop
    insert into public.roles(restaurant_id,key,name,permissions) values(target_restaurant,role_item->>'key',role_item->>'name',coalesce(role_item->'permissions','{}'::jsonb))
    on conflict(restaurant_id,key) do update set name=excluded.name,permissions=excluded.permissions;
  end loop;
  delete from public.roles r where r.restaurant_id=target_restaurant and not exists(select 1 from jsonb_array_elements(new_roles) as role_item(value) where value->>'key'=r.key);
  update public.restaurants set architecture_version_id=target_version,configuration_keys=new_keys,configuration=default_config||retained_config,updated_at=now() where id=target_restaurant;
end; $$;

create or replace function public.setter_update_restaurant_configuration(target_restaurant uuid,config_values jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item record; expected_type text; allowed_options jsonb; actual_type text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'service_role_required'; end if;
  if jsonb_typeof(config_values)<>'object' then raise exception 'invalid_configuration'; end if;
  if not exists(select 1 from public.restaurants where id=target_restaurant) then raise exception 'restaurant_not_found'; end if;
  for item in select key,value from jsonb_each(config_values) loop
    select c.value_type,c.options into expected_type,allowed_options from public.configuration_catalog c join public.restaurants r on r.id=target_restaurant and c.key=any(r.configuration_keys) where c.key=item.key;
    if expected_type is null then raise exception 'configuration_not_available_for_restaurant: %',item.key; end if;
    actual_type:=jsonb_typeof(item.value);
    if expected_type='text' and actual_type<>'string' or expected_type='number' and actual_type<>'number' or expected_type='boolean' and actual_type<>'boolean'
      or expected_type='select' and not exists(select 1 from jsonb_array_elements(allowed_options) option_item(value) where option_item.value=item.value or option_item.value->'value'=item.value) then raise exception 'configuration_value_has_wrong_type_or_option: %',item.key; end if;
  end loop;
  update public.restaurants set configuration=config_values,updated_at=now() where id=target_restaurant;
end; $$;

revoke all on function public.setter_save_need(jsonb),public.setter_delete_need(text),public.setter_save_configuration(jsonb),public.setter_delete_configuration(text),public.setter_save_architecture_family(jsonb),public.setter_create_architecture_version(jsonb),public.setter_delete_architecture_family(text),public.setter_change_restaurant_architecture(uuid,uuid),public.setter_update_restaurant_configuration(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.setter_save_need(jsonb),public.setter_delete_need(text),public.setter_save_configuration(jsonb),public.setter_delete_configuration(text),public.setter_save_architecture_family(jsonb),public.setter_create_architecture_version(jsonb),public.setter_delete_architecture_family(text),public.setter_change_restaurant_architecture(uuid,uuid),public.setter_update_restaurant_configuration(uuid,jsonb) to service_role;
