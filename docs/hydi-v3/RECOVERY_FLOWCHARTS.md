# HYDI V3 Recovery Flowcharts

This document contains recovery flowcharts for power loss, database outage, network outage, and corruption.

## Power Loss Recovery

```mermaid
flowchart TD
    A[Process restarts] --> B[AutonomyManager.start]
    B --> C[CheckpointStore.loadCheckpoint]
    C --> D{Checkpoint exists?}
    D -->|yes| E{Parse OK?}
    E -->|yes| F[Restore mission/decision/reflection counts]
    E -->|no| G[Delete corrupt checkpoint]
    G --> H[Re-initialize from JSON persistence]
    D -->|no| H
    F --> I[Start core loop]
    H --> I
    I --> J[Verify getStatus]
    J --> K[Run production-readiness-score.js]
```

## Database Outage Recovery

```mermaid
flowchart TD
    A[Database unavailable] --> B[Core loop / API error]
    B --> C{SelfHealing configured?}
    C -->|no| D[Log and escalate]
    C -->|yes| E[SelfHealingEngine.heal]
    E --> F[diagnose database_disconnect]
    F --> G[executePlan reconnect_database]
    G --> H{Success?}
    H -->|yes| I[Reset attempts]
    H -->|no| J[Increment attempts]
    J --> K{Attempts > maxAttempts?}
    K -->|no| L[Exponential backoff]
    L --> E
    K -->|yes| M[Emit escalated]
    M --> N[Operator intervention]
    I --> O[Resume normal operation]
```

## Network Outage Recovery

```mermaid
flowchart TD
    A[External API call fails] --> B{Failure type?}
    B -->|timeout / network| C[SelfHealingEngine.heal api_failure]
    B -->|auth / 401| D[SelfHealingEngine.heal auth_failure]
    C --> E[diagnose retry_with_backoff]
    D --> F[diagnose rotate_credentials]
    E --> G[Retry with jittered backoff]
    G --> H{Success?}
    H -->|yes| I[Resume]
    H -->|no| J{Max attempts?}
    J -->|no| G
    J -->|yes| K[Escalate]
    F --> L[Credential rotation handler]
    L --> M{Success?}
    M -->|yes| I
    M -->|no| K
    K --> N[Pause revenue missions]
    N --> O[Operator notified]
```

## Corruption Recovery

```mermaid
flowchart TD
    A[MemoryIntegrity scan fails] --> B[Collect issues and repairs]
    B --> C{Auto-repair possible?}
    C -->|yes| D[Apply in-place repairs]
    D --> E[Re-run scan]
    E --> F{Passed?}
    F -->|yes| G[Log repair summary]
    C -->|no| H[Stop HYDI]
    F -->|no| H
    H --> I[Restore data/ from backup]
    I --> J[Restart HYDI]
    J --> K[Run full test suite]
    K --> L{All pass?}
    L -->|yes| M[Return to production]
    L -->|no| N[Engage on-call engineer]
```

## General Escalation Flow

```mermaid
flowchart TD
    A[Symptom detected] --> B[SelfHealingEngine.diagnose]
    B --> C[Recovery plan selected]
    C --> D[executePlan with backoff]
    D --> E{Success within maxAttempts?}
    E -->|yes| F[Clear attempts, emit healing_completed]
    E -->|no| G[Emit escalated]
    G --> H[Log status and dashboard]
    H --> I[Notify operator]
    I --> J{Revenue path affected?}
    J -->|yes| K[Pause missions, disable auto-actions]
    J -->|no| L[Continue monitoring]
```
