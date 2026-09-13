# HYDI Human Action Engine — Qualification Report

## 1. Architecture

The Human Action Engine extends HYDI from an operational intelligence and credential-management system into a governed Human Action Automation platform. It does NOT create a competing execution architecture — it extends the existing governed-autonomy control plane.

### Core Components

| Component | File | Role |
|-----------|------|------|
| HumanActionEngine | `lib/human-action/HumanActionEngine.ts` | Main orchestrator: INTENT → POLICY → AUTHORIZE → OBSERVE → EXECUTE → VERIFY → ROLLBACK → RECORD |
| ActionCapabilityRegistry | `lib/human-action/ActionCapabilityRegistry.ts` | Registry of 43 capabilities across 8 categories with risk/authorization/verification metadata |
| AuthorityManager | `lib/human-action/AuthorityManager.ts` | Delegated authority model with scopes, time constraints, and confirmation policies |
| ActionJournal | `lib/human-action/ActionJournal.ts` | Persistent JSONL audit trail with secret redaction, survives daemon restarts |
| GoalDecomposer | `lib/human-action/GoalDecomposer.ts` | Turns natural-language goals into dependency-ordered action graphs |
| HumanActionBridge | `lib/human-action/HumanActionBridge.ts` | Integrates with CognitiveCore's ExecutionBridge |

### Action Adapters (Pluggable)

| Adapter | File | Capabilities |
|---------|------|-------------|
| FilesystemAdapter | `adapters/FilesystemAdapter.ts` | read_file, write_file, create_directory, move_file, delete_file |
| ProcessAdapter | `adapters/ProcessAdapter.ts` | execute, inspect, start, stop (structured command allowlist) |
| HttpAdapter | `adapters/HttpAdapter.ts` | http_request, dns_lookup, connectivity_test |
| BrowserAdapter | `adapters/BrowserAdapter.ts` | navigate, click, type, select, submit, inspect, screenshot, upload, download |
| DevelopmentAdapter | `adapters/DevelopmentAdapter.ts` | git_status, git_branch, git_commit, git_push, run_tests, build, deploy |
| InfrastructureAdapter | `adapters/InfrastructureAdapter.ts` | docker_operation, service_restart, health_check |
| CredentialAdapter | `adapters/CredentialAdapter.ts` | discover, validate, provision, rotate, revoke (wraps existing KMS) |
| CommunicationAdapter | `adapters/CommunicationAdapter.ts` | prepare_email, send_email, prepare_message, send_message |

## 2. Capabilities

43 registered capabilities across 8 categories:

| Category | Count | Risk Range | Examples |
|----------|-------|-----------|----------|
| SYSTEM | 9 | R0-R3 | read_file, write_file, create_directory, move_file, delete_file, execute, inspect, start, stop |
| NETWORK | 3 | R0-R1 | http_request, dns_lookup, connectivity_test |
| BROWSER | 9 | R0-R3 | navigate, click, type, select, submit_form, inspect_page, screenshot, upload_file, download |
| DEVELOPMENT | 7 | R0-R4 | git_status, git_branch, git_commit, git_push, run_tests, build, deploy |
| INFRASTRUCTURE | 3 | R0-R3 | docker_operation, service_restart, health_check |
| CREDENTIALS | 5 | R0-R4 | discover, validate, provision, rotate, revoke |
| COMMUNICATION | 4 | R0-R3 | prepare_email, send_email, prepare_message, send_message |
| FINANCIAL | 3 | R5 | create_charge, create_subscription, refund (all PROHIBITED for autonomous) |

## 3. Authorization Model

### Delegated Authority

- Authority is delegated by a user to HYDI with specific scopes, risk limits, resource patterns, and time constraints
- 9 authorization scopes: READ_ONLY, LOCAL_WRITE, SERVICE_OPERATION, EXTERNAL_COMMUNICATION, ACCOUNT_CONFIGURATION, CREDENTIAL_MANAGEMENT, DEPLOYMENT, FINANCIAL, DESTRUCTIVE
- Never assume authorization for one operation grants authorization for unrelated operations

### Risk Classification

| Risk Level | Label | Authorization Mode | Examples |
|-----------|-------|-------------------|----------|
| R0 | LOW | autonomous | read_file, health_check, dns_lookup |
| R1 | LOW | autonomous | write_file, http_request, git_branch |
| R2 | MEDIUM | policy_authorized | execute_process, browser_click, git_commit |
| R3 | HIGH | human_required | delete_file, service_restart, send_email, credential_rotate |
| R4 | HIGH/CRITICAL | human_required | git_push, deploy, credential_revoke |
| R5 | CRITICAL | prohibited (autonomous) | financial operations |

### Confirmation Policy

Three preset policies: STRICT (default), BALANCED, PERMISSIVE
- Destructive actions always require confirmation
- Financial actions always require confirmation
- External communication requires confirmation in STRICT mode
- Credential management (non-read) requires confirmation in STRICT mode

## 4. Action Lifecycle

