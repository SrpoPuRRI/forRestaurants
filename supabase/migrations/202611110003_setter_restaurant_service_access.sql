-- Setter's authenticated Edge Function reads and updates restaurant metadata
-- (name and logo_path) with the service client after checking platform_operators.
-- BYPASSRLS does not grant SQL table privileges, so grant only the operations it needs.
grant select, update on table public.restaurants to service_role;
