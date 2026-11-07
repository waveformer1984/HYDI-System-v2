/**
 * Next.js server startup hook — records runtime provenance for the drift
 * audit (`npm run runtime:audit`), the same contract as the root app's
 * instrumentation.ts. ursula-local runs `next start` directly, so without
 * this the audit can only report UNKNOWN_CODE for it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return;
  const path = await import('path');
  const { recordProcessProvenance } = await import('../../../lib/runtime/provenance.js');
  // PM2 runs `next start` with cwd=apps/ursula-frontend; provenance belongs
  // to the repo root so the drift audit finds it under .runtime/provenance.
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  await recordProcessProvenance('ursula-local', { cwd: repoRoot });
}
