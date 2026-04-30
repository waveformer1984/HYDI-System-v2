# 💰 PROTOFORGE CLIENT PAYOUT SYSTEM

## Architecture Overview

**Master Account Approach** - All payments flow to your master Stripe account first. You maintain control and payout clients monthly via ACH.

```
Payment → Master Stripe Account → Ledger Entry → Client Dashboard
                                            ↓
                                    Monthly Payout Script
                                            ↓
                                    ACH Transfer → Client Bank
                                            ↓
                                    Email Notifications
```

---

## Components Built

### 1️⃣ Client Dashboard (`api/client-dashboard.js` + `dashboard/client-view.html`)

**Features:**
- Real-time project-filtered ledger view
- Available payout balance
- Fee breakdown (Platform 5%, Agent 10%, Stripe 2.9%+$0.30)
- Recent transactions with status
- Monthly revenue breakdown
- Auto-refresh every 30 seconds

**API Endpoint:** `GET /api/client-dashboard?project=galactic_bytes`

**Response:**
```json
{
  "project": "galactic_bytes",
  "summary": {
    "total_gross": 15000.00,
    "total_fees": 2690.00,
    "total_net": 12310.00,
    "available_for_payout": 4110.00,
    "held_for_disputes": 0.00
  },
  "fee_breakdown": {
    "platform_fees": 750.00,
    "agent_fees": 1500.00,
    "stripe_fees": 440.00
  }
}
```

---

### 2️⃣ Monthly Payout Automation (`scripts/monthly-payout-automation.js`)

**Flow:**
1. Calculate available payouts per project
2. Check for disputes/chargebacks
3. Create Stripe ACH transfers
4. Update ledger with batch IDs
5. Send email notifications
6. Track payout status

**Commands:**
```bash
# Run payout manually
node scripts/monthly-payout-automation.js

# Check payout status
node scripts/monthly-payout-automation.js check <batch_id>
```

**Scheduled:** Runs 1st of every month at 9 AM (via Windows Task Scheduler)

---

### 3️⃣ Email Notifications (`scripts/email-notifications.js`)

**Triggers:**
- **Payout Initiated** - When ACH transfer created
- **Payout Cleared** - When funds arrive in client bank
- **Monthly Summary** - Revenue summary each month

**Templates:** Professional HTML + plain text versions

---

### 4️⃣ Ledger Schema (Supabase)

**Table:** `ledger`

| Column | Type | Description |
|--------|------|-------------|
| `transaction_id` | UUID | Primary key |
| `stripe_payment_intent_id` | TEXT | Stripe payment ID |
| `project_code` | TEXT | Client project identifier |
| `revenue_stream` | TEXT | Revenue stream name |
| `amount_gross` | NUMERIC | Total before fees |
| `platform_fee_amount` | GENERATED | 5% fee |
| `agent_fee_amount` | GENERATED | 10% fee |
| `stripe_fee_amount` | GENERATED | 2.9% + $0.30 |
| `net_amount` | GENERATED | 82.07% to client |
| `status` | TEXT | completed/payout_initiated/payout_completed |
| `payout_batch_id` | TEXT | Batch tracking ID |

---

## File Structure

```
api/
  client-dashboard.js          # Dashboard API endpoint
  
dashboard/
  client-view.html             # Client-facing dashboard UI
  
scripts/
  monthly-payout-automation.js  # Payout script
  email-notifications.js          # Email service
  setup-payout-cron.ps1           # Windows Task Scheduler setup
  
supabase/migrations/
  20260425161640_add_stripe_connect_subaccount_support.sql  # Ledger table
```

---

## Configuration

**Environment Variables:**
```bash
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe
STRIPE_SECRET_KEY=

# SMTP (for email notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=

# Client Bank Accounts (Stripe recipient IDs)
GALACTIC_BYTES_BANK_ACCOUNT=
DETAILER_BOT_BANK_ACCOUNT=
LIPI_V2_BANK_ACCOUNT=
PROTOGRANCE_BANK_ACCOUNT=
REZONATE_BANK_ACCOUNT=
WAVEFORMER_BANK_ACCOUNT=
```

---

## Fee Structure

**On a $1,000 transaction:**

| Fee Type | Amount | Who Gets It |
|----------|--------|-------------|
| Gross | $1,000.00 | - |
| Platform Fee (5%) | $50.00 | ProtoForge |
| Agent Pool Fee (10%) | $100.00 | Agent execution pool |
| Stripe Fee (2.9% + $0.30) | $29.30 | Stripe |
| **Net to Client** | **$820.70** | **Client** |

**Client receives:** 82.07% of gross revenue

---

## Why This Beats Stripe Connect Sub-Accounts

✅ **Single reconciliation point** - One master account, one ledger  
✅ **Dispute control** - You hold funds during disputes, not Stripe freezing client accounts  
✅ **Full visibility** - See all revenue before anyone gets paid  
✅ **Operational simplicity** - No managing 6 separate Connect accounts  
✅ **Client experience** - Clean dashboard showing their earnings in real-time  
✅ **Cash flow control** - You control when and how much to payout  

---

## Setup Instructions

1. **Create Supabase ledger table:**
   ```bash
   supabase db push
   ```

2. **Set up Windows scheduled task:**
   ```powershell
   # Run as Administrator
   .\scripts\setup-payout-cron.ps1
   ```

3. **Configure environment variables** (see Configuration section)

4. **Test with:**
   ```bash
   node scripts/monthly-payout-automation.js
   ```

---

## Status: ✅ COMPLETE

- Client dashboard with real-time earnings
- Monthly payout automation with ACH transfers
- Email notifications (initiated + cleared)
- Windows Task Scheduler integration
- Full fee transparency (82.07% net to clients)

**Revenue plumbing locked down.** You control the cash flow. Clients see their dashboard. Everyone gets paid monthly. Clean.
