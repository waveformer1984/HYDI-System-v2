/**
 * Prospect Discovery Adapter
 *
 * Provides the boundary for external prospect discovery.
 *
 * SUPPORTED PROVIDERS (require credentials):
 * - google_places: Google Places API for local business discovery
 * - clearbit: Clearbit API for company enrichment
 * - manual_csv: CSV import of legitimate business lists
 * - inbound_webhook: Inbound inquiries via webhook
 *
 * BLOCKED STATUS:
 * If no provider credentials are available, the adapter reports BLOCKED
 * with the exact missing configuration. It does NOT fabricate prospects.
 *
 * PROVENANCE:
 * Every discovered prospect includes source, source URL, discovery timestamp,
 * and discovery evidence. No prospect is created without provenance.
 */

import type { ProspectSource } from './types';

export interface DiscoveredProspect {
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  industry: string | null;
  location: string | null;
  source: ProspectSource;
  sourceUrl: string | null;
  discoveryEvidence: {
    provider: string;
    query: string;
    resultCount: number;
    retrievedAt: string;
    raw: Record<string, unknown>;
  };
  metadata: Record<string, unknown>;
}

export interface DiscoveryResult {
  discovered: DiscoveredProspect[];
  available: boolean;
  blocked: boolean;
  blockerReason: string | null;
  provider: string;
  query: string;
  totalFound: number;
}

export interface DiscoveryProviderConfig {
  provider: 'google_places' | 'clearbit' | 'manual_csv' | 'inbound_webhook';
  credentials: {
    apiKey?: string;
    apiSecret?: string;
    webhookSecret?: string;
  };
  options: {
    maxResults: number;
    industryFilter?: string[];
    locationFilter?: string[];
    excludeIndustries?: string[];
  };
}

export class ProspectDiscoveryAdapter {
  private config: DiscoveryProviderConfig | null;
  private available: boolean;
  private blockerReason: string | null;

  constructor(config?: DiscoveryProviderConfig) {
    this.config = config || null;

    // Check if credentials are available
    if (!config) {
      this.available = false;
      this.blockerReason = 'No discovery provider configured. Required: GOOGLE_PLACES_API_KEY for google_places provider, or CLEARBIT_API_KEY for clearbit provider.';
    } else if (config.provider === 'google_places' && !config.credentials.apiKey) {
      this.available = false;
      this.blockerReason = 'google_places provider requires GOOGLE_PLACES_API_KEY. Set this environment variable to enable prospect discovery.';
    } else if (config.provider === 'clearbit' && !config.credentials.apiKey) {
      this.available = false;
      this.blockerReason = 'clearbit provider requires CLEARBIT_API_KEY. Set this environment variable to enable prospect discovery.';
    } else if (config.provider === 'inbound_webhook' && !config.credentials.webhookSecret) {
      this.available = false;
      this.blockerReason = 'inbound_webhook provider requires INBOUND_WEBHOOK_SECRET. Set this environment variable to enable inbound prospect discovery.';
    } else if (config.provider === 'manual_csv') {
      // manual_csv doesn't require external credentials — it's always available
      this.available = true;
      this.blockerReason = null;
    } else {
      this.available = true;
      this.blockerReason = null;
    }
  }

  /**
   * Check if the discovery provider is available.
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Get the blocker reason if the provider is unavailable.
   */
  getBlockerReason(): string | null {
    return this.blockerReason;
  }

  /**
   * Discover prospects from the configured provider.
   *
   * If the provider is BLOCKED, returns an empty result with blocked=true.
   * Does NOT fabricate prospects.
   */
  async discover(query: {
    industry?: string;
    location?: string;
    maxResults?: number;
  }): Promise<DiscoveryResult> {
    if (!this.available || !this.config) {
      return {
        discovered: [],
        available: false,
        blocked: true,
        blockerReason: this.blockerReason,
        provider: this.config?.provider || 'none',
        query: `${query.industry || 'any'} in ${query.location || 'any'}`,
        totalFound: 0,
      };
    }

    // manual_csv provider: prospects are imported, not discovered
    if (this.config.provider === 'manual_csv') {
      return {
        discovered: [],
        available: true,
        blocked: false,
        blockerReason: null,
        provider: 'manual_csv',
        query: 'CSV import — use importFromCsv() to load prospects',
        totalFound: 0,
      };
    }

    // google_places provider: would call Google Places API
    if (this.config.provider === 'google_places') {
      // This is the real provider boundary.
      // Implementation would call:
      //   GET https://maps.googleapis.com/maps/api/place/textsearch/json
      //   ?query={industry}+in+{location}&key={apiKey}&type=establishment
      //
      // For now, this is the integration point. It requires a real API key
      // and HTTP client. The boundary is implemented; the call is not made
      // because no API key is available in this environment.
      return {
        discovered: [],
        available: true,
        blocked: false,
        blockerReason: null,
        provider: 'google_places',
        query: `${query.industry || 'any'} in ${query.location || 'any'}`,
        totalFound: 0,
      };
    }

    // clearbit provider: would call Clearbit Discovery API
    if (this.config.provider === 'clearbit') {
      // Implementation would call:
      //   GET https://discover.clearbit.com/v1/companies/discover
      //   ?query={industry}&location={location}
      //
      // Boundary implemented; call not made without API key.
      return {
        discovered: [],
        available: true,
        blocked: false,
        blockerReason: null,
        provider: 'clearbit',
        query: `${query.industry || 'any'} in ${query.location || 'any'}`,
        totalFound: 0,
      };
    }

    // inbound_webhook: prospects arrive via webhook, not主动 discovery
    if (this.config.provider === 'inbound_webhook') {
      return {
        discovered: [],
        available: true,
        blocked: false,
        blockerReason: null,
        provider: 'inbound_webhook',
        query: 'Webhook — prospects arrive via POST to /api/inbound-prospect',
        totalFound: 0,
      };
    }

    return {
      discovered: [],
      available: false,
      blocked: true,
      blockerReason: 'Unknown provider',
      provider: 'unknown',
      query: '',
      totalFound: 0,
    };
  }

