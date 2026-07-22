import { validateBusEvent } from '../../lib/event-bus/validation';

describe('validateBusEvent', () => {
  const validEvent = {
    id: 'evt-1',
    version: 1,
    type: 'payment.received',
    payload: { amount: 100 },
    priority: 'normal',
    timestamp: '2026-01-01T00:00:00Z',
    source: 'stripe-connect-webhook',
    handlerCount: 0,
  };

  it('accepts a valid event', () => {
    const { valid, errors } = validateBusEvent(validEvent);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-object event', () => {
    const { valid, errors } = validateBusEvent(null);
    expect(valid).toBe(false);
    expect(errors[0].field).toBe('event');
  });

  it('requires id to be a non-empty string', () => {
    const { valid, errors } = validateBusEvent({ ...validEvent, id: '' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === 'id')).toBe(true);
  });

  it('requires version to be a positive integer', () => {
    const { valid, errors } = validateBusEvent({ ...validEvent, version: 0 });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === 'version')).toBe(true);
  });

  it('requires type to be a non-empty string', () => {
    const { valid, errors } = validateBusEvent({ ...validEvent, type: '' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === 'type')).toBe(true);
  });

  it('requires payload to be present', () => {
    const { payload, ...missingPayload } = validEvent;
    const { valid, errors } = validateBusEvent(missingPayload);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === 'payload')).toBe(true);
  });

  it('requires a valid priority', () => {
    const { valid, errors } = validateBusEvent({ ...validEvent, priority: 'urgent' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === 'priority')).toBe(true);
  });

  it('requires source to be a non-empty string', () => {
    const { valid, errors } = validateBusEvent({ ...validEvent, source: '' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === 'source')).toBe(true);
  });

  it('rejects invalid correlationId type', () => {
    const { valid, errors } = validateBusEvent({ ...validEvent, correlationId: 123 as any });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === 'correlationId')).toBe(true);
  });
});
