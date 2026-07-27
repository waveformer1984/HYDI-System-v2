'use strict';

const BusinessEventBus = require('../../../src/hydi-v3/BusinessEventBus');
const BusinessEventRegistry = require('../../../src/hydi-v3/BusinessEventRegistry');
const BusinessSignalInterpreter = require('../../../src/hydi-v3/BusinessSignalInterpreter');
const { EvidenceProviders } = require('../../../src/hydi-v3/EvidenceProviders');
const { RevenueSensor } = require('../../../src/hydi-v3/RevenueSensor');

describe('Phase 22 revenue pipeline', () => {
  let eventBus;
  let registry;

  beforeEach(() => {
    registry = new BusinessEventRegistry();
    eventBus = new BusinessEventBus({ registry });
    new RevenueSensor({ eventBus, adapters: [] });
  });

  test('RevenueSensor registers all six financial event types', () => {
    const types = registry.listEventTypes();
    expect(types).toEqual(expect.arrayContaining([
      'RevenueReceived', 'RevenueRefunded', 'InvoicePaid', 'InvoiceOverdue',
      'SubscriptionStarted', 'SubscriptionCancelled',
    ]));
    expect(registry.getMeasurementCapability('RevenueReceived')).toBe('quantitative');
    expect(registry.getStrategicObjective('RevenueRefunded')).toBe('revenue');
  });

  test('BusinessSignalInterpreter handles all new revenue event types', () => {
    const interpreter = new BusinessSignalInterpreter({ eventBus });
    const types = [
      'RevenueReceived', 'RevenueRefunded', 'InvoicePaid', 'InvoiceOverdue',
      'SubscriptionStarted', 'SubscriptionCancelled',
    ];
    for (const type of types) {
      const signal = interpreter.interpret({ type, at: Date.now(), payload: { amount: 100, currency: 'USD' } });
      expect(signal).not.toBeNull();
      expect(signal.type).toBe('BusinessSignal');
      expect(signal.payload.strategicObjective).toBe('revenue');
    }
  });

  test('refunds and cancellations produce negative measured values', () => {
    const interpreter = new BusinessSignalInterpreter({ eventBus });
    const refund = interpreter.interpret({ type: 'RevenueRefunded', at: Date.now(), payload: { amount: 50, currency: 'USD' } });
    expect(refund.payload.amount).toBe(-50);
    const cancelled = interpreter.interpret({ type: 'SubscriptionCancelled', at: Date.now(), payload: { amount: 25, currency: 'USD' } });
    expect(cancelled.payload.amount).toBe(-25);
  });

  test('financial evidence is quantitative for cash events and qualitative for overdue invoices', () => {
    const providers = new EvidenceProviders().registerDefaults();
    const cash = providers.extract('financial', { type: 'RevenueReceived', source: 'RevenueSensor', at: Date.now(), payload: { amount: 100, currency: 'USD' } });
    expect(cash[0].measurementType).toBe('quantitative');
    expect(cash[0].data.value).toBe(100);

    const overdue = providers.extract('financial', { type: 'InvoiceOverdue', source: 'RevenueSensor', at: Date.now(), payload: { amount: 100, currency: 'USD' } });
    expect(overdue[0].measurementType).toBe('qualitative');
    expect(overdue[0].tags).toContain('liability');
  });

  test('refunded evidence carries a negative value', () => {
    const providers = new EvidenceProviders().registerDefaults();
    const ev = providers.extract('financial', { type: 'RevenueRefunded', source: 'RevenueSensor', at: Date.now(), payload: { amount: 30, currency: 'USD' } });
    expect(ev[0].measurementType).toBe('quantitative');
    expect(ev[0].data.value).toBe(-30);
  });
});