```
INTENT (proposed by reasoning layer)
  → POLICY EVALUATION (capability registered? adapter available? scope granted?)
  → AUTHORIZATION (delegated authority check, risk limit check)
  → [if human approval required] → PAUSE → HUMAN INTERVENTION REQUEST
  → OBSERVE (capture pre-execution state)
  → EXECUTE (through adapter)
  → OBSERVE (capture post-execution state)
  → VERIFY (independent verification through adapter)
  → [if verification fails] → ROLLBACK (through adapter)
  → RECORD (in persistent journal with secrets redacted)
  → RETURN RESULT
```

## 5. Verification Model

Every action has a verification strategy:
- `state_check` — verify system state matches expected
- `file_exists` — verify file exists at target path
- `process_running` — verify process is running
- `api_response` — verify HTTP response status
- `health_check` — verify service health
- `custom` — adapter-specific verification

Verification is performed by the adapter independently of execution. An action is only marked `VERIFIED` if verification passes. If verification fails, rollback is attempted.

## 6. Recovery Model

- Recovery handlers can be registered per capability
- Integrates with existing SelfRepairEngine pattern
- Bounded retries with exponential backoff
- Escalation to human intervention when recovery is exhausted

## 7. Human Intervention Model

When HYDI cannot safely continue, it produces a `HumanInterventionRequest` containing:
- What was attempted
- What succeeded
- What failed
- Why HYDI cannot continue
- The EXACT human action required
- What will happen after the human completes it

Intervention types: MFA_REQUIRED, CAPTCHA_REQUIRED, BIOMETRIC_REQUIRED, SECURITY_KEY_REQUIRED, MANUAL_CREDENTIAL_ENTRY, POLICY_AUTHORIZATION, UNSUPPORTED_OPERATION, DESTRUCTIVE_CONFIRMATION, EXTERNAL_ACCOUNT_ACCESS

The system NEVER simply says "Manual intervention required." It always provides actionable information.

## 8. Safety Boundary

```
REASONING LAYER (LLM/HEIDI)
  → proposes HumanActionIntent (NO secret material)
  → POLICY ENGINE evaluates (existing AutonomyPolicyModel concepts)
  → AUTHORITY MANAGER authorizes (delegated authority)
  → ADAPTER EXECUTOR performs (structured, allowlisted)
  → ADAPTER VERIFIER confirms (independent verification)
  → ACTION JOURNAL records (metadata-only, secrets redacted)
```

The reasoning model NEVER directly receives:
- Unrestricted shell execution
- Browser control
- Filesystem access
- Network access
- Credential material
- Financial authority

## 9. Qualification Results

### Unit Tests (19 tests, all passing)

| Scenario | Description | Result |
|----------|-------------|--------|
| A | Create a project directory (PLAN→AUTHORIZE→EXECUTE→VERIFY) | PASS |
| B | Check why ProtoForge is unhealthy (OBSERVE→CORRELATE→DIAGNOSE→REPORT) | PASS |
| C | Repair ProtoForge if safe (OBSERVE→DIAGNOSE→SELECT→AUTHORIZE→EXECUTE→VERIFY) | PASS |
| D | Configure a credential (DISCOVER→POLICY→PROVISION→VALIDATE→VERIFY) | PASS |
| E | Complete a website setup (BROWSER→OBSERVE→ACT→VERIFY→CONTINUE) | PASS (browser not available, correctly reports BLOCKED) |
| F | Encounter MFA (PAUSE→BLOCKED→HUMAN ACTION REQUEST→RESUME) | PASS |
| G | Unauthorized destructive operation (DENY→RECORD→EXPLAIN) | PASS |

Additional tests:
- No secret material in journal/results: PASS
- Persistent journal survives restart: PASS
- Dry-run produces evaluation without execution: PASS
- Goal decomposition produces valid action graphs: PASS
- Capability discovery returns accurate states: PASS
- Safety boundary — unregistered capability rejected: PASS
- Safety boundary — no authority rejected: PASS
- Action journal statistics: PASS

### Live Qualification Script (26 passed, 0 failed, 2 skipped)

```
npx tsx scripts/qualify-human-action-engine.ts
```

Results:
- Filesystem action (create directory, write file, verify content): PASS
- Process action (inspect process): PASS
- API/HTTP action (HTTP request to httpbin.org, verify 200): PASS
- Browser action: SKIP (puppeteer not installed — correctly reported as UNSUPPORTED)
- Credential lifecycle (discover, validate, verify): PASS
- Failed action (read nonexistent file → failure recorded): PASS
- Recovery action (recovery handler registered): PASS
- Authorization denial (write with READ_ONLY authority → denied): PASS
- Human intervention pause (delete file → pending_human): PASS
- Persistent audit (journal has entries, no secrets, survives reload): PASS
- Capability discovery (43 capabilities, no unsupported claimed): PASS

## 10. Security Findings

- Secret material is NEVER included in action parameters, results, journal entries, or audit records
- `redactParameters()` replaces secret values with `[REDACTED]` before journal storage
- Secret key patterns detected: password, secret, token, api_key, private_key, credential, auth, pass, passwd
- Secret value patterns detected: sk_live_, sk_test_, SG., Bearer, long base64 strings, PEM keys
- Credential references use opaque IDs (cred_01J...) resolved only in executor context
- No secret material in journal file (verified by content scan)

