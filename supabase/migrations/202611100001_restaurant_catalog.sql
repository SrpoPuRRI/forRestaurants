-- Tenant-scoped catalog for Black&White POS.
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null default public.current_restaurant_id() references public.restaurants(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, restaurant_id),
  unique (restaurant_id, name)
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null default public.current_restaurant_id() references public.restaurants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (id, restaurant_id),
  unique (restaurant_id, name)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null default public.current_restaurant_id() references public.restaurants(id) on delete cascade,
  name text not null,
  description text,
  category_id uuid,
  product_kind text not null default 'standard' check (product_kind in ('standard','income','expense')),
  -- In B&W this flag means sellable/in stock; unavailable records remain visible in the order menu.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (category_id, restaurant_id) references public.categories(id, restaurant_id) on delete set null (category_id)
);
create unique index if not exists products_one_special_kind_per_restaurant_idx
  on public.products(restaurant_id, product_kind) where product_kind in ('income','expense');
create index if not exists products_restaurant_name_idx on public.products(restaurant_id, name);

create table if not exists public.variants (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null default public.current_restaurant_id() references public.restaurants(id) on delete cascade,
  product_id uuid not null,
  name text not null,
  price numeric(12,2) not null default 0 check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  unique (id, product_id),
  unique (product_id, name),
  foreign key (product_id, restaurant_id) references public.products(id, restaurant_id) on delete cascade
);
create index if not exists variants_restaurant_product_idx on public.variants(restaurant_id, product_id);

create table if not exists public.addons (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null default public.current_restaurant_id() references public.restaurants(id) on delete cascade,
  name text not null,
  price numeric(12,2) not null default 0 check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  unique (restaurant_id, name)
);

create table if not exists public.product_categories (
  restaurant_id uuid not null default public.current_restaurant_id() references public.restaurants(id) on delete cascade,
  product_id uuid not null,
  category_id uuid not null,
  primary key (product_id, category_id),
  foreign key (product_id, restaurant_id) references public.products(id, restaurant_id) on delete cascade,
  foreign key (category_id, restaurant_id) references public.categories(id, restaurant_id) on delete cascade
);
create table if not exists public.product_tags (
  restaurant_id uuid not null default public.current_restaurant_id() references public.restaurants(id) on delete cascade,
  product_id uuid not null,
  tag_id uuid not null,
  primary key (product_id, tag_id),
  foreign key (product_id, restaurant_id) references public.products(id, restaurant_id) on delete cascade,
  foreign key (tag_id, restaurant_id) references public.tags(id, restaurant_id) on delete cascade
);
create table if not exists public.product_addons (
  restaurant_id uuid not null default public.current_restaurant_id() references public.restaurants(id) on delete cascade,
  product_id uuid not null,
  addon_id uuid not null,
  primary key (product_id, addon_id),
  foreign key (product_id, restaurant_id) references public.products(id, restaurant_id) on delete cascade,
  foreign key (addon_id, restaurant_id) references public.addons(id, restaurant_id) on delete restrict
);
create table if not exists public.variant_locations (
  restaurant_id uuid not null default public.current_restaurant_id() references public.restaurants(id) on delete cascade,
  variant_id uuid not null,
  location_id uuid not null,
  is_available boolean not null default true,
  primary key (variant_id, location_id),
  foreign key (variant_id, restaurant_id) references public.variants(id, restaurant_id) on delete cascade,
  foreign key (location_id, restaurant_id) references public.locations(id, restaurant_id) on delete cascade
);

create table if not exists public.restaurant_receipt_templates (
  restaurant_id uuid primary key default public.current_restaurant_id() references public.restaurants(id) on delete cascade,
  format jsonb not null,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(format) = 'object')
);

create or replace function public.catalog_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at before update on public.products
  for each row execute function public.catalog_touch_updated_at();
drop trigger if exists variants_touch_updated_at on public.variants;
create trigger variants_touch_updated_at before update on public.variants
  for each row execute function public.catalog_touch_updated_at();
drop trigger if exists addons_touch_updated_at on public.addons;
create trigger addons_touch_updated_at before update on public.addons
  for each row execute function public.catalog_touch_updated_at();

create or replace function public.catalog_assert_active_product_has_variant()
returns trigger language plpgsql set search_path = '' as $$
declare
  target_product uuid;
  product_is_active boolean;
begin
  if tg_table_name = 'products' then
    target_product := coalesce(new.id, old.id);
  else
    target_product := coalesce(new.product_id, old.product_id);
  end if;
  select p.is_active into product_is_active from public.products p where p.id = target_product;
  if coalesce(product_is_active, false) and not exists (
    select 1 from public.variants v where v.product_id = target_product
  ) then
    raise exception 'active_product_requires_variant';
  end if;
  return null;
end;
$$;
drop trigger if exists products_require_variant on public.products;
create constraint trigger products_require_variant
  after insert or update on public.products deferrable initially deferred
  for each row execute function public.catalog_assert_active_product_has_variant();
drop trigger if exists variants_preserve_product_variant on public.variants;
create constraint trigger variants_preserve_product_variant
  after insert or update or delete on public.variants deferrable initially deferred
  for each row execute function public.catalog_assert_active_product_has_variant();

create or replace function public.set_catalog_stock_availability(
  p_entity text,
  p_entity_id uuid,
  p_is_available boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_restaurant uuid := public.current_restaurant_id();
  actor_role text := public.current_role_key();
  affected integer;
begin
  if current_restaurant is null or coalesce(actor_role, '') not in ('admin','employee') then
    raise exception 'catalog_stock_permission_denied';
  end if;
  if p_entity = 'product' then
    update public.products set is_active = p_is_available
      where id = p_entity_id and restaurant_id = current_restaurant;
  elsif p_entity = 'variant' then
    update public.variants set is_active = p_is_available
      where id = p_entity_id and restaurant_id = current_restaurant;
  elsif p_entity = 'addon' then
    update public.addons set is_active = p_is_available
      where id = p_entity_id and restaurant_id = current_restaurant;
  else
    raise exception 'catalog_stock_entity_invalid';
  end if;
  get diagnostics affected = row_count;
  if affected = 0 then raise exception 'catalog_stock_item_not_found'; end if;
end;
$$;
revoke all on function public.set_catalog_stock_availability(text,uuid,boolean) from public, anon;
grant execute on function public.set_catalog_stock_availability(text,uuid,boolean) to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'categories','tags','products','variants','addons','product_categories',
    'product_tags','product_addons','variant_locations','restaurant_receipt_templates'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_tenant_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_manage', table_name);
    if table_name = 'restaurant_receipt_templates' then
      execute format('create policy %I on public.%I for select to authenticated using (restaurant_id = (select public.current_restaurant_id()) and exists (select 1 from public.restaurants r where r.id = restaurant_id and ''receipts'' = any(r.needs)))', table_name || '_tenant_read', table_name);
      execute format('create policy %I on public.%I for all to authenticated using (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = ''admin'' and exists (select 1 from public.restaurants r where r.id = restaurant_id and ''receipts'' = any(r.needs))) with check (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = ''admin'' and exists (select 1 from public.restaurants r where r.id = restaurant_id and ''receipts'' = any(r.needs)))', table_name || '_admin_manage', table_name);
    else
      execute format('create policy %I on public.%I for select to authenticated using (restaurant_id = (select public.current_restaurant_id()))', table_name || '_tenant_read', table_name);
      execute format('create policy %I on public.%I for all to authenticated using (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = ''admin'') with check (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key()) = ''admin'')', table_name || '_admin_manage', table_name);
    end if;
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
  end loop;
end $$;