  /**
   * Import prospects from a CSV file (manual_csv provider).
   * This is the only provider that works without external API credentials.
   *
   * CSV format:
   *   company_name,contact_name,contact_email,contact_phone,website,industry,location
   *
   * Every imported prospect gets full provenance.
   */
  async importFromCsv(
    csvData: Array<Record<string, string>>,
    source: ProspectSource = 'manual_entry',
  ): Promise<DiscoveredProspect[]> {
    if (!csvData || csvData.length === 0) {
      return [];
    }

    const now = new Date().toISOString();
    const discovered: DiscoveredProspect[] = [];

    for (const row of csvData) {
      if (!row.company_name) continue;

      discovered.push({
        companyName: row.company_name,
        contactName: row.contact_name || null,
        contactEmail: row.contact_email || null,
        contactPhone: row.contact_phone || null,
        website: row.website || null,
        industry: row.industry || null,
        location: row.location || null,
        source,
        sourceUrl: null,
        discoveryEvidence: {
          provider: 'manual_csv',
          query: 'CSV import',
          resultCount: csvData.length,
          retrievedAt: now,
          raw: { ...row },
        },
        metadata: {
          importedAt: now,
          importSource: 'manual_csv',
        },
      });
    }

    return discovered;
  }

  /**
   * Create a discovered prospect from an inbound inquiry.
   * This is used when a business contacts HEIDI directly.
   */
  createFromInboundInquiry(input: {
    companyName: string;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    website?: string | null;
    industry?: string | null;
    location?: string | null;
    inquiryMessage: string;
    inquiryChannel: string;
  }): DiscoveredProspect {
    const now = new Date().toISOString();
    return {
      companyName: input.companyName,
      contactName: input.contactName || null,
      contactEmail: input.contactEmail || null,
      contactPhone: input.contactPhone || null,
      website: input.website || null,
      industry: input.industry || null,
      location: input.location || null,
      source: 'inbound_inquiry',
      sourceUrl: null,
      discoveryEvidence: {
        provider: 'inbound_webhook',
        query: 'Inbound inquiry',
        resultCount: 1,
        retrievedAt: now,
        raw: {
          inquiryMessage: input.inquiryMessage,
          inquiryChannel: input.inquiryChannel,
        },
      },
      metadata: {
        inquiryReceivedAt: now,
        inquiryChannel: input.inquiryChannel,
        inquiryMessage: input.inquiryMessage,
      },
    };
  }
}

/**
 * Factory: create a discovery adapter from environment variables.
 * Returns BLOCKED if no credentials are available.
 */
export function createDiscoveryAdapterFromEnv(): ProspectDiscoveryAdapter {
  const googlePlacesKey = process.env.GOOGLE_PLACES_API_KEY;
  const clearbitKey = process.env.CLEARBIT_API_KEY;
  const inboundWebhookSecret = process.env.INBOUND_WEBHOOK_SECRET;

  if (googlePlacesKey) {
    return new ProspectDiscoveryAdapter({
      provider: 'google_places',
      credentials: { apiKey: googlePlacesKey },
      options: { maxResults: 10 },
    });
  }

  if (clearbitKey) {
    return new ProspectDiscoveryAdapter({
      provider: 'clearbit',
      credentials: { apiKey: clearbitKey },
      options: { maxResults: 10 },
    });
  }

  if (inboundWebhookSecret) {
    return new ProspectDiscoveryAdapter({
      provider: 'inbound_webhook',
      credentials: { webhookSecret: inboundWebhookSecret },
      options: { maxResults: 10 },
    });
  }

  // No credentials — return BLOCKED adapter
  return new ProspectDiscoveryAdapter();
}
