import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // Default config: no ISR/queue bindings required for the current app
  // (no unstable_cache/revalidate usage that needs a KV cache today).
});
