import { describe, expect, it, beforeEach } from 'vitest';
import {
  createSubmission,
  generateInternalJobs,
  getRevenueEngineStatus,
  markOfferPaidFromWebhook,
  processSubmissions,
  ensureDeliveries,
  listOffers,
  listProducts,
} from './engine';
import { saveRevenueState } from './storage';

describe('revenue engine workflow', () => {
  beforeEach(async () => {
    await saveRevenueState({
      sources: [],
      submissions: [],
      offers: [],
      deliveries: [],
      products: [],
      subscriptions: [],
      activity: [],
    });
  });

  it('creates offers for submissions and fulfills only after payment', async () => {
    const submission = await createSubmission({
      content: 'Write grant proposal for nonprofit healthcare pilot',
      source: 'test',
    });

    expect(submission).not.toBeNull();

    const generatedOffers = await processSubmissions();
    expect(generatedOffers).toBe(3);

    const offers = await listOffers();
    expect(offers).toHaveLength(3);
    expect(offers.every((offer) => offer.status === 'pending')).toBe(true);

    // No free work before paid status.
    const beforePaymentDelivery = await ensureDeliveries();
    expect(beforePaymentDelivery.deliveriesCompleted).toBe(0);

    const paidResult = await markOfferPaidFromWebhook(offers[0].id, 'test-payment-ref');
    expect(paidResult.updated).toBe(true);

    const afterPaymentDelivery = await ensureDeliveries();
    expect(afterPaymentDelivery.deliveriesCompleted).toBe(1);

    const products = await listProducts();
    expect(products.length).toBe(1);

    const status = await getRevenueEngineStatus();
    expect(status.offers_paid).toBe(1);
    expect(status.deliveries).toBe(1);
  });

  it('adds seeded internal jobs once and deduplicates repeated generation', async () => {
    const firstRun = await generateInternalJobs();
    const secondRun = await generateInternalJobs();
    const status = await getRevenueEngineStatus();

    expect(firstRun).toBeGreaterThan(0);
    expect(secondRun).toBe(0);
    expect(status.submissions).toBe(firstRun);
  });
});
