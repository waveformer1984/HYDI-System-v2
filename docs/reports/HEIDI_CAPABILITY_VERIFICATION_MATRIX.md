# Capability verification matrix (revenue + execution)

**Source of truth:** `lib/revenue-ops/capabilities.js`, `lib/heidi/CapabilityRegistry.ts`

| Capability ID | Category | executionReady (revenue-ops) | Registry verification | Notes |
|---------------|----------|-------------------------------|----------------------|-------|
| `web_fullstack` | Website / full-stack | true | VERIFICATION_ABSENT | Used in live opportunity matching |
| `ai_agent_dev` | AI agents | true | VERIFICATION_ABSENT | Top match on 2026-11-15 live lead |
| `automation_workflow` | Automation | true | VERIFICATION_ABSENT | n8n-style work |
| `tech_research_docs` | Research/docs | true | VERIFICATION_ABSENT | |
| `api_integration` | APIs | true | VERIFICATION_ABSENT | |
| `testing_qa` | Testing | partial | VERIFICATION_ABSENT | |

**Gap:** Registry audit reports **77× VERIFICATION_ABSENT** — revenue `executionReady` is **declarative**, not Frank-proven.

**Honest scoring:** `assessOpportunity()` downgrades when `matchScore < 20` or `!economicallyViable`.