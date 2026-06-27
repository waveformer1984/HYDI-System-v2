-- the whole picture in one row
select
  (select count(*) from hydi_facts)                          as total_facts,
  (select count(distinct division) from hydi_facts)          as divisions,
  (select count(*) from hydi_facts where embedding is not null) as facts_with_embeddings,
  (select count(*) from pg_extension where extname='vector')  as pgvector_on;