# Apex Archive Failure Matrix

Date: 2026-08-14

| Failure | Expected behavior | Handled by | Tested |
|---|---|---|---|
| Missing `episode_registry.json` | Treated as first run, empty registry | `episode_registry.load_registry()` | yes |
| Corrupt `episode_registry.json` | Renamed to `.corrupt-*`, empty registry returned | `episode_registry.load_registry()` | yes |
| Duplicate episode ID | `check_duplicates()` reports `duplicate_episode_id` | `episode_registry.py` | yes |
| Process crash during registry write | Atomic tmp/rename; half-written tmp ignored | `episode_registry.save_registry()` | yes |
| Missing `hydi_outbox/` | Bridge reports no events | `tools/apex-archive-bridge.js` | yes |
| Malformed outbox JSON | Bridge skips file, reports `invalid_json` | `tools/apex-archive-bridge.js` | yes |
| HYDI unavailable | `hydi_bridge._post()` returns `sent: false` non-fatal | `hydi_bridge.py` | yes (spec) |
| Unauthorized APEX task | Heidi rejects with `lacks permission 'apex:manage'` | `heidi.controller.ts` | yes |
| `APEX_UPLOAD` | Rejected as `SCAFFOLD` with honest `NotImplementedError` | `apex-capability-guard.js` / `youtube_adapter.py` | yes |
| `APEX_PUBLISH` | Rejected as `FORBIDDEN` | `apex-capability-guard.js` | yes |
| Missing credentials | `upload()` raises `NotImplementedError` | `youtube_adapter.py` | yes |
| Publishing policy not enabled | `upload()` raises `NotImplementedError` | `youtube_adapter.py` | yes |
| No human approval | `upload()` raises `NotImplementedError` (new gate) | `youtube_adapter.py` | yes |
| Cloud Supabase unavailable | Not a dependency; no fallback invoked | architecture | n/a |
| Rezonate unavailable | `ApexAgent` throws and records `APEX_TASK_FAILED` | `apex.agent.ts` | partial |
| Invalid state transition | `manifest.py` raises `StateError` | `manifest.py` | yes (spec) |

## Failure truthfulness

- No `unknown → healthy`.
- No `failed → success`.
- `upload()` never claims success.
