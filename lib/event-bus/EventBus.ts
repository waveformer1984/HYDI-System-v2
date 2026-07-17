import { randomUUID } from 'crypto';
import type {
  BusEvent,
  EventBusConfig,
  EventHandler,
  EventHistoryQuery,
  EventPriority,
  PublishOptions,
  SubscribeOptions,
  Subscription,
} from './types';

const PRIORITY_RANK: Record<EventPriority, number> = { high: 0, normal: 1, low: 2 };

export class EventBus {
  private subscriptions = new Map<string, Subscription[]>();
  private history: BusEvent[] = [];
  private maxHistory: number;
  private logHandlers: Array<(entry: { level: string; message: string; event?: BusEvent; error?: string }) => void> = [];
  private queue: BusEvent[] = [];
  private processing = false;
  private logToConsole: boolean;

  constructor(config: EventBusConfig = {}) {
    this.maxHistory = config.maxHistory ?? 1000;
    this.logToConsole = config.logToConsole ?? false;
  }

  subscribe<T = unknown>(
    type: string,
    handler: EventHandler<T>,
    options: SubscribeOptions = {}
  ): string {
    const subscription: Subscription = {
      id: randomUUID(),
      type,
      handler: handler as EventHandler<unknown>,
      handlerPriority: options.handlerPriority ?? 0,
      once: options.once ?? false,
    };

    const list = this.subscriptions.get(type) ?? [];
    list.push(subscription);
    list.sort((a, b) => a.handlerPriority - b.handlerPriority);
    this.subscriptions.set(type, list);

    this.log('debug', `Subscribed handler to ${type}`, { eventType: type });
    return subscription.id;
  }

  unsubscribe(id: string): boolean {
    for (const [type, list] of this.subscriptions.entries()) {
      const index = list.findIndex((sub) => sub.id === id);
      if (index >= 0) {
        list.splice(index, 1);
        this.log('debug', `Unsubscribed handler ${id} from ${type}`, { eventType: type });
        return true;
      }
    }
    return false;
  }

  async publish<T = unknown>(
    type: string,
    payload: T,
    options: PublishOptions = {}
  ): Promise<BusEvent<T>> {
    const event: BusEvent<T> = {
      id: randomUUID(),
      type,
      payload,
      priority: options.priority ?? 'normal',
      timestamp: new Date().toISOString(),
      source: options.source,
      handlerCount: 0,
    };

    this.queue.push(event);
    await this.processQueue();
    return event;
  }

  getHistory(query: EventHistoryQuery = {}): BusEvent[] {
    let result = [...this.history].reverse();

    if (query.type) {
      result = result.filter((e) => e.type === query.type);
    }
    if (query.source) {
      result = result.filter((e) => e.source === query.source);
    }
    if (query.priority) {
      result = result.filter((e) => e.priority === query.priority);
    }
    if (query.since) {
      const since = query.since;
      result = result.filter((e) => e.timestamp >= since);
    }
    if (query.limit && query.limit > 0) {
      result = result.slice(0, query.limit);
    }

    return result;
  }

  onLog(
    handler: (entry: { level: string; message: string; event?: BusEvent; error?: string }) => void
  ): () => void {
    this.logHandlers.push(handler);
    return () => {
      const index = this.logHandlers.indexOf(handler);
      if (index >= 0) this.logHandlers.splice(index, 1);
    };
  }

  clear(): void {
    this.subscriptions.clear();
    this.history = [];
    this.queue = [];
    this.logHandlers = [];
  }

  subscriptionCount(type?: string): number {
    if (type) {
      return this.subscriptions.get(type)?.length ?? 0;
    }
    let total = 0;
    for (const list of this.subscriptions.values()) {
      total += list.length;
    }
    return total;
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        this.queue.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
        const event = this.queue.shift();
        if (!event) continue;

        await this.dispatch(event);
        this.recordHistory(event);
      }
    } finally {
      this.processing = false;
    }
  }

  private async dispatch(event: BusEvent<unknown>): Promise<void> {
    const matching = this.subscriptions.get(event.type) ?? [];
    const wildcards = this.subscriptions.get('*') ?? [];
    const handlers = [...matching, ...wildcards].sort((a, b) => a.handlerPriority - b.handlerPriority);

    const errors: string[] = [];
    let count = 0;

    for (const sub of handlers) {
      try {
        await sub.handler(event);
        count++;
        if (sub.once) {
          this.unsubscribe(sub.id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Handler error';
        errors.push(message);
        this.log('error', `Handler for ${event.type} failed: ${message}`, { event, error: message });
      }
    }

    event.handlerCount = count;
    event.errors = errors.length > 0 ? errors : undefined;
    event.handled = count > 0;
  }

  private recordHistory(event: BusEvent<unknown>): void {
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  private log(
    level: string,
    message: string,
    context?: { event?: BusEvent; eventType?: string; error?: string }
  ): void {
    if (this.logToConsole) {
      const prefix = `[EventBus:${level.toUpperCase()}] ${message}`;
      if (level === 'error') console.error(prefix, context?.error ?? '');
      else if (level === 'warn') console.warn(prefix);
      else console.log(prefix);
    }

    for (const handler of this.logHandlers) {
      try {
        handler({ level, message, event: context?.event, error: context?.error });
      } catch {
        // Log handlers must not break the bus.
      }
    }
  }
}
