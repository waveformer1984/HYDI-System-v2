#!/usr/bin/env node
/**
 * Direct table creation for ProtoForge payout system
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://akbnfovjdcobifeupvbn.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function createTables() {
  console.log('Creating ProtoForge payout tables...\n');

  try {
    // Create clients table
    console.log('▶ Creating clients table...');
    const { error: clientsError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS public.clients (
          client_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          client_name text NOT NULL,
          project_name text NOT NULL,
          stripe_customer_id text unique,
          bank_account_token text,
          email text unique NOT NULL,
          payout_schedule text NOT NULL DEFAULT 'monthly' check (payout_schedule in ('monthly', 'custom')),
          status text NOT NULL DEFAULT 'active' check (status in ('active', 'inactive', 'suspended')),
          created_at timestamptz default now(),
          updated_at timestamptz default now()
        );
        
        CREATE INDEX IF NOT EXISTS idx_clients_email ON public.clients(email);
        CREATE INDEX IF NOT EXISTS idx_clients_stripe_customer ON public.clients(stripe_customer_id);
        
        ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
        
        CREATE POLICY IF NOT EXISTS "service_role_all" ON public.clients
          FOR ALL USING (auth.role() = 'service_role');
      `
    });

    if (clientsError) {
      console.error('  Error creating clients table:', clientsError);
    } else {
      console.log('  ✓ Clients table created');
    }

    // Create payouts table
    console.log('\n▶ Creating payouts table...');
    const { error: payoutsError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS public.payouts (
          payout_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id uuid NOT NULL references public.clients(client_id) on delete cascade,
          period_start date NOT NULL,
          period_end date NOT NULL,
          gross_earnings numeric NOT NULL DEFAULT 0,
          platform_fee_amount numeric NOT NULL DEFAULT 0,
          agent_fee_amount numeric NOT NULL DEFAULT 0,
          net_payout_amount numeric NOT NULL DEFAULT 0,
          status text NOT NULL DEFAULT 'pending' check (status in ('pending', 'scheduled', 'completed', 'failed')),
          payout_date date,
          stripe_transfer_id text,
          created_at timestamptz default now(),
          updated_at timestamptz default now()
        );
        
        CREATE INDEX IF NOT EXISTS idx_payouts_client_id ON public.payouts(client_id);
        CREATE INDEX IF NOT EXISTS idx_payouts_status ON public.payouts(status);
        CREATE INDEX IF NOT EXISTS idx_payouts_period ON public.payouts(period_start, period_end);
        
        ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
        
        CREATE POLICY IF NOT EXISTS "service_role_all" ON public.payouts
          FOR ALL USING (auth.role() = 'service_role');
      `
    });

    if (payoutsError) {
      console.error('  Error creating payouts table:', payoutsError);
    } else {
      console.log('  ✓ Payouts table created');
    }

    // Create ledger table
    console.log('\n▶ Creating ledger table...');
    const { error: ledgerError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS public.ledger (
          transaction_id uuid primary key default gen_random_uuid(),
          timestamp timestamptz default now(),
          source_account text not null,
          amount_gross numeric not null,
          platform_fee_percent numeric not null,
          agent_fee_percent numeric not null,
          platform_fee_amount numeric not null,
          agent_fee_amount numeric not null,
          net_amount numeric not null,
          status text not null default 'pending',
          payout_batch_id text
        );
        
        CREATE INDEX IF NOT EXISTS idx_ledger_source_account ON public.ledger(source_account);
        CREATE INDEX IF NOT EXISTS idx_ledger_timestamp ON public.ledger(timestamp);
        CREATE INDEX IF NOT EXISTS idx_ledger_status ON public.ledger(status);
        
        ALTER TABLE public.ledger ENABLE ROW LEVEL SECURITY;
        
        CREATE POLICY IF NOT EXISTS "service_role_all" ON public.ledger
          FOR ALL USING (auth.role() = 'service_role');
      `
    });

    if (ledgerError) {
      console.error('  Error creating ledger table:', ledgerError);
    } else {
      console.log('  ✓ Ledger table created');
    }

    // Verify tables
    console.log('\n▶ Verifying tables...');
    const { data: tables, error: tablesError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .in('table_name', ['clients', 'payouts', 'ledger']);

    if (tablesError) {
      console.error('  Error verifying tables:', tablesError);
    } else {
      console.log('  ✓ Tables found:', tables.map(t => t.table_name).join(', '));
    }

    console.log('\n✅ Table creation complete!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

createTables();
