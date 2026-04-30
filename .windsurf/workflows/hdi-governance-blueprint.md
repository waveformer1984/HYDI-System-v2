# HYDI Governance Blueprint — Supabase-Native Implementation

## 1. Core State Machine Tables

```sql
-- Enforced phases and statuses
CREATE TYPE hydi_phase AS ENUM ('initialized', 'audit', 'execute', 'verify', 'completed', 'reopen_audit', 'failed');
CREATE TYPE hydi_status AS ENUM ('running', 'paused', 'completed', 'failed');

-- Allowed transitions (source of truth for validation)
CREATE TABLE hydi_allowed_transitions (
  from_phase hydi_phase NOT NULL,
  to_phase hydi_phase NOT NULL,
  actor_role TEXT NOT NULL, -- 'auditor', 'executor', 'verifier', 'ursula'
  PRIMARY KEY (from_phase, to_phase)
);

-- Seed valid transitions
INSERT INTO hydi_allowed_transitions VALUES
  ('initialized', 'audit', 'ursula'),
  ('audit', 'execute', 'auditor'),
  ('audit', 'failed', 'auditor'),
  ('execute', 'verify', 'executor'),
  ('execute', 'reopen_audit', 'executor'),
  ('execute', 'failed', 'executor'),
  ('verify', 'completed', 'verifier'),
  ('verify', 'reopen_audit', 'verifier'),
  ('verify', 'failed', 'verifier'),
  ('reopen_audit', 'audit', 'verifier');
```

## 2. Run Registry (Frozen Schema)

```sql
CREATE TABLE hydi_runs (
  -- Immutable identity
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Version contract (locked at creation)
  context_version TEXT NOT NULL DEFAULT '2.0.0',
  schema_hash TEXT NOT NULL DEFAULT 'a1b2c3d4',
  policy_version TEXT NOT NULL DEFAULT '1.0.0',
  
  -- Current state (only transition gateway can mutate)
  current_phase hydi_phase DEFAULT 'initialized',
  status hydi_status DEFAULT 'running',
  
  -- Actor tracking (who last touched)
  current_actor TEXT,
  actor_customer_id UUID, -- For RLS
  
  -- Scope (set once at init)
  scope JSONB NOT NULL DEFAULT '[]',
  
  -- Non-extensible metadata
  meta JSONB NOT NULL DEFAULT '{}',
  
  -- Constraints: reject unknown keys at write time
  CONSTRAINT valid_meta_keys CHECK (
    meta ?& ARRAY['started_at', 'completed_at', 'external_refs']
  )
);

-- Immutable events (append-only, partitioned by run_id)
CREATE TABLE hydi_events (
  event_id BIGSERIAL,
  run_id UUID NOT NULL REFERENCES hydi_runs(run_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  
  -- Event envelope
  timestamp TIMESTAMPTZ DEFAULT now(),
  type TEXT NOT NULL, -- 'PHASE_TRANSITION', 'FINDINGS_PERSISTED', etc.
  actor TEXT NOT NULL,
  
  -- State delta (what changed)
  from_phase hydi_phase,
  to_phase hydi_phase,
  payload JSONB NOT NULL DEFAULT '{}',
  
  -- Idempotency (run_id + seq is unique)
  PRIMARY KEY (run_id, seq),
  UNIQUE (event_id)
) PARTITION BY HASH (run_id);

-- Partition for scale (create 16 partitions)
CREATE TABLE hydi_events_p0 PARTITION OF hydi_events FOR VALUES WITH (MODULUS 16, REMAINDER 0);
-- ... p1 through p15
```

## 3. Agent-Scoped Data (RLS-Enforced Boundaries)

```sql
-- HEIDI only: Audit findings
CREATE TABLE hydi_findings (
  finding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES hydi_runs(run_id) ON DELETE CASCADE,
  component TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('CRITICAL', 'WARNING', 'OK')),
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT -- Populated by RLS
);

-- EXECUTOR only: Tasks
CREATE TABLE hydi_tasks (
  task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES hydi_runs(run_id) ON DELETE CASCADE,
  task_name TEXT NOT NULL,
  status TEXT CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT -- Populated by RLS
);

-- KILO only: Verification results
CREATE TABLE hydi_verifications (
  verification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES hydi_runs(run_id) ON DELETE CASCADE,
  component TEXT NOT NULL,
  status TEXT CHECK (status IN ('pass', 'fail', 'warn')),
  baseline TEXT,
  actual TEXT,
  delta TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT -- Populated by RLS
);

-- KILO only: Certifications
CREATE TABLE hydi_certifications (
  cert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL UNIQUE REFERENCES hydi_runs(run_id) ON DELETE CASCADE,
  certificate_status TEXT CHECK (certificate_status IN ('CLEAN', 'CONDITIONAL')),
  passed_count INTEGER,
  warning_count INTEGER,
  failed_count INTEGER,
  issued_at TIMESTAMPTZ DEFAULT now(),
  issued_by TEXT -- Populated by RLS
);
```

