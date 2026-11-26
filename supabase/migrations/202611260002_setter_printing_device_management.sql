-- Setter can atomically remove an inactive printer without racing BPrint's
-- heartbeat. The service-role-only RPC is called by setter-admin after it has
-- authenticated the platform operator.
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
  where device.id = p_device_id
    and device.restaurant_id = p_restaurant_id
  for update;

  if not found then
    return jsonb_build_object('deleted', false, 'not_found', true);
  end if;

  select exists (
    select 1
    from public.printing_jobs as job
    where job.device_id = p_device_id
      and job.restaurant_id = p_restaurant_id
      and job.status = 'taken'
  ) into v_has_taken;

  v_timeout := case when v_has_taken then interval '7 seconds' else interval '15 seconds' end;
  v_is_active := v_device.last_seen_at is not null
    and v_device.last_seen_at >= clock_timestamp() - v_timeout;

  if v_is_active then
    return jsonb_build_object(
      'deleted', false,
      'device', jsonb_build_object(
        'id', v_device.id,
        'hardware_key', v_device.hardware_key,
        'model', v_device.model,
        'display_name', v_device.display_name,
        'serial_number', v_device.serial_number,
        'network_name', v_device.network_name,
        'ip_address', v_device.ip_address,
        'tcp_port', v_device.tcp_port,
        'connection_type', v_device.connection_type,
        'last_seen_at', v_device.last_seen_at,
        'operation_mode', v_device.operation_mode,
        'is_active', true,
        'heartbeat_timeout_seconds', extract(epoch from v_timeout)
      )
    );
  end if;

  select coalesce(array_agg(distinct job.flow_run_id), '{}'::uuid[])
    into v_run_ids
  from public.printing_jobs as job
  where job.device_id = p_device_id
    and job.restaurant_id = p_restaurant_id
    and job.status in ('published', 'taken');

  -- Pending tasks cannot remain queued for a device that is being removed.
  update public.printing_jobs as job
  set status = 'failed',
      last_error = 'printing_device_removed',
      completed_at = coalesce(job.completed_at, clock_timestamp())
  where job.device_id = p_device_id
    and job.restaurant_id = p_restaurant_id
    and job.status in ('published', 'taken');

  -- Preserve configured points and historical print runs; detach only the
  -- physical-device foreign keys before deleting its registry row.
  update public.printing_points as point
  set device_id = null
  where point.device_id = p_device_id
    and point.restaurant_id = p_restaurant_id;

  update public.printing_jobs as job
  set device_id = null
  where job.device_id = p_device_id
    and job.restaurant_id = p_restaurant_id;

  update public.printing_flow_runs as run
  set completed_at = coalesce(run.completed_at, clock_timestamp()),
      result_summary = jsonb_build_object(
        'success_count', (select count(*) from public.printing_jobs as job where job.flow_run_id = run.id and job.status = 'success'),
        'failed_count', (select count(*) from public.printing_jobs as job where job.flow_run_id = run.id and job.status = 'failed')
      )
  where run.id = any(v_run_ids)
    and run.restaurant_id = p_restaurant_id
    and not exists (
      select 1 from public.printing_jobs as job
      where job.flow_run_id = run.id
        and job.status in ('published', 'taken')
    );

  delete from public.printing_devices as device
  where device.id = p_device_id
    and device.restaurant_id = p_restaurant_id;

  return jsonb_build_object('deleted', true);
end;
$$;

revoke all on function public.setter_delete_inactive_printing_device(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.setter_delete_inactive_printing_device(uuid, uuid)
  to service_role;

comment on function public.setter_delete_inactive_printing_device(uuid, uuid) is
  'Atomically rechecks printer heartbeat and removes only an inactive restaurant device; invoked by the authenticated Setter Edge Function.';
