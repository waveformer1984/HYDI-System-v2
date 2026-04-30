import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import Stripe from "npm:stripe@14.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ConnectAccountRequest {
  action: 'create' | 'update' | 'retrieve' | 'list' | 'delete' | 'create_login_link';
  client_id?: string;
  account_id?: string;
  account_data?: {
    type: 'express' | 'standard' | 'custom';
    country?: string;
    email?: string;
    capabilities?: {
      card_payments?: { requested: boolean };
      transfers?: { requested: boolean };
    };
    business_profile?: {
      name?: string;
      url?: string;
    };
  };
  refresh_url?: string;
  return_url?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2024-04-10",
  });

  try {
    const body: ConnectAccountRequest = await req.json();
    const { action, client_id, account_id, account_data, refresh_url, return_url } = body;

    console.log(`[STRIPE-CONNECT-ADMIN] Action: ${action}`);

    let result;

    switch (action) {
      case 'create':
        result = await handleCreateConnectAccount(client_id, account_data, supabase, stripe);
        break;

      case 'update':
        result = await handleUpdateConnectAccount(account_id, account_data, supabase, stripe);
        break;

      case 'retrieve':
        result = await handleRetrieveConnectAccount(account_id, supabase, stripe);
        break;

      case 'list':
        result = await handleListConnectAccounts(supabase, stripe);
        break;

      case 'delete':
        result = await handleDeleteConnectAccount(account_id, supabase, stripe);
        break;

      case 'create_login_link':
        result = await handleCreateLoginLink(account_id, refresh_url, return_url, supabase, stripe);
        break;

      default:
        throw new Error(`Invalid action: ${action}`);
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error('[STRIPE-CONNECT-ADMIN] Error:', err);
    return new Response(
      JSON.stringify({ error: err.message, status: 'failed' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function handleCreateConnectAccount(
  clientId: string,
  accountData: any,
  supabase: any,
  stripe: Stripe
) {
  if (!clientId || !accountData) {
    throw new Error('client_id and account_data are required for create action');
  }

  // Get client info
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('*')
    .eq('client_id', clientId)
    .single();

  if (clientError || !client) {
    throw new Error(`Client not found: ${clientId}`);
  }

  // Create Stripe Connect account
  const accountParams: any = {
    type: accountData.type || 'express',
    country: accountData.country || 'US',
    email: accountData.email || client.email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
      ...accountData.capabilities
    },
    metadata: {
      client_id: clientId,
      client_name: client.client_name,
      project_name: client.project_name
    }
  };

  if (accountData.business_profile) {
    accountParams.business_profile = {
      name: accountData.business_profile.name || client.client_name,
      url: accountData.business_profile.url,
      ...accountData.business_profile
    };
  }

  const account = await stripe.accounts.create(accountParams);

  // Update client with Stripe account ID
  await supabase
    .from('clients')
    .update({
      stripe_customer_id: account.id, // Using this field for Connect account ID
      updated_at: new Date().toISOString()
    })
    .eq('client_id', clientId);

  // Log the event
  await supabase.from('keymaker_events').insert({
    event_id: `connect_account_created_${account.id}`,
    type: 'stripe_connect_account_created',
    source: 'stripe_connect_admin',
    severity: 'info',
    payload: {
      client_id: clientId,
      stripe_account_id: account.id,
      account_type: account.type
    },
    processed: true,
    occurred_at: new Date().toISOString()
  });

  console.log(`[STRIPE-CONNECT-ADMIN] Created Connect account ${account.id} for client ${clientId}`);

  return {
    account_id: account.id,
    client_id: clientId,
    type: account.type,
    capabilities: account.capabilities,
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    requirements: account.requirements
  };
}

async function handleUpdateConnectAccount(
  accountId: string,
  accountData: any,
  supabase: any,
  stripe: Stripe
) {
  if (!accountId || !accountData) {
    throw new Error('account_id and account_data are required for update action');
  }

  const account = await stripe.accounts.update(accountId, accountData);

  // Log the event
  await supabase.from('keymaker_events').insert({
    event_id: `connect_account_updated_${accountId}`,
    type: 'stripe_connect_account_updated',
    source: 'stripe_connect_admin',
    severity: 'info',
    payload: {
      stripe_account_id: accountId,
      updated_fields: Object.keys(accountData)
    },
    processed: true,
    occurred_at: new Date().toISOString()
  });

  return account;
}

async function handleRetrieveConnectAccount(
  accountId: string,
  supabase: any,
  stripe: Stripe
) {
  if (!accountId) {
    throw new Error('account_id is required for retrieve action');
  }

  const account = await stripe.accounts.retrieve(accountId);

  // Find associated client
  const { data: client } = await supabase
    .from('clients')
    .select('client_id, client_name, email')
    .eq('stripe_customer_id', accountId)
    .maybeSingle();

  return {
    ...account,
    client_info: client
  };
}

async function handleListConnectAccounts(
  supabase: any,
  stripe: Stripe
) {
  // Get all clients with Stripe accounts
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('client_id, client_name, email, stripe_customer_id, status')
    .not('stripe_customer_id', 'is', null);

  if (clientsError) {
    throw new Error(`Failed to fetch clients: ${clientsError.message}`);
  }

  const accounts = [];

  for (const client of clients || []) {
    try {
      const account = await stripe.accounts.retrieve(client.stripe_customer_id);
      accounts.push({
        client_id: client.client_id,
        client_name: client.client_name,
        email: client.email,
        stripe_account_id: client.stripe_customer_id,
        account_type: account.type,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        status: client.status,
        created: account.created
      });
    } catch (err: any) {
      console.error(`Failed to retrieve account ${client.stripe_customer_id}:`, err.message);
      accounts.push({
        client_id: client.client_id,
        client_name: client.client_name,
        email: client.email,
        stripe_account_id: client.stripe_customer_id,
        error: err.message
      });
    }
  }

  return accounts;
}

async function handleDeleteConnectAccount(
  accountId: string,
  supabase: any,
  stripe: Stripe
) {
  if (!accountId) {
    throw new Error('account_id is required for delete action');
  }

  // First, find the client
  const { data: client } = await supabase
    .from('clients')
    .select('client_id')
    .eq('stripe_customer_id', accountId)
    .single();

  // Delete the Stripe account
  const deleted = await stripe.accounts.del(accountId);

  // Update client to remove Stripe account ID
  if (client) {
    await supabase
      .from('clients')
      .update({
        stripe_customer_id: null,
        bank_account_token: null,
        updated_at: new Date().toISOString()
      })
      .eq('client_id', client.client_id);
  }

  // Log the event
  await supabase.from('keymaker_events').insert({
    event_id: `connect_account_deleted_${accountId}`,
    type: 'stripe_connect_account_deleted',
    source: 'stripe_connect_admin',
    severity: 'warning',
    payload: {
      stripe_account_id: accountId,
      client_id: client?.client_id
    },
    processed: true,
    occurred_at: new Date().toISOString()
  });

  return { deleted: deleted.deleted, account_id: accountId };
}

async function handleCreateLoginLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string,
  supabase: any,
  stripe: Stripe
) {
  if (!accountId) {
    throw new Error('account_id is required for create_login_link action');
  }

  const loginLink = await stripe.accounts.createLoginLink(accountId, {
    refresh_url: refreshUrl || 'https://your-app.com/reconnect',
    return_url: returnUrl || 'https://your-app.com/return'
  });

  // Log the event
  await supabase.from('keymaker_events').insert({
    event_id: `connect_login_link_created_${accountId}`,
    type: 'stripe_connect_login_link_created',
    source: 'stripe_connect_admin',
    severity: 'info',
    payload: {
      stripe_account_id: accountId,
      link_created: loginLink.created
    },
    processed: true,
    occurred_at: new Date().toISOString()
  });

  return {
    url: loginLink.url,
    created: loginLink.created,
    expires_at: loginLink.expires_at
  };
}
