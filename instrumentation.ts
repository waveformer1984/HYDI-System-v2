/**
 * Next.js server startup hook.
 *
 * heidi-web-standalone is `next start`. The served code is the production
 * build, so provenance is recorded here rather than from a later checkout
 * of the working tree. The SHA comes from BUILD_SHA or `.next/hydi-build.json`.
 */

declare const __non_webpack_require__: NodeRequire;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return;
  const path = __non_webpack_require__('path') as typeof import('path');
  const bridgePath = path.join(process.cwd(), 'lib', 'runtime', 'next-provenance-register.cjs');
  const bridge = __non_webpack_require__(bridgePath) as {
    registerHeidiWebStandaloneProvenance: () => Promise<void>;
  };
  await bridge.registerHeidiWebStandaloneProvenance();
}