# OpenAI resource opportunities (official sources only)

**Audit date:** 2026-11-15 UTC  
**HYDI posture:** Local-first orchestration platform; **$0 default** (`HYDI_ALLOW_PAID_LLM` off).  
**Eligibility below is indicative — not a guarantee. Operator must verify every URL before applying.**

---

## 1. OpenAI for Startups

| Field | Detail |
|-------|--------|
| **Official URL** | https://openai.com/startups/ · https://openai.com/business/why-openai/startups/ |
| **Availability** | Public program pages live (checked 2026-11-15) |
| **Resources** | Community (Build Hours, cookbooks), events; **API credits for VC-backed startups** via partner VCs |
| **Eligibility** | All founders: community content. **Credits:** startups backed by listed VC partners (e.g. a16z, Sequoia, Thrive, Kleiner Perkins, Conviction — per FAQ) |
| **Application** | Community: self-serve. **Credits:** referral code from VC; product description, org ID, business email |
| **Fees** | None stated for community; credits path via VC |
| **HYDI fit** | **Likely partial** — strong technical story (multi-agent, local-first) but credits path needs VC backing unless hackathon/event credits |
| **To qualify** | Incorporate narrative; secure VC partner referral OR attend official startup events offering credits; document API use case (orchestration, evals, tool-calling) |

## 2. VC Partnerships (for funds, not founders)

| Field | Detail |
|-------|--------|
| **Official URL** | https://openai.com/form/vc-partnerships-application/ |
| **Audience** | Venture capital firms |
| **Resources** | Portfolio API credits, tier upgrades, events |
| **HYDI fit** | **N/A directly** — unless operator's fund applies |

## 3. OpenAI API / platform credits (general)

| Field | Detail |
|-------|--------|
| **Official URL** | https://platform.openai.com/settings/organization/billing |
| **Availability** | Standard pay-as-you-go; credits when awarded |
| **Application** | Via startup program, events, or VC referral — **no universal public credit form** on marketing pages |
| **HYDI fit** | **REQUIRES OPERATOR APPROVAL** to spend even with credits |

## 4. OpenAI Developer Community

| Field | Detail |
|-------|--------|
| **Official URL** | https://community.openai.com |
| **Resources** | Forums, announcements, support peer network |
| **Eligibility** | Open |
| **HYDI fit** | **Qualified now** for technical engagement and visibility |

## 5. Build Hours / founder events

| Field | Detail |
|-------|--------|
| **Official URL** | Linked from https://openai.com/startups/ (virtual Build Hours) |
| **Resources** | API/model workshops, agentic tool-calling content |
| **Eligibility** | Founder registration per event |
| **Deadlines** | Event-specific |
| **HYDI fit** | **Qualified now** for learning; document attendance as partnership evidence |

## 6. Researcher Access Program

| Field | Detail |
|-------|--------|
| **Official URL** | Verify current page at https://openai.com (search "Researcher Access Program") |
| **Resources** | Research API access (program terms change) |
| **HYDI fit** | **Uncertain** — better fit if HYDI publishes reproducible eval/pipeline research |
| **To qualify** | Academic/research affiliation or published research agenda — **operator verify** |

## 7. Codex (product) vs Codex for Open Source

| Program | URL (verify) | Notes |
|---------|--------------|-------|
| **Codex** (agentic coding) | https://openai.com/codex/ | Commercial product; **not** the same as ChatGPT subscription API access |
| **Codex for Open Source** | Search https://openai.com for current open-source program | Eligibility typically tied to OSS maintainers — **do not assume HYDI qualifies** |

**HYDI fit:** Use Codex as **development accelerator** (Agent 06); open-source program depends on published eligibility criteria at apply time.

## 8. Codex Security

| Field | Detail |
|-------|--------|
| **Official URL** | https://openai.com/security/ (and product pages for Codex Security) |
| **Eligibility** | Enterprise / security program — verify current intake |
| **HYDI fit** | **CONFIGURED BUT UNTESTED** — HYDI has security audit docs; may qualify for review conversation, not automatic access |

## 9. ChatGPT Business / Team (not API)

| Field | Detail |
|-------|--------|
| **Note** | ChatGPT subscriptions **do not** replace `OPENAI_API_KEY` for HYDI server routes |
| **HYDI** | Keep `paid-llm-gate`; never expose keys to frontend |

## 10. Additional legitimate paths

| Opportunity | URL | HYDI classification |
|-------------|-----|---------------------|
| OpenAI documentation | https://platform.openai.com/docs | **VERIFIED LIVE** (read-only) |
| OpenAI Help Center | https://help.openai.com | Support |
| GitHub / cookbook | https://github.com/openai/openai-cookbook | Integration patterns |

## Priority ranking (no application fee, meaningful dev value)

1. **OpenAI for Startups community + Build Hours** — immediate, $0  
2. **Developer Community** — immediate, $0  
3. **VC-referred API credits** — high value if VC path exists — **REQUIRES OPERATOR APPROVAL**  
4. **Codex for Open Source** — apply only if eligibility matches — **verify before submit**  
5. **Researcher Access** — longer cycle  

## What HYDI must not claim

- Submitted applications (none sent by agents)  
- Accepted into programs without operator confirmation  
- Live OpenAI spend without `HYDI_ALLOW_PAID_LLM=true`