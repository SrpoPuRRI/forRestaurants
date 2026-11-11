-- Keep restaurant logos in private storage and allow restaurant admins to replace them.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-assets',
  'restaurant-assets',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "restaurant logo read scope" on storage.objects;
create policy "restaurant logo read scope" on storage.objects
for select to authenticated
using (
  bucket_id = 'restaurant-assets'
  and (storage.foldername(name))[1] = (select public.current_restaurant_id())::text
);

drop policy if exists "restaurant logo write admin" on storage.objects;
create policy "restaurant logo write admin" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'restaurant-assets'
  and (storage.foldername(name))[1] = (select public.current_restaurant_id())::text
  and (select public.current_role_key()) = 'admin'
);

drop policy if exists "restaurant logo update admin" on storage.objects;
create policy "restaurant logo update admin" on storage.objects
for update to authenticated
using (
  bucket_id = 'restaurant-assets'
  and (storage.foldername(name))[1] = (select public.current_restaurant_id())::text
  and (select public.current_role_key()) = 'admin'
)
with check (
  bucket_id = 'restaurant-assets'
  and (storage.foldername(name))[1] = (select public.current_restaurant_id())::text
  and (select public.current_role_key()) = 'admin'
);

drop policy if exists "restaurant logo delete admin" on storage.objects;
create policy "restaurant logo delete admin" on storage.objects
for delete to authenticated
using (
  bucket_id = 'restaurant-assets'
  and (storage.foldername(name))[1] = (select public.current_restaurant_id())::text
  and (select public.current_role_key()) = 'admin'
);
