import { randomUUID } from 'crypto';
import { eventContext } from './context';
import { validateBusEvent } from './validation';
import type {
  BusEvent,
  EventBusConfig,
  EventHandler,
  EventHistoryQuery,
  EventPriority,
  PublishOptions,
  RequestOptions,
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
    const id = randomUUID();

    // Resolved synchronously, at call time — not later inside dispatch().
    // processQueue() is reentrant-guarded, not reentrant-safe: a handler
    // that calls publish() recursively has its nested event sit in `queue`
    // and get drained later by the OUTER loop, after the AsyncLocalStorage
    // context would otherwise have already exited. Reading the store here
    // sidesteps that entirely, and works for the pervasive
    // `void eventBus.publish(...)` fire-and-forget pattern too, since
    // capture doesn't depend on the caller awaiting.
    const store = eventContext.getStore();
    const causationId = options.causationId ?? store?.eventId;
    const traceId = options.traceId ?? store?.traceId ?? id; // no store => this event starts a new trace

    const event: BusEvent<T> = {
      id,
      version: options.version ?? 1,
      type,
      payload,
      priority: options.priority ?? 'normal',
      timestamp: options.timestamp ?? new Date().toISOString(),
      source: options.source ?? 'unknown',
      handlerCount: 0,
      correlationId: options.correlationId,
      traceId,
      causationId,
    };

    const validation = validateBusEvent(event);
    if (!validation.valid) {
      const summary = validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
      throw new Error(`Invalid BusEvent: ${summary}`);
    }

    this.queue.push(event);
    await this.processQueue();
    return event;
  }

  /** Pure sugar over publish() — dispatch() already unions '*' wildcard subscribers with type-matched ones, so this is not a separate delivery path. Documented alias for NEXUS's "broadcast" capability. */
  broadcast<T = unknown>(type: string, payload: T, options: PublishOptions = {}): Promise<BusEvent<T>> {
    return this.publish(type, payload, options);
  }

  /**
   * Publishes `type` and waits for a matching `${type}:response` event
   * (correlated by id). Rejects on timeout (default 5000ms), cleaning up
   * its temporary subscription either way.
   */
  async request<TReq = unknown, TRes = unknown>(
    type: string,
    payload: TReq,
    options: RequestOptions = {}
  ): Promise<BusEvent<TRes>> {
    const correlationId = randomUUID();
    const timeoutMs = options.timeoutMs ?? 5000;

    return new Promise<BusEvent<TRes>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.unsubscribe(subId);
        reject(new Error(`request timed out after ${timeoutMs}ms: ${type}`));
      }, timeoutMs);

      const subId = this.subscribe<TRes>(`${type}:response`, (event) => {
        if (event.correlationId !== correlationId) return; // not ours — shared response channel
        clearTimeout(timer);
        this.unsubscribe(subId);
        resolve(event);
      });

      this.publish(type, payload, { priority: options.priority, source: options.source, correlationId }).catch((error) => {
        clearTimeout(timer);
        this.unsubscribe(subId);
        reject(error);
      });
    });
  }

  /**
   * Sugar for answering a request() — publishes `${requestEvent.type}:response`
   * with correlationId/causationId copied from the request. The `:response`
   * suffix is documented convention, not enforced: calling this on an event
   * that didn't carry a correlationId just publishes something nothing is
   * waiting for, rather than throwing.
   */
  respond<TRes = unknown>(
    requestEvent: BusEvent<unknown>,
    payload: TRes,
    options: PublishOptions = {}
  ): Promise<BusEvent<TRes>> {
    return this.publish(`${requestEvent.type}:response`, payload, {
      ...options,
      correlationId: requestEvent.correlationId,
      causationId: requestEvent.id,
    });
  }

  /** All events sharing a traceId, in chronological order. Reconstructs a whole causal chain, per NEXUS's "every decision must be reconstructable." */
  getTrace(traceId: string): BusEvent[] {
    return this.history.filter((e) => e.traceId === traceId);
  }

  /**
   * Walks backward from `eventId` via causationId to its root. A chain
   * truncates wherever an ancestor has aged out of the maxHistory ring
   * buffer — same inherent limitation getTrace() has.
   */
  getCausationChain(eventId: string): BusEvent[] {
    const byId = new Map(this.history.map((e) => [e.id, e]));
    const chain: BusEvent[] = [];
    const seen = new Set<string>();

    let current = byId.get(eventId);
    while (current && !seen.has(current.id)) {
      chain.push(current);
      seen.add(current.id);
      current = current.causationId ? byId.get(current.causationId) : undefined;
    }

    return chain;
  }

  /**
   * Read-side replay for a late-joining consumer or reconstructing derived
   * state: invokes `handler` once per historical event matching `query`, in
   * chronological order, with a shallow clone of each event (never the live
   * object). Never touches queue/history/subscriptions — cannot corrupt the
   * real audit trail or re-trigger real subscribers.
   */
  async replay(query: EventHistoryQuery, handler: EventHandler): Promise<number> {
    const events = [...this.getHistory(query)].reverse(); // getHistory() is newest-first; replay wants chronological
    for (const event of events) {
      await handler({ ...event });
    }
    return events.length;
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
        await eventContext.run({ eventId: event.id, traceId: event.traceId ?? event.id }, () => sub.handler(event));
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
