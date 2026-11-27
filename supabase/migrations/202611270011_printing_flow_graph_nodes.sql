-- Persist the visual editor graph, including unfinished node drafts. Only the
-- complete nodes/routes sent separately are registered as live event routes.
alter table public.printing_flows
  add column if not exists editor_nodes jsonb not null default '[]'::jsonb;

alter table public.printing_flows
  drop constraint if exists printing_flows_editor_nodes_array_check;
alter table public.printing_flows
  add constraint printing_flows_editor_nodes_array_check
  check (jsonb_typeof(editor_nodes) = 'array');

alter table public.printing_flow_routes
  drop constraint if exists printing_flow_routes_data_object_key_check;
alter table public.printing_flow_routes
  add constraint printing_flow_routes_data_object_key_check
  check (data_object_key in ('event','order','items','payment','open_order','paid_order'));

create or replace function public.save_printing_flow_editor_graph(
  p_flow_id uuid,
  p_name text,
  p_captured_events text[],
  p_is_active boolean,
  p_routes jsonb,
  p_engine_account_order uuid[],
  p_editor_nodes jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_flow_id uuid;
  v_node jsonb;
  v_route jsonb;
  v_event text;
  v_object_key text;
  v_allowed boolean;
  v_mapped_routes jsonb;
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if public.current_role_key() is distinct from 'admin' then raise exception 'admin_required'; end if;
  if jsonb_typeof(coalesce(p_editor_nodes, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_printing_flow_nodes';
  end if;
  if jsonb_typeof(coalesce(p_routes, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_flow_routes';
  end if;

  for v_node in select value from jsonb_array_elements(coalesce(p_editor_nodes, '[]'::jsonb)) as nodes(value)
  loop
    v_event := coalesce(v_node->>'event_key', v_node->>'key', '');
    if jsonb_typeof(v_node) <> 'object'
      or v_event not in ('open_order_created','open_order_updated','paid_order_created',
        'payment_corrected','kitchen_order_ready','salon_order_delivered','manual_reprint')
      or jsonb_typeof(coalesce(v_node->'tasks', '[]'::jsonb)) <> 'array' then
      raise exception 'invalid_printing_flow_nodes';
    end if;
  end loop;

  if exists (
    select node_row.value->>'event_key'
    from jsonb_array_elements(coalesce(p_editor_nodes, '[]'::jsonb)) as node_row(value)
    group by node_row.value->>'event_key' having count(*) > 1
  ) then raise exception 'duplicate_printing_flow_event_node'; end if;

  for v_route in select value from jsonb_array_elements(coalesce(p_routes, '[]'::jsonb)) as routes(value)
  loop
    if jsonb_typeof(v_route) <> 'object' then raise exception 'invalid_flow_route'; end if;
    if jsonb_typeof(coalesce(v_route->'event_keys', '[]'::jsonb)) <> 'array' then
      raise exception 'invalid_flow_route';
    end if;
    if jsonb_array_length(coalesce(v_route->'event_keys', '[]'::jsonb)) <> 1 then
      raise exception 'invalid_flow_route';
    end if;
    v_event := (v_route->'event_keys')->>0;
    v_object_key := coalesce(nullif(v_route->>'data_object_key', ''), '');
    v_allowed := case v_event
      when 'open_order_created' then v_object_key = 'open_order'
      when 'open_order_updated' then v_object_key = 'open_order'
      when 'paid_order_created' then v_object_key in ('paid_order','open_order')
      when 'payment_corrected' then v_object_key in ('paid_order','payment')
      when 'kitchen_order_ready' then v_object_key in ('items','event')
      when 'salon_order_delivered' then v_object_key in ('items','event')
      when 'manual_reprint' then v_object_key = 'paid_order'
      else false
    end;
    if not v_allowed then raise exception 'event_data_object_unavailable'; end if;
  end loop;

  -- The existing validator accepts only the original four selector values.
  -- Persist each new explicit selector after that validated save succeeds.
  select coalesce(jsonb_agg(
    case when route.value ? 'data_object_key'
      then jsonb_set(route.value, '{data_object_key}', '"event"'::jsonb, true)
      else route.value end
    order by route.ordinality
  ), '[]'::jsonb)
  into v_mapped_routes
  from jsonb_array_elements(coalesce(p_routes, '[]'::jsonb)) with ordinality as route(value, ordinality);

  v_flow_id := public.save_printing_flow_editor(
    p_flow_id, p_name, p_captured_events, p_is_active, v_mapped_routes, p_engine_account_order
  );

  for v_route in select value from jsonb_array_elements(coalesce(p_routes, '[]'::jsonb)) as routes(value)
  loop
    v_object_key := v_route->>'data_object_key';
    update public.printing_flow_routes as route
    set data_object_key = v_object_key
    where route.restaurant_id = v_restaurant_id and route.flow_id = v_flow_id
      and route.sort_order = coalesce((v_route->>'sort_order')::integer, 0)
      and route.point_id = nullif(v_route->>'point_id', '')::uuid
      and route.event_keys = array(select jsonb_array_elements_text(coalesce(v_route->'event_keys', '[]'::jsonb)))
      and route.template_id is not distinct from nullif(v_route->>'template_id', '')::uuid;
    if not found then raise exception 'flow_route_not_found'; end if;
  end loop;

  update public.printing_flows flow
  set editor_nodes = coalesce(p_editor_nodes, '[]'::jsonb), updated_at = clock_timestamp()
  where flow.id = v_flow_id and flow.restaurant_id = v_restaurant_id;
  return v_flow_id;
end;
$$;
revoke all on function public.save_printing_flow_editor_graph(uuid,text,text[],boolean,jsonb,uuid[],jsonb)
  from public, anon;
grant execute on function public.save_printing_flow_editor_graph(uuid,text,text[],boolean,jsonb,uuid[],jsonb)
  to authenticated;

-- Select the explicit event object into a stable renderer payload. If an
-- optional source object (e.g. an open order before payment) was not included,
-- fail this one job with a clear reason instead of silently printing another.
create or replace function public.printing_jobs_apply_data_object()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_object_key text;
  v_task_order integer;
  v_route_object_key text;
  v_route_order integer;
  v_order jsonb;
  v_selected_object jsonb;
begin
  select route.data_object_key, route.sort_order
  into v_route_object_key, v_route_order
  from public.printing_flow_routes route
  where route.id = new.route_id and route.restaurant_id = new.restaurant_id;

  v_object_key := coalesce(nullif(new.route_snapshot->>'data_object_key', ''), v_route_object_key, 'event');
  v_task_order := coalesce(nullif(new.route_snapshot->>'task_order', '')::integer, v_route_order, 0);
  new.task_order := v_task_order;
  new.route_snapshot := coalesce(new.route_snapshot, '{}'::jsonb)
    || jsonb_build_object('data_object_key', v_object_key, 'task_order', v_task_order);
  v_order := coalesce(new.payload->'order', '{}'::jsonb);

  if v_object_key in ('open_order', 'paid_order') then
    v_selected_object := new.payload->v_object_key;
    if jsonb_typeof(v_selected_object) is distinct from 'object' then
      if new.status = 'published' then
        new.status := 'failed';
        new.last_error := 'printing_data_object_unavailable';
        new.completed_at := clock_timestamp();
      end if;
      return new;
    end if;
    new.payload := jsonb_strip_nulls(jsonb_build_object(
      'schema_version', new.payload->'schema_version',
      'event_key', new.event_key,
      'occurred_at', new.payload->'occurred_at',
      'order', v_selected_object - 'items',
      'items', v_selected_object->'items'
    ));
  elsif v_object_key = 'items' and new.payload ? 'order' then
    new.payload := jsonb_strip_nulls(jsonb_build_object(
      'schema_version', new.payload->'schema_version', 'event_key', new.event_key,
      'occurred_at', new.payload->'occurred_at',
      'order', jsonb_build_object('id',v_order->'id','table_label',v_order->'table_label',
        'location',v_order->'location','operator',v_order->'operator','status',v_order->'status','note',v_order->'note'),
      'items', new.payload->'items'));
  elsif v_object_key = 'payment' and new.payload ? 'order' then
    new.payload := jsonb_strip_nulls(jsonb_build_object(
      'schema_version', new.payload->'schema_version', 'event_key', new.event_key,
      'occurred_at', new.payload->'occurred_at',
      'order', jsonb_build_object('id',v_order->'id','paid_at',v_order->'paid_at','operator',v_order->'operator',
        'total',v_order->'total','payment_amounts',v_order->'payment_amounts',
        'payment_method_keys',v_order->'payment_method_keys')));
  elsif v_object_key = 'order' and new.payload ? 'order' then
    new.payload := jsonb_strip_nulls(jsonb_build_object(
      'schema_version', new.payload->'schema_version', 'event_key', new.event_key,
      'occurred_at', new.payload->'occurred_at', 'order', new.payload->'order', 'items', new.payload->'items'));
  end if;
  return new;
end;
$$;
