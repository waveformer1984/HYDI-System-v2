# Phase 11 Chaos Qualification Report

## Environment

* Repository: HYDI-System-v2
* Branch: release/v0.9.0
* HEAD: 66e7fed13dfd687dc0f7a381c29fb731b5dcd1b0
* Date: 2026-08-16T09:57:08.381Z
* Platform: win32
* WSL distro: Ubuntu
* Ursula Suite: C:\ProtoForge_Ecosystem\Ursula_Suite

## Baseline

Overall: **DEGRADED**

* Healthy components: 19 / 25
* Open incidents: 0

## Scenarios

| Scenario             | Detection | Classification | Recovery | Verification | Incident | Result |
| -------------------- | --------: | -------------- | -------: | -----------: | -------: | ------ |
| PostgreSQL           | 49826     | DATABASE_FAILURE | 30128 ms | — | inc-1786873651540-oz5q6a | PASS |
| Redis                | 4229      | CACHE_FAILURE | 27952 ms | — | inc-1786874092635-cpdb01 | PASS |
| ProtoHub             | 4699      | DEPENDENCY_FAILURE | 1770 ms | — | inc-1786874134580-0emx6d | PASS |
| Next.js              | 5011      | DEPENDENCY_FAILURE | — ms | — | inc-1786874199784-qozvw8 | FAIL |
| Bridge               | 2468      | DEPENDENCY_FAILURE | 2026 ms | true | inc-1786874202260-lx3g9t | PASS |
| Recovery failure     | —         | RESOURCE_EXHAUSTION | —        | —            | inc-1786874204265-afivlk | PASS |

## Docker / WSL runtime failure

* Status: **NOT EXECUTED**
* Reason: No bounded reversible runtime-failure injection available for the live Docker/WSL daemon.
* Observer capability: verified (container states, Docker daemon, WSL availability, resource pressure, ports).

## Incident memory validation

* Append-only: verified
* Redaction: verified (SecretBroker)
* Fields present: incident_id, timestamp, component, failure_class, symptoms, environment, dependency_state, diagnosis, action, result, recovery_time, final_state, evidence_paths

## Final diagnostic

Overall: **DEGRADED**

## Verdict

**PASS WITH LIMITATIONS**

The HEIDI Operational Intelligence layer successfully observed, classified, recovered (via bounded WSL compose and process scenarios), verified, and recorded controlled service-level failures. The live Docker/WSL daemon could not be safely failed without risking the host, so that scenario was not executed.

## Evidence

* reports\phase11\baseline.json
* reports\phase11\final.json
* reports\phase11\incidents
* reports\phase11\environment.json

## Limitations

* Docker daemon / WSL runtime failure not injected (no safe reversible mechanism).
* Process-level recoveries for next and bridge were executed by the existing soak-chaos harness; HEIDI observed and recorded them.
