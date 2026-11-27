-- Business events become durable flow runs first. The account elected by the
-- existing web heartbeat materializes each run exactly once into print jobs.
alter table public.printing_flow_runs
  add column if not exists event_payload jsonb not null default '{}'::jsonb,
  add column if not exists route_plan jsonb not null default '[]'::jsonb,
  add column if not exists state text not null default 'materialized',
  add column if not exists materialized_at timestamptz,
  add column if not exists executor_account_id uuid references auth.users(id) on delete set null;

alter table public.printing_flow_runs drop constraint if exists printing_flow_runs_state_check;
alter table public.printing_flow_runs add constraint printing_flow_runs_state_check
  check (state in ('queued','materialized'));
alter table public.printing_flow_runs drop constraint if exists printing_flow_runs_event_payload_object_check;
alter table public.printing_flow_runs add constraint printing_flow_runs_event_payload_object_check
  check (jsonb_typeof(event_payload) = 'object');
alter table public.printing_flow_runs drop constraint if exists printing_flow_runs_route_plan_array_check;
alter table public.printing_flow_runs add constraint printing_flow_runs_route_plan_array_check
  check (jsonb_typeof(route_plan) = 'array');

update public.printing_flow_runs run
set state='materialized', materialized_at=coalesce(run.completed_at,run.created_at)
where exists(select 1 from public.printing_jobs job where job.flow_run_id=run.id);
create index if not exists printing_flow_runs_pending_engine_idx
  on public.printing_flow_runs(restaurant_id,flow_id,created_at,id)
  where state='queued' and materialized_at is null and acknowledged_at is null;

create or replace function public.enqueue_print_event(
  p_event_key text,
  p_payload jsonb default '{}'::jsonb,
  p_event_id uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_flow record;
  v_plan jsonb;
  v_run_id uuid;
  v_new_count integer := 0;
  v_run_ids jsonb := '[]'::jsonb;
  v_allowed_events text[] := array[
    'open_order_created','open_order_updated','paid_order_created',
    'payment_corrected','kitchen_order_ready','salon_order_delivered','manual_reprint'
  ];
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if p_event_key is null or p_event_key <> all(v_allowed_events) then raise exception 'unsupported_print_event'; end if;
  if p_event_id is null then p_event_id:=gen_random_uuid(); end if;
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_payload,'{}'::jsonb)::text) > 65536 then raise exception 'invalid_print_payload'; end if;
  if not exists(select 1 from public.restaurants restaurant
    where restaurant.id=v_restaurant_id and 'printing_systems'=any(restaurant.needs)) then
    raise exception 'printing_systems_not_enabled';
  end if;
  if not (public.current_has_permission('orders') or public.current_has_permission('payments')
    or public.current_has_permission('kitchen') or public.current_has_permission('salon')) then
    raise exception 'printing_permission_denied';
  end if;

  for v_flow in select flow.id,flow.name from public.printing_flows flow
    where flow.restaurant_id=v_restaurant_id and flow.is_active and p_event_key=any(flow.captured_events)
      and exists(select 1 from public.printing_flow_routes route where route.flow_id=flow.id
        and route.restaurant_id=flow.restaurant_id and p_event_key=any(route.event_keys))
    order by flow.created_at,flow.id
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
      'route_id',route.id,'task_order',route.sort_order,'point_id',point.id,
      'point_name',point.name,'point_is_active',point.is_active,'device_id',point.device_id,
      'output_mode',route.output_mode,'transport',point.transport,
      'connection_type',device.connection_type,'device_model',device.model,
      'device_display_name',device.display_name,'template_id',route.template_id,
      'template_name',template.name,'template',template.format,
      'copies',route.copies,'cadence_ms',route.cadence_ms,'text_depth',route.text_depth,
      'data_object_key',route.data_object_key
    ) order by route.sort_order,route.id),'[]'::jsonb)
    into v_plan
    from public.printing_flow_routes route
    join public.printing_points point on point.id=route.point_id and point.restaurant_id=route.restaurant_id
    left join public.printing_devices device on device.id=point.device_id and device.restaurant_id=point.restaurant_id
    left join public.printing_ticket_templates template on template.id=route.template_id and template.restaurant_id=route.restaurant_id
    where route.restaurant_id=v_restaurant_id and route.flow_id=v_flow.id and p_event_key=any(route.event_keys);

    insert into public.printing_flow_runs(
      restaurant_id,flow_id,event_id,event_key,created_by,event_payload,route_plan,state
    ) values (
      v_restaurant_id,v_flow.id,p_event_id,p_event_key,auth.uid(),coalesce(p_payload,'{}'::jsonb),v_plan,'queued'
    ) on conflict(flow_id,event_id) do nothing returning id into v_run_id;
    if v_run_id is not null then
      v_new_count:=v_new_count+1;
      -- If a live motor already owns this flow, expose new work in the same
      -- transaction that inserts its durable run.
      update public.printing_flow_runtime runtime set state='Running',updated_at=clock_timestamp()
      where runtime.flow_id=v_flow.id and runtime.restaurant_id=v_restaurant_id
        and runtime.motor_account_id is not null and runtime.state in ('noRunning','Running')
        and runtime.lease_until>clock_timestamp();
    else
      select run.id into v_run_id from public.printing_flow_runs run
      where run.restaurant_id=v_restaurant_id and run.flow_id=v_flow.id and run.event_id=p_event_id;
    end if;
    v_run_ids:=v_run_ids||jsonb_build_array(v_run_id);
  end loop;
  if jsonb_array_length(v_run_ids)=0 then
    return jsonb_build_object('event_id',p_event_id,'queued',0,'status','no_matching_flow');
  end if;
  return jsonb_build_object('event_id',p_event_id,'queued',0,'scheduled_runs',v_new_count,
    'flow_run_ids',v_run_ids,'status',case when v_new_count>0 then 'queued' else 'duplicate' end);
