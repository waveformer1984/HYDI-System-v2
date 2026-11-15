# HYDI integration matrix (snapshot)

See also: `HYDI_COMPLETION_BACKLOG.md`, `HYDI_MASTER_ARCHITECTURE.md`, issue [#587](https://github.com/waveformer1984/HYDI-System-v2/issues/587).

| From → To | Transport | Auth | Status (code-level) |
|-----------|-----------|------|---------------------|
| Phone `/heidi` → BFF | HTTPS cookie + CSRF | Device pairing / session | Integrated |
| BFF → heidi-core | Signed server HTTP | `HYDI_SERVICE_SECRET` | Integrated (host-dependent) |
| BFF → protoforge-core | Loopback HTTP | Service token | Integrated |
| Mobile ops → action runners | `mobile-ops/run` | Permission + confirm | Integrated |
| Mobile fabric → capabilities | `heidi-mobile/fabric` | Permission + idempotency | Integrated |
| protoforge-core → pipeline | In-process | N/A | **Verified** (`cascade-complete-v2`) |
| Pipeline → Supabase ledger | Adapter / RPC | Service role server-side | Implemented; live needs DB |
| heidi-web → Supabase client | REST | Anon + RLS | Implemented |
| GitHub Actions → Supabase | `health-monitor` | Repo secrets | **Optional skip** if secrets unset |
| Pages static `docs/index.html` | GitHub Pages | User-supplied API URL in UI | Separate from `/heidi` BFF |

**Gap:** Cloud agents cannot close mobile **operational** loop without Frank secrets and pairing; code paths exist and are tested hermetically in CI.