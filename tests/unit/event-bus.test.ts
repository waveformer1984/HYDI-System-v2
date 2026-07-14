/**
 * Unit tests for pao-system/core/event.bus.ts's delivery-failure error
 * normalization. Previously used `error as Error` -- a bare type assertion,
 * not a runtime check -- to pass the caught value into
 * handleDeliveryFailure(event, agentId, error: Error). A handler rejecting
 * with a non-Error (a thrown string, for instance) would silently violate
 * that declared type. Fixed to normalize with
 * `error instanceof Error ? error : new Error(...)`, matching the
 * error-handling convention used everywhere else in this codebase.
 */

import { EventBus, EventSchema } from '../../pao-system/core/event.bus';

function makeEvent(overrides: Partial<EventSchema> = {}): EventSchema {
  return {
    id: 'evt-1',
    type: 'test.event',
    source_agent: 'tester',
    target_agent: 'agent-1',
    priority: 'low',
    payload: {},
    timestamp: new Date().toISOString(),
    retry_count: 0,
    ...overrides,
  };
}

describe('EventBus - deliverEvent error normalization', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('normalizes a non-Error throw into a real Error before handling delivery failure', async () => {
    const handler = jest.fn().mockRejectedValue('a plain string throw, not an Error');
    bus.subscribe({ agent_id: 'agent-1', event_types: ['test.event'], handler });

    const failureSpy = jest
      .spyOn(bus as any, 'handleDeliveryFailure')
      .mockResolvedValue(undefined);

    await (bus as any).deliverEvent(makeEvent());

    expect(failureSpy).toHaveBeenCalledTimes(1);
    const [, , errorArg] = failureSpy.mock.calls[0] as [unknown, unknown, Error];
    expect(errorArg).toBeInstanceOf(Error);
    expect(errorArg.message).toBe('a plain string throw, not an Error');
  });

  it('passes a real Error straight through unwrapped', async () => {
    const originalError = new Error('boom');
    const handler = jest.fn().mockRejectedValue(originalError);
    bus.subscribe({ agent_id: 'agent-1', event_types: ['test.event'], handler });

    const failureSpy = jest
      .spyOn(bus as any, 'handleDeliveryFailure')
      .mockResolvedValue(undefined);

    await (bus as any).deliverEvent(makeEvent());

    const [, , errorArg] = failureSpy.mock.calls[0] as [unknown, unknown, Error];
    expect(errorArg).toBe(originalError);
  });

  it('normalizes a thrown non-string, non-Error value to "Unknown error"', async () => {
    const handler = jest.fn().mockRejectedValue({ some: 'object' });
    bus.subscribe({ agent_id: 'agent-1', event_types: ['test.event'], handler });

    const failureSpy = jest
      .spyOn(bus as any, 'handleDeliveryFailure')
      .mockResolvedValue(undefined);

    await (bus as any).deliverEvent(makeEvent());

    const [, , errorArg] = failureSpy.mock.calls[0] as [unknown, unknown, Error];
    expect(errorArg).toBeInstanceOf(Error);
    expect(errorArg.message).toBe('Unknown error');
  });
});
