-- Keep a printing point's last device UUID after its registry row is removed.
-- The UUID is intentional history used by the POS to show the point as
-- Deprecated. Creation and replacement RPCs still validate restaurant ownership.
alter table public.printing_points
  drop constraint if exists printing_points_device_restaurant_fkey;
alter table public.printing_points
  drop constraint if exists printing_points_device_id_fkey;

create or replace function public.replace_printing_point_device(
  p_point_id uuid,
  p_device_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_point_restaurant_id uuid;
  v_device_restaurant_id uuid;
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if public.current_role_key() is distinct from 'admin' then raise exception 'admin_required'; end if;
  if p_point_id is null or p_device_id is null then raise exception 'printing_device_required'; end if;

  select point.restaurant_id into v_point_restaurant_id
  from public.printing_points as point
  where point.id = p_point_id
  for update;
  if not found or v_point_restaurant_id is distinct from v_restaurant_id then
    raise exception 'printing_point_not_found';
  end if;

  select device.restaurant_id into v_device_restaurant_id
  from public.printing_devices as device
  where device.id = p_device_id
  for update;
  if not found or v_device_restaurant_id is distinct from v_restaurant_id then
    raise exception 'printing_device_not_in_restaurant';
  end if;

  if exists (
    select 1 from public.printing_points as other_point
    where other_point.device_id = p_device_id and other_point.id <> p_point_id
  ) then
    raise exception 'printing_device_already_linked';
  end if;

  update public.printing_points as point
  set device_id = p_device_id, updated_at = clock_timestamp()
  where point.id = p_point_id and point.restaurant_id = v_restaurant_id;
end;
$$;
revoke all on function public.replace_printing_point_device(uuid, uuid) from public, anon;
grant execute on function public.replace_printing_point_device(uuid, uuid) to authenticated;

create or replace function public.set_printing_flow_active(
  p_flow_id uuid,
  p_is_active boolean
)
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
  if p_is_active then
    if exists (
      select 1
      from public.printing_flow_routes as route
      join public.printing_points as point
        on point.id = route.point_id and point.restaurant_id = route.restaurant_id
      left join public.printing_devices as device
        on device.id = point.device_id and device.restaurant_id = point.restaurant_id
      where route.flow_id = p_flow_id
        and route.restaurant_id = v_restaurant_id
        and cardinality(route.event_keys) > 0
        and (point.device_id is null or device.id is null)
    ) then raise exception 'printing_flow_needs_update'; end if;
  end if;

  update public.printing_flows as flow
  set is_active = coalesce(p_is_active, false), updated_at = clock_timestamp()
  where flow.id = p_flow_id and flow.restaurant_id = v_restaurant_id;
  if not found then raise exception 'flow_not_found'; end if;
end;
$$;
revoke all on function public.set_printing_flow_active(uuid, boolean) from public, anon;
grant execute on function public.set_printing_flow_active(uuid, boolean) to authenticated;

-- Override the existing save RPC so an active flow cannot be saved with a
-- route that still points to an absent device. The check is after route edits,
-- so an administrator can replace the route and reactivate it in one save.
create or replace function public.save_printing_flow(
  p_flow_id uuid,
  p_name text,
  p_captured_events text[],
  p_is_active boolean,
  p_routes jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_flow_id uuid;
  v_route jsonb;
  v_route_id uuid;
  v_point_id uuid;
  v_template_id uuid;
  v_event_keys text[];
  v_supported_modes text[];
  v_output_mode text;
  v_copies smallint;
  v_cadence_ms integer;
  v_text_depth text;
  v_sort_order integer;
  v_is_sunat boolean;
  v_kept_route_ids uuid[] := '{}'::uuid[];
  v_allowed_events text[] := array[
    'open_order_created','open_order_updated','paid_order_created',
    'payment_corrected','kitchen_order_ready','salon_order_delivered','manual_reprint'
  ];
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if public.current_role_key() is distinct from 'admin' then raise exception 'admin_required'; end if;
  if coalesce(length(trim(p_name)), 0) not between 1 and 80 then raise exception 'invalid_flow_name'; end if;
  if coalesce(cardinality(p_captured_events), 0) = 0
    or exists(select 1 from unnest(p_captured_events) as selected(event_key)
      where selected.event_key <> all(v_allowed_events)) then
    raise exception 'invalid_flow_events';
  end if;
  if jsonb_typeof(coalesce(p_routes, '[]'::jsonb)) <> 'array' then raise exception 'invalid_flow_routes'; end if;

  if p_flow_id is null then
    insert into public.printing_flows(restaurant_id, name, captured_events, is_active)
    values(v_restaurant_id, trim(p_name), p_captured_events, coalesce(p_is_active, true))
    returning id into v_flow_id;
  else
    update public.printing_flows
    set name = trim(p_name), captured_events = p_captured_events,
        is_active = coalesce(p_is_active, true), updated_at = now()
    where id = p_flow_id and restaurant_id = v_restaurant_id
    returning id into v_flow_id;
    if v_flow_id is null then raise exception 'flow_not_found'; end if;
  end if;

  for v_route in select value from jsonb_array_elements(coalesce(p_routes, '[]'::jsonb)) as route(value)
  loop
    v_point_id := nullif(v_route->>'point_id', '')::uuid;
    v_template_id := nullif(v_route->>'template_id', '')::uuid;
    v_route_id := nullif(v_route->>'route_id', '')::uuid;
    v_output_mode := coalesce(v_route->>'output_mode', 'manual');
    v_copies := greatest(1, least(20, coalesce((v_route->>'copies')::integer, 1)))::smallint;
    v_cadence_ms := greatest(0, least(60000, coalesce((v_route->>'cadence_ms')::integer, 0)));
    v_text_depth := coalesce(v_route->>'text_depth', 'standard');
    v_sort_order := coalesce((v_route->>'sort_order')::integer, 0);
    v_event_keys := array(select jsonb_array_elements_text(coalesce(v_route->'event_keys', '[]'::jsonb)));

    if v_point_id is null or cardinality(v_event_keys) = 0
      or exists(select 1 from unnest(v_event_keys) as event_key(key)
        where event_key.key <> all(p_captured_events)) then
      raise exception 'invalid_flow_route';
    end if;
    select point.supported_output_modes, point.sunat_enabled
      into v_supported_modes, v_is_sunat
    from public.printing_points point
    where point.id = v_point_id and point.restaurant_id = v_restaurant_id and point.is_active;
    if not found then raise exception 'printing_point_unavailable'; end if;
    if not (v_output_mode = any(v_supported_modes)) then raise exception 'unsupported_point_output_mode'; end if;
    if v_text_depth <> all(array['compact','standard','detailed']::text[]) then raise exception 'invalid_text_depth'; end if;
    if v_is_sunat then
      v_template_id := null;
    else
      if v_template_id is null then raise exception 'ticket_template_required'; end if;
      if not exists(select 1 from public.printing_ticket_templates template
        where template.id = v_template_id and template.restaurant_id = v_restaurant_id) then
        raise exception 'ticket_template_unavailable';
      end if;
    end if;

    if v_route_id is null then
      insert into public.printing_flow_routes(
        restaurant_id, flow_id, point_id, template_id, event_keys,
        output_mode, copies, cadence_ms, text_depth, sort_order
      ) values (
        v_restaurant_id, v_flow_id, v_point_id, v_template_id, v_event_keys,
        v_output_mode, v_copies, v_cadence_ms, v_text_depth, v_sort_order
      ) returning id into v_route_id;
    else
      update public.printing_flow_routes route
      set point_id = v_point_id, template_id = v_template_id, event_keys = v_event_keys,
          output_mode = v_output_mode, copies = v_copies, cadence_ms = v_cadence_ms,
          text_depth = v_text_depth, sort_order = v_sort_order
      where route.id = v_route_id and route.flow_id = v_flow_id and route.restaurant_id = v_restaurant_id
      returning id into v_route_id;
      if v_route_id is null then raise exception 'flow_route_not_found'; end if;
    end if;
    v_kept_route_ids := array_append(v_kept_route_ids, v_route_id);
  end loop;

  update public.printing_flow_routes route
  set event_keys = '{}'
  where route.restaurant_id = v_restaurant_id and route.flow_id = v_flow_id
    and not (route.id = any(v_kept_route_ids)) and cardinality(route.event_keys) > 0;

  if coalesce(p_is_active, true) and exists (
    select 1
    from public.printing_flow_routes as route
    join public.printing_points as point
      on point.id = route.point_id and point.restaurant_id = route.restaurant_id
    left join public.printing_devices as device
      on device.id = point.device_id and device.restaurant_id = point.restaurant_id
    where route.flow_id = v_flow_id
      and route.restaurant_id = v_restaurant_id
      and cardinality(route.event_keys) > 0
      and (point.device_id is null or device.id is null)
  ) then raise exception 'printing_flow_needs_update'; end if;

  return v_flow_id;
end;
$$;
revoke all on function public.save_printing_flow(uuid, text, text[], boolean, jsonb) from public, anon;
grant execute on function public.save_printing_flow(uuid, text, text[], boolean, jsonb) to authenticated;

-- Deleting an inactive device leaves its UUID on each point as a detectable
-- broken reference. Those flows are paused; their routes and formats remain.
create or replace function public.setter_delete_inactive_printing_device(
  p_restaurant_id uuid,
  p_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.printing_devices%rowtype;
  v_has_taken boolean;
  v_is_active boolean;
  v_timeout interval;
  v_run_ids uuid[];
begin
  select device.* into v_device
  from public.printing_devices as device
  where device.id = p_device_id and device.restaurant_id = p_restaurant_id
  for update;
  if not found then return jsonb_build_object('deleted', false, 'not_found', true); end if;

  select exists (
    select 1 from public.printing_jobs as job
    where job.device_id = p_device_id and job.restaurant_id = p_restaurant_id and job.status = 'taken'
  ) into v_has_taken;
  v_timeout := case when v_has_taken then interval '7 seconds' else interval '15 seconds' end;
  v_is_active := v_device.last_seen_at is not null
    and v_device.last_seen_at >= clock_timestamp() - v_timeout;
  if v_is_active then
    return jsonb_build_object('deleted', false, 'device', jsonb_build_object(
      'id', v_device.id, 'hardware_key', v_device.hardware_key, 'model', v_device.model,
      'display_name', v_device.display_name, 'serial_number', v_device.serial_number,
      'network_name', v_device.network_name, 'ip_address', v_device.ip_address,
      'tcp_port', v_device.tcp_port, 'connection_type', v_device.connection_type,
      'last_seen_at', v_device.last_seen_at, 'operation_mode', v_device.operation_mode,
      'is_active', true, 'heartbeat_timeout_seconds', extract(epoch from v_timeout)
    ));
  end if;

  update public.printing_flows as flow
  set is_active = false, updated_at = clock_timestamp()
  where flow.restaurant_id = p_restaurant_id
    and flow.is_active
    and exists (
      select 1
      from public.printing_flow_routes as route
      join public.printing_points as point
        on point.id = route.point_id and point.restaurant_id = route.restaurant_id
      where route.flow_id = flow.id and route.restaurant_id = flow.restaurant_id
        and cardinality(route.event_keys) > 0 and point.device_id = p_device_id
    );

  select coalesce(array_agg(distinct job.flow_run_id), '{}'::uuid[])
    into v_run_ids
  from public.printing_jobs as job
  where job.device_id = p_device_id and job.restaurant_id = p_restaurant_id
    and job.status in ('published', 'taken');

  update public.printing_jobs as job
  set status = 'failed', last_error = 'printing_device_removed',
      completed_at = coalesce(job.completed_at, clock_timestamp())
  where job.device_id = p_device_id and job.restaurant_id = p_restaurant_id
    and job.status in ('published', 'taken');

  -- Keep point.device_id unchanged so POS can identify the removed printer.
  update public.printing_jobs as job
  set device_id = null
  where job.device_id = p_device_id and job.restaurant_id = p_restaurant_id;

  update public.printing_flow_runs as run
  set completed_at = coalesce(run.completed_at, clock_timestamp()),
      result_summary = jsonb_build_object(
        'success_count', (select count(*) from public.printing_jobs as job where job.flow_run_id = run.id and job.status = 'success'),
        'failed_count', (select count(*) from public.printing_jobs as job where job.flow_run_id = run.id and job.status = 'failed')
      )
  where run.id = any(v_run_ids) and run.restaurant_id = p_restaurant_id
    and not exists (
      select 1 from public.printing_jobs as job
      where job.flow_run_id = run.id and job.status in ('published', 'taken')
    );

  delete from public.printing_devices as device
  where device.id = p_device_id and device.restaurant_id = p_restaurant_id;
  return jsonb_build_object('deleted', true);
end;
$$;
revoke all on function public.setter_delete_inactive_printing_device(uuid, uuid) from public, anon, authenticated;
grant execute on function public.setter_delete_inactive_printing_device(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
