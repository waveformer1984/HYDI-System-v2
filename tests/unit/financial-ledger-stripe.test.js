'use strict';

const { loadLedger, recordClearedPayment, hardwareReservePlan, liveClearedTotal } = require('../../lib/revenue-ops/financial-ledger');

function mockStripe(handlers) {
  return {
    paymentIntents: {
      retrieve: async (id) => handlers.paymentIntent(id),
    },
    charges: {
      retrieve: async (id, opts) => handlers.charge(id, opts),
    },
    balanceTransactions: {
      retrieve: async (id) => handlers.balanceTransaction(id),
    },
  };
}

const ENV_LIVE = { STRIPE_SECRET_KEY: 'sk_test_mock' };

describe('financial ledger Stripe verification', () => {
  test('succeeded + available balance records live payment', async () => {
    const ledger = loadLedger('/tmp/unused');
    const stripe = mockStripe({
      paymentIntent: async () => ({
        status: 'succeeded',
        livemode: true,
        amount_received: 20000,
        latest_charge: 'ch_1',
      }),
      charge: async () => ({
        balance_transaction: { status: 'available', id: 'txn_1' },
      }),
      balanceTransaction: async () => ({ status: 'available' }),
    });
    await recordClearedPayment(ledger, {
      stripePaymentId: 'pi_live_1',
      env: ENV_LIVE,
      stripe,
    });
    expect(ledger.clearedPaymentsUsd).toBe(200);
    expect(liveClearedTotal(ledger)).toBe(200);
    expect(hardwareReservePlan(ledger).buckets.hardwareExpansionUsd).toBe(100);
  });

  test('pending balance rejects without recording', async () => {
    const ledger = loadLedger('/tmp/unused');
    const stripe = mockStripe({
      paymentIntent: async () => ({
        status: 'succeeded',
        livemode: true,
        amount_received: 10000,
        latest_charge: 'ch_pend',
      }),
      charge: async () => ({ balance_transaction: { status: 'pending' } }),
      balanceTransaction: async () => ({ status: 'pending' }),
    });
    await expect(
      recordClearedPayment(ledger, { stripePaymentId: 'pi_pend', env: ENV_LIVE, stripe }),
    ).rejects.toMatchObject({ code: 'BALANCE_NOT_AVAILABLE' });
    expect(ledger.entries.length).toBe(0);
    expect(ledger.clearedPaymentsUsd).toBe(0);
  });

  test('test mode rejected unless LEDGER_ALLOW_TEST=true', async () => {
    const ledger = loadLedger('/tmp/unused');
    const stripe = mockStripe({
      paymentIntent: async () => ({
        status: 'succeeded',
        livemode: false,
        amount_received: 5000,
        latest_charge: 'ch_test',
      }),
      charge: async () => ({ balance_transaction: { status: 'available' } }),
      balanceTransaction: async () => ({ status: 'available' }),
    });
    await expect(
      recordClearedPayment(ledger, { stripePaymentId: 'pi_test', env: ENV_LIVE, stripe }),
    ).rejects.toMatchObject({ code: 'TEST_MODE_REJECTED' });
    expect(ledger.entries.length).toBe(0);
  });

  test('test mode allowed tags entry and excludes hardware reserve', async () => {
    const ledger = loadLedger('/tmp/unused');
    const stripe = mockStripe({
      paymentIntent: async () => ({
        status: 'succeeded',
        livemode: false,
        amount_received: 5000,
        latest_charge: 'ch_test_ok',
      }),
      charge: async () => ({ balance_transaction: { status: 'available' } }),
      balanceTransaction: async () => ({ status: 'available' }),
    });
    await recordClearedPayment(ledger, {
      stripePaymentId: 'pi_test_ok',
      env: { ...ENV_LIVE, LEDGER_ALLOW_TEST: 'true' },
      stripe,
    });
    expect(ledger.testClearedPaymentsUsd).toBe(50);
    expect(liveClearedTotal(ledger)).toBe(0);
    expect(hardwareReservePlan(ledger).buckets.hardwareExpansionUsd).toBe(0);
    expect(ledger.entries[0].testMode).toBe(true);
  });

  test('missing Stripe key fails closed', async () => {
    const ledger = loadLedger('/tmp/unused');
    await expect(
      recordClearedPayment(ledger, { stripePaymentId: 'pi_x', env: {}, stripe: mockStripe({}) }),
    ).rejects.toMatchObject({ code: 'STRIPE_KEY_REQUIRED' });
    expect(ledger.entries?.length || 0).toBe(0);
  });
});