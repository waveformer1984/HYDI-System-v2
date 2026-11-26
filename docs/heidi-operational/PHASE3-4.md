# Phase 3–4 (design only)

## Phase 3 — One way in

**Goal:** Jordan uses one surface on the phone: `heidi-web-standalone` on **port 3000**, reached via Tailscale at `/heidi` and the existing BFF `/api/heidi-mobile/*`. Ursula’s hover/status UX should call that same backend (health + mobile status routes), not a second origin.

**Retire :3006:** `heidi-mobile-chat` was a legacy Ollama relay when the dashboard was down. After Lifeline + stable `:3000`, remove the PM2 app (`pm2 delete heidi-mobile-chat`) only after Jordan approves Phase 0 truth check. Update docs and `hydi_facts` seeds that still mention 3456/3006 as primary paths.

**No code in this PR** beyond groundwork; implementation is a separate RFC/PR after 48h heartbeat proof.

## Phase 4 — Outreach with human gate

**Flow:** Heidi drafts outreach for rows in `heidi_leads` with `status=new` and `score` above a floor (suggest 0.6). Jordan approves or rejects in mobile Tasks or a dedicated leads view. Every decision appends **`heidi_events`** with `event_type` `lead_outreach_decision`, payload `{ lead_id, decision, confidence, draft_text }`.

**Triple gate before any send:**

1. `HEIDI_ALLOW_EXEC=true` (off by default; Jordan-only).
2. Auto-approve only after **~20 consecutive approvals** at **confidence ≥ 0.85** for the same action class (`lead_outreach_email` or similar), tracked in `heidi_events`.
3. **`heidi_decision_bounds`** must allow the capability (deny list / unattended flag).

**$0 constraint:** drafts use local Ollama only; no paid email API until explicitly budgeted.

**Not implemented here** — this document is the contract for a follow-on PR after Phase 2 digest proves signal.