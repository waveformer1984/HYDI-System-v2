export type EventPriority = 'high' | 'normal' | 'low';

export interface BusEvent<T = unknown> {
  id: string;
  type: string;
  payload: T;
  priority: EventPriority;
  timestamp: string;
  source?: string;
  handled?: boolean;
  handlerCount: number;
  errors?: string[];
}

export interface PublishOptions {
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
