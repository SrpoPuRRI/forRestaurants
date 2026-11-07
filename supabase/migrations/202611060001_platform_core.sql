-- Shared tenant, account, architecture, location and schedule foundation.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.architectures (
  id text primary key,
  name text not null,
  version integer not null default 1,
  description text not null default '',
  role_templates jsonb not null default '[]'::jsonb,
  allowed_features text[] not null default '{}',
  unique (id, version)
);

create table if not exists public.needs (
  key text primary key,
  label text not null,
  description text not null default ''
);

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'Restaurante',
  city text not null default '',
  status text not null default 'active' check (status in ('active','deactivated')),
  architecture_id text not null references public.architectures(id),
  architecture_version integer not null,
  needs text[] not null default '{}',
  configuration jsonb not null default '{}'::jsonb,
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (architecture_id, architecture_version) references public.architectures(id, version)
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  key text not null,
  name text not null,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (restaurant_id, key),
  unique (id, restaurant_id)
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, restaurant_id)
);

create table if not exists public.location_hours (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time,
  closes_at time,
  closed boolean not null default false,
  check (closed or (opens_at is not null and closes_at is not null)),
  unique (location_id, weekday)
);

create table if not exists public.accounts (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  role_id uuid not null,
  username text not null,
  display_name text not null,
  location_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (username),
  foreign key (role_id, restaurant_id) references public.roles(id, restaurant_id),
  foreign key (location_id, restaurant_id) references public.locations(id, restaurant_id)
);

create table if not exists public.account_schedules (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references public.accounts(auth_user_id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  check (starts_at < ends_at)
);

-- Platform operators are authenticated through Supabase Auth but have no Setter profile/UI.
create table if not exists public.platform_operators (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_platform_operator()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_operators where auth_user_id = (select auth.uid()));
$$;

create or replace function public.current_account_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select a.auth_user_id from public.accounts a
  join public.restaurants r on r.id = a.restaurant_id
  where a.auth_user_id = (select auth.uid()) and a.is_active and r.status = 'active';
$$;

create or replace function public.current_restaurant_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select a.restaurant_id from public.accounts a
  join public.restaurants r on r.id = a.restaurant_id
  where a.auth_user_id = (select auth.uid()) and a.is_active and r.status = 'active';
$$;

create or replace function public.current_role_key()
returns text language sql stable security definer set search_path = '' as $$
  select ro.key from public.accounts a join public.roles ro on ro.id = a.role_id
  where a.auth_user_id = (select auth.uid()) and a.is_active;
$$;

create or replace function public.create_restaurant_bundle(payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  rid uuid;
  role_item jsonb;
  new_role uuid;
  initial_uid uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'service_role_required'; end if;
  insert into public.restaurants(name,kind,city,architecture_id,architecture_version,needs,configuration,logo_path)
  values (payload->>'name', coalesce(payload->>'kind','Restaurante'), coalesce(payload->>'city',''),
    payload->>'architecture_id', (payload->>'architecture_version')::integer,
    array(select jsonb_array_elements_text(coalesce(payload->'needs','[]'::jsonb))),
    coalesce(payload->'configuration','{}'::jsonb), nullif(payload->>'logo_path','')) returning id into rid;
  for role_item in select value from jsonb_array_elements(coalesce(payload->'roles','[]'::jsonb)) loop
    insert into public.roles(restaurant_id,key,name,permissions)
    values (rid, role_item->>'key', role_item->>'name', coalesce(role_item->'permissions','{}'::jsonb));
  end loop;
  initial_uid := (payload->>'initial_auth_user_id')::uuid;
  insert into public.accounts(auth_user_id,restaurant_id,role_id,username,display_name)
  select initial_uid, rid, ro.id, lower(payload->>'initial_username'), payload->>'initial_display_name'
  from public.roles ro where ro.restaurant_id=rid and ro.key='admin';
  if not found then raise exception 'architecture_missing_admin_role'; end if;
  return rid;
end; $$;

alter table public.architectures enable row level security;
alter table public.needs enable row level security;
alter table public.restaurants enable row level security;
alter table public.roles enable row level security;
alter table public.locations enable row level security;
alter table public.location_hours enable row level security;
alter table public.accounts enable row level security;
alter table public.account_schedules enable row level security;
alter table public.platform_operators enable row level security;

create policy "catalogs readable to authenticated" on public.architectures for select to authenticated using (true);
create policy "needs readable to authenticated" on public.needs for select to authenticated using (true);
create policy "restaurant scope read" on public.restaurants for select to authenticated
  using (id = (select public.current_restaurant_id()) or (select public.is_platform_operator()));
create policy "restaurant admin update" on public.restaurants for update to authenticated
  using (id = (select public.current_restaurant_id()) and (select public.current_role_key())='admin')
  with check (id = (select public.current_restaurant_id()) and status='active');
create policy "roles scope read" on public.roles for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) or (select public.is_platform_operator()));
create policy "locations scope read" on public.locations for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) or (select public.is_platform_operator()));
create policy "locations admin manage" on public.locations for all to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key())='admin')
  with check (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key())='admin');
