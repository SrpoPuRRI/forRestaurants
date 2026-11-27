-- Save the restaurant-wide motor/backup order from the flow list manager.
-- Synchronize the legacy runtime mirror in this same database operation.
create or replace function public.save_printing_flow_engine_accounts(p_account_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant_id uuid:=public.current_restaurant_id();
  v_order uuid[]:=coalesce(p_account_ids,'{}'::uuid[]);
begin
  if v_restaurant_id is null then raise exception 'authentication_required'; end if;
  if public.current_role_key() is distinct from 'admin' then raise exception 'admin_required'; end if;
  if cardinality(v_order) <> (
    select count(distinct selected.account_id)
    from unnest(v_order) as selected(account_id)
  ) then raise exception 'duplicate_flow_engine_account'; end if;
  if exists(select 1 from unnest(v_order) as selected(account_id)
      where selected.account_id is null
        or not public.printing_flow_account_is_eligible(v_restaurant_id,selected.account_id)) then
    raise exception 'printing_flow_account_unavailable';
  end if;
  if cardinality(v_order)=0 and exists(select 1 from public.printing_flows flow
      where flow.restaurant_id=v_restaurant_id and flow.is_active) then
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
end;
$$;
revoke all on function public.save_printing_flow_engine_accounts(uuid[]) from public,anon;
grant execute on function public.save_printing_flow_engine_accounts(uuid[]) to authenticated;
