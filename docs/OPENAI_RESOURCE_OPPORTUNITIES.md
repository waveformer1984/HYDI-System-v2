# OpenAI resource opportunities (official sources only)

**Research date:** 2026-11-15 (enriched via [OpenAI programs web research](bc-af02fa62-e7cb-5b1b-b42d-8b0cff6c6697))  
**HYDI posture:** Local-first orchestration; **$0 default** (`HYDI_ALLOW_PAID_LLM` off).  
**Rule:** Eligibility notes are qualitative only — operator must verify every URL before applying.

---

## Summary table

| Program | Official URL | Paid benefit? | HYDI starting point |
|---------|--------------|---------------|---------------------|
| OpenAI for Startups | https://openai.com/business/why-openai/startups/ | API credits **via VC partners only** | Build Hours + community: **now**; credits: **if VC in network** |
| Startup community signup | https://openai.com/leads/startup/ | Not stated as credits | Org ID required |
| Codex for Open Source | https://openai.com/form/codex-for-oss/ | API credits (amount discretionary) | **OSS maintainer** narrative for public repo |
| Researcher Access | https://grants.openai.com/prog/openai_researcher_access_program/ | Up to **$1,000** API credits | Needs **research affiliation** |
| Developer Community | https://community.openai.com/ | None | **Open** |
| Build Hours | https://webinar.openai.com/buildhours/ | Education only (event credits rare) | **Open** |
| Codex Security | https://help.openai.com/en/articles/20001107-codex-security | Paid/token or OSS program | Plan or OSS case-by-case |
| Pioneers | https://openai.com/index/openai-pioneers-program/ | RFT collaboration (not generic credits) | Selective vertical cohorts |
| VC partnerships | https://openai.com/form/vc-partnerships-application/ | For **VC firms**, not founders | Investor applies |

**Partnerships workflow:** ingest each row as a separate opportunity record (`lib/partnerships-funding/`, PR #593) — never merge credits with cash or partnership status.

---

## 1. OpenAI for Startups

| Field | Detail |
|-------|--------|
| **URLs** | https://openai.com/business/why-openai/startups/ · https://openai.com/leads/startup/ |
| **Availability** | Ongoing hub + events; credit path via VC |
| **Resources** | Build Hours, repos, guides, newsletters; **VC portfolio:** credits, rate limits, solutions engineers, events |
| **Eligibility** | General resources: founders building with OpenAI. **Credits:** portfolio of **eligible VC partners** (FAQ names examples; not exhaustive) |
| **Application** | Community: signup with **Organization ID** (Platform → Settings → Organization). Credits: **VC referral code** + product/API use description + business email + funding basics (no pitch deck per FAQ) |
| **Deadlines** | None published for hub/VC credit path |
| **HYDI fit** | **High** for free learning; **low–medium** for subsidized API without VC |

---

## 2. API credit pathways (official only)

OpenAI does **not** publish one universal startup credit form.

| Path | URL | Notes |
|------|-----|-------|
| VC partner credits | Startups FAQ | Amount **not** published globally |
| Researcher Access | §6 below | $1k cap, quarterly review |
| Codex for OSS | §3 below | Maintainer-focused |
| Event/hackathon | Startups FAQ mention only | No standing URL |

---

## 3. Codex for Open Source

| Field | Detail |
|-------|--------|
| **URLs** | https://developers.openai.com/community/codex-for-oss/ · https://openai.com/form/codex-for-oss/ · terms: https://learn.chatgpt.com/docs/codex-for-oss-terms |
| **Availability** | Rolling |
| **Eligibility** | **Core maintainers** of **widely used public** projects; public GitHub + public repo |
| **Application** | Form: ChatGPT email, GitHub user, repo URL, rationale (≤500 chars), API credit plan (≤500 chars) |
| **Resources (if selected)** | 6mo ChatGPT Pro w/ Codex; **API credits** (amount discretionary); optional Codex Security |
| **HYDI fit** | **Medium–high** if `HYDI-System-v2` is actively maintained OSS with real maintenance burden — **not** a substitute for production commercial inference billing |

---

## 4. Developer Community

| Field | Detail |
|-------|--------|
| **URL** | https://community.openai.com/ |
| **Eligibility** | OpenAI account linked to **API Platform** (per forum auth policy) |
| **Resources** | Forums — not private billing support |
| **HYDI fit** | **High** for patterns; **no credits** |

---

## 5. Build Hours

| Field | Detail |
|-------|--------|
| **URLs** | https://webinar.openai.com/buildhours/ · https://github.com/openai/build-hours |
| **Eligibility** | Builders using OpenAI APIs (not VC-gated in series description) |
| **Resources** | Demos, repos, Q&A; occasional event credits need org ID |
| **HYDI fit** | **High** for agents, tool-calling, evals — complements Ollama default |

---

## 6. Researcher Access Program

| Field | Detail |
|-------|--------|
| **URLs** | https://grants.openai.com/prog/openai_researcher_access_program/ · https://help.openai.com/en/articles/10139500-researcher-access-program-faq |
| **Availability** | Applications open (reopened 2025-02-03 per portal) |
| **Eligibility** | Academic/research org affiliation; nonprofits doing **research**; API-supported countries |
| **Resources** | Up to **$1,000** credits; **12 months** validity (Japan: 180d if grant after 2025-11-13 per FAQ) |
| **Review** | Quarterly (Mar/Jun/Sep/Dec); ~4–6 weeks after quarter for credits |
| **HYDI fit** | **Low** for commercial product ops; **medium** only with qualified research collaborator on safety/society framing |

---

## 7. Codex Security

| Field | Detail |
|-------|--------|
| **URLs** | https://openai.com/index/codex-security-now-in-research-preview/ · https://help.openai.com/en/articles/20001107-codex-security |
| **Eligibility** | Paid ChatGPT workspace plans; OSS via Codex for OSS (case-by-case) |
| **HYDI fit** | Complements HYDI tests; **$0 default** blocks unless OSS acceptance or paid plan |

---

## 8. Ecosystem partnerships

| Program | URL | Benefit type |
|---------|-----|--------------|
| VC Partnerships | https://openai.com/form/vc-partnerships-application/ | Portfolio credits (VC applies) |
| Pioneers | https://openai.com/index/openai-pioneers-program/ | Evals + up to 3 RFT collaborations |
| Showcase | https://openai.com/form/showcase-submission/ | Visibility, not credits |
| Grove | https://openai.com/index/openai-grove/ | Pre-idea cohort — **applications closed 2026-01-12** |

---

## HYDI exploration order (no eligibility assumed)

1. Register org + [startup community](https://openai.com/leads/startup/) + Build Hours (**VERIFIED LIVE** URLs).  
2. If OSS maintainer story is strong → prepare **Codex for OSS** (evidence-backed).  
3. If VC-backed → confirm investor in OpenAI partner network before credit request.  
4. Researcher Access only with qualified research partner.  
5. Record each program in **Partnerships & Funding** pipeline before drafting (`docs/PARTNERSHIPS_FUNDING_WORKFLOW.md` on PR #593).

---

## Official source index

https://openai.com/business/why-openai/startups/ · https://openai.com/leads/startup/ · https://openai.com/form/vc-partnerships-application/ · https://developers.openai.com/community/codex-for-oss/ · https://openai.com/form/codex-for-oss/ · https://grants.openai.com/prog/openai_researcher_access_program/ · https://community.openai.com/ · https://webinar.openai.com/buildhours/ · https://help.openai.com/en/articles/20001107-codex-security · https://openai.com/index/openai-pioneers-program/

*Unpublished credit amounts and acceptance rates omitted where OpenAI does not state them.*