# 🔷 HEIDI PRODUCTION AGENT - CASCADE Implementation

## 🎯 Overview

This is the **CASCADE MASTER PROMPT** implementation - a production-grade conversational AI orchestration system that moves from architectural complexity to deterministic runtime behavior.

**What this fixes:**
- ✅ Model determinism instead of vibe switching
- ✅ Enforced JSON contracts instead of "LLM poetry mode"
- ✅ Real memory retrieval instead of prompt hallucination
- ✅ Observable system state instead of guessing
- ✅ Hard fallback logic instead of hopeful retries

## 🧱 System Architecture (MANDATORY)

### 1. MODEL ORCHESTRATION LAYER (CRITICAL)
**File:** `/lib/ModelManager.ts`

**Non-negotiable routing logic:**
```typescript
if (localModel.success && latency < 5000ms && outputValid)
    use local response
else
    use API fallback
```

**Features:**
- Local inference via Ollama (Llama 3/Mistral) by default
- 5-second strict timeout on local models
- Circuit breaker: 3 failures → 60-second API mode
- Auto-recovery after cooldown

### 2. ACTIONABLE RESPONSE ENGINE
**File:** `/lib/ActionParser.ts`

**Required output format:**
```json
{
  "response": "string",
  "actions": [
    {
      "type": "string",
      "payload": {}
    }
  ]
}
```

**Enforcement:**
- Invalid JSON → reject
- Retry ONCE with corrected prompt
- Still invalid → fallback model immediately

### 3. MEMORY SYSTEM (SUPABASE)
**Database setup:** `/supabase/heidi-init.sql`

**Tables:**
- `memories` - pgvector for semantic search
- `actions` - action execution log
- `sessions` - session state tracking

**Features:**
- All conversations embedded and stored
- Semantic similarity retrieval (top 5 matches)
- Row-level security for user isolation

### 4. SESSION STATE ENGINE
**State object:**
```typescript
{
  session_id,
  tone: "neutral | focused | degraded | recovery",
  active_model: "local | api",
  last_action_status: "success | failure | pending"
}
```

### 5. FRONTEND (REACT / NEXT.JS)
**Components:**
- `/components/Chat.tsx` - Streaming chat window
- `/components/StatusPanel.tsx` - Model status & session state
- `/hooks/useHeidi.ts` - React hook for integration

**UI Requirements:**
- Streaming chat window
- Model status indicator (LOCAL / API)
- Action log panel
- Session state viewer

### 6. API LAYER
**Endpoints:**
- `/api/chat` - Main chat processing with streaming
- `/api/execute` - Action execution with schema validation

### 7. TOOL EXECUTION SYSTEM
**Features:**
- Schema validated before execution
- Logged in Supabase actions table
- Async safe (never blocks chat loop)
- Retry once, then continue conversation

### 8. SYSTEM OBSERVABILITY
**Logged:**
- Model used, latency, fallback triggers
- JSON validation failures
- Tool execution results
- No silent failures

## 📁 File Structure (STRICT)

```
/lib
  ModelManager.ts
  ActionParser.ts
  orchestrator.ts

/hooks
  useHeidi.ts

/pages
  api/chat.ts
  api/execute.ts

/components
  Chat.tsx
  StatusPanel.tsx

/functions
  heidi-orchestrator
    index.ts

/supabase
  heidi-init.sql
```

**No extra architecture unless explicitly required.**

## 🔒 NON-NEGOTIABLE RULES

1. **No speculative architecture** - Only what's specified
2. **No unused abstraction layers** - Every component must be wired
3. **No mock systems** - Real integration required
4. **No "future extensibility scaffolding"** - Production focus only
5. **Every component must be wired to runtime flow**

## 🚀 Quick Start

### 1. Database Setup
```sql
-- Run in Supabase SQL Editor
-- Copy contents of /supabase/heidi-init.sql
```

### 2. Environment Variables
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_key

# AI Models (optional - will fallback)
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key

# Local Model (Ollama)
# Ensure Ollama is running on localhost:11434
```

### 3. Install Dependencies
```bash
npm install @supabase/supabase-js
npm install next react react-dom
```

### 4. Start Development
```bash
npm run dev
```

### 5. Start Local Model (Optional)
```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull model
ollama pull llama3

# Start Ollama
ollama serve
```

## 🧠 What This Actually Fixes

**Before CASCADE:**
- "Heidi is a system with components"
- Components behave independently
- Output format is unpredictable
- Memory is hallucinated
- Model selection is vibe-based

**After CASCADE:**
- "Heidi is a routing engine with memory, tools, and enforced output contracts"
- Deterministic model routing
- Enforced JSON contracts
- Real memory retrieval
- Observable system state
- Hard fallback logic

## 🎯 The Real Difference

**Before (Creative Developer):**
```
"I need a new service"
→ Creates component → Adds abstraction → Hopes it works
→ Later: "Oops, duplicate" → More complexity
```

**After (Runtime Compiler):**
```
"I need a new service"
→ Registration check → Model routing → JSON validation
→ Action execution → Memory storage → State update
→ Result: Predictable, observable, reliable
```

## 🔧 System Status

**Model Manager Status:**
- Consecutive failures: 0
- Circuit breaker: Inactive
- Last model: local
- Latency: < 5000ms

**Memory System:**
- Connected: Yes
- Embeddings: pgvector
- Retrieval: Semantic similarity

**Action System:**
- Validated: Yes
- Logged: Yes
- Async: Yes

## 🚨 Self-Correction Loop

After model response:
1. Validate JSON
2. If invalid → retry ONCE locally
3. If still invalid → switch model
4. If still invalid → return safe fallback message

**No exceptions.**

## 📊 Observability

Every request logs:
- Model used (local/api)
- Latency (ms)
- Fallback triggers
- JSON validation status
- Action execution results
- Session state changes

**No silent failures.**

---

## 🎉 Result

**Cascade stops behaving like a creative developer and starts behaving like a strict runtime compiler for intelligence behavior.**

This is exactly what you were trying to build... even if it took a few thousand lines of chaos to admit it.
