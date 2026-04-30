/**
 * Pricing configuration for Ursula Service Bundle
 * Defines tiers, limits, and per-use pricing
 */

const pricingConfig = {
  tiers: {
    starter: {
      name: 'Starter',
      price: 49,
      billing: 'monthly',
      description: 'Perfect for individuals and small projects',
      features: [
        '8 essential services',
        '1,000 API calls/month',
        'Local model access',
        'Email support',
        'Basic analytics'
      ],
      limits: {
        apiCalls: 1000,
        services: 8,
        storage: '1GB',
        teamMembers: 1
      },
      popular: false
    },
    pro: {
      name: 'Pro',
      price: 149,
      billing: 'monthly',
      description: 'Ideal for growing businesses and teams',
      features: [
        '20 professional services',
        '10,000 API calls/month',
        'Advanced local models',
        'Priority support',
        'Advanced analytics',
        'Custom integrations',
        'Team collaboration'
      ],
      limits: {
        apiCalls: 10000,
        services: 20,
        storage: '10GB',
        teamMembers: 5
      },
      popular: true
    },
    enterprise: {
      name: 'Enterprise',
      price: 499,
      billing: 'monthly',
      description: 'Complete solution for large organizations',
      features: [
        'All 30 services',
        'Unlimited API calls',
        'Premium local models',
        '24/7 dedicated support',
        'Real-time analytics',
        'Custom model training',
        'Advanced security',
        'SLA guarantee',
        'Dedicated account manager'
      ],
      limits: {
        apiCalls: 'unlimited',
        services: 30,
        storage: '100GB',
        teamMembers: 'unlimited'
      },
      popular: false
    }
  },

  // Per-use pricing for overages
  overagePricing: {
    starter: {
      apiCall: 0.05,
      storageGB: 10
    },
    pro: {
      apiCall: 0.03,
      storageGB: 5
    },
    enterprise: {
      apiCall: 0.01,
      storageGB: 2
    }
  },

  // Service-specific pricing (included in subscription, extra for overages)
  servicePricing: {
    // Content Generation
    'seo-article-generator': { starter: 15, pro: 10, enterprise: 5 },
    'social-post-creator': { starter: 2, pro: 1.5, enterprise: 1 },
    'product-description-writer': { starter: 5, pro: 3, enterprise: 2 },
    'email-newsletter-generator': { starter: 25, pro: 20, enterprise: 15 },
    'blog-post-outliner': { starter: 3, pro: 2, enterprise: 1 },
    'video-script-writer': { starter: 10, pro: 7, enterprise: 5 },
    'press-release-generator': { starter: 50, pro: 40, enterprise: 30 },
    'landing-page-copy': { starter: 20, pro: 15, enterprise: 10 },

    // Data Processing
    'document-summarizer': { starter: 1, pro: 0.75, enterprise: 0.5 },
    'data-extractor': { starter: 2, pro: 1.5, enterprise: 1 },
    'sentiment-analyzer': { starter: 0.5, pro: 0.35, enterprise: 0.25 },
    'keyword-researcher': { starter: 10, pro: 7, enterprise: 5 },
    'competitor-analyzer': { starter: 100, pro: 75, enterprise: 50 },
    'form-processor': { starter: 1, pro: 0.75, enterprise: 0.5 },
    'invoice-processor': { starter: 3, pro: 2, enterprise: 1.5 },
    'survey-analyzer': { starter: 20, pro: 15, enterprise: 10 },

    // Business Automation
    'lead-qualifier': { starter: 2, pro: 1.5, enterprise: 1 },
    'appointment-scheduler': { starter: 1, pro: 0.75, enterprise: 0.5 },
    'follow-up-automator': { starter: 5, pro: 3, enterprise: 2 },
    'ticket-triage': { starter: 2, pro: 1.5, enterprise: 1 },
    'inventory-optimizer': { starter: 50, pro: 35, enterprise: 25 },
    'price-optimizer': { starter: 25, pro: 20, enterprise: 15 },
    'email-automator': { starter: 15, pro: 10, enterprise: 7 },
    'report-generator': { starter: 10, pro: 7, enterprise: 5 },

    // Development & Tech
    'code-reviewer': { starter: 20, pro: 15, enterprise: 10 },
    'api-doc-generator': { starter: 30, pro: 25, enterprise: 20 },
    'test-generator': { starter: 5, pro: 3, enterprise: 2 },
    'bug-detector': { starter: 15, pro: 10, enterprise: 7 },
    'database-optimizer': { starter: 100, pro: 75, enterprise: 50 },
    'security-auditor': { starter: 200, pro: 150, enterprise: 100 }
  },

  // Annual discount
  annualDiscount: 0.2, // 20% off for annual billing

  // Promotional codes
  promoCodes: {
    'LAUNCH20': { discount: 0.2, duration: 'once', expires: '2025-01-01' },
    'STARTUP50': { discount: 0.5, duration: 3, expires: '2024-12-31' }, // 50% off for 3 months
    'ENTERPRISE30': { discount: 0.3, duration: 'repeating', minTier: 'enterprise' }
  },

  // Usage-based discounts
  volumeDiscounts: [
    { threshold: 10000, discount: 0.1 }, // 10% off after 10k calls
    { threshold: 50000, discount: 0.15 }, // 15% off after 50k calls
    { threshold: 100000, discount: 0.2 } // 20% off after 100k calls
  ],

  // Calculate price with discounts
  calculatePrice(tier, billing = 'monthly', promoCode = null, usage = 0) {
    let price = this.tiers[tier].price;
    
    // Apply annual discount
    if (billing === 'annual') {
      price = price * 12 * (1 - this.annualDiscount);
    } else {
      price = price * 12; // Show annual equivalent
    }

    // Apply promo code
    if (promoCode && this.promoCodes[promoCode]) {
      const promo = this.promoCodes[promoCode];
      if (!promo.expires || new Date(promo.expires) > new Date()) {
        if (!promo.minTier || this.compareTiers(tier, promo.minTier) >= 0) {
          price = price * (1 - promo.discount);
        }
      }
    }

    // Apply volume discount
    const volumeDiscount = this.getVolumeDiscount(usage);
    price = price * (1 - volumeDiscount);

    return Math.round(price * 100) / 100;
  },

  // Compare tiers
  compareTiers(tier1, tier2) {
    const tierOrder = { starter: 0, pro: 1, enterprise: 2 };
    return tierOrder[tier1] - tierOrder[tier2];
  },

  // Get volume discount
  getVolumeDiscount(usage) {
    const discount = this.volumeDiscounts
      .filter(d => usage >= d.threshold)
      .sort((a, b) => b.threshold - a.threshold)[0];
    
    return discount ? discount.discount : 0;
  },

  // Calculate overage costs
  calculateOverages(tier, usage) {
    const limits = this.tiers[tier].limits;
    const overages = {};
    
    if (limits.apiCalls !== 'unlimited' && usage.apiCalls > limits.apiCalls) {
      overages.apiCalls = (usage.apiCalls - limits.apiCalls) * this.overagePricing[tier].apiCall;
    }
    
    if (usage.storage > parseInt(limits.storage)) {
      overages.storage = (usage.storage - parseInt(limits.storage)) * this.overagePricing[tier].storageGB;
    }
    
    return overages;
  },

  // Get service pricing for tier
  getServicePrice(serviceId, tier) {
    return this.servicePricing[serviceId]?.[tier] || 0;
  },

  // Export pricing for frontend
  export() {
    return {
      tiers: this.tiers,
      annualDiscount: this.annualDiscount,
      volumeDiscounts: this.volumeDiscounts
    };
  }
};

module.exports = pricingConfig;
