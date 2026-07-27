import type { BusEvent } from '../../event-bus';
import type { Projection } from './projection-engine';

export interface CustomerState {
  customerId: string;
  email: string;
  name: string | null;
  stripeCustomerId: string | null;
  status: 'active' | 'inactive' | 'suspended';
  revenueStream: string | null;
  lastUpdated: string;
}

export interface CustomerProjectionState {
  byId: Record<string, CustomerState>;
  byEmail: Record<string, CustomerState>;
  byStripeCustomerId: Record<string, CustomerState>;
}

function normalizeCustomer(payload: unknown): Partial<CustomerState> | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;

  const customerId = typeof p.customer_id === 'string' ? p.customer_id : undefined;
  const email = typeof p.email === 'string' ? p.email : undefined;

  if (!customerId || !email) return null;

  return {
    customerId,
    email,
    name: typeof p.name === 'string' ? p.name : null,
    stripeCustomerId: typeof p.stripe_customer_id === 'string' ? p.stripe_customer_id : null,
    status: ['active', 'inactive', 'suspended'].includes(p.status as string)
      ? (p.status as 'active' | 'inactive' | 'suspended')
      : 'active',
    revenueStream: typeof p.revenue_stream === 'string' ? p.revenue_stream : null,
  };
}

function upsert(state: CustomerProjectionState, customer: CustomerState): void {
  const existing = state.byId[customer.customerId];
  if (existing && existing.email !== customer.email) {
    delete state.byEmail[existing.email];
  }

  state.byId[customer.customerId] = customer;
  state.byEmail[customer.email] = customer;
  if (customer.stripeCustomerId) {
    state.byStripeCustomerId[customer.stripeCustomerId] = customer;
  }
}

function handleCustomerCreated(state: CustomerProjectionState, event: BusEvent): CustomerProjectionState {
  const partial = normalizeCustomer(event.payload);
  if (!partial) return state;

  const customer: CustomerState = {
    customerId: partial.customerId!,
    email: partial.email!,
    name: partial.name ?? null,
    stripeCustomerId: partial.stripeCustomerId ?? null,
    status: partial.status ?? 'active',
    revenueStream: partial.revenueStream ?? null,
    lastUpdated: event.timestamp,
  };

  upsert(state, customer);
  return state;
}

function handleCustomerUpdated(state: CustomerProjectionState, event: BusEvent): CustomerProjectionState {
  const partial = normalizeCustomer(event.payload);
  if (!partial) return state;

  const existing = state.byId[partial.customerId!];
  if (!existing) {
    // Update for a customer we haven't seen yet becomes a create.
    return handleCustomerCreated(state, event);
  }

  const customer: CustomerState = {
    ...existing,
    ...partial,
    customerId: partial.customerId!,
    email: partial.email!,
    lastUpdated: event.timestamp,
  };

  upsert(state, customer);
  return state;
}

export function createCustomerProjection(): Projection<CustomerProjectionState> {
  const projection: Projection<CustomerProjectionState> = {
    name: 'customer',
    initialState: { byId: {}, byEmail: {}, byStripeCustomerId: {} },
    state: { byId: {}, byEmail: {}, byStripeCustomerId: {} },
    handlers: {
      'customer.created': handleCustomerCreated,
      'customer.updated': handleCustomerUpdated,
    },
    getState() {
      return this.state;
    },
  };

  return projection;
}
