-- =====================================================================
--  HEIDI / HYDI — Deploy missing worker + inventory schema
--
--  Fixes the PGRST205 "Could not find the table ... in the schema cache"
--  errors that were crash-looping EventBusWorker (critical) and spamming
--  InventoryMaterialsWorker.
--
--  Covers two gaps:
--    1. Tables defined in workers-schema.sql that were never applied
--       (event_subscriptions, event_delivery_logs, routing_logs,
--        orchestrator_metrics, event_bus_metrics, webhook_events).
--    2. Inventory tables that exist in NO repo file and had to be authored
--       from how InventoryMaterialsWorker.js actually queries them
--       (inventory_items, material_reservations, procurement_orders,
--        inventory_metrics).
--
--  SAFE TO RERUN: every table uses CREATE TABLE IF NOT EXISTS, every policy
--  is dropped-then-created (the original workers-schema.sql CREATE POLICY
--  statements are NOT idempotent and error on a second run — fixed here).
--
--  Apply: paste into Supabase SQL editor and Run, OR psql < this file.
-- =====================================================================

-- uuid_generate_v4() requires uuid-ossp
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------
--  PART 1 — Event bus / worker tables (from workers-schema.sql)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stripe_event_id TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','queue_failed','duplicate')),
    payload JSONB NOT NULL,
    task_id UUID,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL,
    subscriber TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_type, subscriber)
);

CREATE TABLE IF NOT EXISTS event_delivery_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    delivered_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    failed_details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS routing_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_type TEXT NOT NULL,
    source_queue TEXT NOT NULL,
    target_queue TEXT NOT NULL,
    priority INTEGER,
    reason TEXT,
    confidence FLOAT,
    routed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orchestrator_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_counts JSONB NOT NULL,
    queue_stats JSONB NOT NULL,
    system_health JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_bus_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id TEXT NOT NULL,
    events_published INTEGER DEFAULT 0,
    events_delivered INTEGER DEFAULT 0,
    events_failed INTEGER DEFAULT 0,
    subscribers_count INTEGER DEFAULT 0,
    events_per_second FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
--  PART 2 — Inventory tables (authored from InventoryMaterialsWorker.js)
--    columns map 1:1 to the worker's .select/.insert/.upsert usage.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id TEXT UNIQUE NOT NULL,          -- queried via .in('item_id', ...)
    item_type TEXT NOT NULL,               -- .eq('item_type', ...)
    name TEXT,
    quantity NUMERIC,                      -- generic quantity (low-stock checks)
    quantity_grams NUMERIC,                -- filament
    quantity_count INTEGER,                -- components / pcb / electronics
    quantity_ml NUMERIC,                   -- materials
    location TEXT,
    lot_number TEXT,
    warranty_expiry TIMESTAMPTZ,           -- checkForExpiringItems()
    preferred_supplier TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS material_reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_email TEXT,
    reserved_materials JSONB,
    reserved_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS procurement_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id TEXT,
    item_type TEXT,
    item_name TEXT,
    quantity NUMERIC,
    urgency TEXT,
    status TEXT DEFAULT 'pending',
    ordered_at TIMESTAMPTZ DEFAULT NOW(),
    expected_delivery TIMESTAMPTZ,
    supplier TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id TEXT UNIQUE NOT NULL,        -- .upsert(..., { onConflict: 'worker_id' })
    total_inventory_items INTEGER,
    low_stock_items INTEGER,
    out_of_stock_items INTEGER,
    inventory_value_estimate NUMERIC,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
--  PART 3 — RLS + service_role policies (idempotent)
-- ---------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'webhook_events','event_subscriptions','event_delivery_logs',
        'routing_logs','orchestrator_metrics','event_bus_metrics',
        'inventory_items','material_reservations','procurement_orders','inventory_metrics'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_service_role', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL USING (auth.jwt()->>''role'' = ''service_role'');',
            t || '_service_role', t
        );
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
--  PART 4 — Indexes
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_webhook_events_stripe_id ON webhook_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status    ON webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created   ON webhook_events(created_at);
CREATE INDEX IF NOT EXISTS idx_event_subscriptions_type       ON event_subscriptions(event_type);
CREATE INDEX IF NOT EXISTS idx_event_subscriptions_subscriber ON event_subscriptions(subscriber);
CREATE INDEX IF NOT EXISTS idx_routing_logs_created ON routing_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_routing_logs_target  ON routing_logs(target_queue);
CREATE INDEX IF NOT EXISTS idx_inventory_items_type ON inventory_items(item_type);
CREATE INDEX IF NOT EXISTS idx_procurement_orders_status ON procurement_orders(status);

-- ---------------------------------------------------------------------
--  Verify (run after): expect 10 rows, all true
-- ---------------------------------------------------------------------
-- SELECT tbl, to_regclass('public.'||tbl) IS NOT NULL AS exists
-- FROM unnest(ARRAY[
--   'webhook_events','event_subscriptions','event_delivery_logs','routing_logs',
--   'orchestrator_metrics','event_bus_metrics','inventory_items',
--   'material_reservations','procurement_orders','inventory_metrics']) AS tbl
-- ORDER BY tbl;
