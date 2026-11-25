-- Ticket-format canvas assets use a private, restaurant-scoped Storage bucket.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-assets', 'ticket-assets', false, 5242880,
  array['image/png']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ticket assets read restaurant" on storage.objects;
create policy "ticket assets read restaurant" on storage.objects
for select to authenticated
using (
  bucket_id = 'ticket-assets'
  and (storage.foldername(name))[1] = (select public.current_restaurant_id())::text
);

drop policy if exists "ticket assets insert admin" on storage.objects;
create policy "ticket assets insert admin" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'ticket-assets'
  and (storage.foldername(name))[1] = (select public.current_restaurant_id())::text
  and (select public.current_role_key()) = 'admin'
);

drop policy if exists "ticket assets delete admin" on storage.objects;
create policy "ticket assets delete admin" on storage.objects
for delete to authenticated
using (
  bucket_id = 'ticket-assets'
  and (storage.foldername(name))[1] = (select public.current_restaurant_id())::text
  and (select public.current_role_key()) = 'admin'
);

-- A format can be removed only after it has been unlinked from every flow.
-- Historical jobs retain their immutable route_snapshot; their FK is cleared.
create or replace function public.delete_printing_ticket_template(p_template_id uuid)
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

  perform 1
  from public.printing_ticket_templates as template
  where template.id = p_template_id
    and template.restaurant_id = v_restaurant_id
  for update;
  if not found then raise exception 'ticket_template_not_found'; end if;

  if exists (
    select 1
    from public.printing_flow_routes as route
    where route.template_id = p_template_id
      and route.restaurant_id = v_restaurant_id
      and cardinality(route.event_keys) > 0
  ) then
    raise exception 'ticket_template_linked';
  end if;

  update public.printing_flow_routes as route
  set template_id = null
  where route.template_id = p_template_id
    and route.restaurant_id = v_restaurant_id
    and cardinality(route.event_keys) = 0;

  update public.printing_jobs as job
  set template_id = null
  where job.template_id = p_template_id
    and job.restaurant_id = v_restaurant_id;

  delete from public.printing_ticket_templates as template
  where template.id = p_template_id
    and template.restaurant_id = v_restaurant_id;
  if not found then raise exception 'ticket_template_not_found'; end if;
end;
$$;
revoke all on function public.delete_printing_ticket_template(uuid) from public, anon;
grant execute on function public.delete_printing_ticket_template(uuid) to authenticated;

-- Existing jobs carry a template snapshot; format availability is not an active toggle.
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
  if public.current_role_key() <> 'admin' then raise exception 'admin_required'; end if;
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
  return v_flow_id;
end;
$$;
revoke all on function public.save_printing_flow(uuid, text, text[], boolean, jsonb) from public, anon;
grant execute on function public.save_printing_flow(uuid, text, text[], boolean, jsonb) to authenticated;
