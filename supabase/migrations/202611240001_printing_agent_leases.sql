-- Fencing leases for BPrint agents and atomic batched job results.
-- A device can be operated by its current agent, or taken over after 20 seconds
-- without a heartbeat. Jobs already taken by a previous agent fail as uncertain
-- on takeover so they are never silently reprinted.

alter table public.printing_devices
  add column if not exists lease_owner_id uuid;

alter table public.printing_jobs
  add column if not exists claimed_by_instance uuid;

drop function if exists public.operate_printing_batch(jsonb, jsonb);

create or replace function public.operate_printing_batch(
  p_devices jsonb default '[]'::jsonb,
  p_results jsonb default '[]'::jsonb,
  p_instance_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation jsonb;
  v_result jsonb;
  v_device public.printing_devices%rowtype;
  v_job public.printing_jobs%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_device_id uuid;
  v_device_token text;
  v_job_id uuid;
  v_print_result text;
  v_error text;
  v_mode text;
  v_result_items jsonb := '[]'::jsonb;
begin
  if p_instance_id is null then raise exception 'printing_instance_id_required'; end if;
  if jsonb_typeof(coalesce(p_devices, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_results, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_batch_payload';
  end if;
  if jsonb_array_length(coalesce(p_devices, '[]'::jsonb)) > 100
    or jsonb_array_length(coalesce(p_results, '[]'::jsonb)) > 100 then
    raise exception 'printing_batch_too_large';
  end if;

  -- Results are fenced by both the device lease and the instance which claimed
  -- the job. A retry after a lost HTTP response is idempotent for the same result.
  for v_result in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb))
  loop
    begin
      v_device_id := (v_result->>'device_id')::uuid;
      v_device_token := v_result->>'device_token';
      v_job_id := (v_result->>'job_id')::uuid;
      v_print_result := v_result->>'result';
    exception when others then
      raise exception 'invalid_batch_result';
    end;
    if v_print_result is null or v_print_result <> all(array['success','failed']::text[]) then
      raise exception 'invalid_print_result';
    end if;
    v_error := left(coalesce(v_result->>'error', 'printing_failed'), 1000);

    select device.* into v_device
    from public.printing_devices device
    where device.id = v_device_id
      and device.device_token_hash = encode(extensions.digest(convert_to(v_device_token, 'UTF8'), 'sha256'), 'hex')
    for update;
    if not found then raise exception 'invalid_device_credentials'; end if;
    if v_device.lease_owner_id is distinct from p_instance_id then
      v_result_items := v_result_items || jsonb_build_array(jsonb_build_object(
        'device_id', v_device_id, 'job_id', v_job_id, 'status', 'ownership_lost'
      ));
      continue;
    end if;

    select job.* into v_job
    from public.printing_jobs job
    where job.id = v_job_id
      and job.device_id = v_device_id
      and job.restaurant_id = v_device.restaurant_id
    for update;
    if not found then raise exception 'printing_job_not_active'; end if;
    if v_job.status in ('success','failed') then
      if v_job.status = v_print_result then
        v_result_items := v_result_items || jsonb_build_array(jsonb_build_object(
          'device_id', v_device_id, 'job_id', v_job_id, 'status', 'already_reported'
        ));
      else
        v_result_items := v_result_items || jsonb_build_array(jsonb_build_object(
          'device_id', v_device_id, 'job_id', v_job_id, 'status', 'result_conflict'
        ));
      end if;
      continue;
    elsif v_job.status = 'taken' and v_job.claimed_by_instance = p_instance_id then
      update public.printing_jobs job
      set status = v_print_result,
        last_error = case when v_print_result = 'failed' then v_error else null end,
        completed_at = now(),
        printed_at = case when v_print_result = 'success' then now() else null end
      where job.id = v_job_id;
      v_result_items := v_result_items || jsonb_build_array(jsonb_build_object(
        'device_id', v_device_id, 'job_id', v_job_id, 'status', 'reported'
      ));
    else
      v_result_items := v_result_items || jsonb_build_array(jsonb_build_object(
        'device_id', v_device_id, 'job_id', v_job_id, 'status', 'job_not_owned'
      ));
      continue;
    end if;

    update public.printing_devices device
    set last_seen_at = now(), updated_at = now()
    where device.id = v_device_id;
  end loop;

  for v_operation in select * from jsonb_array_elements(coalesce(p_devices, '[]'::jsonb))
  loop
    begin
      v_device_id := (v_operation->>'device_id')::uuid;
      v_device_token := v_operation->>'device_token';
    exception when others then
      raise exception 'invalid_batch_device';
    end;

    select device.* into v_device
    from public.printing_devices device
    where device.id = v_device_id
      and device.device_token_hash = encode(extensions.digest(convert_to(v_device_token, 'UTF8'), 'sha256'), 'hex')
    for update;
    if not found then raise exception 'invalid_device_credentials'; end if;
    if v_device.restaurant_id is null then raise exception 'printing_device_not_linked'; end if;

    if v_device.lease_owner_id is not null
      and v_device.lease_owner_id <> p_instance_id
      and v_device.last_seen_at >= now() - interval '20 seconds' then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'device_id', v_device_id,
        'mode', 'ownership_lost',
        'poll_after_seconds', 10,
        'job', null
      ));
      continue;
    end if;

    if v_device.lease_owner_id is distinct from p_instance_id then
      update public.printing_jobs job
      set status = 'failed',
        last_error = 'agent_lease_expired_print_result_uncertain',
        completed_at = now()
      where job.device_id = v_device_id
        and job.restaurant_id = v_device.restaurant_id
        and job.status = 'taken'
        and job.claimed_by_instance is distinct from p_instance_id;
    end if;

    update public.printing_devices device
    set lease_owner_id = p_instance_id,
        last_seen_at = now(),
        updated_at = now()
    where device.id = v_device_id;

    select job.* into v_job
    from public.printing_jobs job
    where job.device_id = v_device_id
      and job.restaurant_id = v_device.restaurant_id
      and job.status = 'published'
    order by job.created_at, job.id
    limit 1 for update skip locked;

    if found then
      update public.printing_jobs job
      set status = 'taken',
        claimed_at = now(),
        taken_at = now(),
        attempt_count = attempt_count + 1,
        claimed_by_instance = p_instance_id
      where job.id = v_job.id
      returning job.* into v_job;
      v_mode := 'working';
      update public.printing_devices device
      set operation_mode = v_mode, updated_at = now()
      where device.id = v_device_id;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'device_id', v_device_id,
        'mode', v_mode,
        'poll_after_seconds', 2,
        'job', jsonb_build_object(
          'id', v_job.id,
          'flow_run_id', v_job.flow_run_id,
          'payload', v_job.payload,
          'route', v_job.route_snapshot
        )
      ));
      continue;
    end if;

    if exists (
      select 1 from public.printing_jobs job
      where job.device_id = v_device_id
        and job.restaurant_id = v_device.restaurant_id
        and job.status = 'taken'
        and job.claimed_by_instance = p_instance_id
    ) then
      v_mode := 'working';
    elsif exists (
      select 1 from public.printing_jobs job
      join public.printing_flow_runs run on run.id = job.flow_run_id
      where job.device_id = v_device_id
        and run.acknowledged_at is null
        and run.completed_at is not null
    ) then
      v_mode := 'awaiting_ack';
    else
      v_mode := 'idle';
    end if;

    update public.printing_devices device
    set operation_mode = v_mode, updated_at = now()
    where device.id = v_device_id;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'device_id', v_device_id,
      'mode', v_mode,
      'poll_after_seconds', case when v_mode = 'working' then 2 else 10 end,
      'job', null
    ));
  end loop;

  return jsonb_build_object('devices', v_items, 'results', v_result_items);
end;
$$;

revoke all on function public.operate_printing_batch(jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.operate_printing_batch(jsonb, jsonb, uuid) to anon, authenticated;

-- The previous single-device operation bypasses instance fencing. BPrint now
-- reports heartbeats, claims, and results only through the fenced batch RPC.
revoke all on function public.operate_printing_device(uuid, text, uuid, text, text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
