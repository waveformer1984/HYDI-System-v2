-- ============================================
-- LEDGER IDEMPOTENCY: UNIQUE STRIPE PAYMENT INTENT
-- Stripe delivers webhooks at-least-once. Without a DB-level constraint,
-- a redelivered payment_intent.succeeded event double-books revenue via
-- api/stripe-connect-webhook.js. This replaces the plain lookup index
-- with a unique one so duplicate rows are rejected outright.
-- ============================================

DROP INDEX IF EXISTS idx_ledger_stripe_payment;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_stripe_payment_intent_unique
    ON ledger (stripe_payment_intent_id);
