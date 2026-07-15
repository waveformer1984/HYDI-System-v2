const keyQueues = new Map<string, Promise<void>>();

/**
 * Process-local async lock keyed by idempotency scope.
 * This prevents duplicate side effects when identical requests arrive concurrently.
 */
export async function withKeyLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = keyQueues.get(key) || Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const queued = previous.then(() => current);
  keyQueues.set(key, queued);

  await previous;
  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (keyQueues.get(key) === queued) {
      keyQueues.delete(key);
    }
  }
}

export async function withIdempotencyLock<T>(
  userId: string,
  idempotencyKey: string,
  operation: () => Promise<T>
): Promise<T> {
  const lockKey = `${userId}::${idempotencyKey}`;
  return withKeyLock(lockKey, operation);
}
