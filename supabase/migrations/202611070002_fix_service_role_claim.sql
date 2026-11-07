-- These RPCs are already revoked from public/anon/authenticated and granted
-- only to service_role. Remove the redundant legacy JWT claim guard, which is
-- incompatible with current PostgREST claim handling and newer API keys.
do $$
declare
  fn record;
  definition text;
begin
  for fn in
    select p.oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and position('if coalesce(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role'' then raise exception ''service_role_required''; end if;' in p.prosrc) > 0
  loop
    definition := pg_catalog.pg_get_functiondef(fn.oid);
    definition := replace(
      definition,
      'if coalesce(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role'' then raise exception ''service_role_required''; end if;',
      ''
    );
    execute definition;
  end loop;
end $$;
