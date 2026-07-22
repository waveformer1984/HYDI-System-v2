import type { BusEvent, BusEventValidationError } from './types';

const VALID_PRIORITIES = new Set(['high', 'normal', 'low']);

export function validateBusEvent<T = unknown>(event: unknown): {
  valid: boolean;
  errors: BusEventValidationError[];
} {
  const errors: BusEventValidationError[] = [];

  if (typeof event !== 'object' || event === null) {
    return { valid: false, errors: [{ field: 'event', message: 'Event must be an object' }] };
  }

  const e = event as Partial<BusEvent<T>>;

  if (typeof e.id !== 'string' || e.id.length === 0) {
    errors.push({ field: 'id', message: 'id must be a non-empty string' });
  }

  if (typeof e.version !== 'number' || !Number.isInteger(e.version) || e.version < 1) {
    errors.push({ field: 'version', message: 'version must be a positive integer' });
  }

  if (typeof e.type !== 'string' || e.type.length === 0) {
    errors.push({ field: 'type', message: 'type must be a non-empty string' });
  }

  if (e.payload === undefined) {
    errors.push({ field: 'payload', message: 'payload must be present' });
  }

  if (!VALID_PRIORITIES.has(e.priority ?? '')) {
    errors.push({ field: 'priority', message: 'priority must be high, normal, or low' });
  }

  if (typeof e.timestamp !== 'string' || e.timestamp.length === 0) {
    errors.push({ field: 'timestamp', message: 'timestamp must be a non-empty ISO string' });
  }

  if (typeof e.source !== 'string' || e.source.length === 0) {
    errors.push({ field: 'source', message: 'source must be a non-empty string' });
  }

  if (e.correlationId !== undefined && typeof e.correlationId !== 'string') {
    errors.push({ field: 'correlationId', message: 'correlationId must be a string when present' });
  }

  if (e.causationId !== undefined && typeof e.causationId !== 'string') {
    errors.push({ field: 'causationId', message: 'causationId must be a string when present' });
  }

  if (e.traceId !== undefined && typeof e.traceId !== 'string') {
    errors.push({ field: 'traceId', message: 'traceId must be a string when present' });
  }

  if (typeof e.handlerCount !== 'number' || !Number.isInteger(e.handlerCount) || e.handlerCount < 0) {
    errors.push({ field: 'handlerCount', message: 'handlerCount must be a non-negative integer' });
  }

  if (e.errors !== undefined && !Array.isArray(e.errors)) {
    errors.push({ field: 'errors', message: 'errors must be an array when present' });
  }

  return { valid: errors.length === 0, errors };
}
