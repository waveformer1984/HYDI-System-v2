import { getEventBus } from '../../event-bus';
import { ProjectionEngine } from './projection-engine';
import { createRevenueProjection, toRevenueSummary, REVENUE_STREAMS } from './revenue-projection';
import { createCustomerProjection } from './customer-projection';
import { createSubscriptionProjection } from './subscription-projection';
import type { Projection } from './projection-engine';
import type { RevenueProjectionState, RevenueSummaryView } from './revenue-projection';
import type { CustomerProjectionState } from './customer-projection';
import type { SubscriptionProjectionState } from './subscription-projection';

let engine: ProjectionEngine | null = null;
let revenueProjection: Projection<RevenueProjectionState> | null = null;
let customerProjection: Projection<CustomerProjectionState> | null = null;
let subscriptionProjection: Projection<SubscriptionProjectionState> | null = null;

function ensureEngine(): ProjectionEngine {
  if (!engine) {
    engine = new ProjectionEngine(getEventBus());
    revenueProjection = createRevenueProjection();
    customerProjection = createCustomerProjection();
    subscriptionProjection = createSubscriptionProjection();
    engine.register(revenueProjection);
    engine.register(customerProjection);
    engine.register(subscriptionProjection);
    engine.start();
  }
  return engine;
}

export function getProjectionEngine(): ProjectionEngine {
  return ensureEngine();
}

export function getRevenueProjection(): Projection<RevenueProjectionState> {
  ensureEngine();
  return revenueProjection!;
}

export function getCustomerProjection(): Projection<CustomerProjectionState> {
  ensureEngine();
  return customerProjection!;
}

export function getSubscriptionProjection(): Projection<SubscriptionProjectionState> {
  ensureEngine();
  return subscriptionProjection!;
}

export function getRevenueSummaries(): RevenueSummaryView[] {
  const projection = getRevenueProjection();
  const state = projection.getState();

  const known = REVENUE_STREAMS.map((stream) => {
    const summary = state.streams[stream];
    return summary ? toRevenueSummary(summary) : zeroSummary(stream);
  });

  const unknown = Object.values(state.streams)
    .filter((s) => !REVENUE_STREAMS.includes(s.stream))
    .map(toRevenueSummary);

  return [...known, ...unknown];
}

function zeroSummary(stream: string): RevenueSummaryView {
  return {
    revenueStream: stream,
    gross: 0,
    fees: 0,
    net: 0,
    availableForPayout: 0,
    pendingPayout: 0,
    paidOut: 0,
    heldForDisputes: 0,
    lastUpdated: new Date().toISOString(),
  };
}