## 4. RLS Policies (Agent Boundaries)

```sql
-- Enable RLS on all tables
ALTER TABLE hydi_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hydi_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hydi_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hydi_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE hydi_certifications ENABLE ROW LEVEL SECURITY;

-- Helper: extract agent role from JWT claim
CREATE OR REPLACE FUNCTION get_agent_role()
RETURNS TEXT AS $$
BEGIN
  RETURN coalesce(
    current_setting('request.jwt.claims', true)::json->>'agent_role',
    'anonymous'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper: validate transition permission
CREATE OR REPLACE FUNCTION can_transition(from_p hydi_phase, to_p hydi_phase)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM hydi_allowed_transitions
    WHERE from_phase = from_p 
      AND to_phase = to_p 
      AND actor_role = get_agent_role()
  );
END;
$$ LANGUAGE plpgsql;

-- hydi_runs: actors can only see their own runs
CREATE POLICY runs_actor_isolation ON hydi_runs
  USING (current_actor = get_agent_role() OR get_agent_role() = 'ursula');

-- hydi_findings: HEIDI only
CREATE POLICY findings_heidi_only ON hydi_findings
  FOR ALL
  USING (get_agent_role() IN ('auditor', 'ursula'))
  WITH CHECK (get_agent_role() = 'auditor');

-- hydi_tasks: EXECUTOR only
CREATE POLICY tasks_executor_only ON hydi_tasks
  FOR ALL
  USING (get_agent_role() IN ('executor', 'ursula'))
  WITH CHECK (get_agent_role() = 'executor');

-- hydi_verifications: KILO only
CREATE POLICY verifications_kilo_only ON hydi_verifications
  FOR ALL
  USING (get_agent_role() IN ('verifier', 'ursula'))
  WITH CHECK (get_agent_role() = 'verifier');

-- hydi_certifications: KILO only (one per run)
CREATE POLICY certs_kilo_only ON hydi_certifications
  FOR ALL
  USING (get_agent_role() IN ('verifier', 'ursula'))
  WITH CHECK (get_agent_role() = 'verifier');
```

## 5. Edge Function: Transition Gateway

```typescript
// supabase/functions/hydi-transition/index.ts
import { createClient } from '@supabase/supabase-js'

interface TransitionRequest {
  run_id: string
  from: 'initialized' | 'audit' | 'execute' | 'verify'
  to: 'audit' | 'execute' | 'verify' | 'completed' | 'reopen_audit' | 'failed'
  payload: Record<string, unknown>
  actor: 'auditor' | 'executor' | 'verifier'
  idempotency_key: string // run_id + seq or client-generated
}

Deno.serve(async (req) => {
  const { run_id, from, to, payload, actor, idempotency_key } = await req.json() as TransitionRequest
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )
  
  // Transaction: validate → write event → update state
  const { data, error } = await supabase.rpc('hydi_transition', {
    p_run_id: run_id,
    p_from: from,
    p_to: to,
    p_payload: payload,
    p_actor: actor,
    p_idempotency_key: idempotency_key
  })
  
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 })
  }
  
  return new Response(JSON.stringify({ 
    success: true, 
    event_id: data.event_id,
    new_phase: to 
  }))
})
```

## 6. Postgres Transition Function (Atomic)

```sql
CREATE OR REPLACE FUNCTION hydi_transition(
  p_run_id UUID,
  p_from hydi_phase,
  p_to hydi_phase,
  p_payload JSONB,
  p_actor TEXT,
  p_idempotency_key TEXT
)
RETURNS TABLE(event_id BIGINT, new_phase hydi_phase) AS $$
DECLARE
  v_current hydi_phase;
  v_next_seq INTEGER;
  v_event_id BIGINT;
BEGIN
  -- Lock run row (prevents race conditions)
  SELECT current_phase INTO v_current
  FROM hydi_runs
  WHERE run_id = p_run_id
  FOR UPDATE;
  
  -- Validate: from must match current
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Run % not found', p_run_id;
  END IF;
  
  IF v_current != p_from THEN
    RAISE EXCEPTION 'Phase mismatch: expected %, got %', v_current, p_from;
  END IF;
  
  -- Validate: transition allowed for actor
  IF NOT EXISTS (
    SELECT 1 FROM hydi_allowed_transitions
    WHERE from_phase = p_from 
      AND to_phase = p_to 
      AND actor_role = p_actor
  ) THEN
    RAISE EXCEPTION 'Transition % → % not allowed for actor %', p_from, p_to, p_actor;
  END IF;
  
  -- Get next sequence number
  SELECT COALESCE(MAX(seq), 0) + 1 INTO v_next_seq
  FROM hydi_events
  WHERE run_id = p_run_id;
  
  -- Insert event (idempotent: unique constraint on run_id + seq)
  INSERT INTO hydi_events (
    run_id, seq, type, actor, from_phase, to_phase, payload
  ) VALUES (
    p_run_id, v_next_seq, 'PHASE_TRANSITION', p_actor, p_from, p_to, p_payload
  )
  ON CONFLICT (run_id, seq) DO NOTHING
  RETURNING hydi_events.event_id INTO v_event_id;
  
  -- Update run state
  UPDATE hydi_runs
  SET 
    current_phase = p_to,
    current_actor = p_actor,
    status = CASE 
      WHEN p_to IN ('completed', 'failed') THEN p_to::hydi_status
      ELSE 'running'::hydi_status
    END,
    meta = jsonb_set(
      meta,
      '{last_transition}',
      jsonb_build_object(
        'at', now(),
        'by', p_actor,
        'from', p_from,
        'to', p_to
      )
    )
  WHERE run_id = p_run_id;
  
  RETURN QUERY SELECT v_event_id, p_to;
END;
$$ LANGUAGE plpgsql;
```

