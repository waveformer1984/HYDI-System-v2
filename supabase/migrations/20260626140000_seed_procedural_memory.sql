-- Phase 3: Seed procedural memory with operational knowledge
-- This gives Heidi domain-specific facts to answer questions contextually

-- Seed AppForge division facts
INSERT INTO hydi_facts (content, confidence, division, content_key)
VALUES
  ('AppForge infrastructure runs on Google Cloud Platform (GCP) with Firestore as primary database. Migration to multi-region active-active is scheduled for Q3 2026.', 0.92, 'appforge', 'appforge_gcp_infrastructure'),
  ('AppForge deployment pipeline uses GitHub Actions with staging promotion. All PRs require at least 1 approval and passing contract tests. Production deploys require explicit GitHub release tag.', 0.95, 'appforge', 'appforge_cicd_pipeline'),
  ('AppForge CI/CD has a 15-minute SLA for test completion. Flaky tests that fail >10% are automatically reported to #devops Slack channel.', 0.88, 'appforge', 'appforge_cicd_sla'),
  ('AppForge Firestore has RLS (Row Level Security) policies enforced. Service accounts must have explicit grants. Default deny all except service_role.', 0.94, 'appforge', 'appforge_firestore_rls'),
  ('AppForge API rate limiting: 1000 req/min per user, 10000 req/min per service account. Burst capacity allows 2x for 60 seconds. Excess requests receive 429 Too Many Requests.', 0.91, 'appforge', 'appforge_api_rate_limiting')
ON CONFLICT (content_key) DO NOTHING;

-- Seed Crypto division facts
INSERT INTO hydi_facts (content, confidence, division, content_key)
VALUES
  ('Crypto Ops trading is disabled when market volatility (VIX) exceeds 30. All positions are force-liquidated at market open if margin falls below 150%. This is non-negotiable for regulatory compliance.', 0.97, 'crypto', 'crypto_trading_vix_limits'),
  ('Crypto Ops uses a conservative 2% position size rule per trade. Max portfolio heat is 10% across all open positions. Stop loss is always set at 2x ATR (Average True Range).', 0.93, 'crypto', 'crypto_position_sizing'),
  ('Crypto Ops rebalances portfolio daily at 4 PM UTC when crypto markets are most liquid. Rebalancing includes tax-loss harvesting to offset realized gains.', 0.89, 'crypto', 'crypto_rebalancing_schedule'),
  ('Crypto Ops mining rig produces approximately 0.15 BTC/month at current difficulty. Revenue after electricity (~$800/month) is approximately $4200/month. Hardware ROI is 18 months.', 0.85, 'crypto', 'crypto_mining_revenue'),
  ('Crypto Ops is registered with FinCEN as a Money Services Business (MSB). All trades over $10k must be reported. KYC verified up to $100k/day withdrawal limit.', 0.96, 'crypto', 'crypto_fincen_compliance')
ON CONFLICT (content_key) DO NOTHING;

-- Seed Creative division facts
INSERT INTO hydi_facts (content, confidence, division, content_key)
VALUES
  ('Rezonate audio production pipeline: ingest WAV → AI stem separation → MIDI extraction → re-synthesis → export as multi-format (MP3, WAV, FLAC). Processing time: 8 minutes per 3-minute song.', 0.87, 'creative', 'creative_rezonate_pipeline'),
  ('Proto-YI design generation uses Gemini vision API to analyze mood boards, then generates 5 concept variations. Cost per generation: $0.002. Average approval rate: 68% (needs human curation).', 0.84, 'creative', 'creative_proto_yi_generation'),
  ('Waveformer Records distributes to 12 platforms (Spotify, Apple Music, YouTube, etc.) via DistroKid. Revenue split: 70% artist, 30% label. Payout period: 60 days after distribution.', 0.91, 'creative', 'creative_waveformer_distribution'),
  ('Creative asset storage is in Google Cloud Storage with lifecycle policies. Hot storage (< 30 days): $0.020/GB/month. Archive storage (> 1 year): $0.004/GB/month. Current usage: 2.4 TB.', 0.89, 'creative', 'creative_asset_storage_cost')
