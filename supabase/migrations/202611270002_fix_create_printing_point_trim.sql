-- PostgreSQL's TRIM syntax is implemented by btrim(); it cannot be called as
-- pg_catalog.trim(text). Keep the function's validation and tenant checks, but
-- use the qualified built-in function under the empty search_path.
create or replace function public.create_printing_point(
  p_name text,
  p_device_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_device_restaurant_id uuid;
  v_point_id uuid;
begin
  if v_restaurant_id is null then
    raise exception 'authentication_required';
  end if;
  if public.current_role_key() <> 'admin' then
    raise exception 'admin_required';
  end if;
  if coalesce(pg_catalog.length(pg_catalog.btrim(p_name)), 0) not between 1 and 80 then
    raise exception 'invalid_printing_point_name';
  end if;
  if p_device_id is null then
    raise exception 'printing_device_required';
  end if;

  select device.restaurant_id
    into v_device_restaurant_id
  from public.printing_devices as device
  where device.id = p_device_id
  for update;

  if not found or v_device_restaurant_id is distinct from v_restaurant_id then
    raise exception 'printing_device_not_in_restaurant';
  end if;

  if exists (
    select 1
    from public.printing_points as point
    where point.device_id = p_device_id
  ) then
    raise exception 'printing_device_already_linked';
  end if;

  insert into public.printing_points (
    restaurant_id,
    name,
    is_active,
    sunat_enabled,
    supported_output_modes,
    output_mode,
    transport,
    connection_config,
    sunat_config,
    device_id
  ) values (
    v_restaurant_id,
    pg_catalog.btrim(p_name),
    true,
    false,
    array['automatic']::text[],
    'automatic',
    'local_agent',
    '{}'::jsonb,
    '{}'::jsonb,
    p_device_id
  )
  returning id into v_point_id;

  return v_point_id;
end;
$$;

revoke all on function public.create_printing_point(text, uuid) from public, anon;
grant execute on function public.create_printing_point(text, uuid) to authenticated;
