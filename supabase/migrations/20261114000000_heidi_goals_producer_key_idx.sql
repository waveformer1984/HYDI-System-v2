-- heidi_goals.producerKey lookups (MissionProducer cooldown/dedupe) filter on
-- context->>'producerKey', a JSONB expression with no index — every produce()
-- pass sequentially scans ~12.7k rows per candidate key and exceeds its 20s
-- cycle deadline under memory pressure. A plain expression index makes each
-- lookup an index scan.
CREATE INDEX IF NOT EXISTS idx_heidi_goals_producer_key
  ON heidi_goals ((context->>'producerKey'));