ON CONFLICT (content_key) DO NOTHING;

-- Seed Financial division facts
INSERT INTO hydi_facts (content, confidence, division, content_key)
VALUES
  ('ForgeFinder unclaimed funds database contains 47,000 records. Average recovery per person: $1,200. Processing fee: 15% + $50 flat fee. Legal compliance: all claims verified against state treasury.', 0.88, 'financial', 'financial_forgefinder_metrics'),
  ('Funding Finder sources grants from 500+ foundations. Best ROI sectors: cleantech (45% approval rate), healthcare (38%), education (32%). Application cost: $0 (internal staff). Processing: 2-3 months.', 0.82, 'financial', 'financial_funding_finder_sources'),
  ('HQ Finder land deals: target price range $800-1200/acre for commercial zoning. VA loan strategy saves $120k+ on qualified properties. Typical deal timeline: 90 days. Commission structure: 2% finder fee.', 0.86, 'financial', 'financial_hq_finder_deals'),
  ('ProtoForge cash reserves: $340k in checking, $500k in money market (5.2% APY), $200k in short-term bonds. Burn rate: $28k/month. Runway: 28 months. Target: $1M ARR by Q4 2026.', 0.91, 'financial', 'financial_cash_reserves')
ON CONFLICT (content_key) DO NOTHING;

-- Seed Operations division facts
INSERT INTO hydi_facts (content, confidence, division, content_key)
VALUES
  ('ProtoForge vendor management: 12 critical vendors (GCP, Supabase, DistroKid, etc.). All have SLAs with 99.9% uptime guarantees. Annual vendor spend: $85k. Audit schedule: quarterly.', 0.90, 'operations', 'operations_vendor_management'),
  ('PorchWise family onboarding: intake form → background check (48hrs) → initial setup session (1 hr) → 30-day trial (free). Conversion rate: 62%. NPS score: 8.2/10.', 0.83, 'operations', 'operations_porch_wise_onboarding'),
  ('Toby CLI agent registration requires: manifest JSON, health check endpoint, service account credentials. Agents can claim leases for up to 120 seconds. Auto-renewal every 90 seconds if healthy.', 0.91, 'operations', 'operations_toby_agent_registration'),
  ('ProtoForge security audit: conducted quarterly by third-party firm. Latest findings: 2 high-priority (secrets rotation), 4 medium (encryption gaps), 6 low (logging). Target remediation: 30 days.', 0.89, 'operations', 'operations_security_audit'),
  ('Z-Aero Scholarship: awarded $50k/year to 10 aviation students. Partnership with 8 flight schools. Application deadline: June 15 annually. Expected enrollment impact: 12-15 new pilots over 10 years.', 0.85, 'operations', 'operations_zaero_scholarship')
ON CONFLICT (content_key) DO NOTHING;

-- Seed Heidi system facts
INSERT INTO hydi_facts (content, confidence, division, content_key)
VALUES
  ('Heidi procedural memory system uses three-tier architecture: Hot (Redis, sub-ms), Warm (pgvector, cosine similarity), Cold (knowledge graph). Total capacity: 100k facts per division.', 0.93, 'heidi', 'heidi_memory_architecture'),
  ('Heidi decision bounds: auto-approve threshold is 0.85 confidence. Max auto-approve amount is $10,000 per transaction. Lease TTL is 120 seconds with renewal every 90s. All decisions logged to heidi_events.', 0.96, 'heidi', 'heidi_decision_bounds'),
  ('Heidi reflection cycle runs every 60 minutes. Analyzes last 20 decisions, reports approval/block/review rates, suggests threshold adjustments. Insights stored in heidi_reflections for autonomous learning.', 0.91, 'heidi', 'heidi_reflection_cycle'),
  ('Heidi semantic search uses 1536-dimensional embeddings from Ollama nomic-embed-text model. Similarity threshold for retrieval is 0.6 (cosine). Client-side fallback if pgvector RPC fails.', 0.88, 'heidi', 'heidi_semantic_search')
ON CONFLICT (content_key) DO NOTHING;
