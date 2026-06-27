select extname from pg_extension where extname = 'vector';        -- pgvector enabled?
select count(*) from hydi_facts;                                  -- facts seeded?
select count(*) from hydi_facts where embedding is not null;      -- embeddings written (no silent failure)?
select division, count(*) from hydi_facts group by division order by 2 desc;  -- spread across divisions?