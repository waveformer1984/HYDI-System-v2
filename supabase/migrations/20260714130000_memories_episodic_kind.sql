-- Episodic memory support for the `memories` table.
--
-- Adds a `kind` discriminator (default 'conversation', preserving existing
-- rows' meaning unchanged) and a `metadata` column for structured episodic
-- fields (problem / actions_taken / outcome / lesson), written by
-- lib/episodic-memory.ts. See HYDI_KERNEL_ARCHITECTURE_ROADMAP.md's Phase 2.
--
-- No new table: reuses the existing pgvector-backed `memories` table and
-- its search_memories RPC so episodic experiences are retrievable through
-- the same semantic-search path as conversational memory.

alter table public.memories add column if not exists kind text not null default 'conversation';
alter table public.memories add column if not exists metadata jsonb;

create index if not exists idx_memories_kind on public.memories (kind);
