-- Persist ordered execution accounts and per-task payload selection for the
-- visual flow editor. Existing route/job rows remain compatible.
alter table public.printing_flows
  add column if not exists engine_account_order uuid[] not null default '{}'::uuid[];

alter table public.printing_flow_routes
  add column if not exists data_object_key text not null default 'event';

alter table public.printing_jobs
  add column if not exists task_order integer not null default 0;

update public.printing_jobs job
set task_order = route.sort_order
from public.printing_flow_routes route
where route.id = job.route_id and route.restaurant_id = job.restaurant_id;

create index if not exists printing_jobs_device_task_order_idx
  on public.printing_jobs(device_id, status, created_at, task_order, id);

alter table public.printing_flow_routes
  drop constraint if exists printing_flow_routes_data_object_key_check;
alter table public.printing_flow_routes
  add constraint printing_flow_routes_data_object_key_check
  check (data_object_key in ('event','order','items','payment'));

update public.printing_flows flow
set engine_account_order = coalesce((
  select array_agg(account.auth_user_id order by account.display_name, account.auth_user_id)
  from public.accounts account
  where account.restaurant_id = flow.restaurant_id and account.is_active
), '{}'::uuid[])
where cardinality(flow.engine_account_order) = 0;

create or replace function public.save_printing_flow_editor(
  p_flow_id uuid,
  p_name text,
  p_captured_events text[],
  p_is_active boolean,
  p_routes jsonb,
  p_engine_account_order uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_flow_id uuid;
  v_event text;
  v_point_count integer;
  v_account_count integer;
  v_route jsonb;
  v_object_key text;
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if public.current_role_key() is distinct from 'admin' then raise exception 'admin_required'; end if;
  if jsonb_typeof(coalesce(p_routes, '[]'::jsonb)) <> 'array' then raise exception 'invalid_flow_routes'; end if;
  if coalesce(cardinality(p_engine_account_order), 0) <> (
    select count(distinct selected.account_id)
    from unnest(coalesce(p_engine_account_order, '{}'::uuid[])) as selected(account_id)
  ) then raise exception 'duplicate_flow_engine_account'; end if;
  if exists (
    select 1 from unnest(coalesce(p_engine_account_order, '{}'::uuid[])) as selected(account_id)
    where selected.account_id is null or not exists (
      select 1 from public.accounts account
      where account.auth_user_id = selected.account_id
        and account.restaurant_id = v_restaurant_id and account.is_active
    )
  ) then raise exception 'printing_flow_account_unavailable'; end if;

  foreach v_event in array coalesce(p_captured_events, '{}'::text[]) loop
    select count(distinct route.value->>'point_id')
    into v_point_count
    from jsonb_array_elements(coalesce(p_routes, '[]'::jsonb)) as route(value)
    where exists (
      select 1 from jsonb_array_elements_text(coalesce(route.value->'event_keys', '[]'::jsonb)) as event_key(key)
      where event_key.key = v_event
    );
    if coalesce(v_point_count, 0) = 0 then raise exception 'printing_event_without_task'; end if;
    if v_point_count > 1 then raise exception 'printing_event_multiple_points'; end if;
  end loop;

  v_flow_id := public.save_printing_flow(
    p_flow_id, p_name, p_captured_events, p_is_active, p_routes
  );

  for v_route in select value from jsonb_array_elements(coalesce(p_routes, '[]'::jsonb)) as item(value)
  loop
    v_object_key := coalesce(nullif(v_route->>'data_object_key', ''), 'event');
    if v_object_key not in ('event','order','items','payment') then
      raise exception 'invalid_print_data_object';
    end if;
    update public.printing_flow_routes as route
    set data_object_key = v_object_key
    where route.restaurant_id = v_restaurant_id and route.flow_id = v_flow_id
      and route.sort_order = coalesce((v_route->>'sort_order')::integer, 0)
      and route.point_id = nullif(v_route->>'point_id', '')::uuid
      and route.event_keys = array(select jsonb_array_elements_text(coalesce(v_route->'event_keys', '[]'::jsonb)));
  end loop;

  update public.printing_flows flow
  set engine_account_order = coalesce(p_engine_account_order, '{}'::uuid[]), updated_at = clock_timestamp()
  where flow.id = v_flow_id and flow.restaurant_id = v_restaurant_id;
  return v_flow_id;
end;
$$;
revoke all on function public.save_printing_flow_editor(uuid, text, text[], boolean, jsonb, uuid[]) from public, anon;
grant execute on function public.save_printing_flow_editor(uuid, text, text[], boolean, jsonb, uuid[]) to authenticated;

create or replace function public.delete_printing_flow(p_flow_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if public.current_role_key() is distinct from 'admin' then raise exception 'admin_required'; end if;
  perform 1 from public.printing_flows flow
  where flow.id = p_flow_id and flow.restaurant_id = v_restaurant_id
  for update;
  if not found then raise exception 'flow_not_found'; end if;
  if exists (
    select 1 from public.printing_jobs job
    where job.flow_id = p_flow_id and job.restaurant_id = v_restaurant_id
      and job.status in ('published','taken')
  ) or exists (
    select 1 from public.printing_flow_runs run
    where run.flow_id = p_flow_id and run.restaurant_id = v_restaurant_id
      and run.completed_at is not null and run.acknowledged_at is null
  ) then raise exception 'printing_flow_has_pending_jobs'; end if;
  delete from public.printing_flows flow
  where flow.id = p_flow_id and flow.restaurant_id = v_restaurant_id;
end;
$$;
revoke all on function public.delete_printing_flow(uuid) from public, anon;
grant execute on function public.delete_printing_flow(uuid) to authenticated;

create or replace function public.printing_jobs_apply_data_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object_key text;
  v_task_order integer;
  v_order jsonb;
begin
  select route.data_object_key, route.sort_order into v_object_key, v_task_order
  from public.printing_flow_routes route
  where route.id = new.route_id and route.restaurant_id = new.restaurant_id;
  v_object_key := coalesce(v_object_key, 'event');
  new.task_order := coalesce(v_task_order, 0);
  new.route_snapshot := coalesce(new.route_snapshot, '{}'::jsonb)
    || jsonb_build_object('data_object_key', v_object_key);
  v_order := coalesce(new.payload->'order', '{}'::jsonb);
  if v_object_key = 'items' and new.payload ? 'order' then
    new.payload := jsonb_strip_nulls(jsonb_build_object(
      'schema_version', new.payload->'schema_version',
      'event_key', new.event_key,
      'occurred_at', new.payload->'occurred_at',
      'order', jsonb_build_object(
        'id', v_order->'id', 'table_label', v_order->'table_label',
        'location', v_order->'location', 'operator', v_order->'operator',
        'status', v_order->'status', 'note', v_order->'note'
      ),
      'items', new.payload->'items'
    ));
  elsif v_object_key = 'payment' and new.payload ? 'order' then
    new.payload := jsonb_strip_nulls(jsonb_build_object(
      'schema_version', new.payload->'schema_version',
      'event_key', new.event_key,
      'occurred_at', new.payload->'occurred_at',
      'order', jsonb_build_object(
        'id', v_order->'id', 'paid_at', v_order->'paid_at',
        'operator', v_order->'operator', 'total', v_order->'total',
        'payment_amounts', v_order->'payment_amounts',
        'payment_method_keys', v_order->'payment_method_keys'
      )
    ));
  elsif v_object_key = 'order' and new.payload ? 'order' then
    new.payload := jsonb_strip_nulls(jsonb_build_object(
      'schema_version', new.payload->'schema_version',
      'event_key', new.event_key,
      'occurred_at', new.payload->'occurred_at',
      'order', new.payload->'order', 'items', new.payload->'items'
    ));
  end if;
  return new;
end;
$$;
drop trigger if exists printing_jobs_apply_data_object on public.printing_jobs;
create trigger printing_jobs_apply_data_object
before insert on public.printing_jobs
for each row execute function public.printing_jobs_apply_data_object();