end;
$$;
revoke all on function public.enqueue_print_event(text,jsonb,uuid) from public,anon;
grant execute on function public.enqueue_print_event(text,jsonb,uuid) to authenticated;

create or replace function public.publish_printing_flow_run(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant_id uuid:=public.current_restaurant_id();
  v_account_id uuid:=(select auth.uid());
  v_run public.printing_flow_runs%rowtype;
  v_runtime public.printing_flow_runtime%rowtype;
  v_route jsonb;
  v_device public.printing_devices%rowtype;
  v_job_device_id uuid;
  v_status text;
  v_error text;
  v_has_taken boolean;
  v_payload jsonb;
  v_snapshot jsonb;
  v_created integer:=0;
  v_published integer:=0;
  v_failed integer:=0;
begin
  if v_restaurant_id is null or v_account_id is null then raise exception 'authentication_required'; end if;
  if not (public.current_has_permission('orders') or public.current_has_permission('payments')
    or public.current_has_permission('kitchen') or public.current_has_permission('salon')) then
    raise exception 'printing_permission_denied';
  end if;
  select run.* into v_run from public.printing_flow_runs run
  where run.id=p_run_id and run.restaurant_id=v_restaurant_id for update;
  if not found then raise exception 'printing_flow_run_not_found'; end if;
  if v_run.state='materialized' or v_run.materialized_at is not null then
    return jsonb_build_object('run_id',p_run_id,'status','already_materialized');
  end if;
  select runtime.* into v_runtime from public.printing_flow_runtime runtime
  where runtime.flow_id=v_run.flow_id and runtime.restaurant_id=v_restaurant_id for update;
  if not found or v_runtime.motor_account_id is distinct from v_account_id
    or v_runtime.state not in ('noRunning','Running')
    or v_runtime.lease_until is null or v_runtime.lease_until<=clock_timestamp() then
    raise exception 'printing_flow_executor_not_owner';
  end if;
  for v_route in select value from jsonb_array_elements(v_run.route_plan) as item(value)
    order by coalesce((value->>'task_order')::integer,0),value->>'route_id'
  loop
    v_status:='failed'; v_error:=null; v_device:=null;
    v_job_device_id:=nullif(v_route->>'device_id','')::uuid;
    if coalesce(v_route->>'output_mode','manual')='manual' then
      v_error:='manual_printing_view_pending';
    elsif coalesce((v_route->>'point_is_active')::boolean,false)=false then
      v_error:='printing_point_inactive';
    elsif nullif(v_route->>'device_id','') is null then
      v_error:='printing_device_not_linked';
    else
      select device.* into v_device from public.printing_devices device
      where device.id=(v_route->>'device_id')::uuid and device.restaurant_id=v_restaurant_id;
      if not found then
        v_error:='printing_device_removed';
        v_job_device_id:=null;
      else
        select exists(select 1 from public.printing_jobs active_job where active_job.device_id=v_device.id
          and active_job.restaurant_id=v_restaurant_id and active_job.status='taken') into v_has_taken;
        if v_device.last_seen_at is not null and v_device.operation_mode<>'offline'
          and v_device.last_seen_at >= clock_timestamp() - (case
            when v_has_taken then interval '7 seconds'
            else interval '15 seconds'
          end) then
          v_status:='published';
        else
          v_error:='printing_device_inactive';
        end if;
      end if;
    end if;
    v_payload:=coalesce(v_run.event_payload,'{}'::jsonb);
    if v_route->>'data_object_key'='order' and v_payload ? 'order' then
      v_payload:=jsonb_strip_nulls(jsonb_build_object('schema_version',v_payload->'schema_version',
        'event_key',v_run.event_key,'occurred_at',v_payload->'occurred_at','order',v_payload->'order','items',v_payload->'items'));
    elsif v_route->>'data_object_key'='items' and v_payload ? 'order' then
      v_payload:=jsonb_strip_nulls(jsonb_build_object('schema_version',v_payload->'schema_version',
        'event_key',v_run.event_key,'occurred_at',v_payload->'occurred_at',
        'order',jsonb_build_object('id',v_payload#>'{order,id}','table_label',v_payload#>'{order,table_label}',
          'location',v_payload#>'{order,location}','operator',v_payload#>'{order,operator}',
          'status',v_payload#>'{order,status}','note',v_payload#>'{order,note}'),'items',v_payload->'items'));
    elsif v_route->>'data_object_key'='payment' and v_payload ? 'order' then
      v_payload:=jsonb_strip_nulls(jsonb_build_object('schema_version',v_payload->'schema_version',
        'event_key',v_run.event_key,'occurred_at',v_payload->'occurred_at',
        'order',jsonb_build_object('id',v_payload#>'{order,id}','paid_at',v_payload#>'{order,paid_at}',
          'operator',v_payload#>'{order,operator}','total',v_payload#>'{order,total}',
          'payment_amounts',v_payload#>'{order,payment_amounts}',
          'payment_method_keys',v_payload#>'{order,payment_method_keys}')));
    end if;
    v_snapshot:=jsonb_build_object('output_mode',v_route->>'output_mode','transport',v_route->'transport',
      'copies',coalesce((v_route->>'copies')::integer,1),'cadence_ms',coalesce((v_route->>'cadence_ms')::integer,0),
      'text_depth',coalesce(v_route->>'text_depth','standard'),'point_name',v_route->>'point_name',
      'device_model',v_route->>'device_model','template_name',v_route->>'template_name',
      'template',v_route->'template','data_object_key',v_route->>'data_object_key',
      'task_order',coalesce((v_route->>'task_order')::integer,0));
    insert into public.printing_jobs(
      restaurant_id,flow_id,route_id,point_id,template_id,event_key,event_id,flow_run_id,device_id,
      payload,route_snapshot,status,last_error,completed_at
    ) values (
      v_restaurant_id,v_run.flow_id,(v_route->>'route_id')::uuid,(v_route->>'point_id')::uuid,
      nullif(v_route->>'template_id','')::uuid,v_run.event_key,v_run.event_id,v_run.id,
      v_job_device_id,v_payload,v_snapshot,v_status,v_error,
      case when v_status='failed' then clock_timestamp() else null end
    ) on conflict(event_id,route_id) do nothing;
    if found then
      v_created:=v_created+1;
      if v_status='published' then v_published:=v_published+1; else v_failed:=v_failed+1; end if;
    end if;
  end loop;
  update public.printing_flow_runs run set state='materialized',materialized_at=clock_timestamp(),executor_account_id=v_account_id
  where run.id=v_run.id and run.restaurant_id=v_restaurant_id and run.state='queued';
  if not found then raise exception 'printing_flow_run_already_claimed'; end if;
  update public.printing_flow_runtime runtime set state='Running',lease_until=clock_timestamp()+interval '15 seconds',updated_at=clock_timestamp()
  where runtime.flow_id=v_run.flow_id and runtime.restaurant_id=v_restaurant_id and runtime.motor_account_id=v_account_id;
  return jsonb_build_object('run_id',p_run_id,'status','materialized','created',v_created,
    'published',v_published,'failed',v_failed);
end;
$$;
revoke all on function public.publish_printing_flow_run(uuid) from public,anon;
grant execute on function public.publish_printing_flow_run(uuid) to authenticated;

-- One client call returns statuses, completed reports, and runs for the current
-- motor; the browser does not start a second polling timer or read RPC.
create or replace function public.operate_printing_web_runtime()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_restaurant_id uuid:=public.current_restaurant_id();
  v_account_id uuid:=(select auth.uid());
begin
  v_result:=public.operate_printing_web();
  update public.printing_flow_runtime runtime
  set state=case when exists(select 1 from public.printing_flow_runs run where run.flow_id=runtime.flow_id
        and run.restaurant_id=v_restaurant_id and run.state='queued' and run.materialized_at is null)
      or exists(select 1 from public.printing_jobs job where job.flow_id=runtime.flow_id
        and job.restaurant_id=v_restaurant_id and job.status in ('published','taken'))
    then 'Running' else 'noRunning' end,
    updated_at=clock_timestamp()
  where runtime.restaurant_id=v_restaurant_id and runtime.motor_account_id=v_account_id
    and runtime.state in ('noRunning','Running') and runtime.lease_until>clock_timestamp();
  return v_result || jsonb_build_object(
    'flow_queue', coalesce((select jsonb_agg(jsonb_build_object(
      'run_id',run.id,'flow_id',run.flow_id,'flow_name',flow.name,'event_key',run.event_key,
      'created_at',run.created_at,
      'state',case when counts.taken_count>0 then 'processing' else run.state end,
      'published_count',counts.published_count,'taken_count',counts.taken_count,
      'jobs',(select coalesce(jsonb_agg(jsonb_build_object('id',job.id,'status',job.status,
        'point_name',job.route_snapshot->>'point_name','device_model',job.route_snapshot->>'device_model')
        order by job.created_at,job.task_order,job.id),'[]'::jsonb)
        from public.printing_jobs job where job.flow_run_id=run.id and job.restaurant_id=v_restaurant_id
          and job.status in ('published','taken'))
    ) order by run.created_at,run.id) from public.printing_flow_runs run
      join public.printing_flows flow on flow.id=run.flow_id and flow.restaurant_id=run.restaurant_id
      cross join lateral (select count(*) filter(where job.status='published')::integer as published_count,
        count(*) filter(where job.status='taken')::integer as taken_count
        from public.printing_jobs job where job.flow_run_id=run.id and job.restaurant_id=v_restaurant_id) counts
      where run.restaurant_id=v_restaurant_id and run.completed_at is null
        and (run.state='queued' or counts.published_count>0 or counts.taken_count>0)), '[]'::jsonb),
    'pending_flow_runs',coalesce((select jsonb_agg(jsonb_build_object('run_id',run.id,'flow_id',run.flow_id)
      order by run.created_at,run.id) from public.printing_flow_runs run
      join public.printing_flow_runtime runtime on runtime.flow_id=run.flow_id and runtime.restaurant_id=run.restaurant_id
      where run.restaurant_id=v_restaurant_id and run.state='queued' and run.materialized_at is null
        and runtime.motor_account_id=v_account_id and runtime.state in ('noRunning','Running')
        and runtime.lease_until>clock_timestamp() and not exists(select 1 from public.printing_jobs job where job.flow_run_id=run.id)), '[]'::jsonb),
    'flow_runtime',coalesce((select jsonb_agg(jsonb_build_object('flow_id',flow.id,'flow_name',flow.name,
      'state',runtime.state,'motor_account_id',runtime.motor_account_id,'motor_account_name',motor.display_name,
      'target_account_id',runtime.target_account_id,'target_account_name',target.display_name,
      'lease_until',runtime.lease_until,'updated_at',runtime.updated_at) order by flow.created_at,flow.id)
      from public.printing_flows flow join public.printing_flow_runtime runtime
        on runtime.flow_id=flow.id and runtime.restaurant_id=flow.restaurant_id
      left join public.accounts motor on motor.auth_user_id=runtime.motor_account_id and motor.restaurant_id=v_restaurant_id
      left join public.accounts target on target.auth_user_id=runtime.target_account_id and target.restaurant_id=v_restaurant_id
      where flow.restaurant_id=v_restaurant_id),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.operate_printing_web_runtime() from public,anon;
grant execute on function public.operate_printing_web_runtime() to authenticated;

-- Use the event/task snapshot captured at enqueue time. Route edits made after
-- the event must not change the task's selected data object or order.
create or replace function public.printing_jobs_apply_data_object()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_object_key text;
  v_task_order integer;
  v_route_object_key text;
  v_route_order integer;
  v_order jsonb;
begin
  select route.data_object_key,route.sort_order into v_route_object_key,v_route_order
  from public.printing_flow_routes route
  where route.id=new.route_id and route.restaurant_id=new.restaurant_id;
  v_object_key:=coalesce(nullif(new.route_snapshot->>'data_object_key',''),v_route_object_key,'event');
  v_task_order:=coalesce(nullif(new.route_snapshot->>'task_order','')::integer,v_route_order,0);
  new.task_order:=v_task_order;
  new.route_snapshot:=coalesce(new.route_snapshot,'{}'::jsonb)
    || jsonb_build_object('data_object_key',v_object_key,'task_order',v_task_order);
  v_order:=coalesce(new.payload->'order','{}'::jsonb);
  if v_object_key='items' and new.payload ? 'order' then
    new.payload:=jsonb_strip_nulls(jsonb_build_object('schema_version',new.payload->'schema_version',
      'event_key',new.event_key,'occurred_at',new.payload->'occurred_at',
      'order',jsonb_build_object('id',v_order->'id','table_label',v_order->'table_label',
        'location',v_order->'location','operator',v_order->'operator','status',v_order->'status','note',v_order->'note'),
      'items',new.payload->'items'));
  elsif v_object_key='payment' and new.payload ? 'order' then
    new.payload:=jsonb_strip_nulls(jsonb_build_object('schema_version',new.payload->'schema_version',
      'event_key',new.event_key,'occurred_at',new.payload->'occurred_at',
      'order',jsonb_build_object('id',v_order->'id','paid_at',v_order->'paid_at','operator',v_order->'operator',
        'total',v_order->'total','payment_amounts',v_order->'payment_amounts',
        'payment_method_keys',v_order->'payment_method_keys')));
  elsif v_object_key='order' and new.payload ? 'order' then
    new.payload:=jsonb_strip_nulls(jsonb_build_object('schema_version',new.payload->'schema_version',
      'event_key',new.event_key,'occurred_at',new.payload->'occurred_at',
      'order',new.payload->'order','items',new.payload->'items'));
  end if;
  return new;
end;
$$;
drop trigger if exists printing_jobs_apply_data_object on public.printing_jobs;
create trigger printing_jobs_apply_data_object before insert on public.printing_jobs
for each row execute function public.printing_jobs_apply_data_object();

-- Printer batch operations update derived motor state in the same transaction
-- as job status changes, without adding another heartbeat query.
create or replace function public.refresh_printing_flow_runtime_after_jobs()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.printing_flow_runtime runtime
  set state=case when exists(select 1 from public.printing_flow_runs run
        where run.flow_id=runtime.flow_id and run.restaurant_id=runtime.restaurant_id
          and run.state='queued' and run.materialized_at is null)
      or exists(select 1 from public.printing_jobs job where job.flow_id=runtime.flow_id
        and job.restaurant_id=runtime.restaurant_id and job.status in ('published','taken'))
      then 'Running' else 'noRunning' end,
    updated_at=clock_timestamp()
  from (select distinct new_jobs.flow_id,new_jobs.restaurant_id from new_jobs) changed
  where runtime.flow_id=changed.flow_id and runtime.restaurant_id=changed.restaurant_id
    and runtime.motor_account_id is not null and runtime.lease_until>clock_timestamp()
    and runtime.state in ('noRunning','Running');
  return null;
end;
$$;
revoke all on function public.refresh_printing_flow_runtime_after_jobs() from public,anon,authenticated;
drop trigger if exists printing_jobs_refresh_flow_runtime_insert on public.printing_jobs;
create trigger printing_jobs_refresh_flow_runtime_insert after insert on public.printing_jobs
referencing new table as new_jobs for each statement
execute function public.refresh_printing_flow_runtime_after_jobs();
drop trigger if exists printing_jobs_refresh_flow_runtime_update on public.printing_jobs;
create trigger printing_jobs_refresh_flow_runtime_update after update on public.printing_jobs
referencing new table as new_jobs for each statement
execute function public.refresh_printing_flow_runtime_after_jobs();

-- A queued event is durable work too: prevent deleting a flow until it has
-- materialized and its resulting print report has been acknowledged.
create or replace function public.delete_printing_flow(p_flow_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_restaurant_id uuid:=public.current_restaurant_id();
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if public.current_role_key() is distinct from 'admin' then raise exception 'admin_required'; end if;
  perform 1 from public.printing_flows flow where flow.id=p_flow_id
    and flow.restaurant_id=v_restaurant_id for update;
  if not found then raise exception 'flow_not_found'; end if;
  if exists(select 1 from public.printing_flow_runs run where run.flow_id=p_flow_id
      and run.restaurant_id=v_restaurant_id and run.state='queued' and run.materialized_at is null)
    or exists(select 1 from public.printing_jobs job where job.flow_id=p_flow_id
      and job.restaurant_id=v_restaurant_id and job.status in ('published','taken'))
    or exists(select 1 from public.printing_flow_runs run where run.flow_id=p_flow_id
      and run.restaurant_id=v_restaurant_id and run.completed_at is not null and run.acknowledged_at is null)
  then raise exception 'printing_flow_has_pending_jobs'; end if;
  delete from public.printing_flows flow where flow.id=p_flow_id and flow.restaurant_id=v_restaurant_id;
end;
$$;
revoke all on function public.delete_printing_flow(uuid) from public,anon;
grant execute on function public.delete_printing_flow(uuid) to authenticated;

-- Reset the elected motor atomically whenever an administrator changes the
-- flow's active state, captured events, or backup-account order.
create or replace function public.reset_printing_flow_runtime_after_config()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.printing_flow_runtime runtime
  set state='inactive',
    motor_account_id=null,target_account_id=null,backup_position=0,
    search_started_at=null,lease_until=null,updated_at=clock_timestamp()
  where runtime.flow_id=new.id and runtime.restaurant_id=new.restaurant_id;
  return new;
end;
$$;
revoke all on function public.reset_printing_flow_runtime_after_config() from public,anon,authenticated;
drop trigger if exists printing_flows_reset_runtime_after_config on public.printing_flows;
create trigger printing_flows_reset_runtime_after_config
after update on public.printing_flows
for each row when (
  old.is_active is distinct from new.is_active
  or old.captured_events is distinct from new.captured_events
  or old.engine_account_order is distinct from new.engine_account_order
)
execute function public.reset_printing_flow_runtime_after_config();
