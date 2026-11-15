/**
 * Substituted for instrumentation.ts in the browser webpack graph only.
 * Provenance recording runs in the Node server bundle via the real hook.
 */
export async function register(): Promise<void> {
  // No-op — instrumentation is server-start only.
}