import type { BusEvent } from '../../event-bus';
import type { Projection } from './projection-engine';

export const REVENUE_STREAMS = [
  'galactic_bytes',
  'detailer_bot',
  'lipi_v2',
  'protogrance_aromatics',
  'rezonate',
  'waveformer_studio',
];

export interface RevenueStreamSummary {
  stream: string;
  gross: number;
  net: number;
  fees: number;
  platformFees: number;
  agentFees: number;
  stripeFees: number;
  paymentCount: number;
  refundCount: number;
  paidOut: number;
  pendingPayout: number;
  lastUpdated: string;
}

export interface RevenueProjectionState {
  streams: Record<string, RevenueStreamSummary>;
}

const FEE_STRUCTURE = {
  platformRate: 0.05,
  agentRate: 0.10,
  stripeRate: 0.029,
  stripeFixed: 0.30,
};

function computeNet(gross: number): {
  platformFee: number;
  agentFee: number;
  stripeFee: number;
  net: number;
} {
  const platformFee = gross * FEE_STRUCTURE.platformRate;
  const agentFee = gross * FEE_STRUCTURE.agentRate;
  const stripeFee = gross * FEE_STRUCTURE.stripeRate + FEE_STRUCTURE.stripeFixed;
  const net = gross - platformFee - agentFee - stripeFee;
  return {
    platformFee: round(platformFee),
    agentFee: round(agentFee),
    stripeFee: round(stripeFee),
    net: round(net),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function getOrCreateStream(state: RevenueProjectionState, stream: string): RevenueStreamSummary {
  if (!state.streams[stream]) {
    state.streams[stream] = {
      stream,
      gross: 0,
      net: 0,
      fees: 0,
      platformFees: 0,
      agentFees: 0,
      stripeFees: 0,
      paymentCount: 0,
      refundCount: 0,
      paidOut: 0,
      pendingPayout: 0,
      lastUpdated: new Date(0).toISOString(),
    };
  }
  return state.streams[stream];
}

function handlePaymentReceived(state: RevenueProjectionState, event: BusEvent): RevenueProjectionState {
  const payload = event.payload as {
    revenue_stream?: string;
    amount?: number;
  };

  const stream = payload.revenue_stream && REVENUE_STREAMS.includes(payload.revenue_stream)
    ? payload.revenue_stream
    : 'unknown';
  const gross = typeof payload.amount === 'number' && !isNaN(payload.amount) ? payload.amount : 0;
  const fees = computeNet(gross);

  const summary = getOrCreateStream(state, stream);
  summary.gross = round(summary.gross + gross);
  summary.net = round(summary.net + fees.net);
  summary.platformFees = round(summary.platformFees + fees.platformFee);
  summary.agentFees = round(summary.agentFees + fees.agentFee);
  summary.stripeFees = round(summary.stripeFees + fees.stripeFee);
  summary.fees = round(summary.fees + fees.platformFee + fees.agentFee + fees.stripeFee);
  summary.paymentCount += 1;
  summary.lastUpdated = event.timestamp;

  return state;
}

function handleRefundCompleted(state: RevenueProjectionState, event: BusEvent): RevenueProjectionState {
  const payload = event.payload as {
    revenue_stream?: string;
    refund_amount?: number;
  };

  const stream = payload.revenue_stream && REVENUE_STREAMS.includes(payload.revenue_stream)
    ? payload.revenue_stream
    : 'unknown';
  const refundAmount = typeof payload.refund_amount === 'number' && !isNaN(payload.refund_amount)
    ? payload.refund_amount
    : 0;

  const summary = state.streams[stream];
  if (!summary) return state;

  const fees = computeNet(refundAmount);
  summary.gross = round(summary.gross - refundAmount);
  summary.net = round(summary.net - fees.net);
  summary.platformFees = round(summary.platformFees - fees.platformFee);
  summary.agentFees = round(summary.agentFees - fees.agentFee);
  summary.stripeFees = round(summary.stripeFees - fees.stripeFee);
  summary.fees = round(summary.fees - (fees.platformFee + fees.agentFee + fees.stripeFee));
  summary.refundCount += 1;
  summary.lastUpdated = event.timestamp;

  return state;
}

function handlePayoutCreated(state: RevenueProjectionState, event: BusEvent): RevenueProjectionState {
  const payload = event.payload as {
    revenue_stream?: string;
    amount?: number;
  };

  const stream = payload.revenue_stream && REVENUE_STREAMS.includes(payload.revenue_stream)
    ? payload.revenue_stream
    : 'unknown';
  const amount = typeof payload.amount === 'number' && !isNaN(payload.amount) ? payload.amount : 0;

  const summary = getOrCreateStream(state, stream);
  summary.pendingPayout = round(summary.pendingPayout + amount);
  summary.lastUpdated = event.timestamp;

  return state;
}

function handlePayoutPaid(state: RevenueProjectionState, event: BusEvent): RevenueProjectionState {
  const payload = event.payload as {
    revenue_stream?: string;
    amount?: number;
  };

  const stream = payload.revenue_stream && REVENUE_STREAMS.includes(payload.revenue_stream)
    ? payload.revenue_stream
    : 'unknown';
  const amount = typeof payload.amount === 'number' && !isNaN(payload.amount) ? payload.amount : 0;

  const summary = state.streams[stream];
  if (!summary) return state;

  summary.paidOut = round(summary.paidOut + amount);
  summary.pendingPayout = round(Math.max(0, summary.pendingPayout - amount));
  summary.lastUpdated = event.timestamp;

  return state;
}

export interface RevenueSummaryView {
  revenueStream: string;
  gross: number;
  fees: number;
  net: number;
  availableForPayout: number;
  pendingPayout: number;
  paidOut: number;
  heldForDisputes: number;
  lastUpdated: string;
}

export function toRevenueSummary(summary: RevenueStreamSummary): RevenueSummaryView {
  const availableForPayout = round(Math.max(0, summary.net - summary.paidOut - summary.pendingPayout));
  return {
    revenueStream: summary.stream,
    gross: summary.gross,
    fees: summary.fees,
    net: summary.net,
    availableForPayout,
    pendingPayout: summary.pendingPayout,
    paidOut: summary.paidOut,
    heldForDisputes: 0,
    lastUpdated: summary.lastUpdated,
  };
}

export function createRevenueProjection(): Projection<RevenueProjectionState> {
  const projection: Projection<RevenueProjectionState> = {
    name: 'revenue',
    initialState: { streams: {} },
    state: { streams: {} },
    handlers: {
      'payment.received': handlePaymentReceived,
      'refund.completed': handleRefundCompleted,
      'payout.created': handlePayoutCreated,
      'payout.paid': handlePayoutPaid,
    },
    getState() {
      return this.state;
    },
  };

  return projection;
}
