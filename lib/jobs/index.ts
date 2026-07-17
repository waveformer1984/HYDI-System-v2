export * from './types';
export { MemoryJobQueue } from './stores/MemoryJobQueue';
export { SupabaseJobQueue } from './stores/SupabaseJobQueue';
export { Worker } from './Worker';

import { MemoryJobQueue } from './stores/MemoryJobQueue';

let defaultQueue: MemoryJobQueue | null = null;

export function getDefaultJobQueue(): MemoryJobQueue {
  if (!defaultQueue) {
    defaultQueue = new MemoryJobQueue();
  }
  return defaultQueue;
}
