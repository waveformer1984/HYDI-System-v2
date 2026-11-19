# HYDI blocker register

**Updated:** 2026-11-19 (Phase 0 audit)

| ID | Blocker | Evidence | Clears when | Owner |
|----|---------|----------|-------------|-------|
| B1 | **Frank runtime not observable from cloud** | `docs/PHONE_ACCESS.md` | Jordan pastes `phone-access-report.json`, `runtime:audit`, observe snapshot | Jordan |
| B2 | **Supabase not reachable on audit VM** | `verify-supabase.sh` missing env | Frank/local Supabase up; read-only counts in acceptance doc | Jordan |
| B3 | **Embeddings backfill not proven** | Migration 768 requires `--apply` | `hydi_facts` count + non-null `embedding` sample on Frank DB | Jordan |
| B4 | **Voice services not in PM2** | `ecosystem.config.js` has no :9000/:9001 | PM2 or documented autostart + curl health green | Implementer |
| B5 | **Mobile `missionId` SSE server gap** | Client types exist; no `missionId` in `lib/heidi-mobile` server | BFF emits contract field; jest e2e | Implementer |
| B6 | **End-to-end voice UNVERIFIED** | Unit tests only | Frank STT/TTS + phone `heidi_voice.py` logs | Jordan |
| B7 | **Concurrent model RAM budget unknown** | No Frank measurements | Observer RAM sample under load | Jordan |
| B8 | **Hybrid router not default production path** | `HYDI_INTELLIGENCE_ROUTER` off unless set | Explicit enable + benchmark | Product |
| B9 | **Paid LLM policy** | `HYDI_ALLOW_PAID_LLM` false by default | Intentional unlock + budget if cloud fallback required | Owner |
| B10 | **No acceptance bundle at SHA** | No `.runtime/audit/acceptance-*.json` | `HYDI_ACCEPTANCE_MATRIX.md` rows filled | Jordan + agent |