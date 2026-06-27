export type SourceType = 'api' | 'scrape' | 'email' | 'webhook';

export interface RevenueSource {
  id: string;
  type: SourceType;
  config: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

export type SubmissionStatus = 'new' | 'offered' | 'paid' | 'fulfilled' | 'failed';

export interface Submission {
  id: string;
  content: string;
  source: string;
  status: SubmissionStatus;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type OfferTier = 'basic' | 'pro' | 'premium';
export type OfferStatus = 'pending' | 'payment_link_created' | 'paid' | 'expired';

export interface Offer {
  id: string;
  task_id: string;
  tier: OfferTier;
  price_cents: number;
  preview: string;
  expires_at: string;
  status: OfferStatus;
  payment_link_url?: string;
  paid_at?: string;
  payment_reference?: string;
  created_at: string;
}

export interface Delivery {
  id: string;
  offer_id: string;
  output_url: string;
  status: 'delivered' | 'failed';
  reusable: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  file_url: string;
  created_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan: 'starter' | 'pro' | 'premium';
  status: 'active' | 'inactive' | 'past_due' | 'cancelled';
  created_at: string;
}

export interface RevenueActivity {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface RevenueEngineState {
  sources: RevenueSource[];
  submissions: Submission[];
  offers: Offer[];
  deliveries: Delivery[];
  products: Product[];
  subscriptions: Subscription[];
  activity: RevenueActivity[];
}

export interface AutopilotSummary {
  scannedSources: number;
  ingestedSubmissions: number;
  generatedInternalSubmissions: number;
  generatedOffers: number;
  paymentLinksCreated: number;
  retriesQueued: number;
  deliveriesCompleted: number;
  productsListed: number;
}
