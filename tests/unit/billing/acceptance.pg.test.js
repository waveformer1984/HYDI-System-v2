'use strict';

/**
 * Billing acceptance scenarios on real Postgres (Tier 2 — needs a database
 * with supabase/migrations/20261011120000_billing_revenue_streams_module.sql
 * applied). Connection: BILLING_TEST_DATABASE_URL, else PG_HOST/PG_PORT/...
 * (local Supabase on :54322). Run with `npm run test:local`.
 *
 * This suite TRUNCATEs every billing_* table: never point it at a database
 * holding real billing data.
 */
const { defineAcceptanceScenarios } = require('./acceptance.scenarios');

describe('billing acceptance (postgres store)', () => {
  defineAcceptanceScenarios('postgres');
});
