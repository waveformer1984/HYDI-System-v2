import path from 'path';
import Stripe from 'stripe';
import {
  AutopilotSummary,
  Delivery,
  Offer,
  OfferTier,
  Product,
  RevenueEngineState,
  RevenueSource,
  SourceType,
  Submission,
} from './types';
import { generateId, loadRevenueState, nowIso, saveRevenueState } from './storage';

const INTERNAL_IDEAS = [
  'Build landing page for dentist',
  'Write grant proposal for nonprofit',
  'Create Shopify store for niche product',
];

const OFFER_MULTIPLIERS: Record<OfferTier, number> = {
  basic: 1,
  pro: 1.8,
  premium: 3,
};

const OFFER_EXPIRY_HOURS = 48;
const MAX_ACTIVITY_EVENTS = 500;

let stripeClient: Stripe | null | undefined;

function getStripeClient(): Stripe | null {
  if (stripeClient !== undefined) {
    return stripeClient;
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    stripeClient = null;
    return stripeClient;
  }

  stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-05-27.dahlia',
  });
  return stripeClient;
}

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addActivity(state: RevenueEngineState, type: string, payload: Record<string, unknown>): void {
  state.activity.push({
    id: generateId(),
    type,
    payload,
    created_at: nowIso(),
  });

  if (state.activity.length > MAX_ACTIVITY_EVENTS) {
    state.activity = state.activity.slice(-MAX_ACTIVITY_EVENTS);
  }
}

function hasSubmission(state: RevenueEngineState, content: string, source: string): boolean {
  return state.submissions.some((submission) => {
    return (
      submission.content.toLowerCase() === content.toLowerCase() &&
      submission.source === source &&
      submission.status !== 'failed'
    );
  });
}

function ingestSubmission(
  state: RevenueEngineState,
  content: string,
  source: string,
  metadata: Record<string, unknown> = {},
): Submission | null {
  const normalized = normalizeText(content);
  if (!normalized) {
    return null;
  }

  if (hasSubmission(state, normalized, source)) {
    return null;
  }

  const createdAt = nowIso();
  const submission: Submission = {
    id: generateId(),
    content: normalized,
    source,
    metadata,
    status: 'new',
    created_at: createdAt,
    updated_at: createdAt,
  };

  state.submissions.push(submission);
  addActivity(state, 'submission_ingested', {
    submission_id: submission.id,
    source,
  });
  return submission;
}

function extractJobsFromSource(source: RevenueSource): string[] {
  const config = source.config || {};
  const fromTypeKey = (() => {
    switch (source.type) {
      case 'api':
        return config.api_jobs;
      case 'email':
        return config.email_jobs;
      case 'scrape':
        return config.scrape_jobs;
      case 'webhook':
        return config.webhook_jobs;
      default:
        return undefined;
    }
  })();

  const seedJobs = config.seed_jobs;
  const candidateValues = [fromTypeKey, seedJobs];
  const output: string[] = [];

  for (const candidate of candidateValues) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    for (const item of candidate) {
      if (typeof item === 'string') {
        output.push(item);
      } else if (
        typeof item === 'object' &&
        item !== null &&
        'content' in item &&
        typeof (item as { content: unknown }).content === 'string'
      ) {
        output.push((item as { content: string }).content);
      }
    }
  }

  return output;
}

function createDefaultCheckoutUrl(offerId: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || 'http://localhost:3000';
  return `${baseUrl}/revenue/offers/${offerId}`;
}

export function estimatePriceCents(content: string): number {
  const words = normalizeText(content).split(' ').filter(Boolean).length;
  const lower = content.toLowerCase();

  let base = 4900 + words * 180;

  if (lower.includes('shopify') || lower.includes('website') || lower.includes('landing page')) {
    base += 5000;
  }

  if (lower.includes('automation') || lower.includes('script') || lower.includes('api')) {
    base += 7000;
  }

  if (lower.includes('grant')) {
    base += 6000;
  }

  return Math.max(4900, Math.min(base, 199900));
}

export function generateOfferTiers(content: string): Array<{ tier: OfferTier; price_cents: number }> {
  const base = estimatePriceCents(content);
  return (Object.keys(OFFER_MULTIPLIERS) as OfferTier[]).map((tier) => ({
    tier,
    price_cents: Math.round(base * OFFER_MULTIPLIERS[tier]),
  }));
}

export function generatePreview(content: string): string {
  const window = normalizeText(content).slice(0, 200);
  if (!window) {
    return 'Preview unavailable.';
  }
  return `Preview: ${window}. Deliverable includes scoped execution plan and first draft output.`;
}

