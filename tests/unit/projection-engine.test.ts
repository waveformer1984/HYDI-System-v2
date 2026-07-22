import { EventBus } from '../../lib/event-bus/EventBus';
import { ProjectionEngine } from '../../lib/commercial/projections/projection-engine';
import type { Projection } from '../../lib/commercial/projections/projection-engine';

describe('ProjectionEngine', () => {
  let bus: EventBus;
  let engine: ProjectionEngine;

  beforeEach(() => {
    bus = new EventBus({ maxHistory: 100, logToConsole: false });
    engine = new ProjectionEngine(bus);
  });

  afterEach(() => {
    engine.stop();
    bus.clear();
  });

  it('routes matching events to a projection', async () => {
    const projection: Projection<{ count: number }> = {
      name: 'counter',
      initialState: { count: 0 },
      state: { count: 0 },
      handlers: {
        'thing.happened': (state) => {
          state.count += 1;
          return state;
        },
      },
      getState() {
        return this.state;
      },
    };

    engine.register(projection);
    engine.start();

    await bus.publish('thing.happened', { id: 1 }, { source: 'test' });
    await bus.publish('thing.happened', { id: 2 }, { source: 'test' });

    expect(projection.getState().count).toBe(2);
  });

  it('ignores events a projection does not handle', async () => {
    const projection: Projection<{ count: number }> = {
      name: 'counter',
      initialState: { count: 0 },
      state: { count: 0 },
      handlers: {
        'thing.happened': (state) => {
          state.count += 1;
          return state;
        },
      },
      getState() {
        return this.state;
      },
    };

    engine.register(projection);
    engine.start();

    await bus.publish('other.thing', {}, { source: 'test' });

    expect(projection.getState().count).toBe(0);
  });

  it('supports async handlers', async () => {
    const projection: Projection<{ total: number }> = {
      name: 'summer',
      initialState: { total: 0 },
      state: { total: 0 },
      handlers: {
        'value.added': async (state, event) => {
          const { amount } = event.payload as { amount: number };
          await new Promise((resolve) => setTimeout(resolve, 1));
          state.total += amount;
          return state;
        },
      },
      getState() {
        return this.state;
      },
    };

    engine.register(projection);
    engine.start();

    await bus.publish('value.added', { amount: 10 }, { source: 'test' });
    await bus.publish('value.added', { amount: 20 }, { source: 'test' });

    expect(projection.getState().total).toBe(30);
  });
});
