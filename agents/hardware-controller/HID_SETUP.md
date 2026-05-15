# HID Agent Setup Guide

Before running the hardware automation agent, fill in `webhook_task_hid.json` with your real credentials.

## Required Credentials

### Stripe
| Field | Where to find it |
|---|---|
| `stripe_email` | The email address of your Stripe account |
| `stripe_password` | Your Stripe login password |

Log in at https://dashboard.stripe.com → Developers → Webhooks to verify your endpoint is registered.

### Vercel
| Field | Where to find it |
|---|---|
| `vercel_email` | The email address of your Vercel account |
| `vercel_password` | Your Vercel login password |
| `vercel_project` | The project name (default: `heidi-chat-portal`) |

Log in at https://vercel.com/dashboard to confirm the project name.

### Webhook Endpoint
`webhook_endpoint_url` must point to the live Stripe webhook route, e.g.:
```
https://heidi-chat-portal.vercel.app/api/webhooks/stripe
```

## Step-by-Step

1. **Validate the config** before running:
   ```bash
   node agents/hardware-controller/validate-hid-config.js
   ```
   This checks all required fields and email/URL formats.

2. **Arm the kill switch** (recommended):
   ```bash
   # Linux/Mac
   touch /tmp/STOP_HID

   # Windows (PowerShell)
   New-Item -Path C:\tmp\STOP_HID -ItemType File
   ```
   Delete this file when you are ready to proceed. The agent aborts immediately if this file exists.

3. **Run the orchestrator**:
   ```bash
   python agents/hardware-controller/orchestrator.py \
     --task agents/hardware-controller/webhook_task_hid.json
   ```

4. **Confirm the `EXECUTE` prompt** when shown — the agent requires you to type `EXECUTE` before any HID action runs.

## Contract Settings

| Setting | Default | Description |
|---|---|---|
| `mode` | `hid_required` | `api_only` / `hid_allowed` / `hid_required` |
| `requires_human_confirmation` | `true` | Must type `EXECUTE` to proceed |
| `min_vision_confidence` | `0.92` | OCR must be ≥92% confident before clicking |
| `rollback_strategy` | `revert_webhook` | How to undo on failure |
| `snapshot_before` | `true` | Captures screen state before each action |
| `max_retries` | `1` | Maximum retry attempts |

## Security

- Credentials in `webhook_task_hid.json` are **local only** and must never be committed.
- `webhook_task_hid.json` is in `.gitignore` (verify this before committing).
- The kill switch file (`/tmp/STOP_HID`) is the fastest abort path — create it at any time.
