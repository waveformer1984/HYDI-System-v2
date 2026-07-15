-- which divisions, and how many each
select division, count(*) from hydi_facts group by division order by 2 desc;