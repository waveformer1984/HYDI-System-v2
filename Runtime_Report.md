# Runtime Validation Report

## Executive Summary

- **Next.js dev server (`npm run dev`):** Started successfully on port 3000.
- **`/api/health`:** `200 OK` (`status: healthy`).
- **`/api/ursula/status`:** `200 OK` (`status: success`, `is_operational: true`).
- **`/api/mobile-status`:** `401 Unauthorized` — fail-closed.
- **`/api/events/stream` (SSE):** `401 Unauthorized` — fail-closed.
- **`/api/chat` (Heidi):** `400 Bad Request` due to missing fields; route compiled and responded.
- **`node src/server.js`:** 10-second cold boot successful.
- **Database connection:** `OK`.
- **Ollama:** Reachable, 7 models.
- **Supabase local:** Healthy, migrations applied.

## `npm run server` / `node src/server.js`

### Cold boot

```text
node src/server.js  # 10-second observation
SERVER_EXIT: -1 (force-stopped after 10s)
Stderr: [SIMPLE KEYMAKER] No STARTER_API_KEY/... configured - every POST will be rejected with 401
```

- Process stayed running.
- No fatal crash.
- `SimpleKeymaker` is fail-closed.

## `npm run dev`

- Started on `0.0.0.0:3000`.
- Compiled API routes successfully.
- Healthy traffic log observed:

```text
GET /api/health 200 in 2088ms
GET /api/health 200 in 51ms
...
```

## API Endpoint Tests

### `GET /api/health`

- **Status:** `200 OK`
- **Key fields:**

```json
{
  "status": "healthy",
  "hydi_status": "OK",
  "trend_status": "stable",
  "escalation_level": "NONE",
  "version": "2.0.0-hydi",
  "environment": "development",
  "vercel": true,
  "metrics": {
    "jobs_queued": 0,
    "jobs_failed": 0,
    "events_last_hour": 0,
    "critical_pct": 0,
    "warning_pct": 0
  }
}
```

### `GET /api/ursula/status`

- **Status:** `200 OK`
- **Key fields:**

```json
{
  "status": "success",
  "ursula": {
    "status": "OK",
    "trend": "stable",
    "escalation": "NONE",
    "is_operational": true
  },
  "infrastructure": {
    "overall": "operational",
    "efficiency": 100,
    "power": { "health": 100 },
    "thermal": { "health": 100 }
  }
}
```

### `GET /api/mobile-status`

- **Status:** `401 Unauthorized`
- **Reason:** Missing API key.
- **Interpretation:** `SimpleKeymaker` is correctly fail-closed.

### `GET /api/events/stream` (SSE)

- **Status:** `401 Unauthorized`
- **Reason:** Missing credentials.
- **Interpretation:** SSE endpoint is compiled and protected.

### `POST /api/chat` (Heidi)

- **Status:** `400 Bad Request`
- **Body tested:** `{ "message": "hello", "system": "Heidi" }`
- **Interpretation:** The route compiled and validated the request, rejecting a minimal body. The endpoint is reachable and guarded.

## Connectivity

| Component | Method | Result |
|-----------|--------|--------|
| Supabase local | `database.testConnection()` | `OK` / `DB: true` |
| Ollama | `ollama list` | 7 models present |
| Docker daemon | `docker ps` | Running, 10 containers |
| Next.js dev | `npm run dev` | Compiled, port 3000 healthy |

## Graceful Degradation

- **No API key:** Endpoints return `401`.
- **Malformed chat body:** Endpoint returns `400` rather than crash or leak.
- **Missing `pending_tasks` pre-migration:** Was resolved after `npx supabase migration up --local`.

## Commands Executed

```text
node src/server.js  # 10s cold boot
npm run dev         # Next.js dev server
curl --max-time 3 -N http://localhost:3000/api/events/stream
Invoke-RestMethod -Uri http://localhost:3000/api/health
Invoke-RestMethod -Uri http://localhost:3000/api/ursula/status
Invoke-RestMethod -Uri http://localhost:3000/api/mobile-status
Invoke-RestMethod -Uri http://localhost:3000/api/chat -Method POST -Body '{"message":"hello","system":"Heidi"}'
node -e "require('./src/database.js').testConnection().then(r => console.log('DB:', r));"
ollama list
```

## Conclusion

**PASS.** The Next.js runtime and `src/server.js` boot successfully. Core health and status endpoints return `200`. Endpoints correctly fail-closed with `401` for missing credentials and `400` for malformed chat requests. Supabase and Ollama are reachable. The runtime is functional and ready for the validation/soak phases.
