import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface Customer {
  customer_id: string;
  name: string;
  email: string;
  stripe_customer_id?: string | null;
  status: 'active' | 'inactive' | 'suspended';
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomerInput {
  name: string;
  email: string;
  stripe_customer_id?: string | null;
  status?: 'active' | 'inactive' | 'suspended';
  metadata?: Record<string, unknown>;
}

function getServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function createCustomer(
  input: CreateCustomerInput,
  supabase: SupabaseClient | null = getServiceClient()
): Promise<Customer | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('customers')
    .insert({
      name: input.name,
      email: input.email,
      stripe_customer_id: input.stripe_customer_id ?? null,
      status: input.status ?? 'active',
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    console.error('[CustomerService] Failed to create customer:', error);
    return null;
  }

  return data as Customer;
}

export async function getCustomerById(
  customerId: string,
  supabase: SupabaseClient | null = getServiceClient()
): Promise<Customer | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('customer_id', customerId)
    .single();

  if (error || !data) return null;
  return data as Customer;
}

export async function getCustomerByEmail(
  email: string,
  supabase: SupabaseClient | null = getServiceClient()
): Promise<Customer | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('email', email)
    .single();

  if (error || !data) return null;
  return data as Customer;
}

export async function getCustomerByStripeCustomerId(
  stripeCustomerId: string,
  supabase: SupabaseClient | null = getServiceClient()
): Promise<Customer | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();

  if (error || !data) return null;
  return data as Customer;
}

export interface ResolveCustomerInput {
  email?: string;
  stripe_customer_id?: string;
  name?: string;
}

export async function getOrCreateCustomer(
  input: ResolveCustomerInput,
  supabase: SupabaseClient | null = getServiceClient()
): Promise<Customer | null> {
  if (!supabase) return null;

  if (input.email) {
    const existing = await getCustomerByEmail(input.email, supabase);
    if (existing) return existing;
  }

  if (input.stripe_customer_id) {
    const existing = await getCustomerByStripeCustomerId(input.stripe_customer_id, supabase);
    if (existing) return existing;
  }

  if (!input.email || !input.name) {
    console.error('[CustomerService] Cannot create customer without email and name');
    return null;
  }

  return createCustomer(
    {
      name: input.name,
      email: input.email,
      stripe_customer_id: input.stripe_customer_id,
    },
    supabase
  );
}
