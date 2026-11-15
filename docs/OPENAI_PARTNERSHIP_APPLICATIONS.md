# OpenAI partnership application package (draft — human review required)

**Status:** **REQUIRES OPERATOR APPROVAL** before any submission.  
**Do not** impersonate the project owner or submit via automated agents.

---

## 1. Executive overview (≤ 200 words)

HYDI (Heidi / HYDI System v2) is a **local-first, approval-gated AI orchestration platform** that runs deterministic event pipelines (CASCADE → KILO → ProtoForge), mobile operations, and an **ExecutionGateway** for typed actions and long-running jobs. The system defaults to **$0 operation** (Ollama, local Supabase) with explicit operator consent for paid model calls.

HYDI coordinates specialized agents (architecture, security, QA, revenue discovery) that **submit work through ExecutionGateway** rather than executing autonomously. Distributed workers (home PC, cloud agents, GitHub Actions) queue and authenticate with HMAC + replay protection (PR #590).

We seek OpenAI partnership for **API credits**, **technical collaboration on agentic tool-calling and evals**, and optional **Codex** acceleration — while preserving provider independence.

## 2. Technical architecture summary

- **Runtime:** Node 22+, Next.js, Supabase (local or hosted), PM2 on operator host (“Frank”)
- **Pipeline:** Six-layer boundary-enforced event processing; KILO never executes
- **Execution:** `lib/execution-fabric/gateway.js` — canonical authority
- **Mobile:** Heidi Mobile BFF, fabric capabilities, sealed device cookies
- **Security:** `paid-llm-gate`, RBAC on fabric, human approval for external/financial actions
- **Distributed:** File-backed control plane (PR #590), same-host concurrency lock

## 3. Founder / project background (template)

| Field | Operator completes |
|-------|-------------------|
| Legal entity name | _ |
| HQ / jurisdiction | _ |
| Founding date | _ |
| Team size | _ |
| Funding stage | _ |
| VC partner (if any) | _ |
| OpenAI Organization ID | _ (platform settings) |
| Primary contact email | _ (business domain) |

## 4. API credit request (draft)

**Product:** HYDI orchestration and mobile ops for AI-assisted infrastructure and revenue workflows.

**Planned API use (if credits granted):**

- Responses API with tool calling for Heidi operator assistance (server-side only)
- Structured outputs for mission/evidence JSON
- Embeddings **only if** operator sets `EMBEDDING_PROVIDER=openai` explicitly
- Eval harness for regression on agent prompts (no customer PII in eval fixtures)

**Safeguards:**

- `HYDI_ALLOW_PAID_LLM` master switch
- No keys in client bundles
- Simulated classification default in tests

## 5. Codex for Open Source (draft outline)

- **Repo:** https://github.com/waveformer1984/HYDI-System-v2  
- **License:** _(operator: confirm repo license)_  
- **OSS narrative:** Open orchestration patterns, mobile-first ops, governance gates  
- **Evidence:** Public docs, CI tests, contribution guides  
- **Apply only if** official program criteria match — **verify URL at submission time**

## 6. Startup program (community)

- Join Build Hours / startup events via https://openai.com/startups/  
- Prepare 2-minute demo: `docs/HYDI_OPENAI_DEMO.md`

## 7. Technical collaboration request (draft)

Topics: multi-agent scheduling, eval-driven policy (ProtoForge DSL), safe tool surfaces, replay-safe worker auth.

## 8. Research collaboration concept (optional)

Reproducible pipeline replay (`lib/pipeline` golden traces) as research artifact — requires RFC and operator sponsorship.

## 9. Submission checklist

- [ ] Operator reviewed all claims for accuracy  
- [ ] No secrets in attachments  
- [ ] Org ID and billing account ready  
- [ ] VC referral obtained (if credit path)  
- [ ] Classification updated after submit: **VERIFIED LIVE** (submitted) vs prepared-only