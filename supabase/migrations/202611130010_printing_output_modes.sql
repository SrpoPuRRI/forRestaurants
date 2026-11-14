-- A point may accept manual output, automatic output, or both.
alter table public.printing_points
  add column if not exists supported_output_modes text[] not null default array['manual']::text[];

update public.printing_points
set supported_output_modes = array[output_mode]::text[]
where cardinality(supported_output_modes) = 0
   or not (supported_output_modes <@ array['manual','automatic']::text[]);

alter table public.printing_points
  drop constraint if exists printing_points_supported_output_modes_check;
alter table public.printing_points
  add constraint printing_points_supported_output_modes_check
  check (cardinality(supported_output_modes) > 0
    and supported_output_modes <@ array['manual','automatic']::text[]);
