export type EventPriority = 'high' | 'normal' | 'low';

export interface BusEvent<T = unknown> {
  id: string;
  /** Event schema version. New event schemas bump this number; consumers must ignore or migrate unknown major versions. */
  version: number;
  type: string;
  payload: T;
  priority: EventPriority;
  timestamp: string;
  source: string;
  handled?: boolean;
  handlerCount: number;
  errors?: string[];
  /** Groups related events — e.g. a request() and its matching response. */
  correlationId?: string;
  /** Threads a whole causal chain across multiple publishes. Auto-propagated via AsyncLocalStorage when omitted. */
  traceId?: string;
  /** The id of the event that directly caused this one. Auto-propagated via AsyncLocalStorage when omitted. */
  causationId?: string;
}

export interface BusEventValidationError {
  field: string;
  message: string;
}

export interface PublishOptions {
  priority?: EventPriority;
  source?: string;
  version?: number;
  correlationId?: string;
  traceId?: string;
  timestamp?: string;
  causationId?: string;
}

export interface RequestOptions {
  timeoutMs?: number;
  priority?: EventPriority;
  source?: string;
}

export interface SubscribeOptions {
  handlerPriority?: number;
  once?: boolean;
}

export type EventHandler<T = unknown> = (event: BusEvent<T>) => void | Promise<void>;

export interface Subscription {
  id: string;
  type: string;
  handler: EventHandler;
  handlerPriority: number;
  once: boolean;
}

export interface EventBusConfig {
  maxHistory?: number;
  logToConsole?: boolean;
}

export interface EventHistoryQuery {
  type?: string;
  source?: string;
  priority?: EventPriority;
  limit?: number;
  since?: string;
}