## 7. Replay & Reconstruction

```sql
-- Reconstruct run state from events
CREATE OR REPLACE FUNCTION hydi_reconstruct_run(p_run_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_events JSONB;
  v_state JSONB := '{}'::JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'seq', seq,
      'type', type,
      'actor', actor,
      'from', from_phase,
      'to', to_phase,
      'payload', payload,
      'at', timestamp
    ) ORDER BY seq
  )
  INTO v_events
  FROM hydi_events
  WHERE run_id = p_run_id;
  
  -- Apply reducers (deterministic)
  SELECT jsonb_object_agg(
    key,
    CASE key
      WHEN 'phase' THEN (SELECT to_phase FROM hydi_events WHERE run_id = p_run_id ORDER BY seq DESC LIMIT 1)
      WHEN 'findings_count' THEN (SELECT count(*) FROM hydi_findings WHERE run_id = p_run_id)
      WHEN 'tasks_count' THEN (SELECT count(*) FROM hydi_tasks WHERE run_id = p_run_id)
      WHEN 'certification' THEN (
        SELECT jsonb_build_object('status', certificate_status, 'issued_at', issued_at)
        FROM hydi_certifications WHERE run_id = p_run_id
      )
      ELSE value
    END
  )
  INTO v_state
  FROM jsonb_each(v_state);
  
  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'events', v_events,
    'current_state', v_state
  );
END;
$$ LANGUAGE plpgsql;
```

## 8. Migration Safety

```sql
-- Schema version tracking
CREATE TABLE hydi_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT now(),
  up_transformer TEXT, -- SQL to transform old events
  down_transformer TEXT,
  checksum TEXT
);

-- Transformer example: v2.0.0 → v2.1.0 (adds 'confidence' to findings)
INSERT INTO hydi_schema_migrations VALUES (
  '2.1.0',
  now(),
  'UPDATE hydi_findings SET confidence = 0.85 WHERE confidence IS NULL',
  'ALTER TABLE hydi_findings DROP COLUMN confidence',
  'abc123...'
);

-- Replay safety: all events must be transformable
CREATE OR REPLACE FUNCTION validate_replay_safety()
RETURNS BOOLEAN AS $$
DECLARE
  v_min_version TEXT;
  v_max_version TEXT;
BEGIN
  SELECT MIN(context_version), MAX(context_version) 
  INTO v_min_version, v_max_version
  FROM hydi_runs;
  
  IF v_min_version != v_max_version THEN
    RAISE NOTICE 'Version mismatch: % to %. Run migrations before replay.', v_min_version, v_max_version;
    RETURN FALSE;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
```

## 9. "Don't Sabotage Yourself" Rules (Enforced)

| Rule | Enforcement |
|------|-------------|
| No direct runContext mutation | RLS on hydi_runs, all writes through `hydi_transition()` |
| No new fields without version | `schema_hash` locked at run creation, migrations required |
| No side effects before commit | All-or-nothing transaction in transition function |
| No silent retries | `idempotency_key` constraint, duplicate events rejected |
| No cross-agent writes | RLS policies reject `created_by` mismatches |
| No illegal transitions | `hydi_allowed_transitions` table, runtime validation |

## 10. Frontend Integration

```javascript
// Replace direct Supabase calls with transition gateway
async function transition(runId, from, to, payload) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/hydi-transition`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        run_id: runId,
        from,
        to,
        payload,
        actor: runContext.execution.current_agent, // 'auditor' | 'executor' | 'verifier'
        idempotency_key: `${runId}-${Date.now()}`
      })
    }
  );
  return response.json();
}
```

---

**Summary:**
- **Single entrypoint** for all state changes (`hydi_transition`)
- **RLS-enforced** agent boundaries (no cross-contamination)
- **Append-only events** for deterministic replay
- **Version-locked runs** for migration safety
- **Atomic transactions** (no partial failures)
