# Procedural Memory Implementation Plan

## Overview

This document outlines the implementation of a reflection + procedural-memory loop for Heidi. This enables Heidi to learn from its own actions, extract reusable lessons, and apply them to future tasks.

## Current State Analysis

### Existing Components

**Semantic Memory** (`heidi-semantic-memory.js`)
- Stores facts with embeddings
- Uses cosine similarity for retrieval
- Local JSON fallback at `.heidi-memory.json`
- Schema: id, content, embedding, source, importance, ts
- Already has extraction from chat conversations

**Action Executor** (`action-executor.js`)
- Executes actions: run_script, run_command, write_file, read_file, api_call, log_event
- Execution log: action, result, duration_ms, timestamp, error
- Safety checks on action types, commands, domains

**Agent Loop** (`heidi-agent-loop.js`)
- Observes → reasons → acts pattern
- World model stores correlation rules from observation history
- Stores observations in `heidi_observations` table
- Pending actions require operator authorization

## Design: Procedural Memory Schema

### Table: `heidi_procedural_lessons`

```sql
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

-- Indexes for similarity search
create index if not exists idx_procedural_situation_emb on public.heidi_procedural_lessons using ivfflat (situation_emb vector_cosine_ops);
create index if not exists idx_procedural_lesson_emb on public.heidi_procedural_lessons using ivfflat (lesson_emb vector_cosine_ops);
create index if not exists idx_procedural_device_id on public.heidi_procedural_lessons(device_id);
create index if not exists idx_procedural_confidence on public.heidi_procedural_lessons(confidence desc);

-- RLS
alter table public.heidi_procedural_lessons enable row level security;

-- Service role can do everything
drop policy if exists "service_role_all" on public.heidi_procedural_lessons;
create policy "service_role_all" on public.heidi_procedural_lessons
    for all to service_role using (true) with check (true);
```

### Local JSON Fallback: `.heidi-procedural-memory.json`

```json
{
  "device_id": {
    "lessons": [
      {
        "id": "pl_1234567890_abcde",
        "situation": "When user asks to deploy to staging",
        "situation_emb": [0.1, 0.2, ...],
        "action_type": "run_script",
        "action_summary": "deploy.sh with --env=staging",
        "outcome": "success",
        "outcome_detail": "Deploy completed in 45s",
        "lesson": "Always run health check after deploy",
        "lesson_emb": [0.3, 0.4, ...],
        "confidence": 0.8,
        "application_count": 5,
        "success_count": 4,
        "last_applied_at": "2026-06-25T10:00:00Z",
        "created_at": "2026-06-20T15:30:00Z",
        "updated_at": "2026-06-25T10:00:00Z"
      }
    ]
  }
}
```

## Design: Reflection Prompt

### When to Trigger Reflection

1. **After action execution** (in action-executor.js)
   - When an action completes (success or failure)
   - When an action fails with a specific error pattern
   - After a sequence of related actions completes

2. **After agent loop cycle** (in heidi-agent-loop.js)
   - After a decision is made and acted upon
   - When a queued action is authorized and executed

### Reflection Prompt Template

```
You are Heidi's reflection engine. Analyze this action execution and extract reusable lessons.

USER REQUEST: {user_request}
ACTION TAKEN: {action_type} - {action_summary}
OUTCOME: {outcome} {outcome_detail}
CONTEXT: {additional_context}

Extract 0-2 procedural lessons from this execution:
- A lesson should be a reusable rule that applies to similar future situations
- Focus on patterns: "for X-type requests, always do Y before Z"
- If the action failed, extract what should have been done differently
- If the action succeeded, extract what made it successful
- If nothing is reusable, output NONE

Format as JSON:
{
  "lessons": [
    {
      "situation": "When user asks to deploy to staging",
      "lesson": "Always run health check after deploy",
      "confidence": 0.8
    }
  ]
}
```

### Example Reflections

**Success case:**
```
USER REQUEST: Deploy the latest build to staging
ACTION TAKEN: run_script - deploy.sh --env=staging
OUTCOME: success - Deploy completed in 45s
CONTEXT: Previous deploy failed due to missing health check

LESSON:
{
  "lessons": [
    {
      "situation": "When user asks to deploy to staging",
      "lesson": "Always run health check after deploy",
      "confidence": 0.9
    }
  ]
}
```

**Failure case:**
```
USER REQUEST: Check database connection
ACTION TAKEN: api_call - GET /api/health
OUTCOME: failure - Connection timeout after 30s
CONTEXT: Database was recently migrated

LESSON:
{
  "lessons": [
    {
      "situation": "When database operations timeout",
      "lesson": "Retry with exponential backoff up to 3 times before reporting failure",
      "confidence": 0.7
    }
  ]
}
```

## Design: Retrieval Mechanism

### When to Retrieve Lessons

1. **Before action execution** (in action-executor.js)
   - When an action is about to be executed
   - Query for lessons matching the current situation

2. **Before agent reasoning** (in heidi-agent-loop.js)
   - Before the reasoning step
   - Include relevant lessons in the prompt

### Retrieval Algorithm

