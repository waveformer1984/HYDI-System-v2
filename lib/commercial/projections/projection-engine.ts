import type { BusEvent, EventBus } from '../../event-bus';

export type ProjectionHandler<TState> = (state: TState, event: BusEvent) => TState | Promise<TState>;

export interface Projection<TState> {
  name: string;
  initialState: TState;
  state: TState;
  handlers: Record<string, ProjectionHandler<TState>>;
  getState(): TState;
}

/**
 * Runs registered projections over the Event Fabric.
 *
 * Each projection is a pure-ish fold over the event stream: it maintains its
 * own state and updates it when it sees an event type it cares about.
 * Projections never mutate the bus or the events themselves — they are read
 * models built from the canonical event log.
 */
export class ProjectionEngine {
  private bus: EventBus;
  private projections = new Map<string, Projection<unknown>>();
  private subscriptionId: string | null = null;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  register<TState>(projection: Projection<TState>): void {
    this.projections.set(projection.name, projection as Projection<unknown>);
  }

  getProjection<TState>(name: string): Projection<TState> | undefined {
    return this.projections.get(name) as Projection<TState> | undefined;
  }

  start(): void {
    if (this.subscriptionId) return;
    this.subscriptionId = this.bus.subscribe('*', async (event) => {
      for (const projection of this.projections.values()) {
        const handler = projection.handlers[event.type];
        if (!handler) continue;
        // Projections may be async; await to keep ordering deterministic.
        const next = await handler(projection.getState(), event);
        // Handlers are expected to return the next state. We replace the
        // internal state reference to keep the projection observable.
        projection.state = next;
      }
    });
  }

  stop(): void {
    if (this.subscriptionId) {
      this.bus.unsubscribe(this.subscriptionId);
      this.subscriptionId = null;
    }
  }
}
