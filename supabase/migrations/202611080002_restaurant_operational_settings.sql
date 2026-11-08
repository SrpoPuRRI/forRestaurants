-- Typed, restaurant-scoped settings for the fixed POS sections.
alter table public.restaurants
  add column if not exists employee_note_reset_mode text not null default 'manual'
    check (employee_note_reset_mode in ('manual','automatic')),
  add column if not exists employee_note_reset_days smallint not null default 30
    check (employee_note_reset_days in (7,15,30)),
  add column if not exists rankings_enabled boolean not null default false,
  add column if not exists rankings_products boolean not null default false,
  add column if not exists rankings_variants boolean not null default false,
  add column if not exists rankings_addons boolean not null default false,
  add column if not exists rankings_categories boolean not null default false,
  add column if not exists rankings_employees_enabled boolean not null default false,
  add column if not exists rankings_same_for_all_roles boolean not null default true,
  add column if not exists order_minimum_enabled boolean not null default false,
  add column if not exists order_minimum_amount numeric(12,2),
  add column if not exists order_minimum_admin boolean not null default true,
  add column if not exists order_minimum_employees boolean not null default false,
  add column if not exists order_maximum_enabled boolean not null default false,
  add column if not exists order_maximum_amount numeric(12,2),
  add column if not exists order_maximum_admin boolean not null default true,
  add column if not exists order_maximum_employees boolean not null default false,
  add column if not exists corrections_admin boolean not null default true,
  add column if not exists corrections_employees boolean not null default false,
  add column if not exists catalog_addons_enabled boolean not null default false,
  add column if not exists catalog_category_groups_enabled boolean not null default false,
  add column if not exists catalog_promotions_enabled boolean not null default false;

create table if not exists public.restaurant_payment_methods (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  method_key text not null check (method_key in ('cash','yape','plin','bank_transfer','card')),
  enabled boolean not null default false,
  manual_enabled boolean not null default false,
  automatic_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, method_key),
  check (not manual_enabled or enabled),
  check (not automatic_enabled or enabled),
  check (method_key not in ('cash','bank_transfer') or not automatic_enabled)
);

create table if not exists public.restaurant_role_settings (
  restaurant_id uuid not null,
  role_id uuid not null,
  rankings_products boolean not null default false,
  rankings_variants boolean not null default false,
  rankings_addons boolean not null default false,
  rankings_categories boolean not null default false,
  order_minimum_allowed boolean not null default false,
  order_maximum_allowed boolean not null default false,
  corrections_allowed boolean not null default false,
  primary key (restaurant_id, role_id),
  foreign key (role_id, restaurant_id) references public.roles(id, restaurant_id) on delete cascade,
  foreign key (restaurant_id) references public.restaurants(id) on delete cascade
);

create unique index if not exists accounts_auth_restaurant_uidx on public.accounts(auth_user_id, restaurant_id);
create table if not exists public.employee_notes (
  auth_user_id uuid primary key references public.accounts(auth_user_id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  note text not null default '',
  updated_at timestamptz not null default now(),
  foreign key (auth_user_id, restaurant_id) references public.accounts(auth_user_id, restaurant_id) on delete cascade
);

create index if not exists employee_notes_restaurant_idx on public.employee_notes(restaurant_id);
alter table public.restaurant_payment_methods enable row level security;
alter table public.restaurant_role_settings enable row level security;
alter table public.employee_notes enable row level security;

create policy "payment methods restaurant read" on public.restaurant_payment_methods for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id()));
create policy "payment methods admin manage" on public.restaurant_payment_methods for all to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key())='admin')
  with check (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key())='admin');
create policy "role settings restaurant read" on public.restaurant_role_settings for select to authenticated
  using (restaurant_id = (select public.current_restaurant_id()));
create policy "role settings admin manage" on public.restaurant_role_settings for all to authenticated
  using (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key())='admin')
  with check (restaurant_id = (select public.current_restaurant_id()) and (select public.current_role_key())='admin');
create policy "employee notes self or admin read" on public.employee_notes for select to authenticated
  using (auth_user_id=(select auth.uid()) or (restaurant_id=(select public.current_restaurant_id()) and (select public.current_role_key())='admin'));
create policy "employee notes self write" on public.employee_notes for insert to authenticated
  with check (auth_user_id=(select auth.uid()) and restaurant_id=(select public.current_restaurant_id()));
create policy "employee notes self update" on public.employee_notes for update to authenticated
  using (auth_user_id=(select auth.uid()) and restaurant_id=(select public.current_restaurant_id()))
  with check (auth_user_id=(select auth.uid()) and restaurant_id=(select public.current_restaurant_id()));
grant select, insert, update, delete on public.restaurant_payment_methods, public.restaurant_role_settings to authenticated;
grant select, insert, update on public.employee_notes to authenticated;
grant update on public.restaurants to authenticated;
