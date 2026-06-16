-- Auto-create indexes for every unindexed foreign key in public and core schemas.
-- Unindexed FKs cause slow JOINs and slow ON DELETE CASCADE scans.
-- Index names follow the pattern: idx_{table}_{fk_name}_fk_auto

do $$
declare r record;
declare idx_name text;
declare cols text;
begin
  for r in
    with fk as (
      select
        con.oid              as con_oid,
        ns.nspname           as schema_name,
        tbl.relname          as table_name,
        con.conname          as fk_name,
        con.conkey           as key_cols
      from pg_constraint con
      join pg_class         tbl on tbl.oid = con.conrelid
      join pg_namespace     ns  on ns.oid  = tbl.relnamespace
      where con.contype = 'f'
        and ns.nspname in ('public', 'core')
    ),
    missing as (
      select f.*
      from fk f
      where not exists (
        select 1
        from pg_index i
        where i.indrelid = (quote_ident(f.schema_name) || '.' || quote_ident(f.table_name))::regclass
          and i.indisvalid
          and (i.indkey::int2[])[1:array_length(f.key_cols, 1)] = f.key_cols
      )
    )
    select * from missing
  loop
    select string_agg(quote_ident(att.attname), ', ' order by ord.n)
      into cols
    from unnest(r.key_cols) with ordinality as ord(attnum, n)
    join pg_attribute att
      on  att.attrelid = (quote_ident(r.schema_name) || '.' || quote_ident(r.table_name))::regclass
      and att.attnum   = ord.attnum;

    idx_name := format('idx_%s_%s_fk_auto',
                       r.table_name,
                       replace(r.fk_name, '-', '_'));

    execute format(
      'create index if not exists %I on %I.%I (%s);',
      idx_name, r.schema_name, r.table_name, cols
    );

    raise notice 'created index % on %.%(%)',
      idx_name, r.schema_name, r.table_name, cols;
  end loop;
end $$;
