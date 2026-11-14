-- Rename the optional need and establish the generic printing configuration/queue.
-- Keep historical migrations immutable; this migration upgrades persisted restaurants.

alter table public.restaurants drop constraint if exists restaurants_needs_optional_only;
update public.restaurants
set needs = array(
  select distinct case value when 'receipts' then 'printing_systems' else value end
  from unnest(coalesce(needs, '{}'::text[])) as need(value)
  order by 1
)
where 'receipts' = any(coalesce(needs, '{}'::text[]));

alter table public.restaurants add constraint restaurants_needs_optional_only
  check (needs <@ array['crm','kitchen','salon','delivery','printing_systems']::text[]);

create table if not exists public.printing_ticket_templates (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null default public.current_restaurant_id()
    references public.restaurants(id) on delete cascade,
  name text not null,
  format jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  check (length(trim(name)) between 1 and 80),
  check (jsonb_typeof(format) = 'object')
);

-- Preserve the previous single template as the first entry in the new collection.
insert into public.printing_ticket_templates (restaurant_id, name, format)
select legacy.restaurant_id, 'Formato predeterminado', legacy.format
from public.restaurant_receipt_templates legacy
where not exists (
  select 1 from public.printing_ticket_templates current_template
  where current_template.restaurant_id = legacy.restaurant_id
);

create table if not exists public.printing_points (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null default public.current_restaurant_id()
    references public.restaurants(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  sunat_enabled boolean not null default false,
  output_mode text not null default 'manual'
    check (output_mode in ('manual','automatic')),
  transport text not null default 'browser'
    check (transport in ('browser','local_agent','network_escpos','cloud_webhook')),
  connection_config jsonb not null default '{}'::jsonb,
  sunat_config jsonb not null default '{}'::jsonb,
  secret_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  check (length(trim(name)) between 1 and 80),
  check (jsonb_typeof(connection_config) = 'object'),
  check (jsonb_typeof(sunat_config) = 'object')
);

create table if not exists public.printing_flows (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null default public.current_restaurant_id()
    references public.restaurants(id) on delete cascade,
  name text not null,
  captured_events text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  check (length(trim(name)) between 1 and 80),
  check (captured_events <@ array[
    'open_order_created','open_order_updated','paid_order_created',
    'payment_corrected','kitchen_order_ready','salon_order_delivered',
    'manual_reprint'
  ]::text[])
);

create table if not exists public.printing_flow_routes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null default public.current_restaurant_id()
    references public.restaurants(id) on delete cascade,
  flow_id uuid not null,
  point_id uuid not null,
  template_id uuid,
  event_keys text[] not null default '{}',
  output_mode text not null default 'manual' check (output_mode in ('manual','automatic')),
  copies smallint not null default 1 check (copies between 1 and 20),
  cadence_ms integer not null default 0 check (cadence_ms between 0 and 60000),
  text_depth text not null default 'standard' check (text_depth in ('compact','standard','detailed')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (flow_id, restaurant_id) references public.printing_flows(id, restaurant_id) on delete cascade,
  foreign key (point_id, restaurant_id) references public.printing_points(id, restaurant_id) on delete cascade,
  foreign key (template_id, restaurant_id) references public.printing_ticket_templates(id, restaurant_id) on delete restrict,
  check (event_keys <@ array[
    'open_order_created','open_order_updated','paid_order_created',
    'payment_corrected','kitchen_order_ready','salon_order_delivered',
    'manual_reprint'
  ]::text[])
);

create table if not exists public.printing_jobs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  flow_id uuid not null,
  route_id uuid not null,
  point_id uuid not null,
  template_id uuid,
  event_key text not null,
  event_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  route_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','claimed','printed','failed','cancelled')),
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  printed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (event_id, route_id),
  foreign key (flow_id, restaurant_id) references public.printing_flows(id, restaurant_id) on delete cascade,
  foreign key (route_id) references public.printing_flow_routes(id) on delete cascade,
  foreign key (point_id, restaurant_id) references public.printing_points(id, restaurant_id) on delete cascade,
  foreign key (template_id, restaurant_id) references public.printing_ticket_templates(id, restaurant_id) on delete restrict,
  check (jsonb_typeof(payload) = 'object'),
  check (jsonb_typeof(route_snapshot) = 'object')
);
create index if not exists printing_jobs_queue_idx
  on public.printing_jobs (restaurant_id, status, available_at, created_at);

