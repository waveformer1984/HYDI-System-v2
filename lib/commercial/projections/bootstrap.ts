import { getEventBus } from '../../event-bus';
import { ProjectionEngine } from './projection-engine';
import { createRevenueProjection, toRevenueSummary, REVENUE_STREAMS } from './revenue-projection';
import type { Projection } from './projection-engine';
import type { RevenueProjectionState, RevenueStreamSummary, RevenueSummaryView } from './revenue-projection';

let engine: ProjectionEngine | null = null;
let revenueProjection: Projection<RevenueProjectionState> | null = null;

function ensureEngine(): ProjectionEngine {
  if (!engine) {
    engine = new ProjectionEngine(getEventBus());
    revenueProjection = createRevenueProjection();
    engine.register(revenueProjection);
    engine.start();
  }
  return engine;
}

export function getRevenueProjection(): Projection<RevenueProjectionState> {
  ensureEngine();
  return revenueProjection!;
}

export function getProjectionEngine(): ProjectionEngine {
  return ensureEngine();
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
