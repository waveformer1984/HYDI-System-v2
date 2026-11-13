# Heidi Life mock streams (Phase 9)

## Opt-in

Set on Frank (heidi-web PM2 env):

```bash
HEIDI_LIFE_MOCK_STREAMS=true
```

Default **off** — route returns empty suggestions.

## API

`GET /api/heidi-life/streams` → `{ ok, optIn, streams, suggestions, ts }`

Suggestions are `read_only` — no auto-execute; real Heidi Life still uses `heidi-life/src/gate.js` on Frank.

## Fixtures

`lib/heidi-life/mock-streams.js` — calendar / usage / stripe placeholders.

## Real package

Production collector: `heidi-life/` (separate process on :3470). Mock route is for Ursula/phone preview only.
