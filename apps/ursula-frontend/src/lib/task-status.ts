/**
 * Canonical task lifecycle contract for Ursula + Heidi orchestration.
 *
 * Storage may still use legacy values while migration is in progress.
 * This module ensures every API/UI boundary sees one consistent lifecycle.
 */

export const CANONICAL_TASK_STATUSES = [
  'planned',
  'queued',
  'running',
  'waiting_review',
  'completed',
  'failed_retryable',
  'failed_terminal',
] as const;

export type CanonicalTaskStatus = (typeof CANONICAL_TASK_STATUSES)[number];
export type StorageTaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'resolving'
  | 'completed'
  | 'failed'
  | 'hard_failed';

type LegacyTaskStatus = string;

const LEGACY_TO_CANONICAL: Record<string, CanonicalTaskStatus> = {
  // Planned / backlog
  pending: 'planned',
  accepted: 'planned',
  planned: 'planned',

  // Queue
  assigned: 'queued',
  queued: 'queued',

  // Active execution
  in_progress: 'running',
  claimed: 'running',
  running: 'running',

  // Human review
  needs_approval: 'waiting_review',
  waiting_review: 'waiting_review',
  resolving: 'waiting_review',

  // Success terminal
  done: 'completed',
  complete: 'completed',
  completed: 'completed',

  // Failure (retryable/non-terminal)
  retrying: 'failed_retryable',
  failed: 'failed_retryable',
  failed_retryable: 'failed_retryable',

  // Failure terminal
  aborted: 'failed_terminal',
  hard_failed: 'failed_terminal',
  failed_terminal: 'failed_terminal',
};

const CANONICAL_TO_STORAGE: Record<CanonicalTaskStatus, StorageTaskStatus> = {
  planned: 'pending',
  queued: 'queued',
  running: 'running',
  waiting_review: 'resolving',
  completed: 'completed',
  failed_retryable: 'failed',
  failed_terminal: 'hard_failed',
};

const TRANSITIONS: Record<CanonicalTaskStatus, CanonicalTaskStatus[]> = {
  planned: ['queued', 'failed_terminal'],
  queued: ['running', 'waiting_review', 'failed_retryable', 'failed_terminal'],
  running: ['waiting_review', 'completed', 'failed_retryable', 'failed_terminal'],
  waiting_review: ['queued', 'running', 'completed', 'failed_terminal'],
  failed_retryable: ['queued', 'running', 'failed_terminal'],
  completed: [],
  failed_terminal: [],
};

export function normalizeTaskStatus(
  status: string | undefined | null,
  fallback: CanonicalTaskStatus = 'planned'
): CanonicalTaskStatus {
  if (!status) return fallback;
  return LEGACY_TO_CANONICAL[status.toLowerCase()] ?? fallback;
}

export function toCanonicalTaskStatus(
  status: string | undefined | null,
  fallback: CanonicalTaskStatus = 'planned'
): CanonicalTaskStatus {
  return normalizeTaskStatus(status, fallback);
}

export function toStorageTaskStatus(status: CanonicalTaskStatus | string): StorageTaskStatus {
  const canonical = normalizeTaskStatus(status);
  return CANONICAL_TO_STORAGE[canonical];
}

export function isTerminalTaskStatus(status: CanonicalTaskStatus | string): boolean {
  const canonical = normalizeTaskStatus(status);
  return TRANSITIONS[canonical].length === 0;
}

export function canTransitionTaskStatus(from: CanonicalTaskStatus | string, to: CanonicalTaskStatus | string): boolean {
  const canonicalFrom = normalizeTaskStatus(from);
  const canonicalTo = normalizeTaskStatus(to);
  return TRANSITIONS[canonicalFrom].includes(canonicalTo);
}

export function normalizeTaskForApi<T extends { status?: string }>(task: T): T & { status: CanonicalTaskStatus; raw_status?: string } {
  const rawStatus = task.status;
  const canonicalStatus = normalizeTaskStatus(rawStatus);
  return {
    ...task,
    status: canonicalStatus,
    ...(rawStatus && rawStatus !== canonicalStatus ? { raw_status: rawStatus } : {}),
  };
}
