/**
 * Next.js server startup hook — records runtime provenance for the drift
 * audit (`npm run runtime:audit`), the same contract as the root app's
 * instrumentation.ts. ursula-local runs `next start` directly, so without
 * this the audit can only report UNKNOWN_CODE for it.
 */

declare const __non_webpack_require__: NodeRequire;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return;
  const path = __non_webpack_require__('path') as typeof import('path');
  const bridgePath = path.join(process.cwd(), '..', '..', 'lib', 'runtime', 'next-provenance-register.cjs');
  const bridge = __non_webpack_require__(bridgePath) as {
    registerUrsulaLocalProvenance: () => Promise<void>;
  };
  await bridge.registerUrsulaLocalProvenance();
}