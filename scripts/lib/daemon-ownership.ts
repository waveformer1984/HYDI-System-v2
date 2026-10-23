interface OwnershipCleanup {
  releaseLease: () => Promise<unknown>;
  closeLeasePool: () => Promise<unknown>;
  releaseLock: () => void;
  warn?: (message: string) => void;
  leaseTimeoutMs?: number;
  poolTimeoutMs?: number;
}

async function bounded(task: Promise<unknown>, timeoutMs: number, label: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Release durable ownership before the local lock. Both async DB operations
 * are bounded; the synchronous lock release always runs in the final clause.
 */
export async function releaseDaemonOwnership(cleanup: OwnershipCleanup): Promise<void> {
  const warn = cleanup.warn ?? ((message: string) => console.warn(message));
  try {
    await bounded(cleanup.releaseLease(), cleanup.leaseTimeoutMs ?? 2000, 'operator lease release');
  } catch (error: unknown) {
    warn(`[daemon] ${error instanceof Error ? error.message : 'operator lease release failed'}`);
  } finally {
    try {
      await bounded(cleanup.closeLeasePool(), cleanup.poolTimeoutMs ?? 1000, 'operator lease pool close');
    } catch (error: unknown) {
      warn(`[daemon] ${error instanceof Error ? error.message : 'operator lease pool close failed'}`);
    } finally {
      cleanup.releaseLock();
    }
  }
}