```javascript
async function retrieveProceduralLessons(deviceId, situation, ollamaUrl, supabase = null) {
    // 1. Embed the situation
    const situationEmbed = await embed(situation, ollamaUrl);
    if (!situationEmbed) return [];
    
    // 2. Try Supabase first (vector similarity search)
    if (supabase) {
        try {
            const { data, error } = await supabase.rpc('match_procedural_lessons', {
                query_device_id: deviceId,
                query_embedding: situationEmbed,
                match_threshold: 0.75,
                max_results: 3
            });
            if (!error && data) return data;
        } catch (e) {
            console.log('[ProceduralMemory] Supabase retrieval failed, falling back to local');
        }
    }
    
    // 3. Fall back to local JSON
    const store = loadProceduralStore();
    const lessons = store[deviceId]?.lessons || [];
    
    const scored = lessons
        .filter(l => l.situation_emb)
        .map(l => ({
            ...l,
            sim: cosine(situationEmbed, l.situation_emb)
        }))
        .filter(l => l.sim >= 0.75)
        .sort((a, b) => b.confidence * b.sim - a.confidence * a.sim)
        .slice(0, 3);
    
    return scored;
}
```

### Supabase RPC Function for Vector Search

```sql
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
    success_count float,
    similarity float
)
language sql
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
        and 1 - (l.situation_emb <=> query_embedding) > match_threshold
    order by (l.confidence * (1 - (l.situation_emb <=> query_embedding))) desc
    limit max_results;
$$;
```

## Design: Integration Points

### 1. Action Executor Integration (`action-executor.js`)

**After action execution:**
```javascript
async execute(action) {
    // ... existing execution logic ...
    
    const execution = {
        action,
        result: result ? 'success' : 'failed',
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        error: error?.message
    };
    
    this.executionLog.push(execution);
    
    // NEW: Trigger reflection after execution
    if (this.reflectionEnabled) {
        this.emit('action_completed', execution);
    }
    
    return { success: result !== null, result, execution };
}
```

### 2. Agent Loop Integration (`heidi-agent-loop.js`)

**Before reasoning:**
```javascript
async _reason(obs) {
    // NEW: Retrieve relevant procedural lessons
    const lessons = await this._retrieveProceduralLessons(obs.summary);
    
    const lessonsContext = lessons.length
        ? `\nRELEVANT LESSONS (learned from past actions):\n${lessons.map(l => `  - ${l.lesson} (confidence: ${l.confidence})`).join('\n')}`
        : '';
    
    const prompt = `...${lessonsContext}...`;
    
    // ... existing reasoning logic ...
}
```

**After action execution:**
```javascript
async _act(decision, obs) {
    // ... existing action logic ...
    
    // NEW: Trigger reflection after consequential actions
    if (decision.action !== 'no_action') {
        await this._reflectOnAction(decision, obs);
    }
}
```

### 3. New Module: `heidi-procedural-memory.js`

```javascript
/**
 * Heidi Procedural Memory
 * Stores and retrieves lessons learned from action execution.
 * Uses vector similarity to find relevant lessons for new situations.
 */

const fs = require('fs');
const path = require('path');

const PROCEDURAL_FILE = path.join(__dirname, '.heidi-procedural-memory.json');
const MAX_LESSONS = 200;
const MIN_SIM = 0.75;

// ... implementation similar to semantic memory ...
```

## Implementation Steps

### Phase 1: Core Infrastructure
1. Create migration for `heidi_procedural_lessons` table
2. Create `heidi-procedural-memory.js` module
3. Implement local JSON storage/retrieval
4. Implement embedding and similarity search

### Phase 2: Reflection Integration
1. Add reflection trigger to action-executor.js
2. Design and implement reflection prompt
3. Add lesson extraction logic
4. Test with sample actions

### Phase 3: Retrieval Integration
1. Add retrieval to agent loop reasoning
2. Add retrieval to action executor before execution
3. Implement Supabase RPC function for vector search
4. Test lesson application

### Phase 4: Learning Loop
1. Implement confidence scoring (increase on success, decrease on failure)
2. Add application counting
3. Implement lesson pruning (remove low-confidence lessons)
4. Add metrics/visualization for learning progress

### Phase 5: Evaluation
1. Create eval harness with held-out tasks
2. Measure performance improvement over time
3. A/B test with/without procedural memory
4. Tune similarity thresholds and confidence decay

## Safety Considerations

1. **Lesson validation**: Lessons should be reviewed before high-confidence application
2. **Confidence capping**: Start lessons at low confidence, build up over time
3. **Lesson expiration**: Old lessons should decay or be re-validated
4. **Human oversight**: Critical lessons should require operator approval
5. **Sandboxing**: Lessons that suggest new actions should be gated

## Success Metrics

1. **Learning rate**: How many lessons are extracted per 100 actions?
2. **Application rate**: How often are lessons retrieved and applied?
3. **Success rate**: Do lessons actually improve outcomes?
4. **Generalization**: Do lessons apply to novel situations?
5. **Efficiency**: Does procedural memory reduce execution time?

## Next Steps

1. Review and approve this plan
2. Create migration file
3. Implement `heidi-procedural-memory.js` module
4. Add integration points to action-executor.js
5. Add integration points to heidi-agent-loop.js
6. Test with sample scenarios
7. Deploy and monitor
