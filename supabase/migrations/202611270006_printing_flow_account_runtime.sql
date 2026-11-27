-- Account presence and single-coordinator election are folded into the
-- existing five-second web operation. No additional browser polling loop.
create table if not exists public.printing_flow_account_presence (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default clock_timestamp(),
  primary key (restaurant_id, account_id)
);

create table if not exists public.printing_flow_runtime (
  flow_id uuid primary key,
  restaurant_id uuid not null,
  state text not null default 'inactive'
    check (state in ('inactive','searching','noRunning','Running','waitingForAccount')),
  motor_account_id uuid references auth.users(id) on delete set null,
  target_account_id uuid references auth.users(id) on delete set null,
  backup_position integer not null default 0 check (backup_position >= 0),
  search_started_at timestamptz,
  lease_until timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (flow_id, restaurant_id)
    references public.printing_flows(id, restaurant_id) on delete cascade
);

create index if not exists printing_flow_presence_active_idx
  on public.printing_flow_account_presence(restaurant_id, last_seen_at desc);
alter table public.printing_flow_account_presence enable row level security;
alter table public.printing_flow_runtime enable row level security;
revoke all on public.printing_flow_account_presence from public, anon, authenticated;
revoke all on public.printing_flow_runtime from public, anon, authenticated;

create or replace function public.reconcile_printing_flow_runtime()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.printing_flow_runtime runtime
  set state = 'inactive', motor_account_id = null, target_account_id = null,
      lease_until = null, search_started_at = null, updated_at = clock_timestamp()
  from public.printing_flows flow
  where flow.id = runtime.flow_id and flow.restaurant_id = runtime.restaurant_id
    and not flow.is_active and runtime.state <> 'inactive';

  update public.printing_flow_runtime runtime
  set state = 'waitingForAccount', motor_account_id = null, target_account_id = null,
      lease_until = null, search_started_at = null, backup_position = 0,
      updated_at = clock_timestamp()
  from public.printing_flows flow
  where flow.id = runtime.flow_id and flow.restaurant_id = runtime.restaurant_id
    and flow.is_active and runtime.state in ('noRunning','Running','searching')
    and not exists (
      select 1 from public.printing_flow_account_presence presence
      where presence.restaurant_id = runtime.restaurant_id
        and presence.last_seen_at >= clock_timestamp() - interval '15 seconds'
    )
    and (runtime.lease_until is null or runtime.lease_until <= clock_timestamp()
      or runtime.state = 'searching');
end;
$$;
revoke all on function public.reconcile_printing_flow_runtime() from public, anon, authenticated;
grant execute on function public.reconcile_printing_flow_runtime() to service_role;

create or replace function public.operate_printing_web()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_account_id uuid := (select auth.uid());
  v_previous_seen timestamptz;
  v_new_session boolean;
  v_flow public.printing_flows%rowtype;
  v_runtime public.printing_flow_runtime%rowtype;
  v_target_position integer;
  v_next_position integer;
  v_next_account uuid;
