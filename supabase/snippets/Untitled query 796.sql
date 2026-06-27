select b.content as related, round((a.embedding <=> b.embedding)::numeric, 3) as distance
from hydi_facts a
join hydi_facts b on a.id <> b.id
where a.content ilike '%AppForge%'
order by a.embedding <=> b.embedding
limit 5;