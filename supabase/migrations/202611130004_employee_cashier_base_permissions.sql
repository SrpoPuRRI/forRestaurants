-- Employee is the conceptual cashier when the restaurant has no extra need
-- beyond receipts. This keeps its base Orders access aligned with the POS UI.
create or replace function public.current_has_permission(p_permission_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.accounts a
    join public.restaurants restaurant on restaurant.id = a.restaurant_id
    join public.roles assigned on assigned.id = any(a.role_ids)
    where a.auth_user_id = (select auth.uid())
      and a.is_active and restaurant.status = 'active'
      and assigned.id = any(restaurant.available_role_ids)
      and (
        assigned.key = 'admin'
        or (
          assigned.key = 'employee'
          and (
            exists (
              select 1 from public.roles enabled
              where enabled.id = any(restaurant.available_role_ids)
                and enabled.key not in ('admin', 'employee')
                and coalesce((enabled.permissions ->> p_permission_key)::boolean, false)
            )
            or (
              p_permission_key in ('orders', 'payments')
              and not exists (
                select 1
                from unnest(coalesce(restaurant.needs, '{}'::text[])) as need(key)
                where need.key <> 'receipts'
              )
            )
          )
        )
        or (
          assigned.key not in ('admin', 'employee')
          and coalesce((assigned.permissions ->> p_permission_key)::boolean, false)
        )
      )
  );
$$;

-- Repair any role arrays that drifted from the configured needs before this fix.
select public.restaurant_sync_available_roles(id)
from public.restaurants;
