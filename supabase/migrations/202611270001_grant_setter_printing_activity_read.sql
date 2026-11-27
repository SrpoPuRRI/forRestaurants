-- The Setter Edge Function reads only device_id to determine whether a device
-- has a currently taken job. Grant the minimum required columns to its
-- service-role client; authenticated POS clients retain their existing grants.
grant select (device_id, restaurant_id, status)
  on table public.printing_jobs
  to service_role;
