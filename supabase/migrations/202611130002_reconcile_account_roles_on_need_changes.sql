-- Keep employee role assignments valid when an administrator changes needs.
-- Removed capabilities are dropped; an account with no remaining role becomes Employee.
create or replace function public.restaurant_sync_available_roles(p_restaurant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  selected_needs text[];
  separate_bar boolean;
  allowed_role_ids uuid[];
  employee_role_id uuid;
begin
  select needs, kitchen_has_separate_bar
  into selected_needs, separate_bar
  from public.restaurants
  where id = p_restaurant_id;
  if not found then return; end if;

  select coalesce(array_agg(role.id order by role.sort_order, role.key), '{}')
  into allowed_role_ids
  from public.roles role
  where role.key in ('admin', 'employee')
     or (role.key = 'cashier' and coalesce(cardinality(array_remove(selected_needs, 'receipts')), 0) > 0)
     or (role.key = 'cook' and 'kitchen' = any(selected_needs))
     or (role.key in ('barista', 'bartender') and 'kitchen' = any(selected_needs) and separate_bar)
     or (role.key in ('waiter', 'host') and 'salon' = any(selected_needs))
     or (role.key = 'social_manager' and 'crm' = any(selected_needs))
     or (role.key = 'courier' and 'delivery' = any(selected_needs));

  update public.restaurants
  set available_role_ids = allowed_role_ids
  where id = p_restaurant_id;

  select id into employee_role_id
  from public.roles
  where key = 'employee';

  with valid_roles as (
    select account.auth_user_id,
      coalesce(
        array_agg(role.id order by role.sort_order, role.key)
          filter (where role.id is not null and role.id = any(allowed_role_ids)),
        '{}'
      ) as role_ids
    from public.accounts account
    left join lateral unnest(account.role_ids) assigned(role_id) on true
    left join public.roles role on role.id = assigned.role_id
    where account.restaurant_id = p_restaurant_id
    group by account.auth_user_id
  )
  update public.accounts account
  set role_ids = case
    when employee_role_id = any(valid_roles.role_ids) then array[employee_role_id]
    when cardinality(valid_roles.role_ids) = 0 then array[employee_role_id]
    else valid_roles.role_ids
  end
  from valid_roles
  where account.auth_user_id = valid_roles.auth_user_id
    and account.restaurant_id = p_restaurant_id
    and not (account.role_ids <@ allowed_role_ids);
end;
$$;

select public.restaurant_sync_available_roles(id)
from public.restaurants;
