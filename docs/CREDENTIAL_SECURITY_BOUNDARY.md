# HYDI Credential Security Boundary Analysis

## PHASE 1 — Where Plaintext Credentials Currently Exist

### 1. Credential Entry Points

Credentials enter the system through these paths:

| Path | Status | Risk |
|------|--------|------|
| `.env.local` | **Primary owner flow** — daemon re-reads every 60s | Plaintext on disk |
| `.env` | Secondary — loaded at startup | Plaintext on disk |
| `process.env` | Runtime — loaded from .env files or inherited | Plaintext in memory |
| Provider APIs | Key creation returns plaintext key value | Transient — stored to vault |
| CLI arguments | Not used for credential values | N/A |
| API requests | Not used for credential values | N/A |
| Database records | Not currently stored in DB | N/A |

### 2. Where Plaintext Credentials Live

#### Plaintext on Disk
- `.env.local` — contains `STRIPE_SECRET_KEY=sk_test_...`, `SENDGRID_API_KEY=SG...`, etc.
- `.env` — may contain additional credentials
- `.hydi-operational/key-vault.enc` — encrypted vault (AES-256-GCM) — NOT plaintext

#### Plaintext in Memory (process.env)
- `process.env.STRIPE_SECRET_KEY`
- `process.env.STRIPE_WEBHOOK_SECRET`
- `process.env.SENDGRID_API_KEY`
- `process.env.SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS`
- `process.env.GOOGLE_PLACES_API_KEY`
- `process.env.TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER`
- `process.env.SUPABASE_SERVICE_ROLE_KEY`
- `process.env.HYDI_SERVICE_SECRET`

#### Direct process.env Access (66 files)

The following categories of files directly read credential values from `process.env`:

**Key Management Layer (intentional — reads to store in vault):**
- `lib/operational/KeyProviders.ts` — reads master keys to create/rotate/revoke
- `lib/operational/KeyManagementService.ts` — reads to classify risk level
- `lib/operational/KeyVaults.ts` — `EnvVarVault.retrieve()` reads from process.env

**Credential Probes (intentional — reads to validate against provider):**
- `lib/operational/EnhancedCredentialProbes.ts` — reads to make API validation calls
- `lib/operational/ProviderAdapters.ts` — reads to make API validation calls

**Revenue/Billing Layer (consumer — reads to process payments):**
- `lib/revenue/StripeBridge.ts`
- `lib/revenue/CommercialWorkflow.ts`
- `lib/revenue/ProspectDiscoveryAdapter.ts`
- `api/checkout.js`, `api/revenue.js`
- `api/webhooks/stripe.js`, `api/stripe-connect-webhook.js`
- `revenue-engine/index.js`, `revenue-engine/revenue-engine-v2.js`
- `src/revenue/HeidiRevenueEngine.js`
- `src/services/subscription-manager.js`

**Orchestrator/Health:**
- `lib/orchestrator.ts`
- `lib/health/collectors/database.ts`
- `lib/health/collectors/external.ts`

**Scripts:**
- `scripts/verify-credential.ts`
- `scripts/failure-injection.ts`
- `scripts/execute-real-campaign.ts`
- `scripts/preflight.js`
- Various test scripts

**Archive (not active):**
- `archive/superseded-stripe-implementations/` — 4 files (not in use)

### 3. Credential Flow Diagram

```
                    OWNER
                      |
                      | edits .env.local
                      v
              +---------------+
              |  .env.local   |  (plaintext on disk)
              +---------------+
                      |
          daemon re-reads (every 60s)
                      |
                      v
              +---------------+
              |  process.env  |  (plaintext in memory)
              +---------------+
                      |
        +-------------+-------------+
        |             |             |
        v             v             v
  +-----------+ +-----------+ +-----------+
  | Probes    | | Revenue   | | KeyMgr    |
  | (validate)| | (consume) | | (manage)  |
  +-----------+ +-----------+ +-----------+
        |             |             |
        v             v             v
  +-----------+ +-----------+ +-----------+
  | Provider  | | Provider  | | Vault     |
  | API call  | | API call  | | (encrypt) |
  +-----------+ +-----------+ +-----------+
        |             |             |
        v             v             v
  +-----------+ +-----------+ +-----------+
  | Health    | | Payment   | | Inventory |
  | Report    | | Processed | | (metadata)|
  +-----------+ +-----------+ +-----------+
                                |
                                v
                          +-----------+
                          | Audit     |
                          | (no secrets)|
                          +-----------+
```

### 4. Security Boundary Status

#### What's ALREADY secured:
- `KeyMetadata` domain objects contain ONLY fingerprints (SHA-256, first 16 hex chars), never secret values
- `KeyAuditService` records contain ONLY metadata, operation types, and fingerprints — never secret values
- `KeyInventoryStore` persists ONLY metadata — never secret values
- `SecretScanner` redacts all findings (first 4 + last 4 chars only)
- API responses under `/api/keys/*` return ONLY metadata — never secret values
- `LocalDevVault` encrypts at rest (AES-256-GCM)
- `KeyPolicyEngine` enforces R0/R1/R2/R3/R5 authorization on all operations
- Kill switch blocks all mutations; observation remains allowed
- Policy enforcement is fail-closed

#### What's NOT yet secured (gaps):
1. **`process.env` is the de facto vault** — 66 files read credentials directly from `process.env` rather than through the `KeyVault` interface. The `EnvVarVault` exists but is not the primary retrieval path for most consumers.
2. **No authorization gate on vault retrieval** — `vault.retrieve(keyId)` returns the plaintext value without checking authorization. Any code with a reference to the vault can retrieve any key.
3. **No rotation idempotency lock** — concurrent rotation requests for the same key can create multiple replacement credentials.
4. **Credential health and service health are conflated** — `CapabilityHealthManager` reports a single state that mixes credential validity with service availability.
5. **Credential recovery is not integrated into `SelfRepairEngine`** — `KeyManagementService.recover()` exists but is not called by the self-repair pipeline.
6. **No natural language interface** — HEIDI cannot translate "rotate the Stripe credential" into a governed credential operation.
7. **No dashboard view** — no UI for credential operations.
8. **No `--dry-run` on CLI lifecycle commands** — `keys-cli.ts` lacks dry-run for destructive operations.

### 5. Boundary Enforcement Plan

The long-term goal is:

```
OWNER → .env.local (bootstrap only)
                ↓
        CredentialVault (authoritative)
                ↓
    retrieveForAuthorizedOperation()
                ↓
        Authorized consumer only
```

`.env.local` becomes a bootstrap/development compatibility mechanism. The `CredentialVault` becomes the authoritative source. Consumers retrieve credentials through `retrieveForAuthorizedOperation()` which enforces policy.

**This will NOT be a breaking change.** The existing `process.env` access continues to work. The vault is an additional layer that progressively replaces direct `process.env` access for managed credentials.

### 6. What Will NOT Change

- The six-layer pipeline (Ingestion → RAW LEDGER → CASCADE → KILO → ProtoForge → Emission)
- The `PolicyEngine` fail-closed default
- The cooldown windows
- The `CognitiveCore`/`HeidiExecutive` governance plane
- The existing `verify-credential.ts` behavior
- The existing `EnhancedCredentialProbes` behavior
- The existing `CredentialRunbookRegistry` behavior
- The dynamic `.env.local` detection in the daemon
