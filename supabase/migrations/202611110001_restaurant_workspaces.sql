-- Restaurant-scoped floor maps and preparation/service queues.
alter table public.restaurants
  add column if not exists kitchen_has_separate_bar boolean not null default false,
  add column if not exists kitchen_entry_mode text not null default 'paid'
    check (kitchen_entry_mode in ('open','paid')),
  add column if not exists salon_entry_mode text not null default 'paid'
    check (salon_entry_mode in ('open','paid')),
  add column if not exists delivery_kitchen_after_virtual_payment boolean not null default false,
  add column if not exists salon_waiter_map_edit boolean not null default false,
  add column if not exists salon_host_map_edit boolean not null default false,
  add column if not exists salon_show_seats boolean not null default false;

create table if not exists public.salon_floors (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  grid_rows smallint not null default 8 check (grid_rows between 3 and 30),
  grid_columns smallint not null default 8 check (grid_columns between 3 and 30),
  row_sizes jsonb not null default '[1,1,1,1,1,1,1,1]'::jsonb check (jsonb_typeof(row_sizes)='array'),
  column_sizes jsonb not null default '[1,1,1,1,1,1,1,1]'::jsonb check (jsonb_typeof(column_sizes)='array'),
  seat_count smallint check (seat_count is null or seat_count between 0 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  unique (restaurant_id, name)
);

create table if not exists public.salon_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  floor_id uuid not null,
  table_number smallint not null check (table_number between 1 and 100),
  grid_row smallint not null check (grid_row >= 0),
  grid_column smallint not null check (grid_column >= 0),
  row_span smallint not null default 1 check (row_span between 1 and 10),
  column_span smallint not null default 1 check (column_span between 1 and 10),
  fusion_group_id uuid,
  status text not null default 'free' check (status in ('free','occupied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  unique (restaurant_id, table_number),
  foreign key (floor_id, restaurant_id) references public.salon_floors(id, restaurant_id) on delete cascade
);

create table if not exists public.kitchen_queue_entries (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  source_order_id uuid not null,
  source_order_kind text not null check (source_order_kind in ('open','paid')),
  location_id uuid,
  table_id uuid,
  table_label text,
  order_note text not null default '',
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  status text not null default 'queued' check (status in ('queued','completed','cancelled')),
  queued_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (restaurant_id, source_order_id, source_order_kind),
  unique (id, restaurant_id),
  foreign key (location_id, restaurant_id) references public.locations(id, restaurant_id) on delete set null (location_id),
  foreign key (table_id, restaurant_id) references public.salon_tables(id, restaurant_id) on delete set null (table_id)
);

create table if not exists public.kitchen_queue_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  queue_entry_id uuid not null,
  item_index integer,
  unit_index integer,
  action text not null check (action in ('order_ready','item_ready','unit_ready','item_out_of_stock','unit_out_of_stock')),
  actor_id uuid not null default auth.uid(),
  happened_at timestamptz not null default now(),
  foreign key (queue_entry_id, restaurant_id) references public.kitchen_queue_entries(id, restaurant_id) on delete cascade
);

create table if not exists public.salon_service_entries (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  kitchen_entry_id uuid,
  source_order_id uuid not null,
  source_order_kind text not null check (source_order_kind in ('open','paid')),
  location_id uuid,
  table_id uuid,
  table_label text,
  order_note text not null default '',
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  status text not null default 'ready' check (status in ('ready','delivered','cancelled')),
  queued_at timestamptz not null default now(),
  delivered_at timestamptz,
  delivered_by uuid,
  unique (restaurant_id, source_order_id, source_order_kind),
  unique (id, restaurant_id),
  foreign key (kitchen_entry_id, restaurant_id) references public.kitchen_queue_entries(id, restaurant_id) on delete set null (kitchen_entry_id),
  foreign key (location_id, restaurant_id) references public.locations(id, restaurant_id) on delete set null (location_id),
  foreign key (table_id, restaurant_id) references public.salon_tables(id, restaurant_id) on delete set null (table_id)
);

create index if not exists salon_tables_floor_position_idx on public.salon_tables(floor_id, grid_row, grid_column);
create index if not exists kitchen_queue_active_idx on public.kitchen_queue_entries(restaurant_id, queued_at) where status = 'queued';
create index if not exists salon_service_active_idx on public.salon_service_entries(restaurant_id, queued_at) where status = 'ready';
create index if not exists kitchen_events_entry_idx on public.kitchen_queue_events(queue_entry_id, happened_at);

alter table public.salon_floors enable row level security;
alter table public.salon_tables enable row level security;
alter table public.kitchen_queue_entries enable row level security;
alter table public.kitchen_queue_events enable row level security;
alter table public.salon_service_entries enable row level security;

create or replace function public.workspace_has_need(p_need text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_need = any(r.needs), false)
  from public.restaurants r where r.id = public.current_restaurant_id();
$$;

create or replace function public.workspace_can_edit_salon_map()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_role_key() = 'admin' or (
    public.current_role_key() = 'employee' and exists (
      select 1 from public.restaurants r where r.id = public.current_restaurant_id()
        and (r.salon_waiter_map_edit or r.salon_host_map_edit)
    )
  );
$$;

create policy salon_floors_read on public.salon_floors for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) and (select public.workspace_has_need('salon')));
create policy salon_tables_read on public.salon_tables for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) and (select public.workspace_has_need('salon')));