async function createStripeCheckoutUrl(offer: Offer, submission: Submission): Promise<string | null> {
  const stripe = getStripeClient();
  if (!stripe) {
    return null;
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || 'http://localhost:3000';
  const successUrl =
    process.env.REVENUE_ENGINE_SUCCESS_URL ||
    `${baseUrl}/?revenue_checkout=success&offer_id=${offer.id}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl =
    process.env.REVENUE_ENGINE_CANCEL_URL ||
    `${baseUrl}/?revenue_checkout=cancelled&offer_id=${offer.id}`;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      offer_id: offer.id,
      submission_id: submission.id,
      tier: offer.tier,
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: offer.price_cents,
          product_data: {
            name: `${offer.tier.toUpperCase()} offer`,
            description: submission.content.slice(0, 250),
          },
        },
      },
    ],
  });

  return session.url ?? null;
}

function offerIsExpired(offer: Offer): boolean {
  return new Date(offer.expires_at).getTime() <= Date.now();
}

export async function listSources(): Promise<RevenueSource[]> {
  const state = await loadRevenueState();
  return state.sources;
}

export async function createSource(input: {
  type: SourceType;
  config?: Record<string, unknown>;
  active?: boolean;
}): Promise<RevenueSource> {
  const state = await loadRevenueState();
  const source: RevenueSource = {
    id: generateId(),
    type: input.type,
    config: input.config || {},
    active: input.active ?? true,
    created_at: nowIso(),
  };
  state.sources.push(source);
  addActivity(state, 'source_created', { source_id: source.id, type: source.type });
  await saveRevenueState(state);
  return source;
}

export async function createSubmission(input: {
  content: string;
  source?: string;
  metadata?: Record<string, unknown>;
}): Promise<Submission | null> {
  const state = await loadRevenueState();
  const inserted = ingestSubmission(state, input.content, input.source || 'manual', input.metadata || {});
  await saveRevenueState(state);
  return inserted;
}

export async function listSubmissions(): Promise<Submission[]> {
  const state = await loadRevenueState();
  return state.submissions;
}

export async function listOffers(): Promise<Offer[]> {
  const state = await loadRevenueState();
  return state.offers;
}

export async function listDeliveries(): Promise<Delivery[]> {
  const state = await loadRevenueState();
  return state.deliveries;
}

export async function listProducts(): Promise<Product[]> {
  const state = await loadRevenueState();
  return state.products;
}

export async function scanSources(): Promise<{ scannedSources: number; ingestedSubmissions: number }> {
  const state = await loadRevenueState();
  const activeSources = state.sources.filter((source) => source.active);
  let ingestedSubmissions = 0;

  for (const source of activeSources) {
    const jobs = extractJobsFromSource(source);
    for (const job of jobs) {
      const inserted = ingestSubmission(state, job, `source:${source.id}`, { source_type: source.type });
      if (inserted) {
        ingestedSubmissions += 1;
      }
    }
  }

  addActivity(state, 'source_scan_completed', {
    scanned_sources: activeSources.length,
    ingested_submissions: ingestedSubmissions,
  });
  await saveRevenueState(state);

  return { scannedSources: activeSources.length, ingestedSubmissions };
}

export async function generateInternalJobs(): Promise<number> {
  const state = await loadRevenueState();
  let generated = 0;

  for (const idea of INTERNAL_IDEAS) {
    const inserted = ingestSubmission(state, idea, 'HYDI_internal');
    if (inserted) {
      generated += 1;
    }
  }

  addActivity(state, 'internal_jobs_generated', {
    generated_submissions: generated,
  });
  await saveRevenueState(state);
  return generated;
}

function expirePendingOffers(state: RevenueEngineState): number {
  let expired = 0;
  for (const offer of state.offers) {
    if (offer.status === 'paid' || offer.status === 'expired') {
      continue;
    }

    if (offerIsExpired(offer)) {
      offer.status = 'expired';
      expired += 1;
    }
  }
  return expired;
}

export async function processSubmissions(): Promise<number> {
  const state = await loadRevenueState();
  let generatedOffers = 0;

  for (const submission of state.submissions) {
    if (submission.status !== 'new') {
      continue;
    }

    const tiers = generateOfferTiers(submission.content);
    const preview = generatePreview(submission.content);
    const expiresAt = addHours(new Date(), OFFER_EXPIRY_HOURS).toISOString();

    for (const tier of tiers) {
      const offer: Offer = {
        id: generateId(),
        task_id: submission.id,
        tier: tier.tier,
        price_cents: tier.price_cents,
        preview,
        expires_at: expiresAt,
        status: 'pending',
        created_at: nowIso(),
      };
      state.offers.push(offer);
      generatedOffers += 1;
    }

    submission.status = 'offered';
    submission.updated_at = nowIso();
    addActivity(state, 'offers_generated', {
      submission_id: submission.id,
      offers_created: 3,
    });
  }

  const expiredOffers = expirePendingOffers(state);
  if (expiredOffers > 0) {
    addActivity(state, 'offers_expired', { offers_expired: expiredOffers });
  }

  await saveRevenueState(state);
  return generatedOffers;
}

export async function createPaymentLinks(): Promise<number> {
  const state = await loadRevenueState();
  let created = 0;
  const now = Date.now();

  for (const offer of state.offers) {
    if (offer.status === 'paid' || offer.status === 'expired') {
      continue;
    }

    if (new Date(offer.expires_at).getTime() <= now) {
      offer.status = 'expired';
      continue;
    }

    if (offer.payment_link_url) {
      continue;
    }

    const submission = state.submissions.find((item) => item.id === offer.task_id);
    if (!submission) {
      continue;
    }

    try {
      const stripeLink = await createStripeCheckoutUrl(offer, submission);
      offer.payment_link_url = stripeLink || createDefaultCheckoutUrl(offer.id);
      offer.status = 'payment_link_created';
      created += 1;
    } catch (error) {
      console.error('[REVENUE_ENGINE] Failed to create Stripe checkout link:', error);
    }
  }

  if (created > 0) {
    addActivity(state, 'payment_links_created', { offers_updated: created });
  }
  await saveRevenueState(state);
  return created;
}

export async function markOfferPaidFromWebhook(
  offerId: string,
  paymentReference: string,
): Promise<{ updated: boolean; offerId: string; reason?: string }> {
  const state = await loadRevenueState();
  const offer = state.offers.find((item) => item.id === offerId);

  if (!offer) {
    return { updated: false, offerId, reason: 'offer_not_found' };
  }

  if (offer.status === 'paid') {
    return { updated: false, offerId, reason: 'already_paid' };
  }

  offer.status = 'paid';
  offer.paid_at = nowIso();
  offer.payment_reference = paymentReference;

  const submission = state.submissions.find((item) => item.id === offer.task_id);
  if (submission) {
    submission.status = 'paid';
    submission.updated_at = nowIso();
  }

  addActivity(state, 'offer_paid', {
    offer_id: offer.id,
    payment_reference: paymentReference,
  });
  await saveRevenueState(state);
  return { updated: true, offerId };
}

export function executeTaskByContent(content: string): {
  fileExtension: string;
  mimeType: string;
  body: string;
  title: string;
} {
  const lower = content.toLowerCase();

  if (lower.includes('grant')) {
    return {
      fileExtension: 'md',
      mimeType: 'text/markdown',
      title: 'grant-proposal',
      body: [
        '# Grant Proposal',
        '',
        `Project: ${content}`,
        '',
        '## Executive Summary',
        'This proposal outlines measurable impact, milestones, budget, and reporting cadence.',
        '',
        '## Budget and Metrics',
        '- Budget aligned to outcomes',
        '- 90-day rollout milestones',
        '- KPI reporting schedule',
      ].join('\n'),
    };
  }

  if (lower.includes('website') || lower.includes('landing page') || lower.includes('shopify')) {
    return {
      fileExtension: 'html',
      mimeType: 'text/html',
      title: 'website-deliverable',
      body: [
        '<!doctype html>',
        '<html lang="en">',
        '<head><meta charset="utf-8"><title>Website Deliverable</title></head>',
        '<body>',
        `  <h1>${content}</h1>`,
        '  <p>Production-ready starter layout with sections for hero, features, proof, and CTA.</p>',
        '</body>',
        '</html>',
      ].join('\n'),
    };
  }

  if (lower.includes('automation') || lower.includes('script')) {
    return {
      fileExtension: 'py',
      mimeType: 'text/x-python',
      title: 'automation-script',
      body: [
        '"""Generated automation starter script."""',
        '',
        'def run():',
        `    task = ${JSON.stringify(content)}`,
        '    print(f"Running automation for: {task}")',
        '',
        '',
        "if __name__ == '__main__':",
        '    run()',
      ].join('\n'),
    };
  }

  return {
    fileExtension: 'txt',
    mimeType: 'text/plain',
    title: 'generic-output',
    body: `Generated deliverable:\n${content}\n\nIncludes scoped implementation notes and next actions.`,
  };
}

async function persistOutput(offerId: string, execution: ReturnType<typeof executeTaskByContent>): Promise<string> {
  const fs = await import('fs/promises');
  const outputDir = path.join(process.cwd(), 'data', 'revenue-engine', 'outputs');
  await fs.mkdir(outputDir, { recursive: true });
  const filename = `${offerId}.${execution.fileExtension}`;
  const filePath = path.join(outputDir, filename);
  await fs.writeFile(filePath, execution.body, 'utf-8');
  return `/data/revenue-engine/outputs/${filename}`;
}

export async function ensureDeliveries(): Promise<{ deliveriesCompleted: number; productsListed: number }> {
  const state = await loadRevenueState();
  let deliveriesCompleted = 0;
  let productsListed = 0;

  for (const offer of state.offers) {
    if (offer.status !== 'paid') {
      continue;
    }

    const existingDelivery = state.deliveries.find((delivery) => delivery.offer_id === offer.id);
    if (existingDelivery) {
      continue;
    }

    const submission = state.submissions.find((item) => item.id === offer.task_id);
    if (!submission) {
      continue;
    }

    const execution = executeTaskByContent(submission.content);
    const outputUrl = await persistOutput(offer.id, execution);

    const delivery: Delivery = {
      id: generateId(),
      offer_id: offer.id,
      output_url: outputUrl,
      status: 'delivered',
      reusable: true,
      created_at: nowIso(),
    };
    state.deliveries.push(delivery);
    submission.status = 'fulfilled';
    submission.updated_at = nowIso();
    deliveriesCompleted += 1;

    const alreadyListed = state.products.some((product) => product.file_url === outputUrl);
    if (!alreadyListed && delivery.reusable) {
      const product: Product = {
        id: generateId(),
        title: `${offer.tier.toUpperCase()} - ${submission.content.slice(0, 80)}`,
        description: `Reusable deliverable generated from submission ${submission.id}.`,
        price_cents: offer.price_cents,
        file_url: outputUrl,
        created_at: nowIso(),
      };
      state.products.push(product);
      productsListed += 1;
    }

    addActivity(state, 'delivery_completed', {
      offer_id: offer.id,
      output_url: outputUrl,
    });
  }

  await saveRevenueState(state);
  return { deliveriesCompleted, productsListed };
}

export async function retryFailed(): Promise<number> {
  const state = await loadRevenueState();
  let retriesQueued = 0;

  for (const submission of state.submissions) {
    if (submission.status !== 'failed') {
      continue;
    }

    const currentRetries =
      typeof submission.metadata?.retry_count === 'number' ? Number(submission.metadata.retry_count) : 0;
    if (currentRetries >= 3) {
      continue;
    }

    submission.status = 'new';
    submission.updated_at = nowIso();
    submission.metadata = {
      ...(submission.metadata || {}),
      retry_count: currentRetries + 1,
    };
    retriesQueued += 1;
  }

  if (retriesQueued > 0) {
    addActivity(state, 'retries_queued', { retries_queued: retriesQueued });
  }
  await saveRevenueState(state);
  return retriesQueued;
}

export async function hydiAutopilot(): Promise<AutopilotSummary> {
  const sourceScan = await scanSources();
  const generatedInternalSubmissions = await generateInternalJobs();
  const generatedOffers = await processSubmissions();
  const paymentLinksCreated = await createPaymentLinks();
  const retriesQueued = await retryFailed();
  const deliverySummary = await ensureDeliveries();

  return {
    scannedSources: sourceScan.scannedSources,
    ingestedSubmissions: sourceScan.ingestedSubmissions,
    generatedInternalSubmissions,
    generatedOffers,
    paymentLinksCreated,
    retriesQueued,
    deliveriesCompleted: deliverySummary.deliveriesCompleted,
    productsListed: deliverySummary.productsListed,
  };
}

export async function getRevenueEngineStatus(): Promise<{
  sources: number;
  submissions: number;
  offers: number;
  offers_paid: number;
  deliveries: number;
  products: number;
  subscriptions: number;
  recent_activity: RevenueEngineState['activity'];
}> {
  const state = await loadRevenueState();

  return {
    sources: state.sources.length,
    submissions: state.submissions.length,
    offers: state.offers.length,
    offers_paid: state.offers.filter((offer) => offer.status === 'paid').length,
    deliveries: state.deliveries.length,
    products: state.products.length,
    subscriptions: state.subscriptions.length,
    recent_activity: state.activity.slice(-20).reverse(),
  };
}
