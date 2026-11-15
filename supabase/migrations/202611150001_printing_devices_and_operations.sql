-- Device registry, coordinated print runs, adaptive heartbeats and atomic operations.
create table if not exists public.printing_devices (
  id uuid primary key default gen_random_uuid(),
  hardware_key text not null unique,
  model text not null default 'unknown',
  restaurant_id uuid references public.restaurants(id) on delete set null,
  device_token_hash text not null,
  last_seen_at timestamptz,
  operation_mode text not null default 'offline'
    check (operation_mode in ('idle','working','awaiting_ack','offline')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  check (length(trim(hardware_key)) between 8 and 200),
  check (length(trim(model)) between 1 and 120),
  check (device_token_hash ~ '^[0-9a-f]{64}$')
);

alter table public.printing_points
  add column if not exists device_id uuid;
alter table public.printing_points drop constraint if exists printing_points_device_id_fkey;
alter table public.printing_points
  add constraint printing_points_device_restaurant_fkey
  foreign key (device_id, restaurant_id) references public.printing_devices(id, restaurant_id);
create unique index if not exists printing_points_device_unique
  on public.printing_points(device_id) where device_id is not null;

create table if not exists public.printing_flow_runs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  flow_id uuid not null,
  event_id uuid not null,
  event_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  acknowledged_at timestamptz,
  result_summary jsonb not null default '{}'::jsonb,
  unique(flow_id, event_id),
  unique(id, restaurant_id),
  foreign key (flow_id, restaurant_id)
    references public.printing_flows(id, restaurant_id) on delete cascade,
  check (jsonb_typeof(result_summary) = 'object')
);

alter table public.printing_jobs
  add column if not exists flow_run_id uuid,
  add column if not exists device_id uuid,
  add column if not exists taken_at timestamptz,
  add column if not exists completed_at timestamptz;
alter table public.printing_jobs drop constraint if exists printing_jobs_device_id_fkey;
alter table public.printing_jobs
  add constraint printing_jobs_device_restaurant_fkey
  foreign key (device_id, restaurant_id) references public.printing_devices(id, restaurant_id);

-- Preserve pre-existing jobs by grouping them into reportable runs.
insert into public.printing_flow_runs(restaurant_id, flow_id, event_id, event_key, created_at)
select job.restaurant_id, job.flow_id, job.event_id, min(job.event_key), min(job.created_at)
from public.printing_jobs job
group by job.restaurant_id, job.flow_id, job.event_id
on conflict(flow_id, event_id) do nothing;
update public.printing_jobs job
set flow_run_id = run.id,
    device_id = point.device_id
from public.printing_flow_runs run, public.printing_points point
where run.restaurant_id = job.restaurant_id and run.flow_id = job.flow_id and run.event_id = job.event_id
  and point.id = job.point_id;
alter table public.printing_jobs
  drop constraint if exists printing_jobs_status_check;
update public.printing_jobs
set status = case status
  when 'queued' then 'published'
  when 'claimed' then 'taken'
  when 'printed' then 'success'
  when 'cancelled' then 'failed'
  else status
end;
update public.printing_jobs
set status = 'failed', last_error = 'printing_device_not_linked', completed_at = now()
where status in ('published','taken') and device_id is null;
update public.printing_jobs
set taken_at = coalesce(taken_at, claimed_at)
where status = 'taken';
update public.printing_jobs
set completed_at = coalesce(completed_at, printed_at, now())
where status in ('success','failed');
alter table public.printing_jobs alter column status set default 'published';
alter table public.printing_jobs
  add constraint printing_jobs_status_check
  check (status in ('published','taken','failed','success'));
alter table public.printing_jobs alter column flow_run_id set not null;
alter table public.printing_jobs
  add constraint printing_jobs_flow_run_restaurant_fkey
  foreign key (flow_run_id, restaurant_id)
  references public.printing_flow_runs(id, restaurant_id) on delete cascade;
create index if not exists printing_jobs_device_queue_idx
  on public.printing_jobs(device_id, status, created_at);
create index if not exists printing_jobs_flow_run_idx
  on public.printing_jobs(flow_run_id, status, created_at);

alter table public.printing_devices enable row level security;
alter table public.printing_flow_runs enable row level security;
drop policy if exists printing_devices_tenant_read on public.printing_devices;
create policy printing_devices_tenant_read on public.printing_devices for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id()));
drop policy if exists printing_flow_runs_tenant_read on public.printing_flow_runs;
create policy printing_flow_runs_tenant_read on public.printing_flow_runs for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id()));

