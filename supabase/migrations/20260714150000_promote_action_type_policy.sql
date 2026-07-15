-- Promotes a real, active ProtoForge policy for Heidi's actual action
-- vocabulary (create_task, send_email, update_database, fetch_data,
-- schedule_event) — see HYDI_KERNEL_ARCHITECTURE_ROADMAP.md.
--
-- Does NOT activate the seed policy from 20260528000002_policies_table.sql
-- (baseline-v1, version 1): its budget-auto-approve rule
-- (revenue_impact <= 100 -> approve, no other condition) would auto-approve
-- every single action, since lib/protoforge/action-gate.ts hardcodes
-- revenue_impact=0 for every hypothesis today (no real revenue-impact
-- model exists yet). That seed row is left in place, inactive, as
-- historical placeholder data — not something to accidentally activate.
--
-- Risk tiers (2026-07-14 decision): confidence/risk are the same
-- degenerate values (confidence=0, risk=1) for every action today, since
-- no real CASCADE classifier exists yet — action_type is the only
-- meaningful signal a policy can currently use. Tiered by actual blast
-- radius:
--   - fetch_data (read-only), create_task / schedule_event (internal,
--     reversible record-keeping) -> approve
--   - update_database (writes — though lib/action-executor.ts already
--     scopes this to the sessions table only), send_email (external,
--     irreversible, reputational risk) -> escalate for human review
-- Nothing auto-rejects. Revisit the confidence/risk thresholds once a
-- real CASCADE classifier exists (see the honesty note in
-- lib/protoforge/action-gate.ts).
--
-- This alone does not turn on enforcement — PROTOFORGE_ENFORCE_ACTIONS
-- must also be set to 'true' (lib/protoforge/action-gate.ts's
-- isEnforcing()). Applying this migration only makes a real policy
-- available to evaluate against; observe-only mode stays the default
-- until that env var is deliberately flipped.

-- Idempotent on re-run via WHERE NOT EXISTS rather than ON CONFLICT: this
-- row would violate two different unique constraints on a second run —
-- policies_stream_version_unique (stream, version) AND
-- idx_policies_one_active_per_stream (one active row per stream, this
-- being active). ON CONFLICT only suppresses the specific arbiter it
-- names; Postgres evaluates unique indexes in an unspecified order, so
-- `ON CONFLICT (stream, version) DO NOTHING` still raised on the OTHER
-- constraint here rather than being suppressed (verified against a local
-- Postgres instance) — same class of bug just fixed for the previous two
-- migrations (CREATE POLICY/CREATE TRIGGER having no IF NOT EXISTS).
-- WHERE NOT EXISTS sidesteps the ambiguity: on a second run the row is
-- never attempted at all, so no constraint is ever checked.
insert into public.policies (version, stream, name, description, rules, author, is_active)
select
  2,
  null,
  'action-type-tiered-v1',
  'Tiers Heidi''s 5 real action types by actual blast radius: read-only/internal actions auto-approve, external/write actions escalate for human review. Nothing auto-rejects. Written because the seed baseline-v1 policy would auto-approve everything given action-gate.ts''s current revenue_impact=0.',
  '{
    "version": "1",
    "default": "escalate",
    "rules": [
      {
        "id": "auto-approve-safe-actions",
        "if": { "action_type": { "in": ["fetch_data", "create_task", "schedule_event"] } },
        "then": "approve",
        "priority": 1
      },
      {
        "id": "escalate-external-or-write-actions",
        "if": { "action_type": { "in": ["update_database", "send_email"] } },
        "then": "escalate",
        "priority": 2
      }
    ]
  }'::jsonb,
  'system',
  true
where not exists (
  select 1 from public.policies where stream is null and version = 2
);
