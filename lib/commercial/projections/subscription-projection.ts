import type { BusEvent } from '../../event-bus';
import type { Projection } from './projection-engine';

export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'paused';
export type SubscriptionTier = 'starter' | 'pro' | 'enterprise';

export interface SubscriptionState {
  subscriptionId: string;
  customerId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  revenueStream: string | null;
  startedAt: string | null;
  cancelledAt: string | null;
  cancelAtPeriodEnd: boolean;
  lastUpdated: string;
}

export interface SubscriptionProjectionState {
  byId: Record<string, SubscriptionState>;
  byCustomerId: Record<string, SubscriptionState[]>;
}

function normalizeSubscription(payload: unknown): Partial<SubscriptionState> | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;

  const subscriptionId = typeof p.subscription_id === 'string' ? p.subscription_id : undefined;
  const customerId = typeof p.customer_id === 'string' ? p.customer_id : undefined;

  if (!subscriptionId || !customerId) return null;

  const status = ['active', 'canceled', 'past_due', 'trialing', 'paused'].includes(p.status as string)
    ? (p.status as SubscriptionStatus)
    : 'active';

  const tier = ['starter', 'pro', 'enterprise'].includes(p.tier as string)
    ? (p.tier as SubscriptionTier)
    : 'starter';

  return {
    subscriptionId,
    customerId,
    status,
    tier,
    revenueStream: typeof p.revenue_stream === 'string' ? p.revenue_stream : null,
    startedAt: typeof p.started_at === 'string' ? p.started_at : null,
    cancelledAt: typeof p.cancelled_at === 'string' ? p.cancelled_at : null,
    cancelAtPeriodEnd: typeof p.cancel_at_period_end === 'boolean' ? p.cancel_at_period_end : false,
  };
}

function indexByCustomer(state: SubscriptionProjectionState): void {
  const byCustomer: Record<string, SubscriptionState[]> = {};
  for (const sub of Object.values(state.byId)) {
    if (!byCustomer[sub.customerId]) byCustomer[sub.customerId] = [];
    byCustomer[sub.customerId].push(sub);
  }
  state.byCustomerId = byCustomer;
}

function upsert(state: SubscriptionProjectionState, subscription: SubscriptionState): void {
  const existing = state.byId[subscription.subscriptionId];
  state.byId[subscription.subscriptionId] = subscription;

  if (existing && existing.customerId !== subscription.customerId) {
    // Re-index if customer changed.
    indexByCustomer(state);
  } else {
    const list = state.byCustomerId[subscription.customerId] ?? [];
    state.byCustomerId[subscription.customerId] = list
      .filter((s) => s.subscriptionId !== subscription.subscriptionId)
      .concat(subscription)
      .sort((a, b) => a.lastUpdated.localeCompare(b.lastUpdated));
  }
}

function handleSubscriptionCreated(state: SubscriptionProjectionState, event: BusEvent): SubscriptionProjectionState {
  const partial = normalizeSubscription(event.payload);
  if (!partial) return state;

  const subscription: SubscriptionState = {
    subscriptionId: partial.subscriptionId!,
    customerId: partial.customerId!,
    tier: partial.tier ?? 'starter',
    status: partial.status ?? 'active',
    revenueStream: partial.revenueStream ?? null,
    startedAt: partial.startedAt ?? null,
    cancelledAt: partial.cancelledAt ?? null,
    cancelAtPeriodEnd: partial.cancelAtPeriodEnd ?? false,
    lastUpdated: event.timestamp,
  };

  upsert(state, subscription);
  return state;
}

function handleSubscriptionUpdated(state: SubscriptionProjectionState, event: BusEvent): SubscriptionProjectionState {
  const partial = normalizeSubscription(event.payload);
  if (!partial) return state;

  const existing = state.byId[partial.subscriptionId!];
  if (!existing) {
    return handleSubscriptionCreated(state, event);
  }

  const subscription: SubscriptionState = {
    ...existing,
    ...partial,
    subscriptionId: partial.subscriptionId!,
    customerId: partial.customerId!,
    lastUpdated: event.timestamp,
  };

  upsert(state, subscription);
  return state;
}

function handleSubscriptionCancelled(state: SubscriptionProjectionState, event: BusEvent): SubscriptionProjectionState {
  const payload = event.payload as {
    subscription_id?: string;
    cancelled_at?: string;
    cancel_at_period_end?: boolean;
  };

  const subscriptionId = typeof payload.subscription_id === 'string' ? payload.subscription_id : undefined;
  if (!subscriptionId) return state;

  const existing = state.byId[subscriptionId];
  if (!existing) return state;

  existing.status = 'canceled';
  existing.cancelledAt = typeof payload.cancelled_at === 'string' ? payload.cancelled_at : event.timestamp;
  existing.cancelAtPeriodEnd = payload.cancel_at_period_end ?? false;
  existing.lastUpdated = event.timestamp;

  upsert(state, existing);
  return state;
}

export function createSubscriptionProjection(): Projection<SubscriptionProjectionState> {
  const projection: Projection<SubscriptionProjectionState> = {
    name: 'subscription',
    initialState: { byId: {}, byCustomerId: {} },
    state: { byId: {}, byCustomerId: {} },
    handlers: {
      'subscription.created': handleSubscriptionCreated,
      'subscription.updated': handleSubscriptionUpdated,
      'subscription.cancelled': handleSubscriptionCancelled,
    },
    getState() {
      return this.state;
    },
  };

  return projection;
}