alter table public.printing_ticket_templates enable row level security;
alter table public.printing_points enable row level security;
alter table public.printing_flows enable row level security;
alter table public.printing_flow_routes enable row level security;
alter table public.printing_jobs enable row level security;

drop policy if exists printing_templates_read on public.printing_ticket_templates;
drop policy if exists printing_templates_admin_write on public.printing_ticket_templates;
create policy printing_templates_read on public.printing_ticket_templates for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id())
    and exists (select 1 from public.restaurants r where r.id = printing_ticket_templates.restaurant_id
      and 'printing_systems' = any(r.needs)));
create policy printing_templates_admin_write on public.printing_ticket_templates for all to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = 'admin'
    and exists (select 1 from public.restaurants r where r.id = printing_ticket_templates.restaurant_id
      and 'printing_systems' = any(r.needs)))
  with check (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = 'admin'
    and exists (select 1 from public.restaurants r where r.id = printing_ticket_templates.restaurant_id
      and 'printing_systems' = any(r.needs)));
drop policy if exists printing_points_read on public.printing_points;
drop policy if exists printing_points_admin_write on public.printing_points;
create policy printing_points_read on public.printing_points for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id())
    and exists (select 1 from public.restaurants r where r.id = printing_points.restaurant_id
      and 'printing_systems' = any(r.needs)));
create policy printing_points_admin_write on public.printing_points for all to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = 'admin'
    and exists (select 1 from public.restaurants r where r.id = printing_points.restaurant_id
      and 'printing_systems' = any(r.needs)))
  with check (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = 'admin'
    and exists (select 1 from public.restaurants r where r.id = printing_points.restaurant_id
      and 'printing_systems' = any(r.needs)));
drop policy if exists printing_flows_read on public.printing_flows;
drop policy if exists printing_flows_admin_write on public.printing_flows;
create policy printing_flows_read on public.printing_flows for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id()));
create policy printing_flows_admin_write on public.printing_flows for all to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = 'admin')
  with check (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = 'admin');
drop policy if exists printing_routes_read on public.printing_flow_routes;
drop policy if exists printing_routes_admin_write on public.printing_flow_routes;
create policy printing_routes_read on public.printing_flow_routes for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id()));
create policy printing_routes_admin_write on public.printing_flow_routes for all to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = 'admin')
  with check (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = 'admin');
drop policy if exists printing_jobs_read on public.printing_jobs;
create policy printing_jobs_read on public.printing_jobs for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id())
    and (select public.current_has_permission('orders') or public.current_has_permission('payments')));

grant select, insert, update, delete on public.printing_ticket_templates,
  public.printing_points, public.printing_flows, public.printing_flow_routes to authenticated;
grant select on public.printing_jobs to authenticated;

