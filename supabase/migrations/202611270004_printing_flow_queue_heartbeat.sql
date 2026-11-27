-- Include the current durable print-flow queue snapshot in the existing
-- five-second web operation. This avoids a second client timer/RPC.
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
      'display_name', device.display_name, 'serial_number', device.serial_number,
      'network_name', device.network_name, 'ip_address', device.ip_address,
      'tcp_port', device.tcp_port, 'connection_type', device.connection_type,
      'last_seen_at', device.last_seen_at, 'operation_mode', device.operation_mode,
      'available', device.operation_mode <> 'offline'
    ) order by device.created_at) from public.printing_devices device where device.restaurant_id = v_restaurant_id), '[]'::jsonb),
    'flow_queue', coalesce((select jsonb_agg(jsonb_build_object(
      'run_id', run.id,
      'flow_id', run.flow_id,
      'flow_name', flow.name,
      'event_key', run.event_key,
      'created_at', run.created_at,
      'state', case when counts.taken_count > 0 then 'processing' else 'queued' end,
      'published_count', counts.published_count,
      'taken_count', counts.taken_count,
      'jobs', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', job.id,
        'status', job.status,
        'point_name', job.route_snapshot->>'point_name',
        'device_model', job.route_snapshot->>'device_model'
      ) order by job.created_at, job.id), '[]'::jsonb)
        from public.printing_jobs job
        where job.flow_run_id = run.id and job.restaurant_id = v_restaurant_id
          and job.status in ('published','taken'))
    ) order by run.created_at, run.id)
      from public.printing_flow_runs run
      join public.printing_flows flow
        on flow.id = run.flow_id and flow.restaurant_id = run.restaurant_id
      cross join lateral (
        select count(*) filter (where job.status = 'published')::integer as published_count,
          count(*) filter (where job.status = 'taken')::integer as taken_count
        from public.printing_jobs job
        where job.flow_run_id = run.id and job.restaurant_id = v_restaurant_id
      ) counts
      where run.restaurant_id = v_restaurant_id and run.completed_at is null
        and (counts.published_count > 0 or counts.taken_count > 0)), '[]'::jsonb),
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