begin
  if v_restaurant_id is null or v_account_id is null then raise exception 'authentication_required'; end if;
  if not (public.current_has_permission('orders') or public.current_has_permission('payments')
    or public.current_has_permission('kitchen') or public.current_has_permission('salon')) then
    raise exception 'printing_permission_denied';
  end if;

  select presence.last_seen_at into v_previous_seen
  from public.printing_flow_account_presence presence
  where presence.restaurant_id = v_restaurant_id and presence.account_id = v_account_id;
  v_new_session := v_previous_seen is null or v_previous_seen < clock_timestamp() - interval '15 seconds';
  insert into public.printing_flow_account_presence(restaurant_id, account_id, last_seen_at)
  values(v_restaurant_id, v_account_id, clock_timestamp())
  on conflict(restaurant_id, account_id) do update set last_seen_at = excluded.last_seen_at;

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

  for v_flow in
    select flow.* from public.printing_flows flow
    where flow.restaurant_id = v_restaurant_id order by flow.id
  loop
    insert into public.printing_flow_runtime(flow_id, restaurant_id, state)
    values(v_flow.id, v_restaurant_id, 'inactive') on conflict(flow_id) do nothing;
    select runtime.* into v_runtime from public.printing_flow_runtime runtime
    where runtime.flow_id = v_flow.id and runtime.restaurant_id = v_restaurant_id for update;

    if not v_flow.is_active then
      update public.printing_flow_runtime set state = 'inactive', motor_account_id = null,
        target_account_id = null, lease_until = null, search_started_at = null,
        backup_position = 0, updated_at = clock_timestamp()
      where flow_id = v_flow.id and restaurant_id = v_restaurant_id;
      continue;
    end if;

    if v_runtime.state = 'inactive' then
      if cardinality(v_flow.engine_account_order) = 0 then
        update public.printing_flow_runtime set state='waitingForAccount',updated_at=clock_timestamp()
        where flow_id=v_flow.id and restaurant_id=v_restaurant_id;
      else
        update public.printing_flow_runtime set state='searching',target_account_id=v_flow.engine_account_order[1],
          backup_position=1,search_started_at=clock_timestamp(),lease_until=null,updated_at=clock_timestamp()
        where flow_id=v_flow.id and restaurant_id=v_restaurant_id;
        v_runtime.state := 'searching'; v_runtime.target_account_id := v_flow.engine_account_order[1];
        v_runtime.backup_position := 1; v_runtime.search_started_at := clock_timestamp();
      end if;
    elsif v_runtime.state = 'waitingForAccount' and v_new_session
      and v_account_id = any(v_flow.engine_account_order) then
      if cardinality(v_flow.engine_account_order) > 0 then
        update public.printing_flow_runtime set state='searching',target_account_id=v_flow.engine_account_order[1],
          backup_position=1,search_started_at=clock_timestamp(),updated_at=clock_timestamp()
        where flow_id=v_flow.id and restaurant_id=v_restaurant_id;
        v_runtime.state := 'searching'; v_runtime.target_account_id := v_flow.engine_account_order[1];
        v_runtime.backup_position := 1; v_runtime.search_started_at := clock_timestamp();
      end if;
    end if;

    if v_runtime.state = 'searching' then
      if v_runtime.target_account_id = v_account_id then
        update public.printing_flow_runtime runtime
        set state = case when exists(select 1 from public.printing_jobs job
              where job.flow_id=v_flow.id and job.restaurant_id=v_restaurant_id and job.status in ('published','taken'))
            then 'Running' else 'noRunning' end,
          motor_account_id=v_account_id,target_account_id=null,search_started_at=null,
          lease_until=clock_timestamp()+interval '15 seconds',updated_at=clock_timestamp()
        where runtime.flow_id=v_flow.id and runtime.restaurant_id=v_restaurant_id and runtime.state='searching'
          and runtime.target_account_id=v_account_id;
      elsif v_runtime.search_started_at < clock_timestamp() - interval '10 seconds' then
        v_next_position := v_runtime.backup_position + 1;
        if v_next_position > cardinality(v_flow.engine_account_order) then
          update public.printing_flow_runtime set state='waitingForAccount',motor_account_id=null,
            target_account_id=null,search_started_at=null,lease_until=null,backup_position=0,updated_at=clock_timestamp()
          where flow_id=v_flow.id and restaurant_id=v_restaurant_id;
        else
          v_next_account := v_flow.engine_account_order[v_next_position];
          update public.printing_flow_runtime set target_account_id=v_next_account,
            backup_position=v_next_position,search_started_at=clock_timestamp(),updated_at=clock_timestamp()
          where flow_id=v_flow.id and restaurant_id=v_restaurant_id and state='searching';
        end if;
      end if;
    elsif v_runtime.state in ('noRunning','Running') then
      if v_runtime.motor_account_id = v_account_id then
        update public.printing_flow_runtime runtime
        set state = case when exists(select 1 from public.printing_jobs job
              where job.flow_id=v_flow.id and job.restaurant_id=v_restaurant_id and job.status in ('published','taken'))
            then 'Running' else 'noRunning' end,
          lease_until=clock_timestamp()+interval '15 seconds',updated_at=clock_timestamp()
        where runtime.flow_id=v_flow.id and runtime.restaurant_id=v_restaurant_id;
      elsif v_runtime.lease_until is null or v_runtime.lease_until <= clock_timestamp() then
        v_target_position := array_position(v_flow.engine_account_order,v_runtime.motor_account_id);
        v_next_position := coalesce(v_target_position,0)+1;
        if v_next_position > cardinality(v_flow.engine_account_order) then
          update public.printing_flow_runtime set state='waitingForAccount',motor_account_id=null,
            target_account_id=null,lease_until=null,search_started_at=null,backup_position=0,updated_at=clock_timestamp()
          where flow_id=v_flow.id and restaurant_id=v_restaurant_id;
        else
          v_next_account := v_flow.engine_account_order[v_next_position];
          update public.printing_flow_runtime set state='searching',motor_account_id=null,
            target_account_id=v_next_account,backup_position=v_next_position,
            search_started_at=clock_timestamp(),lease_until=null,updated_at=clock_timestamp()
          where flow_id=v_flow.id and restaurant_id=v_restaurant_id;
          if v_next_account = v_account_id then
            update public.printing_flow_runtime set state=case when exists(
              select 1 from public.printing_jobs job where job.flow_id=v_flow.id
                and job.restaurant_id=v_restaurant_id and job.status in ('published','taken'))
              then 'Running' else 'noRunning' end,
              motor_account_id=v_account_id,target_account_id=null,search_started_at=null,
              lease_until=clock_timestamp()+interval '15 seconds',updated_at=clock_timestamp()
            where flow_id=v_flow.id and restaurant_id=v_restaurant_id;
          end if;
        end if;
      end if;
    end if;
  end loop;

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
      'run_id', run.id, 'flow_id', run.flow_id, 'flow_name', flow.name,
      'event_key', run.event_key, 'created_at', run.created_at,
      'state', case when counts.taken_count > 0 then 'processing' else 'queued' end,
      'published_count', counts.published_count, 'taken_count', counts.taken_count,
      'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', job.id,'status',job.status,
        'point_name',job.route_snapshot->>'point_name','device_model',job.route_snapshot->>'device_model')
        order by job.created_at,job.id),'[]'::jsonb) from public.printing_jobs job
        where job.flow_run_id=run.id and job.restaurant_id=v_restaurant_id and job.status in ('published','taken'))
    ) order by run.created_at,run.id) from public.printing_flow_runs run
      join public.printing_flows flow on flow.id=run.flow_id and flow.restaurant_id=run.restaurant_id
      cross join lateral (select count(*) filter(where job.status='published')::integer as published_count,
        count(*) filter(where job.status='taken')::integer as taken_count from public.printing_jobs job
        where job.flow_run_id=run.id and job.restaurant_id=v_restaurant_id) counts
      where run.restaurant_id=v_restaurant_id and run.completed_at is null
        and (counts.published_count>0 or counts.taken_count>0)), '[]'::jsonb),
    'flow_runtime', coalesce((select jsonb_agg(jsonb_build_object(
      'flow_id',flow.id,'flow_name',flow.name,'state',runtime.state,
      'motor_account_id',runtime.motor_account_id,
      'motor_account_name',motor.display_name,
      'target_account_id',runtime.target_account_id,
      'target_account_name',target.display_name,
      'lease_until',runtime.lease_until,'updated_at',runtime.updated_at
    ) order by flow.created_at,flow.id) from public.printing_flows flow
      join public.printing_flow_runtime runtime on runtime.flow_id=flow.id and runtime.restaurant_id=flow.restaurant_id
      left join public.accounts motor on motor.auth_user_id=runtime.motor_account_id and motor.restaurant_id=v_restaurant_id
      left join public.accounts target on target.auth_user_id=runtime.target_account_id and target.restaurant_id=v_restaurant_id
      where flow.restaurant_id=v_restaurant_id), '[]'::jsonb),
    'completed_runs', coalesce((select jsonb_agg(jsonb_build_object(
      'id', run.id, 'flow_id', run.flow_id, 'event_key', run.event_key, 'created_at', run.created_at,
      'success_count', coalesce((run.result_summary->>'success_count')::integer, 0),
      'failed_count', coalesce((run.result_summary->>'failed_count')::integer, 0),
      'tasks', (select coalesce(jsonb_agg(jsonb_build_object('id',job.id,'status',job.status,'error',job.last_error,
        'point_name',job.route_snapshot->>'point_name','device_model',job.route_snapshot->>'device_model')
        order by job.created_at,job.id),'[]'::jsonb) from public.printing_jobs job where job.flow_run_id=run.id)
    ) order by run.created_at) from public.printing_flow_runs run
      where run.restaurant_id=v_restaurant_id and run.completed_at is not null and run.acknowledged_at is null), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.operate_printing_web() from public, anon;
grant execute on function public.operate_printing_web() to authenticated;

do $$
begin
  if to_regnamespace('cron') is not null then
    execute 'select cron.schedule(''printing-flow-runtime-reconcile'', ''* * * * *'', ''select public.reconcile_printing_flow_runtime()'')';
  end if;
end;
$$;