create or replace function public.enqueue_print_event(
  p_event_key text,
  p_payload jsonb default '{}'::jsonb,
  p_event_id uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_count integer := 0;
  v_event_keys text[] := array[
    'open_order_created','open_order_updated','paid_order_created',
    'payment_corrected','kitchen_order_ready','salon_order_delivered',
    'manual_reprint'
  ];
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if not (p_event_key = any(v_event_keys)) then raise exception 'unsupported_print_event'; end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 65536 then
    raise exception 'invalid_print_payload';
  end if;
  if not exists (
    select 1 from public.restaurants restaurant
    where restaurant.id = v_restaurant_id
      and 'printing_systems' = any(restaurant.needs)
  ) then raise exception 'printing_systems_not_enabled'; end if;
  if not (
    public.current_has_permission('orders')
    or public.current_has_permission('payments')
    or public.current_has_permission('kitchen')
    or public.current_has_permission('salon')
  ) then raise exception 'printing_permission_denied'; end if;

  with matches as (
    select flow.id as flow_id, route.id as route_id, route.point_id,
      route.template_id, route.output_mode, route.copies, route.cadence_ms,
      route.text_depth, point.sunat_enabled, point.transport,
      template.name as template_name, template.format as template_format
    from public.printing_flows flow
    join public.printing_flow_routes route
      on route.flow_id = flow.id and route.restaurant_id = flow.restaurant_id
    join public.printing_points point
      on point.id = route.point_id and point.restaurant_id = route.restaurant_id and point.is_active
    left join public.printing_ticket_templates template
      on template.id = route.template_id and template.restaurant_id = route.restaurant_id
    where flow.restaurant_id = v_restaurant_id and flow.is_active
      and p_event_key = any(flow.captured_events)
      and p_event_key = any(route.event_keys)
  ), inserted as (
    insert into public.printing_jobs (
      restaurant_id, flow_id, route_id, point_id, template_id,
      event_key, event_id, payload, route_snapshot
    )
    select v_restaurant_id, matches.flow_id, matches.route_id, matches.point_id,
      matches.template_id, p_event_key, p_event_id, coalesce(p_payload, '{}'::jsonb),
      jsonb_build_object(
        'output_mode', case when matches.sunat_enabled then 'sunat' else matches.output_mode end,
        'transport', matches.transport, 'copies', matches.copies,
        'cadence_ms', matches.cadence_ms, 'text_depth', matches.text_depth,
        'template_name', matches.template_name, 'template', matches.template_format
      )
    from matches
    on conflict (event_id, route_id) do nothing
    returning id
  ) select count(*) into v_count from inserted;

  return jsonb_build_object('event_id', p_event_id, 'queued', v_count,
    'status', case when v_count > 0 then 'queued' else 'no_matching_flow' end);
end;
$$;
revoke all on function public.enqueue_print_event(text, jsonb, uuid) from public, anon;
grant execute on function public.enqueue_print_event(text, jsonb, uuid) to authenticated;

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

-- Employee keeps the conceptual cashier permissions when printing is the only need.
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
          and (
            exists (
              select 1 from public.roles enabled
              where enabled.id = any(restaurant.available_role_ids)
                and enabled.key not in ('admin', 'employee')
                and coalesce((enabled.permissions ->> p_permission_key)::boolean, false)
            )
            or (
              p_permission_key in ('orders', 'payments')
              and not exists (
                select 1 from unnest(coalesce(restaurant.needs, '{}'::text[])) as need(key)
                where need.key <> 'printing_systems'
              )
            )
          )
        )
        or (
          assigned.key not in ('admin', 'employee')
          and coalesce((assigned.permissions ->> p_permission_key)::boolean, false)
        )
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

-- The old single-template table remains during rollout; its read policy follows the renamed need.
drop policy if exists restaurant_receipt_templates_tenant_read on public.restaurant_receipt_templates;
drop policy if exists restaurant_receipt_templates_admin_manage on public.restaurant_receipt_templates;
create policy restaurant_receipt_templates_tenant_read on public.restaurant_receipt_templates for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id())
    and exists (select 1 from public.restaurants r where r.id = restaurant_receipt_templates.restaurant_id
      and 'printing_systems' = any(r.needs)));
create policy restaurant_receipt_templates_admin_manage on public.restaurant_receipt_templates for all to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = 'admin'
    and exists (select 1 from public.restaurants r where r.id = restaurant_receipt_templates.restaurant_id
      and 'printing_systems' = any(r.needs)))
  with check (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = 'admin'
    and exists (select 1 from public.restaurants r where r.id = restaurant_receipt_templates.restaurant_id
      and 'printing_systems' = any(r.needs)));
