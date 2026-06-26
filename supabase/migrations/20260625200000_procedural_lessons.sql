-- Procedural Memory: Lessons learned from action execution
-- Stores reusable patterns extracted via reflection on past actions

-- Enable pgvector if not already enabled
create extension if not exists vector;

create table if not exists public.heidi_procedural_lessons (
    id              uuid primary key default gen_random_uuid(),
    device_id       text not null,
    
    -- The pattern/situation
    situation       text not null,           -- "When user asks to deploy to staging"
    situation_emb   vector(768),             -- embedding of situation for similarity search
    
    -- What was done
    action_type     text not null,           -- "run_script", "api_call", etc.
    action_summary  text not null,           -- "deploy.sh with --env=staging"
    
    -- The outcome
    outcome         text not null,           -- "success" or "failure"
    outcome_detail  text,                    -- error message or success metrics
    
    -- The reusable lesson
    lesson          text not null,           -- "Always run health check after deploy"
    lesson_emb      vector(768),             -- embedding of lesson for similarity search
    
    -- Metadata
    confidence      float default 0.5,       -- 0-1, increases with successful reapplication
    application_count int default 0,         -- how many times this lesson was applied
    success_count  int default 0,           -- how many times application succeeded
    last_applied_at timestamptz,
    
    -- Timestamps
    created_at      timestamptz default now(),
    updated_at      timestamptz default now()
);

-- Indexes for similarity search (ivfflat is faster for large datasets)
create index if not exists idx_procedural_situation_emb on public.heidi_procedural_lessons using ivfflat (situation_emb vector_cosine_ops) with (lists = 100);
create index if not exists idx_procedural_lesson_emb on public.heidi_procedural_lessons using ivfflat (lesson_emb vector_cosine_ops) with (lists = 100);
create index if not exists idx_procedural_device_id on public.heidi_procedural_lessons(device_id);
create index if not exists idx_procedural_confidence on public.heidi_procedural_lessons(confidence desc);

-- RLS
alter table public.heidi_procedural_lessons enable row level security;

-- Service role can do everything
drop policy if exists "service_role_all" on public.heidi_procedural_lessons;
create policy "service_role_all" on public.heidi_procedural_lessons
    for all to service_role using (true) with check (true);

-- Function to match lessons by vector similarity
create or replace function match_procedural_lessons(
    query_device_id text,
    query_embedding vector(768),
    match_threshold float default 0.75,
    max_results int default 3
)
returns table (
    id uuid,
    situation text,
    lesson text,
    confidence float,
    application_count int,
    success_rate float,
    similarity float
)
language sql
stable
as $$
    select 
        l.id,
        l.situation,
        l.lesson,
        l.confidence,
        l.application_count,
        l.success_count::float / nullif(l.application_count, 0) as success_rate,
        1 - (l.situation_emb <=> query_embedding) as similarity
    from public.heidi_procedural_lessons l
    where l.device_id = query_device_id
        and l.situation_emb is not null
        and 1 - (l.situation_emb <=> query_embedding) > match_threshold
    order by (l.confidence * (1 - (l.situation_emb <=> query_embedding))) desc
    limit max_results;
$$;

-- Function to update lesson application stats
create or replace function update_lesson_application(
    lesson_id uuid,
    was_successful boolean
)
returns void
language plpgsql
as $$
begin
    update public.heidi_procedural_lessons
    set 
        application_count = application_count + 1,
        success_count = success_count + case when was_successful then 1 else 0 end,
        confidence = least(1.0, 
            case 
                when was_successful then confidence + 0.05
                else confidence - 0.1
            end
        ),
        last_applied_at = now(),
        updated_at = now()
    where id = lesson_id;
end;
$$;

-- Function to prune low-confidence lessons
create or replace function prune_low_confidence_lessons(
    min_confidence float default 0.3,
    min_age_days int default 30
)
returns int
language plpgsql
as $$
declare
    deleted_count int;
begin
    delete from public.heidi_procedural_lessons
    where confidence < min_confidence
        and created_at < now() - (min_age_days || ' days')::interval;
    
    get diagnostics deleted_count = row_count;
    return deleted_count;
end;
$$;
