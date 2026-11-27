-- heidi_leads scoring v2 columns (NOT applied in cloud — Frank applies when approved)

ALTER TABLE public.heidi_leads
  ADD COLUMN IF NOT EXISTS contractor text,
  ADD COLUMN IF NOT EXISTS score_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS scored_by text;

COMMENT ON COLUMN public.heidi_leads.score IS 'Nullable: unscored leads stay NULL (never 0 placeholder)';
COMMENT ON COLUMN public.heidi_leads.scored_by IS 'rules | llm | null';

CREATE INDEX IF NOT EXISTS heidi_leads_contractor_created_idx
  ON public.heidi_leads (contractor, created_at DESC)
  WHERE contractor IS NOT NULL;