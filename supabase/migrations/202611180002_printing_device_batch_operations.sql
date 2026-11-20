create or replace function public.operate_printing_batch(
  p_devices jsonb default '[]'::jsonb,
  p_results jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
begin
  if jsonb_typeof(coalesce(p_devices, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_results, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_batch_payload';
  end if;

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

    if v_print_result <> all(array['success','failed']::text[]) then
      raise exception 'invalid_print_result';
    end if;
    v_error := left(coalesce(v_result->>'error', 'printing_failed'), 1000);
    select device.* into v_device
    from public.printing_devices device
    where device.id = v_device_id
      and device.device_token_hash = encode(extensions.digest(convert_to(v_device_token, 'UTF8'), 'sha256'), 'hex')
    for update;
    if not found then raise exception 'invalid_device_credentials'; end if;
    select job.* into v_job
    from public.printing_jobs job
    where job.id = v_job_id
      and job.device_id = v_device_id
      and job.restaurant_id = v_device.restaurant_id
      and job.status = 'taken'
    for update;
    if not found then raise exception 'printing_job_not_active'; end if;
    update public.printing_jobs job
    set status = v_print_result,
      last_error = case when v_print_result = 'failed' then v_error else null end,
      completed_at = now(),
      printed_at = case when v_print_result = 'success' then now() else null end
    where job.id = v_job_id;
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

    update public.printing_devices device
    set last_seen_at = now(), updated_at = now()
    where device.id = v_device_id;

    select job.* into v_job
    from public.printing_jobs job
    where job.device_id = v_device_id
      and job.restaurant_id = v_device.restaurant_id
      and job.status = 'taken'
    order by job.taken_at, job.id
    limit 1;

    if not found then
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
          attempt_count = attempt_count + 1
        where job.id = v_job.id
        returning job.* into v_job;
      end if;
    end if;

    if found then
      update public.printing_devices device
      set operation_mode = 'working', updated_at = now()
      where device.id = v_device_id;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'device_id', v_device_id,
        'mode', 'working',
        'job', jsonb_build_object(
          'id', v_job.id,
          'flow_run_id', v_job.flow_run_id,
          'payload', v_job.payload,
          'route', v_job.route_snapshot
        )
      ));
    else
      update public.printing_devices device
      set operation_mode = 'idle', updated_at = now()
      where device.id = v_device_id;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'device_id', v_device_id,
        'mode', 'idle',
        'job', null
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'devices', v_items,
    'poll_after_seconds', 2
  );
end;
$$;

revoke all on function public.operate_printing_batch(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.operate_printing_batch(jsonb, jsonb) to anon, authenticated;