## 11. Unsupported Capabilities

| Capability | Status | Reason |
|-----------|--------|--------|
| browser.* (all) | BLOCKED | puppeteer/puppeteer-core not installed |
| financial.* (all) | REQUIRES_AUTHORIZATION | R5 — prohibited for autonomous execution |
| filesystem.delete_file | REQUIRES_AUTHORIZATION | R3 — requires human confirmation |
| process.stop | REQUIRES_AUTHORIZATION | R3 — requires human confirmation |
| dev.git_push | REQUIRES_AUTHORIZATION | R4 — requires human confirmation |
| dev.deploy | REQUIRES_AUTHORIZATION | R4 — requires human confirmation |
| infra.service_restart | REQUIRES_AUTHORIZATION | R3 — requires human confirmation |
| credential.provision | REQUIRES_AUTHORIZATION | R3 — requires human confirmation |
| credential.rotate | REQUIRES_AUTHORIZATION | R3 — requires human confirmation |
| credential.revoke | REQUIRES_AUTHORIZATION | R4 — requires human confirmation |
| comm.send_email | REQUIRES_AUTHORIZATION | R3 — requires human confirmation |
| comm.send_message | REQUIRES_AUTHORIZATION | R3 — requires human confirmation |
| browser.submit_form | REQUIRES_AUTHORIZATION | R3 — requires human confirmation |
| browser.upload_file | REQUIRES_AUTHORIZATION | R3 — requires human confirmation |

## 12. Known Limitations

1. **Browser automation** requires puppeteer or puppeteer-core to be installed. Without it, all browser capabilities are correctly reported as BLOCKED.
2. **Process execution** uses a structured command allowlist (not arbitrary shell). Commands must be pre-registered in the allowlist.
3. **Goal decomposition** uses pattern matching on goal statements. More complex goals may not match any pattern and will produce a generic observation action.
4. **Credential adapter** wraps the existing KeyManagementService. Provisioning support depends on the underlying KMS implementation.
5. **Communication adapter** requires email/message services to be configured.
6. **MFA/CAPTCHA detection** in BrowserAdapter uses page content pattern matching. More sophisticated detection may be needed for specific sites.

## 13. Remaining Blockers

1. Install puppeteer-core to enable browser automation capabilities
2. Wire HumanActionBridge into CognitiveCoreBuilder for daemon integration
3. Add API endpoint for natural-language goal submission
4. Add dashboard view for action journal and pending interventions
5. Add CLI command for goal submission and action execution

## 14. Exact Commands Executed

```bash
# Typecheck
npx tsc --noEmit
# Result: 114 errors (baseline — zero new errors from human-action module)

# Unit tests
npx jest tests/unit/human-action-engine.test.ts --forceExit
# Result: 19 passed, 0 failed

# Existing tests (regression check)
npx jest tests/unit/key-management.test.ts tests/unit/key-management-qualification.test.ts tests/unit/no-secret-regression.test.ts --forceExit
# Result: 57 passed, 0 failed

# Combined
npx jest tests/unit/human-action-engine.test.ts tests/unit/key-management.test.ts tests/unit/key-management-qualification.test.ts tests/unit/no-secret-regression.test.ts --forceExit
# Result: 76 passed, 0 failed

# Live qualification
npx tsx scripts/qualify-human-action-engine.ts
# Result: 26 passed, 0 failed, 2 skipped (browser — puppeteer not installed)
# Status: QUALIFIED
```

## 15. Git Commit

```
feat(human-action): governed Human Action Automation engine

Adds a provider-independent action model that extends HYDI from
operational intelligence into governed human action automation:

- HumanAction abstraction (intent → policy → authorize → execute → verify → record)
- ActionCapabilityRegistry with 43 capabilities across 8 categories
- 8 pluggable action adapters (filesystem, process, HTTP, browser, dev, infra, credential, communication)
- Delegated authority model with 9 authorization scopes
- Risk classification (R0-R5 → LOW/MEDIUM/HIGH/CRITICAL)
- Goal decomposition into dependency-ordered action graphs
- Persistent action journal with secret redaction (survives restarts)
- Human intervention protocol with actionable explanations
- MFA/CAPTCHA/biometric challenge detection and pause
- Safety boundary: model proposes, policy authorizes, executor performs
- 19 unit tests (scenarios A-G + security + persistence + dry-run)
- Live qualification script (26 checks, all passing)
- Zero new typecheck errors (114 baseline maintained)
```

## 16. Final Daemon Status

The Human Action Engine is implemented as a library that integrates with the existing HEIDI daemon through the ExecutionBridge. It does not modify the daemon directly — integration is through the `HumanActionBridge` interface which can be wired into `CognitiveCoreBuilder`.

The daemon continues to operate with its existing cognitive loop. The Human Action Engine adds a new capability layer that the cognitive core can invoke when goals require human-action automation.