create policy kitchen_queue_read on public.kitchen_queue_entries for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) and (select public.workspace_has_need('kitchen')));
create policy kitchen_events_read on public.kitchen_queue_events for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) and (select public.workspace_has_need('kitchen')));
create policy salon_queue_read on public.salon_service_entries for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) and (select public.workspace_has_need('salon')));
grant select on public.salon_floors, public.salon_tables to authenticated;
grant select on public.kitchen_queue_entries, public.kitchen_queue_events, public.salon_service_entries to authenticated;

create or replace function public.workspace_assert_actor(p_need text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare rid uuid := public.current_restaurant_id();
begin
  if rid is null or not public.workspace_has_need(p_need) then raise exception 'workspace_not_enabled'; end if;
  if public.current_role_key() not in ('admin','employee') then raise exception 'workspace_permission_denied'; end if;
  return rid;
end;
$$;

create or replace function public.workspace_enqueue_order(
  p_destination text,
  p_source_order_id uuid,
  p_source_order_kind text,
  p_location_id uuid,
  p_table_id uuid,
  p_table_label text,
  p_order_note text,
  p_items jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare rid uuid; entry_id uuid; item jsonb; normalized jsonb := '[]'::jsonb;
begin
  if p_destination not in ('kitchen','salon') or p_source_order_kind not in ('open','paid') or jsonb_typeof(p_items) <> 'array' then
    raise exception 'workspace_order_payload_invalid';
  end if;
  rid := public.workspace_assert_actor(p_destination);
  if p_source_order_id is null then raise exception 'workspace_source_order_required'; end if;
  if p_source_order_kind = 'open' then
    if not exists (
      select 1 from public.open_orders o join public.locations l on l.id=o.location_id
      where o.id=p_source_order_id and o.status='open' and l.restaurant_id=rid
    ) then raise exception 'workspace_open_order_not_found'; end if;
  else
    if not exists (
      select 1 from public.orders o join public.locations l on l.id=o.location_id
      where o.id=p_source_order_id and o.status='correct' and l.restaurant_id=rid
    ) then raise exception 'workspace_paid_order_not_found'; end if;
  end if;
  if p_location_id is not null and not exists(select 1 from public.locations l where l.id=p_location_id and l.restaurant_id=rid) then
    raise exception 'workspace_location_invalid';
  end if;
  if p_table_id is not null and (not public.workspace_has_need('salon') or not exists(select 1 from public.salon_tables t where t.id=p_table_id and t.restaurant_id=rid)) then raise exception 'workspace_table_invalid'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    normalized := normalized || jsonb_build_array(jsonb_build_object(
      'product_id', nullif(item->>'product_id',''),
      'name', coalesce(item->>'product_name', item->>'name', item->>'concept', 'Producto'),
      'variant_name', coalesce(item->>'variant_name',''),
      'quantity', greatest(1, least(99, coalesce(nullif(item->>'quantity','')::integer, nullif(item->>'qty','')::integer, 1))),
      'unit_price', coalesce(nullif(item->>'unit_price','')::numeric, nullif(item->>'price','')::numeric, 0),
      'addons', coalesce(item->'addons','[]'::jsonb),
      'units', (select jsonb_agg(jsonb_build_object('status','pending')) from generate_series(1, greatest(1, least(99, coalesce(nullif(item->>'quantity','')::integer, nullif(item->>'qty','')::integer, 1)))))
    ));
  end loop;
  if p_destination = 'kitchen' then
    insert into public.kitchen_queue_entries(restaurant_id,source_order_id,source_order_kind,location_id,table_id,table_label,order_note,items)
    values(rid,p_source_order_id,p_source_order_kind,p_location_id,p_table_id,p_table_label,coalesce(p_order_note,''),normalized)
    on conflict(restaurant_id,source_order_id,source_order_kind) do update set
      location_id=excluded.location_id, table_id=coalesce(excluded.table_id,public.kitchen_queue_entries.table_id), table_label=coalesce(excluded.table_label,public.kitchen_queue_entries.table_label), order_note=excluded.order_note,
      items=case when not exists(select 1 from public.kitchen_queue_events e where e.queue_entry_id=public.kitchen_queue_entries.id) and public.kitchen_queue_entries.status='queued' then excluded.items else public.kitchen_queue_entries.items end
    returning id into entry_id;
  else
    insert into public.salon_service_entries(restaurant_id,source_order_id,source_order_kind,location_id,table_id,table_label,order_note,items)
    values(rid,p_source_order_id,p_source_order_kind,p_location_id,p_table_id,p_table_label,coalesce(p_order_note,''),normalized)
    on conflict(restaurant_id,source_order_id,source_order_kind) do nothing
    returning id into entry_id;
    if entry_id is null then select id into entry_id from public.salon_service_entries where restaurant_id=rid and source_order_id=p_source_order_id and source_order_kind=p_source_order_kind; end if;
  end if;
  if p_table_id is not null then update public.salon_tables set status='occupied',updated_at=now() where id=p_table_id and restaurant_id=rid; end if;
  return entry_id;
end;
$$;

create or replace function public.kitchen_set_progress(p_entry_id uuid, p_action text, p_item_index integer default null, p_unit_index integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rid uuid; entry public.kitchen_queue_entries%rowtype; item jsonb; units jsonb; unit jsonb; i integer; u integer; now_at timestamptz := now(); complete boolean := true; salon_id uuid;
begin
  rid := public.workspace_assert_actor('kitchen');
  if p_action not in ('order_ready','item_ready','unit_ready','item_out_of_stock','unit_out_of_stock') then raise exception 'kitchen_action_invalid'; end if;
  select * into entry from public.kitchen_queue_entries where id=p_entry_id and restaurant_id=rid for update;
  if not found or entry.status <> 'queued' then raise exception 'kitchen_entry_not_active'; end if;
  if p_action='order_ready' then
    for i in 0..jsonb_array_length(entry.items)-1 loop
      item := entry.items->i; units := item->'units';
      for u in 0..jsonb_array_length(units)-1 loop
        unit := units->u;
        if unit->>'status'='pending' then units := jsonb_set(units, array[u::text], jsonb_build_object('status','ready','changed_at',now_at), false); end if;
      end loop;
      entry.items := jsonb_set(entry.items, array[i::text,'units'], units, false);
    end loop;
  elsif p_action in ('item_ready','item_out_of_stock') then
    if p_item_index is null or p_item_index<0 or p_item_index>=jsonb_array_length(entry.items) then raise exception 'kitchen_item_index_invalid'; end if;
    item := entry.items->p_item_index; units := item->'units';
    for u in 0..jsonb_array_length(units)-1 loop
      unit := units->u;
      if unit->>'status'='pending' then units := jsonb_set(units, array[u::text], jsonb_build_object('status',case when p_action='item_ready' then 'ready' else 'out_of_stock' end,'changed_at',now_at), false); end if;
    end loop;
    entry.items := jsonb_set(entry.items, array[p_item_index::text,'units'], units, false);
  else
    if p_item_index is null or p_unit_index is null or p_item_index<0 or p_item_index>=jsonb_array_length(entry.items) then raise exception 'kitchen_unit_index_invalid'; end if;
    item := entry.items->p_item_index; units := item->'units';
    if p_unit_index<0 or p_unit_index>=jsonb_array_length(units) or units->p_unit_index->>'status' <> 'pending' then raise exception 'kitchen_unit_not_pending'; end if;
    units := jsonb_set(units, array[p_unit_index::text], jsonb_build_object('status',case when p_action='unit_ready' then 'ready' else 'out_of_stock' end,'changed_at',now_at), false);
    entry.items := jsonb_set(entry.items, array[p_item_index::text,'units'], units, false);
  end if;
  for i in 0..jsonb_array_length(entry.items)-1 loop
    item := entry.items->i; units := item->'units';
    for u in 0..jsonb_array_length(units)-1 loop if units->u->>'status'='pending' then complete := false; end if; end loop;
  end loop;
  update public.kitchen_queue_entries set items=entry.items,status=case when complete then 'completed' else 'queued' end,completed_at=case when complete then now_at else null end,updated_at=now_at where id=p_entry_id;
  insert into public.kitchen_queue_events(restaurant_id,queue_entry_id,item_index,unit_index,action) values(rid,p_entry_id,p_item_index,p_unit_index,p_action);
  if complete and public.workspace_has_need('salon') then
    insert into public.salon_service_entries(restaurant_id,kitchen_entry_id,source_order_id,source_order_kind,location_id,table_id,table_label,order_note,items)
    values(rid,p_entry_id,entry.source_order_id,entry.source_order_kind,entry.location_id,entry.table_id,entry.table_label,entry.order_note,entry.items)
    on conflict(restaurant_id,source_order_id,source_order_kind) do update set items=excluded.items,status=case when public.salon_service_entries.status='delivered' then 'delivered' else 'ready' end;
  end if;
  return jsonb_build_object('status',case when complete then 'completed' else 'queued' end,'completed_at',case when complete then now_at else null end);
end;
$$;

create or replace function public.salon_mark_delivered(p_entry_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare rid uuid; done_at timestamptz := now();
begin
  rid := public.workspace_assert_actor('salon');
  update public.salon_service_entries set status='delivered',delivered_at=done_at,delivered_by=auth.uid()
  where id=p_entry_id and restaurant_id=rid and status='ready';
  if not found then raise exception 'salon_entry_not_ready'; end if;
  update public.salon_tables t set status='free',updated_at=done_at
    where t.restaurant_id=rid and t.id=(select table_id from public.salon_service_entries where id=p_entry_id)
      and not exists(select 1 from public.salon_service_entries s where s.table_id=t.id and s.restaurant_id=rid and s.status='ready')
      and not exists(select 1 from public.kitchen_queue_entries k where k.table_id=t.id and k.restaurant_id=rid and k.status='queued');
  return done_at;
end;
$$;

create or replace function public.workspace_cancel_order(p_source_order_id uuid,p_source_order_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare rid uuid := public.current_restaurant_id(); target_table uuid;
begin
  if rid is null or p_source_order_kind not in ('open','paid') then raise exception 'workspace_order_reference_invalid'; end if;
  select coalesce(
    (select k.table_id from public.kitchen_queue_entries k where k.restaurant_id=rid and k.source_order_id=p_source_order_id and k.source_order_kind=p_source_order_kind limit 1),
    (select s.table_id from public.salon_service_entries s where s.restaurant_id=rid and s.source_order_id=p_source_order_id and s.source_order_kind=p_source_order_kind limit 1)
  ) into target_table;
  if public.workspace_has_need('kitchen') and public.current_role_key() in ('admin','employee') then
    update public.kitchen_queue_entries set status='cancelled',updated_at=now() where restaurant_id=rid and source_order_id=p_source_order_id and source_order_kind=p_source_order_kind and status='queued';
  end if;
  if public.workspace_has_need('salon') and public.current_role_key() in ('admin','employee') then
    update public.salon_service_entries set status='cancelled' where restaurant_id=rid and source_order_id=p_source_order_id and source_order_kind=p_source_order_kind and status='ready';
  end if;
  update public.salon_tables t set status='free',updated_at=now() where t.restaurant_id=rid and t.id=target_table and t.status='occupied'
    and not exists(select 1 from public.salon_service_entries s where s.table_id=t.id and s.restaurant_id=rid and s.status='ready')
    and not exists(select 1 from public.kitchen_queue_entries k where k.table_id=t.id and k.restaurant_id=rid and k.status='queued');
end;
$$;

create or replace function public.salon_create_floor(p_name text, p_rows integer default 8, p_columns integer default 8)
returns uuid language plpgsql security definer set search_path = '' as $$
declare rid uuid; floor_id uuid; row_sizes jsonb; column_sizes jsonb;
begin
  rid := public.workspace_assert_actor('salon');
  if not public.workspace_can_edit_salon_map() then raise exception 'salon_map_permission_denied'; end if;
  if nullif(trim(p_name),'') is null or p_rows not between 3 and 30 or p_columns not between 3 and 30 then raise exception 'salon_floor_invalid'; end if;
  select jsonb_agg(1) into row_sizes from generate_series(1,p_rows);
  select jsonb_agg(1) into column_sizes from generate_series(1,p_columns);
  insert into public.salon_floors(restaurant_id,name,sort_order,grid_rows,grid_columns,row_sizes,column_sizes)
  values(rid,trim(p_name),(select coalesce(max(sort_order),-1)+1 from public.salon_floors where restaurant_id=rid),p_rows,p_columns,row_sizes,column_sizes)
  returning id into floor_id;
  return floor_id;
end;
$$;

create or replace function public.salon_create_table(p_floor_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare rid uuid; f public.salon_floors%rowtype; n integer; r integer; c integer; table_id uuid;
begin
  rid := public.workspace_assert_actor('salon');
  if not public.workspace_can_edit_salon_map() then raise exception 'salon_map_permission_denied'; end if;
  select * into f from public.salon_floors where id=p_floor_id and restaurant_id=rid for update;
  if not found then raise exception 'salon_floor_not_found'; end if;
  select coalesce(min(candidate),101) into n from generate_series(1,100) candidate where not exists(select 1 from public.salon_tables t where t.restaurant_id=rid and t.table_number=candidate);
  if n>100 then raise exception 'salon_table_limit_reached'; end if;
  for r in 0..f.grid_rows-1 loop
    for c in 0..f.grid_columns-1 loop
      if not exists(select 1 from public.salon_tables t where t.floor_id=f.id and r>=t.grid_row and r<t.grid_row+t.row_span and c>=t.grid_column and c<t.grid_column+t.column_span) then
        insert into public.salon_tables(restaurant_id,floor_id,table_number,grid_row,grid_column) values(rid,f.id,n,r,c) returning id into table_id;
        return table_id;
      end if;
    end loop;
  end loop;
  raise exception 'salon_floor_grid_full';
end;
$$;

create or replace function public.salon_update_floor(p_floor_id uuid,p_rows integer,p_columns integer,p_seat_count integer,p_row_sizes jsonb,p_column_sizes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  rid := public.workspace_assert_actor('salon');
  if not public.workspace_can_edit_salon_map() then raise exception 'salon_map_permission_denied'; end if;
  if p_rows not between 3 and 30 or p_columns not between 3 and 30 or p_seat_count not between 0 and 500 then raise exception 'salon_floor_dimensions_invalid'; end if;
  if jsonb_typeof(p_row_sizes)<>'array' or jsonb_array_length(p_row_sizes)<>p_rows or jsonb_typeof(p_column_sizes)<>'array' or jsonb_array_length(p_column_sizes)<>p_columns
    or exists(select 1 from jsonb_array_elements_text(p_row_sizes) as sizes(value) where value::numeric not between 0.5 and 4)
    or exists(select 1 from jsonb_array_elements_text(p_column_sizes) as sizes(value) where value::numeric not between 0.5 and 4) then raise exception 'salon_grid_sizes_invalid'; end if;
  if not exists(select 1 from public.salon_floors where id=p_floor_id and restaurant_id=rid) then raise exception 'salon_floor_not_found'; end if;
  if exists(select 1 from public.salon_tables t where t.floor_id=p_floor_id and (t.grid_row+t.row_span>p_rows or t.grid_column+t.column_span>p_columns)) then raise exception 'salon_floor_would_cut_table'; end if;
  update public.salon_floors set grid_rows=p_rows,grid_columns=p_columns,seat_count=p_seat_count,row_sizes=p_row_sizes,column_sizes=p_column_sizes,updated_at=now() where id=p_floor_id and restaurant_id=rid;
end;
$$;

create or replace function public.salon_save_seat_counts(p_updates jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare rid uuid; item jsonb; target uuid; seats integer;
begin
  rid := public.workspace_assert_actor('salon');
  if not public.workspace_can_edit_salon_map() then raise exception 'salon_map_permission_denied'; end if;
  if jsonb_typeof(p_updates)<>'array' or jsonb_array_length(p_updates)=0 then raise exception 'salon_seat_update_invalid'; end if;
  if jsonb_array_length(p_updates)<>(select count(*) from public.salon_floors where restaurant_id=rid) then raise exception 'salon_seat_update_incomplete'; end if;
  for item in select value from jsonb_array_elements(p_updates) loop
    target := (item->>'floor_id')::uuid; seats := (item->>'seat_count')::integer;
    if seats not between 0 and 500 or not exists(select 1 from public.salon_floors where id=target and restaurant_id=rid) then raise exception 'salon_seat_update_invalid'; end if;
  end loop;
  update public.salon_floors f set seat_count=(u.value->>'seat_count')::smallint,updated_at=now()
    from jsonb_array_elements(p_updates) as u(value) where f.id=(u.value->>'floor_id')::uuid and f.restaurant_id=rid;
end;
$$;

create or replace function public.salon_update_table(p_table_id uuid,p_table_number integer,p_row integer,p_column integer,p_row_span integer,p_column_span integer)
returns void language plpgsql security definer set search_path = '' as $$
declare rid uuid; t public.salon_tables%rowtype; f public.salon_floors%rowtype;
begin
  rid := public.workspace_assert_actor('salon');
  if not public.workspace_can_edit_salon_map() then raise exception 'salon_map_permission_denied'; end if;
  select * into t from public.salon_tables where id=p_table_id and restaurant_id=rid for update;
  if not found then raise exception 'salon_table_not_found'; end if;
  select * into f from public.salon_floors where id=t.floor_id;
  if p_table_number not between 1 and 100 or p_row<0 or p_column<0 or p_row_span not between 1 and 10 or p_column_span not between 1 and 10 or p_row+p_row_span>f.grid_rows or p_column+p_column_span>f.grid_columns then raise exception 'salon_table_dimensions_invalid'; end if;
  if exists(select 1 from public.salon_tables x where x.floor_id=t.floor_id and x.id<>t.id and p_row<x.grid_row+x.row_span and p_row+p_row_span>x.grid_row and p_column<x.grid_column+x.column_span and p_column+p_column_span>x.grid_column) then raise exception 'salon_table_space_occupied'; end if;
  update public.salon_tables set table_number=p_table_number,grid_row=p_row,grid_column=p_column,row_span=p_row_span,column_span=p_column_span,updated_at=now() where id=t.id;
end;
$$;

create or replace function public.salon_merge_tables(p_first_id uuid,p_second_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare rid uuid; a public.salon_tables%rowtype; b public.salon_tables%rowtype; group_id uuid := gen_random_uuid(); touching boolean;
begin
  rid := public.workspace_assert_actor('salon');
  if not public.workspace_can_edit_salon_map() then raise exception 'salon_map_permission_denied'; end if;
  select * into a from public.salon_tables where id=p_first_id and restaurant_id=rid for update;
  select * into b from public.salon_tables where id=p_second_id and restaurant_id=rid for update;
  if not found or a.floor_id<>b.floor_id or a.id=b.id then raise exception 'salon_merge_invalid'; end if;
  touching := (a.grid_row+a.row_span=b.grid_row or b.grid_row+b.row_span=a.grid_row) and a.grid_column<b.grid_column+b.column_span and a.grid_column+a.column_span>b.grid_column
    or (a.grid_column+a.column_span=b.grid_column or b.grid_column+b.column_span=a.grid_column) and a.grid_row<b.grid_row+b.row_span and a.grid_row+a.row_span>b.grid_row;
  if not touching then raise exception 'salon_tables_not_adjacent'; end if;
  update public.salon_tables set fusion_group_id=group_id where id in (a.id,b.id);
  return group_id;
end;
$$;

create or replace function public.salon_unmerge_table(p_table_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare rid uuid := public.workspace_assert_actor('salon'); group_id uuid;
begin
  if not public.workspace_can_edit_salon_map() then raise exception 'salon_map_permission_denied'; end if;
  select fusion_group_id into group_id from public.salon_tables where id=p_table_id and restaurant_id=rid;
  if group_id is null then raise exception 'salon_table_not_merged'; end if;
  update public.salon_tables set fusion_group_id=null,updated_at=now() where restaurant_id=rid and fusion_group_id=group_id;
end;
$$;

create or replace function public.workspace_prune_completed_queues()
returns integer language plpgsql security definer set search_path = '' as $$
declare rid uuid; removed integer;
begin
  rid := public.workspace_assert_actor('kitchen');
  delete from public.kitchen_queue_entries where restaurant_id=rid and status='completed' and completed_at < now()-interval '2 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.workspace_has_need(text), public.workspace_can_edit_salon_map(), public.workspace_assert_actor(text) from public, anon;
revoke all on function public.workspace_enqueue_order(text,uuid,text,uuid,uuid,text,text,jsonb), public.kitchen_set_progress(uuid,text,integer,integer), public.salon_mark_delivered(uuid), public.workspace_cancel_order(uuid,text), public.salon_create_floor(text,integer,integer), public.salon_create_table(uuid), public.salon_update_floor(uuid,integer,integer,integer,jsonb,jsonb), public.salon_save_seat_counts(jsonb), public.salon_update_table(uuid,integer,integer,integer,integer,integer), public.salon_merge_tables(uuid,uuid), public.salon_unmerge_table(uuid), public.workspace_prune_completed_queues() from public, anon;
grant execute on function public.workspace_has_need(text), public.workspace_can_edit_salon_map() to authenticated;
grant execute on function public.workspace_enqueue_order(text,uuid,text,uuid,uuid,text,text,jsonb), public.kitchen_set_progress(uuid,text,integer,integer), public.salon_mark_delivered(uuid), public.workspace_cancel_order(uuid,text), public.salon_create_floor(text,integer,integer), public.salon_create_table(uuid), public.salon_update_floor(uuid,integer,integer,integer,jsonb,jsonb), public.salon_save_seat_counts(jsonb), public.salon_update_table(uuid,integer,integer,integer,integer,integer), public.salon_merge_tables(uuid,uuid), public.salon_unmerge_table(uuid), public.workspace_prune_completed_queues() to authenticated;
