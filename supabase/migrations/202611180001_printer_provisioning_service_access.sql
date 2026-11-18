-- Printer provisioning Edge Function reads the account, restaurant and role,
-- then creates or updates printing_devices with the service role.
grant select on table public.accounts to service_role;
grant select on table public.restaurants to service_role;
grant select on table public.roles to service_role;
grant select, insert, update on table public.printing_devices to service_role;
