import { EventBus } from '../../lib/event-bus/EventBus';
import { ProjectionEngine } from '../../lib/commercial/projections/projection-engine';
import { createRevenueProjection } from '../../lib/commercial/projections/revenue-projection';

describe('RevenueProjection', () => {
  let bus: EventBus;
  let engine: ProjectionEngine;
  let revenue: ReturnType<typeof createRevenueProjection>;

  beforeEach(() => {
    bus = new EventBus({ maxHistory: 100, logToConsole: false });
    revenue = createRevenueProjection();
    engine = new ProjectionEngine(bus);
    engine.register(revenue);
    engine.start();
  });

  afterEach(() => {
    engine.stop();
    bus.clear();
  });

  it('starts empty', () => {
    expect(Object.keys(revenue.getState().streams)).toHaveLength(0);
  });

  it('aggregates payment.received events by stream', async () => {
    await bus.publish('payment.received', { revenue_stream: 'galactic_bytes', amount: 100 }, { source: 'test' });
    await bus.publish('payment.received', { revenue_stream: 'galactic_bytes', amount: 50 }, { source: 'test' });

    const summary = revenue.getState().streams.galactic_bytes;
    expect(summary).toBeDefined();
    expect(summary.gross).toBe(150);
    expect(summary.paymentCount).toBe(2);
    expect(summary.net).toBeCloseTo(122.55, 2);
    expect(summary.fees).toBeCloseTo(27.45, 2);
    expect(summary.platformFees).toBeCloseTo(7.5, 2);
    expect(summary.agentFees).toBeCloseTo(15, 2);
    expect(summary.stripeFees).toBeCloseTo(4.95, 2);
  });

  it('tracks multiple streams independently', async () => {
    await bus.publish('payment.received', { revenue_stream: 'galactic_bytes', amount: 100 }, { source: 'test' });
    await bus.publish('payment.received', { revenue_stream: 'detailer_bot', amount: 200 }, { source: 'test' });

    expect(revenue.getState().streams.galactic_bytes.gross).toBe(100);
    expect(revenue.getState().streams.detailer_bot.gross).toBe(200);
  });

  it('applies refunds', async () => {
    await bus.publish('payment.received', { revenue_stream: 'galactic_bytes', amount: 100 }, { source: 'test' });
    await bus.publish('refund.completed', { revenue_stream: 'galactic_bytes', refund_amount: 25 }, { source: 'test' });

    const summary = revenue.getState().streams.galactic_bytes;
    expect(summary.gross).toBe(75);
    expect(summary.refundCount).toBe(1);
  });

  it('applies payouts', async () => {
    await bus.publish('payment.received', { revenue_stream: 'galactic_bytes', amount: 100 }, { source: 'test' });
    await bus.publish('payout.paid', { revenue_stream: 'galactic_bytes', amount: 80 }, { source: 'test' });

    const summary = revenue.getState().streams.galactic_bytes;
    expect(summary.paidOut).toBe(80);
  });

  it('tracks pending payouts and available balance', async () => {
    await bus.publish('payment.received', { revenue_stream: 'galactic_bytes', amount: 100 }, { source: 'test' });
    await bus.publish('payout.created', { revenue_stream: 'galactic_bytes', amount: 60 }, { source: 'test' });

    const { toRevenueSummary } = await import('../../lib/commercial/projections/revenue-projection');
    const view = toRevenueSummary(revenue.getState().streams.galactic_bytes);
    expect(view.pendingPayout).toBe(60);
    expect(view.availableForPayout).toBeCloseTo(21.8, 1);
  });

  it('buckets unknown revenue streams as "unknown"', async () => {
    await bus.publish('payment.received', { revenue_stream: 'not_a_stream', amount: 10 }, { source: 'test' });

    expect(revenue.getState().streams.unknown).toBeDefined();
    expect(revenue.getState().streams.unknown.gross).toBe(10);
  });
});