create policy "location hours scoped" on public.location_hours for all to authenticated
  using ((select public.current_role_key())='admin' and exists(select 1 from public.locations l where l.id=location_id and l.restaurant_id=(select public.current_restaurant_id())))
  with check ((select public.current_role_key())='admin' and exists(select 1 from public.locations l where l.id=location_id and l.restaurant_id=(select public.current_restaurant_id())));
create policy "account self or admin read" on public.accounts for select to authenticated
  using (auth_user_id=(select auth.uid()) or (restaurant_id=(select public.current_restaurant_id()) and (select public.current_role_key())='admin') or (select public.is_platform_operator()));
create policy "account schedule self or admin" on public.account_schedules for select to authenticated
  using (auth_user_id=(select auth.uid()) or exists(select 1 from public.accounts a where a.auth_user_id=account_schedules.auth_user_id and a.restaurant_id=(select public.current_restaurant_id()) and (select public.current_role_key())='admin'));
create policy "platform operator self lookup" on public.platform_operators for select to authenticated using (auth_user_id=(select auth.uid()));

grant select on public.architectures, public.needs, public.restaurants, public.roles, public.locations, public.location_hours, public.accounts, public.account_schedules to authenticated;
grant select on public.platform_operators to authenticated;
grant update on public.restaurants to authenticated;
grant all on public.locations, public.location_hours, public.account_schedules to authenticated;
revoke all on function public.create_restaurant_bundle(jsonb) from public, anon, authenticated;
grant execute on function public.create_restaurant_bundle(jsonb) to service_role;

insert into public.needs(key,label) values
 ('accounts','Cuentas'),('crm','CRM'),('orders','Flujo de pedidos'),('dining','Salón'),('kitchen','Cocina'),('statistics','Estadísticas'),('catalog','Catálogo'),('settings','Configuración')
on conflict(key) do nothing;
insert into public.architectures(id,name,version,description,role_templates,allowed_features) values
 ('caja_sencilla','Caja sencilla',1,'Operación compacta para atención directa.', '[{"key":"admin","name":"Administrador","permissions":{"all":true}},{"key":"employee","name":"Empleado","permissions":{"orders":true}}]'::jsonb, array['accounts','crm','orders','dining','kitchen','statistics','catalog','settings']),
 ('caja_cocina','Caja + cocina',1,'Separación de cobro y preparación.', '[{"key":"admin","name":"Administrador","permissions":{"all":true}},{"key":"cashier","name":"Cajero","permissions":{"orders":true,"payments":true}},{"key":"cook","name":"Cocinero","permissions":{"kitchen":true}}]'::jsonb, array['accounts','crm','orders','dining','kitchen','statistics','catalog','settings']),
 ('servicio_completo','Servicio completo',1,'Caja, servicio de mesas y preparación.', '[{"key":"admin","name":"Administrador","permissions":{"all":true}},{"key":"cashier","name":"Cajero","permissions":{"orders":true,"payments":true}},{"key":"waiter","name":"Mesero","permissions":{"orders":true,"dining":true}},{"key":"cook","name":"Cocinero","permissions":{"kitchen":true}}]'::jsonb, array['accounts','crm','orders','dining','kitchen','statistics','catalog','settings'])
on conflict(id) do nothing;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('restaurant-assets','restaurant-assets',false,5242880,array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict(id) do nothing;
create policy "restaurant logo read scope" on storage.objects for select to authenticated
using (bucket_id='restaurant-assets' and (storage.foldername(name))[1]=(select public.current_restaurant_id())::text);
create policy "restaurant logo write admin" on storage.objects for insert to authenticated
with check (bucket_id='restaurant-assets' and (storage.foldername(name))[1]=(select public.current_restaurant_id())::text and (select public.current_role_key())='admin');
create policy "restaurant logo update admin" on storage.objects for update to authenticated
using (bucket_id='restaurant-assets' and (storage.foldername(name))[1]=(select public.current_restaurant_id())::text and (select public.current_role_key())='admin')
with check (bucket_id='restaurant-assets' and (storage.foldername(name))[1]=(select public.current_restaurant_id())::text and (select public.current_role_key())='admin');

