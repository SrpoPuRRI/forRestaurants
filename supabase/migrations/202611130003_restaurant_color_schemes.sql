-- Restaurant-wide color schemes are optional. A null active ID uses the built-in themes.
alter table public.restaurants
  add column if not exists appearance jsonb not null
    default '{"color_schemes":[],"active_color_scheme_id":null}'::jsonb;
