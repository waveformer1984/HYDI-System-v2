/**
 * Live-action guard — a runtime kill-switch for real-world side effects.
 *
 * Why this exists (red-team 2026-09-18, hermetic-hang incident)
 * ------------------------------------------------------------
 * tests/tier1-hermetic-guard.js confines Tier 1 at the SOCKET layer — but a
 * socket guard cannot police child_process. SelfRepairEngine's repair
 * handlers called through it anyway: the Ollama handler exec'd a real
 * `ollama serve` on the host and then polled for 15s while every fetch was
 * refused (the observed "15s hermetic hang"), and the same path could reach
 * docker restarts. A "hermetic" test was spawning real processes — the same
 * class of escape as the PM2 incident.
 *
 * The Tier 1 guard sets HYDI_DISABLE_LIVE_ACTIONS=1 for the process (it
 * propagates to spawned node children via inherited env). Execution paths
 * that would mutate the outside world check liveActionsDisabled() and
 * refuse honestly instead of pretending to run.
 *
 * This is a TEST SEAM, like BOOT_CONTROL_DIR / HYDI_BOOT_LEASE_PATH — never
 * set it in production.
 */
export function liveActionsDisabled(): boolean {
  return process.env.HYDI_DISABLE_LIVE_ACTIONS === '1';
}
