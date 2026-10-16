/**
 * Next.js server startup hook.
 *
 * heidi-web-standalone is `next start`. The served code is the production
 * build, so provenance is recorded here rather than from a later checkout
 * of the working tree. The SHA comes from BUILD_SHA or `.next/hydi-build.json`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { recordProcessProvenance } = await import('./lib/runtime/provenance.js');
  await recordProcessProvenance('heidi-web-standalone');
}
