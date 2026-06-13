# Dependency Map — HYDI / ProtoForge Mobile Stack

Last updated: 2026-06-13

---

## Runtime Dependency Graph

```
Phone Browser
    └── Heidi Mobile (Node :3006)
            ├── Ollama (:11434)          AI inference
            ├── Heidi Bridge (:5050)     Local data + forge events
            │       ├── protoforge.db    SQLite — telemetry, alerts, builds
            │       ├── build_registry   JSON — forge build history
            │       └── Ursula Vercel    Cloud health + revenue proxy
            ├── Supabase (cloud)         Chat memory + revenue ledger
            └── Stripe (cloud)           Checkout session creation

forge_runner.py
    └── heidi_forge_hook.py
            └── Heidi Bridge :5050/api/forge/webhook
                    └── Heidi Mobile :3006/api/events/push  (SSE broadcast)
```

---

## Service → Dependency Matrix

| Service | Requires | Optional |
|---|---|---|
| Heidi Mobile | Node.js ≥ 20, express, dotenv | Supabase (memory+revenue), Stripe (checkout), web-push |
| Heidi Bridge | Python 3, Flask | Rezonate core (score endpoint) |
| Ollama | Ollama binary, GPU/CPU | — |
| forge_runner.py | Python 3, Supabase keys | heidi_forge_hook.py |
| Ursula (Vercel) | Next.js, Supabase | — |

---

## npm Dependencies (`package.json`)

### Runtime
| Package | Version | Used for |
|---|---|---|
| `express` | ^4.21.2 | HTTP server |
| `dotenv` | ^17.4.2 | .env loading (dotenvx) |
| `web-push` | ^3.6.7 | VAPID background notifications |
| `@supabase/supabase-js` | ^2.105.1 | Revenue tools + chat memory |
| `stripe` | ^22.1.0 | Checkout session (imported but Stripe REST used directly) |
| `express-rate-limit` | ^8.4.1 | Rate limiting middleware |
| `axios` | ^1.15.2 | HTTP client (available but fetch used directly) |

### Not used by launch-heidi-mobile.js (Next.js app deps)
`next`, `react`, `react-dom`, `@supabase/ssr`, `typescript` — for the Next.js app in this repo, not the mobile server.

---

## Python Dependencies (`heidi-bridge.py`)

```
flask
flask-cors (optional — CORS headers set manually)
requests
```

Install: `pip install flask requests`

---

## Environment Variables — Full Reference

### Required for full operation
```
URSULA_URL=http://192.168.86.82:5050     # Bridge (or Vercel URL fallback)
OLLAMA_URL=http://192.168.86.82:11434    # Ollama (PC IP when running from phone)
PORT=3006
```

### Required for revenue tools
```
SUPABASE_URL=https://...supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # SERVER-SIDE ONLY — never expose to client
```

### Required for Stripe checkout
```
STRIPE_SECRET_KEY=sk_live_...           # SERVER-SIDE ONLY
STRIPE_ACCOUNT_GALACTIC_BYTES=acct_...
STRIPE_ACCOUNT_DETAILER_BOT=acct_...
STRIPE_ACCOUNT_LIPI_V2=acct_...
STRIPE_ACCOUNT_PROTOGRANCE_AROMATICS=acct_...
STRIPE_ACCOUNT_REZONATE=acct_...
STRIPE_ACCOUNT_WAVEFORMER_STUDIO=acct_...
```

### Optional
```
LM_STUDIO_URL=http://localhost:1234     # LM Studio fallback AI
HYDI_URL=http://localhost:3005          # Legacy HYDI v1 bridge
PROTOHUB_URL=http://localhost:4000      # Protohub Node service
NEXT_APP_URL=https://ursula-nine.vercel.app
BRIEFING_HOUR=8                         # Daily briefing hour (24h)
HEIDI_BRIDGE_URL=http://localhost:5050  # Used by heidi_forge_hook.py
```

---

## Port Allocation

| Port | Service | Notes |
|---|---|---|
| 3006 | Heidi Mobile Server | This repo |
| 4000 | Protohub (Node) | Not currently running |
| 5050 | Heidi Bridge (Flask) | `C:\ProtoForge_Ecosystem\` |
| 11434 | Ollama | Must run with `OLLAMA_HOST=0.0.0.0` for LAN access |
| 3005 | Legacy HYDI v1 | Not running |

---

## Generated Files (not in git)

| File | Created by | Contents |
|---|---|---|
| `.vapid-keys.json` | Heidi Mobile (auto) | VAPID public + private keys for web push |
| `.env` | Manual | Environment variables |

**Note:** `.vapid-keys.json` should be added to `.gitignore` — it contains a private key.
