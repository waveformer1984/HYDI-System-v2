# HYDI Unified Memory Engine

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    UNIFIED MEMORY API                            │
│              (Single interface, 4 storage layers)                │
└──────────────────────────────┬──────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  SHORT-TERM      │  │  PROCEDURAL      │  │  KNOWLEDGE       │
│  (Redis)         │  │  (Supabase)      │  │  (Supabase)      │
├──────────────────┤  ├──────────────────┤  ├──────────────────┤
│ • Conversations  │  │ • Workflows      │  │ • Docs           │
│ • Running tasks  │  │ • Patterns       │  │ • Code           │
│ • Temp context   │  │ • Confidence     │  │ • Architecture   │
│ • TTL: 24h       │  │ • Optimizations  │  │ • History        │
└──────────────────┘  └──────────────────┘  └──────────────────┘
        │                      │                      │
        └──────────────────────┼──────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   SEMANTIC LAYER     │
                    │  (pgvector + Ollama) │
                    ├──────────────────────┤
                    │ • Embeddings         │
                    │ • Vector search      │
                    │ • Code search        │
                    │ • Doc search         │
                    └──────────────────────┘
```

## Database Schema

### Procedural Memory (workflows table)

```sql
CREATE TABLE procedural_workflows (
  id UUID PRIMARY KEY,
  name VARCHAR NOT NULL,
  description TEXT,
  
  -- Task definition
  task_type VARCHAR NOT NULL,
  inputs JSONB,
  outputs JSONB,
  
  -- Execution record
  success_count INT DEFAULT 0,
  failure_count INT DEFAULT 0,
  avg_duration_ms FLOAT,
  
  -- Confidence scoring
  confidence FLOAT DEFAULT 0.0,  -- 0-1
  last_success TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Optimization hints
  optimizations JSONB,
  dependencies JSONB,
  
  -- Source tracking
  source_agent VARCHAR,
  source_context JSONB,
  
  -- Enabled for autonomous execution?
  autonomous_ready BOOLEAN DEFAULT FALSE,
  user_approved BOOLEAN DEFAULT FALSE
);
```

### Knowledge Memory (documents table)

```sql
CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY,
  title VARCHAR NOT NULL,
  content TEXT NOT NULL,
  content_type VARCHAR,  -- 'code', 'doc', 'architecture', 'decision'
  
  -- Vector embedding for search
  embedding vector(1536),
  
  -- Metadata
  source_path VARCHAR,
  last_updated TIMESTAMP,
  tags TEXT[],
  
  -- Search optimization
  indexed BOOLEAN DEFAULT TRUE,
  search_score FLOAT
);
```

### Semantic Index (embeddings table)

```sql
CREATE TABLE semantic_index (
  id UUID PRIMARY KEY,
  content_id UUID REFERENCES knowledge_documents(id),
  chunk_index INT,
  chunk_text TEXT,
  
  embedding vector(1536),
  
  -- Metadata for ranking
  relevance_score FLOAT,
  retrieval_count INT DEFAULT 0
);
```

## Service Interface

```typescript
// memory-engine.js
interface MemoryEngine {
  // Write operations
  storeWorkflow(workflow: Workflow): Promise<void>;
  storeDocument(doc: Document): Promise<void>;
  recordInteraction(interaction: Interaction): Promise<void>;
  
  // Read operations
  getWorkflow(id: string): Promise<Workflow>;
  getWorkflows(filter: Filter): Promise<Workflow[]>;
  searchDocuments(query: string, limit: number): Promise<Document[]>;
  searchCode(query: string): Promise<CodeMatch[]>;
  
  // Learning
  updateWorkflowConfidence(id: string, feedback: Feedback): Promise<void>;
  suggestOptimizations(workflow: Workflow): Promise<Optimization[]>;
  
  // Vector search
  semanticSearch(query: string, limit: number): Promise<Match[]>;
  
  // Cleanup
  expireShortTerm(): Promise<void>;
  archiveOldWorkflows(): Promise<void>;
}
```

## Integration Points

1. **Supervisor Core** → Logs all service health to procedural memory
2. **Task Orchestrator** → Records every task execution, success/failure
3. **Agents** → Learn from feedback, store patterns
4. **Dashboard** → Query memory for statistics
5. **Learning Engine** → Analyze workflows, suggest optimizations

## Confidence Scoring Algorithm

```
confidence = (success_count / (success_count + failure_count)) 
           × (1 - (days_since_last_success / 365))
           × (frequency_multiplier)

Where:
- success_count: historical successes
- failure_count: historical failures  
- days_since_last_success: recency penalty
- frequency_multiplier: workflows used often are more trusted

Thresholds:
- 95%+ = autonomous execution
- 85-95% = propose automation
- 70-85% = track but don't automate
- <70% = learning phase, always ask
```

## Workflow Learning Example

```json
{
  "workflow": {
    "id": "wf-proposal-generation",
    "name": "Generate Client Proposal",
    "task_type": "business/proposal",
    "inputs": {
      "client_name": "string",
      "scope": "string",
      "budget_range": "range"
    },
    "steps": [
      {
        "agent": "business-agent",
        "action": "research-client"
      },
      {
        "agent": "business-agent", 
        "action": "estimate-resources"
      },
      {
        "agent": "business-agent",
        "action": "generate-proposal"
      }
    ],
    "outputs": {
      "proposal_doc": "string",
      "estimated_cost": "number",
      "timeline_days": "number"
    },
    "statistics": {
      "success_count": 47,
      "failure_count": 3,
      "avg_duration_ms": 45000,
      "confidence": 0.94
    },
    "optimizations": [
      "Parallelize research and estimation steps",
      "Cache client data for 30 days"
    ],
    "autonomous_ready": true,
    "user_approved": true
  }
}
```
