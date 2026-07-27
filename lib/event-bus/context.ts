import { AsyncLocalStorage } from 'node:async_hooks';

export interface EventContextStore {
  eventId: string;
  traceId: string;
}

/**
 * Backs automatic correlation/trace/causality propagation in EventBus. A
 * handler that publishes a new event while handling another one inherits
 * that event's id (as causationId) and traceId automatically, without any
 * caller having to thread ids through manually. Survives .then/.catch/
 * .finally continuations and setTimeout/setImmediate/setInterval callbacks
 * scheduled from within a run() callback — does not survive timers
 * registered before run() is entered, which is correct: those aren't
 * caused by the event in question, they should start a fresh trace.
 */
export const eventContext = new AsyncLocalStorage<EventContextStore>();
