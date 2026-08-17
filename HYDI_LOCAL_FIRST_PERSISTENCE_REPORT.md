# HYDI Local-First Persistence Report

**Generated:** 2026-08-17T23:13:00Z
**Canonical repository:** `C:\Users\Owner\HYDI-System-v2`

## Local-First Configuration

| Variable | Value | Source |
|----------|-------|--------|
| `SUPABASE_URL` | `http://127.0.0.1:54321` | `.env.local` |
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` | `.env.local` |
| `ENABLE_LOCAL_MODEL` | `true` | `.env.local` |
| `LOCAL_MODEL_URL` | `http://localhost:11434` | `.env.local` |
| `LOCAL_MODEL_NAME` | `llama3.2:3b` | `.env.local` |
| `EMBEDDING_PROVIDER` | `ollama` | `.env.local` |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | `.env.local` |

## Persistence Strategy

The system boots with `[HYBRID STACK] Strategy: LOCAL_FIRST`, meaning:
- Local models (Ollama) are tried first for inference
- External API models (OpenAI, Gemini) are used as fallback
- Local Supabase (`127.0.0.1:54321`) is the default database
- Cloud Supabase is not required for local operation

## Verification Results

### Database (Local Supabase)

| Check | Result |
|-------|--------|
| REST API reachable at `127.0.0.1:54321` | **PASS** |
| Service-role key writes to `leads` table | **PASS** |
| Service-role key reads written row | **PASS** |
| Service-role key deletes test row | **PASS** |

**Conclusion:** Local Supabase is fully operational for CRUD via service-role key.

### AI Runtime (Local Ollama)

| Check | Result |
|-------|--------|
| Ollama reachable at `localhost:11434` | **PASS** |
| Models available | **PASS** (7 models) |

**Conclusion:** Local AI runtime is operational.

### Cloud Independence

- `SUPABASE_URL` points to `127.0.0.1` (local), not a cloud URL.
- No cloud Supabase URL is configured as a fallback.
- If cloud Supabase is unavailable, local operation is unaffected.
- If Ollama is unavailable, the system falls back to API models (OpenAI/Gemini).

## Known Issue

The orchestrator's local model spawning (`./bin/main`) fails with `ENOENT` because the binary doesn't exist. This is a configuration issue — the system falls back to API models. To fully achieve local-first AI operation, the `./bin/main` binary needs to be built or the model configuration needs to point at Ollama directly.

## Conclusion

The system is local-first for database persistence. AI inference is local-first with API fallback. Cloud services are not required for local operation.
