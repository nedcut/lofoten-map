-- Run only after migration verification and the rollback window. This removes
-- the disposable staging copies and source-to-target identity map. Application
-- tables and Neon Auth data are not touched.

\set ON_ERROR_STOP on

do $$
begin
  if not exists (
    select 1
    from information_schema.schemata
    where schema_name = 'migration'
  ) then
    raise exception 'migration staging schema does not exist';
  end if;
end;
$$;

drop schema migration cascade;
