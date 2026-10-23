# Phase 11 Chaos Qualification Report

## Environment

* Repository: HYDI-System-v2
* Branch: release/v0.9.0
* HEAD: 66e7fed13dfd687dc0f7a381c29fb731b5dcd1b0
* Date: 2026-08-17T03:28:42.929Z
* Platform: win32
* Docker context: desktop-linux
* Docker server version: 29.7.2
* Runtime: Windows docker CLI (live Docker Desktop)
* Ursula Suite: C:\ProtoForge_Ecosystem\Ursula_Suite

## Baseline

Overall: **HEALTHY**

* Healthy components: 22 / 25
* Open incidents: 18

## Scenarios

| Scenario             | Detection | Classification | Recovery | Verification | Incident | Result |
| -------------------- | --------: | -------------- | -------: | -----------: | -------: | ------ |
| PostgreSQL           | 2148      | DATABASE_FAILURE | 1293 ms | — | inc-1786937225181-0ip0ml | PASS |
| Redis                | 1115      | CACHE_FAILURE | 1140 ms | — | inc-1786937235541-y42qhk | PASS |
| ProtoHub             | 2199      | DEPENDENCY_FAILURE | 831 ms | — | inc-1786937266583-06y1qn | PASS |
| Next.js              | 30076     | DEPENDENCY_FAILURE | 29644 ms | true | inc-1786937296699-nwojcp | PASS |
| Bridge               | 4391      | DEPENDENCY_FAILURE | 4036 ms | true | inc-1786937301101-kcud9j | PASS |
| Recovery failure     | —         | RESOURCE_EXHAUSTION | —        | —            | inc-1786937303117-y8gfvh | PASS |

## Dry-run target resolution

* Next.js (restart-next) :: RESOLVED — next-app 
* Bridge (kill-bridge) :: RESOLVED — heidi-bridge 
* restart-postgres :: RESOLVED — postgres (7e2b522e99b4942d5b5a123c14782131ae3a65c2a88fa34d271d1065348ff6dc) 
* restart-redis :: RESOLVED — redis (b2d3a1c26da982409854e0840902ca9a08ea5f65e8875f5c32ccfad0a8893ea9) 
* restart-protohub-api :: RESOLVED — protohub-api (a40f7dd5b51d872b194e0b1d4640ae83a1b3f55299c3e557b7088183952a7908) 

## Docker / WSL runtime failure

* Status: **NOT EXECUTED**
* Reason: No bounded reversible runtime-failure injection available for the live Docker daemon.
* Observer capability: verified (container states, Docker daemon, WSL availability, resource pressure, ports).

## Incident memory validation

* Append-only: verified
* Redaction: verified (SecretBroker)
* Fields present: incident_id, timestamp, component, failure_class, symptoms, environment, dependency_state, diagnosis, action, result, recovery_time, final_state, evidence_paths

## Final diagnostic

Overall: **HEALTHY**

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