revoke all on public.printing_devices from anon, authenticated;
revoke all on public.printing_flow_runs from anon, authenticated;
revoke all on public.printing_jobs from anon, authenticated;
revoke insert, update, delete on public.printing_points from anon, authenticated;
grant select (id, hardware_key, model, restaurant_id, last_seen_at, operation_mode, created_at, updated_at)
  on public.printing_devices to authenticated;
grant select on public.printing_flow_runs to authenticated;
grant select on public.printing_points to authenticated;
grant select on public.printing_jobs to authenticated;

-- Provisioning is kept server-side; a future printer bootstrap endpoint calls this with service_role.
create or replace function public.register_printing_device(
  p_hardware_key text,
  p_model text,
  p_device_token text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_hash text;
  v_existing_hash text;
begin
  if coalesce(length(trim(p_hardware_key)), 0) not between 8 and 200
    or coalesce(length(trim(p_model)), 0) not between 1 and 120
    or coalesce(length(p_device_token), 0) < 32 then
    raise exception 'invalid_device_registration';
  end if;
  v_hash := encode(extensions.digest(convert_to(p_device_token, 'UTF8'), 'sha256'), 'hex');
  select device.id, device.device_token_hash
    into v_id, v_existing_hash
  from public.printing_devices device
  where device.hardware_key = trim(p_hardware_key)
  for update;
  if found then
    if v_existing_hash <> v_hash then raise exception 'device_already_registered'; end if;
    update public.printing_devices
    set model = trim(p_model), last_seen_at = now(), operation_mode = 'idle', updated_at = now()
    where id = v_id;
    return v_id;
  end if;
  insert into public.printing_devices(hardware_key, model, device_token_hash, last_seen_at, operation_mode)
  values(trim(p_hardware_key), trim(p_model), v_hash, now(), 'idle')
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.register_printing_device(text, text, text) from public, anon, authenticated;
grant execute on function public.register_printing_device(text, text, text) to service_role;

create or replace function public.save_printing_point(
  p_point_id uuid,
  p_name text,
  p_is_active boolean,
  p_sunat_enabled boolean,
  p_supported_modes text[],
  p_output_mode text,
  p_transport text,
  p_connection_config jsonb,
  p_sunat_config jsonb,
  p_device_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_point_id uuid;
  v_device_restaurant uuid;
  v_old_device_id uuid;
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if public.current_role_key() <> 'admin' then raise exception 'admin_required'; end if;
  if coalesce(length(trim(p_name)), 0) not between 1 and 80 then raise exception 'invalid_printing_point_name'; end if;
  if coalesce(cardinality(p_supported_modes), 0) = 0
    or not (p_supported_modes <@ array['manual','automatic']::text[]) then raise exception 'invalid_output_modes'; end if;
  if not (p_output_mode = any(p_supported_modes)) then raise exception 'invalid_default_output_mode'; end if;
  if p_transport <> all(array['browser','local_agent','network_escpos','cloud_webhook']::text[]) then raise exception 'invalid_print_transport'; end if;
  if jsonb_typeof(coalesce(p_connection_config, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_sunat_config, '{}'::jsonb)) <> 'object' then raise exception 'invalid_printing_configuration'; end if;
  if p_device_id is null and not coalesce(p_sunat_enabled, false)
    and 'automatic' = any(p_supported_modes) then raise exception 'printing_device_required'; end if;
  if p_device_id is not null then
    select device.restaurant_id into v_device_restaurant
    from public.printing_devices device where device.id = p_device_id for update;
    if not found then raise exception 'printing_device_not_found'; end if;
    if v_device_restaurant is not null and v_device_restaurant <> v_restaurant_id then raise exception 'printing_device_already_linked'; end if;
  end if;

  if p_point_id is null then
    insert into public.printing_points(
      restaurant_id, name, is_active, sunat_enabled, supported_output_modes,
      output_mode, transport, connection_config, sunat_config
    ) values (
      v_restaurant_id, trim(p_name), coalesce(p_is_active, true), coalesce(p_sunat_enabled, false),
      p_supported_modes, p_output_mode, p_transport,
      coalesce(p_connection_config, '{}'::jsonb), coalesce(p_sunat_config, '{}'::jsonb)
    ) returning id into v_point_id;
  else
    select point.device_id into v_old_device_id
    from public.printing_points point
    where point.id = p_point_id and point.restaurant_id = v_restaurant_id
    for update;
    if not found then raise exception 'printing_point_not_found'; end if;
    update public.printing_points point
    set name = trim(p_name), is_active = coalesce(p_is_active, true),
        sunat_enabled = coalesce(p_sunat_enabled, false), supported_output_modes = p_supported_modes,
        output_mode = p_output_mode, transport = p_transport,
        connection_config = coalesce(p_connection_config, '{}'::jsonb),
        sunat_config = coalesce(p_sunat_config, '{}'::jsonb), updated_at = now()
    where point.id = p_point_id and point.restaurant_id = v_restaurant_id
    returning point.id into v_point_id;
  end if;

  update public.printing_devices device
  set restaurant_id = v_restaurant_id, updated_at = now()
  where device.id = p_device_id;
  update public.printing_points point
  set device_id = p_device_id
  where point.id = v_point_id and point.restaurant_id = v_restaurant_id;
  if v_old_device_id is distinct from p_device_id and v_old_device_id is not null then
    update public.printing_devices device
    set restaurant_id = null, operation_mode = 'offline', updated_at = now()
    where device.id = v_old_device_id
      and not exists(select 1 from public.printing_points linked where linked.device_id = device.id);
  end if;
  return v_point_id;
end;
$$;
revoke all on function public.save_printing_point(uuid, text, boolean, boolean, text[], text, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.save_printing_point(uuid, text, boolean, boolean, text[], text, text, jsonb, jsonb, uuid) to authenticated;

create or replace function public.set_printing_point_active(p_point_id uuid, p_is_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_restaurant_id uuid := public.current_restaurant_id();
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if public.current_role_key() <> 'admin' then raise exception 'admin_required'; end if;
  update public.printing_points point set is_active = coalesce(p_is_active, false), updated_at = now()
  where point.id = p_point_id and point.restaurant_id = v_restaurant_id;
  if not found then raise exception 'printing_point_not_found'; end if;
end;
$$;
revoke all on function public.set_printing_point_active(uuid, boolean) from public, anon;
grant execute on function public.set_printing_point_active(uuid, boolean) to authenticated;

create or replace function public.enqueue_print_event(
  p_event_key text,
  p_payload jsonb default '{}'::jsonb,
  p_event_id uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_flow record;
  v_route record;
  v_run_id uuid;
  v_created integer := 0;
  v_published integer := 0;
  v_failed integer := 0;
  v_routes integer := 0;
  v_is_online boolean;
  v_initial_status text;
  v_initial_error text;
  v_run_ids jsonb := '[]'::jsonb;
  v_events text[] := array[
    'open_order_created','open_order_updated','paid_order_created',
    'payment_corrected','kitchen_order_ready','salon_order_delivered','manual_reprint'
  ];
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if p_event_key <> all(v_events) then raise exception 'unsupported_print_event'; end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 65536 then raise exception 'invalid_print_payload'; end if;
  if not exists(select 1 from public.restaurants r where r.id = v_restaurant_id and 'printing_systems' = any(r.needs)) then
    raise exception 'printing_systems_not_enabled';
  end if;
  if not (public.current_has_permission('orders') or public.current_has_permission('payments')
    or public.current_has_permission('kitchen') or public.current_has_permission('salon')) then
    raise exception 'printing_permission_denied';
  end if;

  for v_flow in
    select flow.id, flow.name
    from public.printing_flows flow
    where flow.restaurant_id = v_restaurant_id and flow.is_active and p_event_key = any(flow.captured_events)
      and exists(select 1 from public.printing_flow_routes route
        where route.flow_id = flow.id and route.restaurant_id = flow.restaurant_id and p_event_key = any(route.event_keys))
    order by flow.created_at, flow.id
  loop
    v_run_id := null;
    insert into public.printing_flow_runs(restaurant_id, flow_id, event_id, event_key, created_by)
    values(v_restaurant_id, v_flow.id, p_event_id, p_event_key, auth.uid())
    on conflict(flow_id, event_id) do nothing
    returning id into v_run_id;
    if v_run_id is null then
      select run.id into v_run_id from public.printing_flow_runs run
      where run.restaurant_id = v_restaurant_id and run.flow_id = v_flow.id and run.event_id = p_event_id;
      v_run_ids := v_run_ids || jsonb_build_array(v_run_id);
      continue;
    end if;
    v_run_ids := v_run_ids || jsonb_build_array(v_run_id);
    for v_route in
      select route.id, route.point_id, route.template_id, route.output_mode, route.copies,
        route.cadence_ms, route.text_depth, point.name as point_name, point.device_id,
        point.is_active as point_is_active,
        point.sunat_enabled, point.transport, device.model as device_model,
        device.last_seen_at, device.operation_mode,
        template.name as template_name, template.format as template_format,
        exists(select 1 from public.printing_jobs active_job
          where active_job.device_id = point.device_id and active_job.status = 'taken') as has_taken_job
      from public.printing_flow_routes route
      join public.printing_points point on point.id = route.point_id and point.restaurant_id = route.restaurant_id
      left join public.printing_devices device on device.id = point.device_id
      left join public.printing_ticket_templates template on template.id = route.template_id and template.restaurant_id = route.restaurant_id
      where route.restaurant_id = v_restaurant_id and route.flow_id = v_flow.id and p_event_key = any(route.event_keys)
      order by route.sort_order, route.id
    loop
      v_routes := v_routes + 1;
      v_is_online := coalesce(v_route.device_id is not null
        and v_route.operation_mode <> 'offline'
        and v_route.last_seen_at is not null
        and v_route.last_seen_at >= now() - case when v_route.has_taken_job then interval '7 seconds' else interval '15 seconds' end, false);
      if p_event_key = 'manual_reprint' and (not v_route.point_is_active
        or (v_route.output_mode = 'automatic' and not v_is_online)) then
        raise exception 'printing_device_inactive';
      end if;
      v_initial_status := case when v_route.output_mode = 'automatic' and v_is_online
        and v_route.point_is_active and not v_route.sunat_enabled then 'published' else 'failed' end;
      v_initial_error := case
        when v_route.sunat_enabled then 'sunat_integration_pending'
        when not v_route.point_is_active then 'printing_point_inactive'
        when v_route.output_mode = 'manual' then 'manual_printing_view_pending'
        when v_route.device_id is null then 'printing_device_not_linked'
        when not v_is_online then 'printing_device_inactive'
        else null end;
      insert into public.printing_jobs(
        restaurant_id, flow_id, route_id, point_id, template_id, event_key, event_id,
        flow_run_id, device_id, payload, route_snapshot, status, last_error, completed_at
      ) values (
        v_restaurant_id, v_flow.id, v_route.id, v_route.point_id, v_route.template_id,
        p_event_key, p_event_id, v_run_id, v_route.device_id, coalesce(p_payload, '{}'::jsonb),
        jsonb_build_object(
          'output_mode', case when v_route.sunat_enabled then 'sunat' else v_route.output_mode end,
          'transport', v_route.transport, 'copies', v_route.copies,
          'cadence_ms', v_route.cadence_ms, 'text_depth', v_route.text_depth,
          'point_name', v_route.point_name, 'device_model', v_route.device_model,
          'template_name', v_route.template_name, 'template', v_route.template_format
        ), v_initial_status, v_initial_error,
        case when v_initial_status = 'failed' then now() else null end
      ) on conflict(event_id, route_id) do nothing;
      if found then
        v_created := v_created + 1;
        if v_initial_status = 'published' then v_published := v_published + 1;
        else v_failed := v_failed + 1; end if;
      end if;
    end loop;
  end loop;
  if v_routes = 0 then return jsonb_build_object('event_id', p_event_id, 'queued', 0, 'status', 'no_matching_flow'); end if;
  return jsonb_build_object('event_id', p_event_id, 'queued', v_created,
    'published', v_published, 'failed', v_failed,
    'flow_run_ids', v_run_ids, 'status', case when v_published > 0 then 'published' else 'completed' end);
end;
$$;
revoke all on function public.enqueue_print_event(text, jsonb, uuid) from public, anon;
grant execute on function public.enqueue_print_event(text, jsonb, uuid) to authenticated;

-- One device operation both refreshes its heartbeat and claims/updates a job.
create or replace function public.operate_printing_device(
  p_device_id uuid,
  p_device_token text,
  p_job_id uuid default null,
  p_result text default null,
  p_error text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_device public.printing_devices%rowtype;
  v_job public.printing_jobs%rowtype;
  v_result jsonb;
  v_mode text;
begin
  if p_device_id is null or coalesce(length(p_device_token), 0) < 32 then raise exception 'invalid_device_credentials'; end if;
  select device.* into v_device from public.printing_devices device
  where device.id = p_device_id
    and device.device_token_hash = encode(extensions.digest(convert_to(p_device_token, 'UTF8'), 'sha256'), 'hex')
  for update;
  if not found then raise exception 'invalid_device_credentials'; end if;
  if v_device.restaurant_id is null then raise exception 'printing_device_not_linked'; end if;

  if p_job_id is not null then
    select job.* into v_job from public.printing_jobs job
    where job.id = p_job_id and job.device_id = p_device_id and job.restaurant_id = v_device.restaurant_id
    for update;
    if not found or v_job.status <> 'taken' then raise exception 'printing_job_not_active'; end if;
    if p_result is null then
      update public.printing_devices device set last_seen_at = now(), operation_mode = 'working', updated_at = now()
      where device.id = p_device_id;
      return jsonb_build_object('device_id', p_device_id, 'mode', 'working', 'poll_after_seconds', 2,
        'job', jsonb_build_object('id', v_job.id, 'flow_run_id', v_job.flow_run_id, 'payload', v_job.payload, 'route', v_job.route_snapshot));
    end if;
    if p_result <> all(array['success','failed']::text[]) then raise exception 'invalid_print_result'; end if;
    update public.printing_jobs job set status = p_result,
      last_error = case when p_result = 'failed' then left(coalesce(p_error, 'printing_failed'), 1000) else null end,
      completed_at = now(), printed_at = case when p_result = 'success' then now() else null end
    where job.id = p_job_id;
    update public.printing_devices device set last_seen_at = now(), updated_at = now()
    where device.id = p_device_id;
  elsif p_result is not null then
    raise exception 'printing_job_id_required';
  end if;

  if p_job_id is null then
    update public.printing_devices device set last_seen_at = now(), updated_at = now()
    where device.id = p_device_id;
    select job.* into v_job from public.printing_jobs job
    where job.device_id = p_device_id and job.restaurant_id = v_device.restaurant_id and job.status = 'taken'
    order by job.taken_at, job.id limit 1;
    if found then
      update public.printing_devices device set operation_mode = 'working', updated_at = now()
      where device.id = p_device_id;
      return jsonb_build_object('device_id', p_device_id, 'mode', 'working', 'poll_after_seconds', 2,
        'job', jsonb_build_object('id', v_job.id, 'flow_run_id', v_job.flow_run_id, 'payload', v_job.payload, 'route', v_job.route_snapshot));
    end if;
    select job.* into v_job from public.printing_jobs job
    where job.device_id = p_device_id and job.restaurant_id = v_device.restaurant_id and job.status = 'published'
    order by job.created_at, job.id
    limit 1 for update skip locked;
    if found then
      update public.printing_jobs job set status = 'taken', claimed_at = now(), taken_at = now(), attempt_count = attempt_count + 1
      where job.id = v_job.id returning job.* into v_job;
      update public.printing_devices device set operation_mode = 'working', updated_at = now()
      where device.id = p_device_id;
      return jsonb_build_object('device_id', p_device_id, 'mode', 'working', 'poll_after_seconds', 2,
        'job', jsonb_build_object('id', v_job.id, 'flow_run_id', v_job.flow_run_id, 'payload', v_job.payload, 'route', v_job.route_snapshot));
    end if;
  end if;

  if exists(select 1 from public.printing_jobs job join public.printing_flow_runs run on run.id = job.flow_run_id
      where job.device_id = p_device_id and run.acknowledged_at is null and run.completed_at is null) then
    v_mode := 'working';
  elsif exists(select 1 from public.printing_jobs job join public.printing_flow_runs run on run.id = job.flow_run_id
      where job.device_id = p_device_id and run.acknowledged_at is null) then
    v_mode := 'awaiting_ack';
  else
    v_mode := 'idle';
  end if;
  update public.printing_devices device set operation_mode = v_mode, updated_at = now()
  where device.id = p_device_id;
  v_result := jsonb_build_object('device_id', p_device_id, 'mode', v_mode,
    'poll_after_seconds', case when v_mode = 'idle' then 10 else 2 end, 'job', null);
  return v_result;
end;
$$;
revoke all on function public.operate_printing_device(uuid, text, uuid, text, text) from public, authenticated;
grant execute on function public.operate_printing_device(uuid, text, uuid, text, text) to anon;

-- The web's five-second operation evaluates mode-specific timeouts and returns terminal runs.
create or replace function public.operate_printing_web()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if not (public.current_has_permission('orders') or public.current_has_permission('payments')
    or public.current_has_permission('kitchen') or public.current_has_permission('salon')) then
    raise exception 'printing_permission_denied';
  end if;

  update public.printing_devices device
  set operation_mode = 'offline', updated_at = now()
  where device.restaurant_id = v_restaurant_id
    and exists(select 1 from public.printing_jobs active_job where active_job.device_id = device.id and active_job.status = 'taken')
    and (device.last_seen_at is null or device.last_seen_at < now() - interval '7 seconds');
  update public.printing_devices device
  set operation_mode = 'offline', updated_at = now()
  where device.restaurant_id = v_restaurant_id
    and not exists(select 1 from public.printing_jobs active_job where active_job.device_id = device.id and active_job.status = 'taken')
    and (device.last_seen_at is null or device.last_seen_at < now() - interval '15 seconds');
  update public.printing_jobs job
  set status = 'failed', last_error = 'printer_heartbeat_timeout', completed_at = now()
  from public.printing_devices device
  where job.device_id = device.id and job.restaurant_id = v_restaurant_id
    and device.restaurant_id = v_restaurant_id and device.operation_mode = 'offline'
    and job.status in ('published','taken');
  update public.printing_flow_runs run
  set completed_at = now(), result_summary = jsonb_build_object(
      'success_count', (select count(*) from public.printing_jobs job where job.flow_run_id = run.id and job.status = 'success'),
      'failed_count', (select count(*) from public.printing_jobs job where job.flow_run_id = run.id and job.status = 'failed')
    )
  where run.restaurant_id = v_restaurant_id and run.completed_at is null
    and exists(select 1 from public.printing_jobs job where job.flow_run_id = run.id)
    and not exists(select 1 from public.printing_jobs job where job.flow_run_id = run.id and job.status in ('published','taken'));

  return jsonb_build_object(
    'devices', coalesce((select jsonb_agg(jsonb_build_object(
      'id', device.id, 'hardware_key', device.hardware_key, 'model', device.model,
      'last_seen_at', device.last_seen_at, 'operation_mode', device.operation_mode,
      'available', device.operation_mode <> 'offline'
    ) order by device.created_at) from public.printing_devices device where device.restaurant_id = v_restaurant_id), '[]'::jsonb),
    'completed_runs', coalesce((select jsonb_agg(jsonb_build_object(
      'id', run.id, 'flow_id', run.flow_id, 'event_key', run.event_key, 'created_at', run.created_at,
      'success_count', coalesce((run.result_summary->>'success_count')::integer, 0),
      'failed_count', coalesce((run.result_summary->>'failed_count')::integer, 0),
      'tasks', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', job.id, 'status', job.status, 'error', job.last_error,
        'point_name', job.route_snapshot->>'point_name', 'device_model', job.route_snapshot->>'device_model'
      ) order by job.created_at, job.id), '[]'::jsonb) from public.printing_jobs job where job.flow_run_id = run.id)
    ) order by run.created_at) from public.printing_flow_runs run
      where run.restaurant_id = v_restaurant_id and run.completed_at is not null and run.acknowledged_at is null), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.operate_printing_web() from public, anon;
grant execute on function public.operate_printing_web() to authenticated;

create or replace function public.acknowledge_printing_flow_run(p_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if not (public.current_has_permission('orders') or public.current_has_permission('payments')
    or public.current_has_permission('kitchen') or public.current_has_permission('salon')) then
    raise exception 'printing_permission_denied';
  end if;
  update public.printing_flow_runs run set acknowledged_at = now()
  where run.id = p_run_id and run.restaurant_id = v_restaurant_id and run.completed_at is not null and run.acknowledged_at is null;
  if not found then raise exception 'printing_run_not_acknowledgeable'; end if;
  delete from public.printing_jobs job where job.flow_run_id = p_run_id and job.restaurant_id = v_restaurant_id;
end;
$$;
revoke all on function public.acknowledge_printing_flow_run(uuid) from public, anon;
grant execute on function public.acknowledge_printing_flow_run(uuid) to authenticated;

