// Process liveness endpoint — deliberately dependency-free.
//
// Purpose: distinguish "the Next.js process is alive and can execute a
// route" from "the service's dependencies are healthy". /api/health
// queries the Supabase system_dashboard view, so a stalled Supabase can
// make a perfectly healthy process look dead to the watchdog — the
// mechanism that fed false-positive recovery churn before /api/ping
// existed.
//
// Contract (verified by tests/unit/heidi-web-liveness.test.ts):
//   - no database access
//   - no Supabase client construction
//   - no Ollama / model call
//   - no PM2 / subprocess / filesystem work
//   - deterministic body
//   - HTTP 200 whenever the server can execute the route at all
//
// The response carries no timestamp: a clock-skewed timestamp in a
// liveness probe would let a stale value masquerade as a fresh reading,
// which is exactly the fake-healthy failure mode this system's telemetry
// contract exists to prevent.
export default function handler(req, res) {
  res.status(200).json({ status: 'alive', service: 'heidi-web' });
}
