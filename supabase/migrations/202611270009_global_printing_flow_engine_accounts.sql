-- The engine/back-up account order belongs to the restaurant, not an
-- individual printing flow. Keep the old per-flow array only as a synchronized
-- compatibility mirror for the current runtime implementation.
create table if not exists public.printing_flow_engine_accounts (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  priority integer not null check (priority > 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (restaurant_id, account_id),
  unique (restaurant_id, priority)
);

alter table public.printing_flow_engine_accounts enable row level security;
revoke all on public.printing_flow_engine_accounts from public, anon, authenticated;
drop policy if exists printing_flow_engine_accounts_tenant_read
  on public.printing_flow_engine_accounts;
create policy printing_flow_engine_accounts_tenant_read
  on public.printing_flow_engine_accounts for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id()));
grant select on public.printing_flow_engine_accounts to authenticated;

create or replace function public.printing_flow_account_is_eligible(
  p_restaurant_id uuid,
  p_account_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.accounts account
    join public.restaurants restaurant on restaurant.id=account.restaurant_id
    join public.roles assigned on assigned.id=any(account.role_ids)
    where account.restaurant_id=p_restaurant_id and account.auth_user_id=p_account_id
      and account.is_active and assigned.id=any(restaurant.available_role_ids)
      and (
        assigned.key='admin'
        or (assigned.key='employee' and exists(
          select 1 from public.roles enabled
          where enabled.id=any(restaurant.available_role_ids)
            and enabled.key not in ('admin','employee')
            and (coalesce((enabled.permissions->>'orders')::boolean,false)
              or coalesce((enabled.permissions->>'payments')::boolean,false)
              or coalesce((enabled.permissions->>'kitchen')::boolean,false)
              or coalesce((enabled.permissions->>'salon')::boolean,false))
        ))
        or (assigned.key not in ('admin','employee') and (
          coalesce((assigned.permissions->>'orders')::boolean,false)
          or coalesce((assigned.permissions->>'payments')::boolean,false)
          or coalesce((assigned.permissions->>'kitchen')::boolean,false)
          or coalesce((assigned.permissions->>'salon')::boolean,false)
        ))
      )
  );
$$;
revoke all on function public.printing_flow_account_is_eligible(uuid,uuid)
  from public,anon,authenticated;

-- Seed one shared order from the earliest configured flow, then append any
-- currently active accounts omitted from that older per-flow configuration.
with preferred as (
  select distinct on (flow.restaurant_id)
    flow.restaurant_id, flow.engine_account_order
  from public.printing_flows flow
  where cardinality(flow.engine_account_order) > 0
  order by flow.restaurant_id, flow.created_at, flow.id
), ordered as (
  select preferred.restaurant_id, selected.account_id,
    row_number() over (partition by preferred.restaurant_id order by selected.ordinality)::integer as priority
  from preferred
  cross join lateral unnest(preferred.engine_account_order) with ordinality as selected(account_id, ordinality)
  join public.accounts account on account.restaurant_id=preferred.restaurant_id
    and account.auth_user_id=selected.account_id and account.is_active
  where public.printing_flow_account_is_eligible(preferred.restaurant_id,selected.account_id)
)
insert into public.printing_flow_engine_accounts(restaurant_id,account_id,priority)
select ordered.restaurant_id,ordered.account_id,ordered.priority from ordered
on conflict do nothing;

with missing as (
  select account.restaurant_id,account.auth_user_id,
    coalesce((select max(existing.priority) from public.printing_flow_engine_accounts existing
      where existing.restaurant_id=account.restaurant_id),0)
      + row_number() over (partition by account.restaurant_id order by account.display_name,account.auth_user_id)::integer as priority
  from public.accounts account
  where account.is_active and public.printing_flow_account_is_eligible(account.restaurant_id,account.auth_user_id)
    and not exists(select 1 from public.printing_flow_engine_accounts existing
    where existing.restaurant_id=account.restaurant_id and existing.account_id=account.auth_user_id)
)
insert into public.printing_flow_engine_accounts(restaurant_id,account_id,priority)
select missing.restaurant_id,missing.auth_user_id,missing.priority from missing
on conflict do nothing;

-- Align old flow arrays once. All later edits go through the shared list.
update public.printing_flows flow
set engine_account_order=coalesce((select array_agg(shared.account_id order by shared.priority)
  from public.printing_flow_engine_accounts shared where shared.restaurant_id=flow.restaurant_id),'{}'::uuid[]),
  updated_at=clock_timestamp()
where flow.engine_account_order is distinct from coalesce((
  select array_agg(shared.account_id order by shared.priority)
  from public.printing_flow_engine_accounts shared where shared.restaurant_id=flow.restaurant_id
),'{}'::uuid[]);

-- Retain the existing validated editor implementation as an internal routine;
-- the public RPC now saves the shared order and synchronizes all flows atomically.
do $$
begin
  if to_regprocedure('public.save_printing_flow_editor_with_flow_order(uuid,text,text[],boolean,jsonb,uuid[])') is null then
    if to_regprocedure('public.save_printing_flow_editor(uuid,text,text[],boolean,jsonb,uuid[])') is null then
      raise exception 'printing_flow_editor_implementation_missing';
    end if;
    execute 'alter function public.save_printing_flow_editor(uuid,text,text[],boolean,jsonb,uuid[]) rename to save_printing_flow_editor_with_flow_order';
  end if;
end;
$$;
revoke all on function public.save_printing_flow_editor_with_flow_order(uuid,text,text[],boolean,jsonb,uuid[])
  from public,anon,authenticated;

create or replace function public.save_printing_flow_editor(
  p_flow_id uuid,
  p_name text,
  p_captured_events text[],
  p_is_active boolean,
  p_routes jsonb,
  p_engine_account_order uuid[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant_id uuid:=public.current_restaurant_id();
  v_flow_id uuid;
  v_order uuid[]:=coalesce(p_engine_account_order,'{}'::uuid[]);
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if public.current_role_key() is distinct from 'admin' then raise exception 'admin_required'; end if;
  if exists(select 1 from unnest(v_order) as selected(account_id)
      where not public.printing_flow_account_is_eligible(v_restaurant_id,selected.account_id)) then
    raise exception 'printing_flow_account_unavailable';
  end if;
  v_flow_id:=public.save_printing_flow_editor_with_flow_order(
    p_flow_id,p_name,p_captured_events,p_is_active,p_routes,v_order
  );
  if exists(select 1 from public.printing_flows flow
      where flow.restaurant_id=v_restaurant_id and flow.is_active)
    and cardinality(v_order)=0 then
    raise exception 'printing_flow_account_order_required';
  end if;

  delete from public.printing_flow_engine_accounts shared
  where shared.restaurant_id=v_restaurant_id;
  insert into public.printing_flow_engine_accounts(restaurant_id,account_id,priority)
  select v_restaurant_id,selected.account_id,selected.ordinality::integer
  from unnest(v_order) with ordinality as selected(account_id,ordinality);

  update public.printing_flows flow
  set engine_account_order=v_order,updated_at=clock_timestamp()
  where flow.restaurant_id=v_restaurant_id
    and flow.engine_account_order is distinct from v_order;
  return v_flow_id;
end;
$$;
revoke all on function public.save_printing_flow_editor(uuid,text,text[],boolean,jsonb,uuid[])
  from public,anon;
grant execute on function public.save_printing_flow_editor(uuid,text,text[],boolean,jsonb,uuid[])
  to authenticated;
