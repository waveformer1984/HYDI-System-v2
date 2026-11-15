# Heidi distributed execution

**Scheduler / control plane:** `lib/distributed-cloud/*`, `config/distributed-cloud.json`.

**Production execution authority:** `lib/execution-fabric/gateway.js` — business logic stays on trusted nodes; distributed layer schedules only.

**Workers:** File-backed queue; GHA workflow optional; Frank home worker requires tailnet auth.

**Tests:** `distributed-cloud-acceptance.test.js` — labeled `[SIMULATED]`.

**Inventory:** `docs/DISTRIBUTED_CLOUD_RESOURCE_INVENTORY.md` (when present on branch).

**Policy:** Never expose workers on public internet; use Tailscale / ingress gate.