# CANONICAL.md — HYDI System v2 Repository Identity

> **This file is the single source of truth for which HYDI repository is
> canonical. Any agent, human, or CI pipeline must verify repository identity
> against this file before making changes.**

## Canonical Repository

| Field              | Value |
|--------------------|-------|
| **Name**           | HYDI-System-v2 |
| **Absolute path**  | `C:\Users\Owner\HYDI-System-v2` |
| **Git remote**     | `https://github.com/waveformer1984/HYDI-System-v2.git` |
| **Primary branch** | `clean-main` |
| **GitHub repo**    | `waveformer1984/HYDI-System-v2` |

## Rules

1. **All development happens in `C:\Users\Owner\HYDI-System-v2`.**
   No other directory may be treated as the active development root.

2. **No new clones or remediation directories.**
   If work cannot proceed, document the blocker inside this repository
   (in `HYDI_RUNTIME_RECOVERY_REPORT.md` or the gate state file) and stop.
   Do not create another copy.

3. **No modifications to archived/noncanonical copies.**
   The directories listed below in "Quarantined Copies" must not be
   edited, built, or booted. They are preserved as evidence only.

4. **Stale path references must be updated.**
   Any configuration file, script, or manifest that references
   `C:\Users\Owner\HYDI_System`, `F:\HYDI_System`, `C:\Dev\HydiSuite`,
   or `C:\HYDI_System` as a project root is stale and must be updated
   to point at `C:\Users\Owner\HYDI-System-v2` or removed.

5. **Repository identity must be verified before any operation.**
   Run `node scripts/verify-canonical.js` (or
   `npm run verify:canonical`) before starting work. This gate checks
   the Git remote, branch, and working directory against this file.

## Quarantined Copies

These directories are **not canonical** and must not be used for
development, boot, or testing. They are preserved as evidence or
backups only.

| Path | Classification | Remote | Notes |
|------|---------------|--------|-------|
| `C:\Users\Owner\HYDI_System` | **OBSOLETE CLONE** (same remote, stale branch `release/v0.9.0`) | `HYDI-System-v2.git` | 141 dirty files, 2.5GB. Do not modify. |
| `F:\HYDI_System` | **OBSOLETE CLONE** (same remote, stale branch `session/runtime-ops-restore`) | `HYDI-System-v2.git` | Clean but stale. Do not modify. |
| `C:\Users\Owner\HYDI-Remediation` | **OBSOLETE CLONE** (no git, has boot.config.json) | none | 702MB non-git copy. Do not modify. |
| `C:\Users\Owner\HYDI_Backups` | **BACKUP** | none | 1GB of backup snapshots. Do not modify. |
| `C:\Users\Owner\HYDI_CORE` | **ARCHIVE** | none | Empty/minimal. |
| `C:\Users\Owner\HYDI_Vault` | **ARCHIVE** | none | Empty/minimal. |
| `C:\Users\Owner\hydi-evolution` | **ARCHIVE** | none | Empty/minimal. |
| `C:\Users\Owner\hydi-logs` | **EVIDENCE** | none | 23MB of historical logs. |
| `C:\Users\Owner\HYDI_Governance_Audit_20260724` | **AUDIT/EVIDENCE** | none | July 24 governance audit reports. Read-only evidence. |
| `C:\Users\Owner\heidi_frank_drop` | **ARCHIVE** | none | 34MB. Do not modify. |
| `C:\Users\Owner\HYDI-TailNet` | **ARCHIVE** | none | 49MB. Do not modify. |
| `C:\Users\Owner\.hydi` | **ARCHIVE** | none | 6MB. Runtime data. |
| `C:\Dev\HYDI_System` | **OBSOLETE CLONE** (different remote: `HYDI_System.git`) | `HYDI_System.git` | Old Python-based system. Not the same project. |
| `C:\Dev\HydiSuite` | **OBSOLETE CLONE** (different remote: `HydiSuite.git`) | `HydiSuite.git` | Separate project. |
| `C:\Dev\protoforge` | **OBSOLETE CLONE** (different remote: `protoforge-workspace.git`) | `protoforge-workspace.git` | Separate project. |
| `C:\HYDI_System` | **DELETED** | `ProtoForge_Dashboard.git` | Was 4.5GB. Had a GitHub PAT (ghp_) embedded in remote URL and git internals. PAT was already revoked (HTTP 401). Remote URL scrubbed, then entire directory deleted 2026-08-17 per explicit user request. |
| `F:\ProtoForge` | **ARCHIVE** | none | Empty/minimal. |
| `C:\ProtoForge_Ecosystem\Hydi_Core` | **ARCHIVE** | none | Empty/minimal. |
| `C:\Users\Owner\protoforgesite` | **ACTIVE BUT NONCANONICAL** (different project) | `protoforgesite` | Separate ProtoForge website project. Not HYDI. |

## Security Finding (Resolved)

`C:\HYDI_System` previously had a GitHub Personal Access Token (PAT)
embedded in its Git remote URL (`https://waveformer1984:ghp_...@github.com/...`).
The PAT was confirmed already revoked (HTTP 401). The remote URL was
scrubbed to remove the credential, then the entire `C:\HYDI_System`
directory was deleted on 2026-08-17 per explicit user request. The
token no longer exists anywhere on this machine.

## Verification Procedure for Future Agents

Before starting any work on HYDI:

```bash
cd C:\Users\Owner\HYDI-System-v2
node scripts/verify-canonical.js
```

If the gate fails, **stop** — you are in the wrong directory or the
repository has been tampered with. Do not proceed until identity is
confirmed.

If you discover a new HYDI copy that is not listed above, add it to
the quarantined copies table before doing anything else.
