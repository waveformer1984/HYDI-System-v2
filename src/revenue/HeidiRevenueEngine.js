/**
 * HEIDI REVENUE ENGINE - Revenue First, Not Optional
 * If Heidi is not tied to revenue, it becomes a philosopher. You don't need that.
 * 
 * Immediate Monetization Stack:
 * 1. Stripe Integration - Products = tiers, Webhook = access control
 * 2. Offer Engine - Heidi generates landing pages, pricing tests, bundles
 * 3. Conversion Tracking - Page visits, clicks, purchases
 * 
 * ⚠️ Rule: If Heidi is not tied to revenue, it becomes a dead system with logs.
 */

const EventEmitter = require('events');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const { supabase } = require('../database');

class HeidiRevenueEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Revenue settings
      enableRevenueTracking: config.enableRevenueTracking !== false,
      enableAutoOffers: config.enableAutoOffers !== false,
      enableABTesting: config.enableABTesting !== false,
      
      // Stripe settings
      stripeSecretKey: config.stripeSecretKey || process.env.STRIPE_SECRET_KEY,
      stripeWebhookSecret: config.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET,
      
      // Offer generation settings
      offerGenerationInterval: config.offerGenerationInterval || 3600000, // 1 hour
      maxConcurrentOffers: config.maxConcurrentOffers || 10,
      offerValidityDuration: config.offerValidityDuration || 86400000, // 24 hours
      
      // Conversion tracking
      conversionTrackingWindow: config.conversionTrackingWindow || 1800000, // 30 minutes
      minConversionValue: config.minConversionValue || 1.0, // $1 minimum
      
      // Pricing tiers
      defaultTiers: config.defaultTiers || [
        {
          id: 'starter',
          name: 'Starter',
          price: 29,
          features: ['Basic AI access', '1000 requests/month', 'Email support'],
          limits: { requests: 1000, concurrency: 2 }
        },
        {
          id: 'pro',
          name: 'Professional',
          price: 99,
          features: ['Advanced AI access', '10000 requests/month', 'Priority support', 'API access'],
          limits: { requests: 10000, concurrency: 5 }
        },
        {
          id: 'enterprise',
          name: 'Enterprise',
          price: 299,
          features: ['Unlimited AI access', 'Custom models', 'Dedicated support', 'SLA'],
          limits: { requests: -1, concurrency: 20 }
        }
      ],
      
      ...config
    };
    
    // Revenue state
    this.revenue = {
      total: 0,
      today: 0,
      thisWeek: 0,
      thisMonth: 0,
      lastRevenue: null,
      conversionRate: 0,
      averageOrderValue: 0
    };
    
    // Active offers
    this.activeOffers = new Map();
    
    // Conversion tracking
    this.conversionTracking = new Map(); // sessionId -> tracking data
    
    // A/B tests
    this.abTests = new Map();
    
    // Customer segments
    this.segments = new Map();
    
    // Revenue metrics
    this.metrics = {
      offersGenerated: 0,
      offersConverted: 0,
      pageViews: 0,
      checkoutsStarted: 0,
      paymentsCompleted: 0,
      refunds: 0,
      chargebacks: 0
    };
    
    // Initialize
    this.initialize();
    
    console.log('[REVENUE ENGINE] Heidi Revenue Engine initialized');
    console.log(`[REVENUE ENGINE] Revenue tracking: ${this.config.enableRevenueTracking ? 'ENABLED' : 'DISABLED'}`);
    console.log(`[REVENUE ENGINE] Auto offers: ${this.config.enableAutoOffers ? 'ENABLED' : 'DISABLED'}`);
  }
  
  async initialize() {
    try {
      // Initialize Stripe products and prices
      await this.initializeStripeProducts();
      
      // Start revenue monitoring
      this.startRevenueMonitoring();
      
      // Start offer generation if enabled
      if (this.config.enableAutoOffers) {
        this.startOfferGeneration();
      }
      
      // Load existing offers
      await this.loadExistingOffers();
      
      // Start conversion tracking cleanup
      this.startConversionTrackingCleanup();
      
      console.log('[REVENUE ENGINE] Revenue engine initialized successfully');
      
    } catch (error) {
      console.error('[REVENUE ENGINE] Initialization failed:', error.message);
      throw error;
    }
  }
  
  /**
   * STRIPE INTEGRATION
   */
  
  async initializeStripeProducts() {
    console.log('[REVENUE ENGINE] Initializing Stripe products...');

    if (!stripe) {
      console.warn('[REVENUE ENGINE] STRIPE_SECRET_KEY not set — skipping Stripe product initialization');
      return;
    }

    try {
      // Create or update products for each tier
      for (const tier of this.config.defaultTiers) {
        await this.createOrUpdateStripeProduct(tier);
      }
      
      console.log(`[REVENUE ENGINE] Initialized ${this.config.defaultTiers.length} Stripe products`);
      
    } catch (error) {
      console.error('[REVENUE ENGINE] Stripe initialization failed:', error.message);
      throw error;
    }
  }
  
  async createOrUpdateStripeProduct(tier) {
    try {
      // Check if product exists
      const existingProducts = await stripe.products.list({
        limit: 100,
        active: true
      });
      
      const existingProduct = existingProducts.data.find(p => p.metadata.tierId === tier.id);
      
      let product;
      if (existingProduct) {
        // Update existing product
        product = await stripe.products.update(existingProduct.id, {
          name: tier.name,
          description: `HYDI ${tier.name} Plan`,
          metadata: {
            tierId: tier.id,
            features: tier.features.join(', ')
          }
        });
      } else {
        // Create new product
        product = await stripe.products.create({
          name: tier.name,
          description: `HYDI ${tier.name} Plan`,
          metadata: {
            tierId: tier.id,
            features: tier.features.join(', ')
          }
        });
      }
      
      // Create or update price
      const existingPrices = await stripe.prices.list({
        product: product.id,
        active: true,
        limit: 10
      });
      
      const existingPrice = existingPrices.data.find(p => p.unit_amount === tier.price * 100 && p.recurring?.interval === 'month');
      
      if (!existingPrice) {
        await stripe.prices.create({
          product: product.id,
          unit_amount: tier.price * 100, // Convert to cents
          currency: 'usd',
          recurring: {
            interval: 'month'
          },
          metadata: {
            tierId: tier.id
          }
        });
      }
      
      console.log(`[REVENUE ENGINE] Stripe product ready: ${tier.name} ($${tier.price}/month)`);
      
    } catch (error) {
      console.error(`[REVENUE ENGINE] Failed to create Stripe product for ${tier.name}:`, error.message);
      throw error;
    }
  }
  
  /**
   * OFFER ENGINE
   */
  
  async generateOffer(context = {}) {
    const offerId = `offer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`[REVENUE ENGINE] Generating offer: ${offerId}`);
      
      // Determine offer type based on context
      const offerType = this.determineOfferType(context);
      
      // Generate offer content
      const offer = await this.createOfferContent(offerType, context, offerId);
      
      // Set pricing
      offer.pricing = this.calculateOfferPricing(offerType, context);
      
      // Set validity
      offer.validUntil = new Date(Date.now() + this.config.offerValidityDuration).toISOString();
      
      // Create Stripe checkout session
      if (offer.pricing.price > 0) {
        offer.checkout = await this.createCheckoutSession(offer);
      }
      
      // Store offer
      this.activeOffers.set(offerId, offer);
      await this.storeOfferInDatabase(offer);
      
      // Update metrics
      this.metrics.offersGenerated++;
      
      // Emit offer generated
      this.emit('offer_generated', {
        offerId,
        offer,
        type: offerType,
        context
      });
      
      console.log(`[REVENUE ENGINE] Offer generated: ${offerId} (${offerType})`);
      
      return offer;
      
    } catch (error) {
      console.error(`[REVENUE ENGINE] Offer generation failed: ${offerId}:`, error.message);
      throw error;
    }
  }
  
  determineOfferType(context) {
    // Based on user behavior, time, and other factors
    if (context.isNewUser) return 'new_user';
    if (context.currentTier && context.currentTier !== 'enterprise') return 'upgrade';
    if (context.riskOfChurn) return 'retention';
    if (context.hasPurchased) return 'cross_sell';
    if (context.urgent) return 'flash_sale';
    
    // Default to upgrade offer
    return 'upgrade';
  }
  
  async createOfferContent(type, context, offerId) {
    const templates = {
      new_user: {
        title: 'Welcome to HYDI - Special Intro Offer',
        description: 'Get started with our AI-powered system at a special introductory price.',
        features: ['Full access to all AI models', 'Priority support', '30-day money back guarantee'],
        urgency: 'Limited time - Offer expires in 24 hours'
      },
      upgrade: {
        title: 'Upgrade Your HYDI Experience',
        description: 'Unlock more power and features with our professional tier.',
        features: ['Advanced AI capabilities', 'Higher limits', 'Priority support', 'API access'],
        urgency: 'Upgrade now and get 20% off your first month'
      },
      retention: {
        title: 'We Want You To Stay - Special Offer',
        description: 'Here\'s a special offer to keep you powered with HYDI.',
        features: ['All your current features', 'Bonus credits', 'Dedicated support'],
        urgency: 'Claim this offer before it expires'
      },
      cross_sell: {
        title: 'Expand Your HYDI Capabilities',
        description: 'Add powerful features to your existing plan.',
        features: ['Advanced analytics', 'Custom integrations', 'Team collaboration'],
        urgency: 'Add now and save'
      },
      flash_sale: {
        title: '⚡ FLASH SALE - Limited Time',
        description: 'Incredible deal on HYDI Pro - Act fast!',
        features: ['Everything in Pro', 'Bonus features', 'Priority support'],
        urgency: 'Ends in 2 hours - Don\'t miss out!'
      }
    };
    
    const template = templates[type] || templates.upgrade;
    
    // Personalize based on context
    let title = template.title;
    let description = template.description;
    
    if (context.userName) {
      title = `${context.userName}, ${title.toLowerCase()}`;
    }
    
    if (context.currentTier) {
      description = description.replace('your existing plan', `your ${context.currentTier} plan`);
    }
    
    return {
      id: offerId,
      type,
      title,
      description,
      features: template.features,
      urgency: template.urgency,
      landingPage: await this.generateLandingPage(type, context),
      emailTemplate: await this.generateEmailTemplate(type, context)
    };
  }
  
  calculateOfferPricing(type, context) {
    const basePricing = {
      new_user: { price: 19, discount: 35, originalPrice: 29 },
      upgrade: { price: 79, discount: 20, originalPrice: 99 },
      retention: { price: 69, discount: 30, originalPrice: 99 },
      cross_sell: { price: 49, discount: 0, originalPrice: 49 },
      flash_sale: { price: 59, discount: 40, originalPrice: 99 }
    };
    
    const pricing = basePricing[type] || basePricing.upgrade;
    
    // Adjust based on context
    if (context.isHighValueCustomer) {
      pricing.price *= 0.8; // 20% additional discount
    }
    
    if (context.urgent) {
      pricing.price *= 0.9; // 10% additional discount
    }
    
    return {
      ...pricing,
      currency: 'USD',
      interval: 'month',
      trialDays: type === 'new_user' ? 14 : 0
    };
  }
  
  async createCheckoutSession(offer) {
    try {
      const sessionParams = {
        payment_method_types: ['card'],
        mode: 'subscription',
        success_url: `${process.env.BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.BASE_URL}/offers/${offer.id}`,
        customer_email: offer.context?.email,
        metadata: {
          offerId: offer.id,
          offerType: offer.type
        },
        subscription_data: {
          metadata: {
            offerId: offer.id,
            offerType: offer.type
          }
        }
      };
      
      // Find the right price
      const prices = await stripe.prices.list({
        product: `prod_${offer.type}`, // This would need to be mapped properly
        active: true,
        limit: 10
      });
      
      const price = prices.data.find(p => p.unit_amount === offer.pricing.price * 100);
      
      if (price) {
        sessionParams.line_items = [{
          price: price.id,
          quantity: 1
        }];
      } else {
        // Create a new price
        const newPrice = await stripe.prices.create({
          unit_amount: offer.pricing.price * 100,
          currency: offer.pricing.currency,
          recurring: { interval: offer.pricing.interval },
          product_data: {
            name: offer.title,
            description: offer.description
          }
        });
        
        sessionParams.line_items = [{
          price: newPrice.id,
          quantity: 1
        }];
      }
      
      const session = await stripe.checkout.sessions.create(sessionParams);
      
      return {
        sessionId: session.id,
        url: session.url
      };
      
    } catch (error) {
      console.error('[REVENUE ENGINE] Checkout session creation failed:', error.message);
      throw error;
    }
  }
  
  /**
   * CONVERSION TRACKING
   */
  
  trackPageView(sessionId, pageData) {
    const tracking = this.conversionTracking.get(sessionId) || {
      sessionId,
      startTime: Date.now(),
      pageViews: [],
      events: [],
      converted: false
    };
    
    tracking.pageViews.push({
      timestamp: Date.now(),
      page: pageData.page,
      url: pageData.url,
      referrer: pageData.referrer,
      userAgent: pageData.userAgent
    });
    
    this.conversionTracking.set(sessionId, tracking);
    this.metrics.pageViews++;
    
    this.emit('page_view_tracked', { sessionId, pageData });
  }
  
  trackEvent(sessionId, eventType, eventData) {
    const tracking = this.conversionTracking.get(sessionId);
    if (!tracking) return;
    
    tracking.events.push({
      timestamp: Date.now(),
      type: eventType,
      data: eventData
    });
    
    // Special handling for conversion events
    if (eventType === 'checkout_started') {
      this.metrics.checkoutsStarted++;
    }
    
    if (eventType === 'payment_completed') {
      this.handleConversion(sessionId, eventData);
    }
    
    this.emit('event_tracked', { sessionId, eventType, eventData });
  }
  
  async handleConversion(sessionId, eventData) {
    const tracking = this.conversionTracking.get(sessionId);
    if (!tracking) return;
    
    tracking.converted = true;
    tracking.conversionData = eventData;
    tracking.conversionTime = Date.now();
    
    // Update metrics
    this.metrics.paymentsCompleted++;
    this.metrics.offersConverted++;
    
    // Update revenue
    const amount = eventData.amount || 0;
    this.updateRevenue(amount);
    
    // Calculate conversion rate
    this.updateConversionRate();
    
    // Store conversion in database
    await this.storeConversionInDatabase(tracking);
    
    // Emit conversion event
    this.emit('conversion_completed', {
      sessionId,
      tracking,
      amount,
      conversionTime: tracking.conversionTime - tracking.startTime
    });
    
    console.log(`[REVENUE ENGINE] Conversion tracked: ${sessionId} ($${amount})`);
  }
  
  updateRevenue(amount) {
    this.revenue.total += amount;
    this.revenue.today += amount;
    this.revenue.thisWeek += amount;
    this.revenue.thisMonth += amount;
    this.revenue.lastRevenue = {
      amount,
      timestamp: Date.now()
    };
    
    // Update average order value
    if (this.metrics.paymentsCompleted > 0) {
      this.revenue.averageOrderValue = this.revenue.total / this.metrics.paymentsCompleted;
    }
    
    // Emit revenue update
    this.emit('revenue_updated', {
      amount,
      total: this.revenue.total,
      averageOrderValue: this.revenue.averageOrderValue
    });
  }
  
  updateConversionRate() {
    const totalOffers = this.metrics.offersGenerated;
    const convertedOffers = this.metrics.offersConverted;
    
    this.revenue.conversionRate = totalOffers > 0 ? convertedOffers / totalOffers : 0;
  }
  
  /**
   * A/B TESTING
   */
  
  async createABTest(testConfig) {
    const testId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const test = {
      id: testId,
      name: testConfig.name,
      type: testConfig.type, // 'pricing', 'landing_page', 'email'
      variants: testConfig.variants,
      trafficSplit: testConfig.trafficSplit || 'equal',
      status: 'active',
      startTime: Date.now(),
      results: {
        participants: 0,
        conversions: {},
        revenue: {}
      }
    };
    
    // Initialize results for each variant
    for (const variant of test.variants) {
      test.results.conversions[variant.id] = 0;
      test.results.revenue[variant.id] = 0;
    }
    
    this.abTests.set(testId, test);
    await this.storeABTestInDatabase(test);
    
    this.emit('ab_test_created', { testId, test });
    
    console.log(`[REVENUE ENGINE] A/B test created: ${testId} (${test.name})`);
    
    return test;
  }
  
  assignVariant(testId, userId) {
    const test = this.abTests.get(testId);
    if (!test || test.status !== 'active') return null;
    
    // Simple hash-based assignment
    const hash = this.hashString(userId + testId);
    const variantIndex = hash % test.variants.length;
    const variant = test.variants[variantIndex];
    
    // Update participant count
    test.results.participants++;
    
    return variant;
  }
  
  recordABTestResult(testId, variantId, conversion, revenue = 0) {
    const test = this.abTests.get(testId);
    if (!test) return;
    
    if (conversion) {
      test.results.conversions[variantId]++;
      test.results.revenue[variantId] += revenue;
    }
    
    // Check if test should be concluded
    if (this.shouldConcludeTest(test)) {
      this.concludeABTest(testId);
    }
  }
  
  shouldConcludeTest(test) {
    const participants = test.results.participants;
    const totalConversions = Object.values(test.results.conversions).reduce((sum, count) => sum + count, 0);
    
    // Conclude if we have enough data
    return participants >= 1000 || (participants >= 100 && totalConversions >= 50);
  }
  
  concludeABTest(testId) {
    const test = this.abTests.get(testId);
    if (!test) return;
    
    test.status = 'concluded';
    test.endTime = Date.now();
    
    // Calculate winner
    const winner = this.calculateABTestWinner(test);
    test.winner = winner;
    
    this.emit('ab_test_concluded', { testId, test, winner });
    
    console.log(`[REVENUE ENGINE] A/B test concluded: ${testId} - Winner: ${winner.variantId}`);
  }
  
  calculateABTestWinner(test) {
    let winner = null;
    let bestConversionRate = 0;
    
    for (const variant of test.variants) {
      const conversions = test.results.conversions[variant.id];
      const participants = test.results.participants / test.variants.length; // Approximate
      const conversionRate = participants > 0 ? conversions / participants : 0;
      
      if (conversionRate > bestConversionRate) {
        bestConversionRate = conversionRate;
        winner = {
          variantId: variant.id,
          conversionRate,
          revenue: test.results.revenue[variant.id]
        };
      }
    }
    
    return winner;
  }
  
  /**
   * AUTOMATED OFFER GENERATION
   */
  
  startOfferGeneration() {
    const generateOffers = async () => {
      try {
        // Check if we should generate new offers
        if (this.activeOffers.size >= this.config.maxConcurrentOffers) {
          console.log('[REVENUE ENGINE] Max concurrent offers reached');
          return;
        }
        
        // Identify opportunities
        const opportunities = await this.identifyOfferOpportunities();
        
        // Generate offers for opportunities
        for (const opportunity of opportunities) {
          try {
            await this.generateOffer(opportunity.context);
          } catch (error) {
            console.error('[REVENUE ENGINE] Auto offer generation failed:', error.message);
          }
        }
        
      } catch (error) {
        console.error('[REVENUE ENGINE] Offer generation cycle failed:', error.message);
      }
      
      // Schedule next generation
      this._offerGenerationTimeout = setTimeout(generateOffers, this.config.offerGenerationInterval);
    };
    
    // Start offer generation
    generateOffers();
  }
  
  async identifyOfferOpportunities() {
    const opportunities = [];
    
    // Check for inactive users
    const inactiveUsers = await this.findInactiveUsers();
    for (const user of inactiveUsers) {
      opportunities.push({
        type: 'retention',
        priority: 'high',
        context: {
          userId: user.id,
          email: user.email,
          lastActive: user.last_active,
          riskOfChurn: true
        }
      });
    }
    
    // Check for users ready to upgrade
    const upgradeCandidates = await this.findUpgradeCandidates();
    for (const user of upgradeCandidates) {
      opportunities.push({
        type: 'upgrade',
        priority: 'medium',
        context: {
          userId: user.id,
          email: user.email,
          currentTier: user.tier,
          usage: user.usage
        }
      });
    }
    
    return opportunities;
  }
  
  async findInactiveUsers() {
    // This would query the database for users inactive for 30+ days
    // For now, return empty array
    return [];
  }
  
  async findUpgradeCandidates() {
    // This would query the database for users with high usage
    // For now, return empty array
    return [];
  }
  
  /**
   * REVENUE MONITORING
   */
  
  startRevenueMonitoring() {
    const monitor = async () => {
      try {
        // Reset daily counters at midnight
        const now = new Date();
        if (now.getHours() === 0 && now.getMinutes() === 0) {
          this.revenue.today = 0;
        }
        
        // Reset weekly counters on Sunday
        if (now.getDay() === 0 && now.getHours() === 0 && now.getMinutes() === 0) {
          this.revenue.thisWeek = 0;
        }
        
        // Reset monthly counters on 1st
        if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() === 0) {
          this.revenue.thisMonth = 0;
        }
        
        // Emit revenue status
        this.emit('revenue_status', {
          revenue: { ...this.revenue },
          metrics: { ...this.metrics }
        });
        
      } catch (error) {
        console.error('[REVENUE ENGINE] Revenue monitoring failed:', error.message);
      }
      
      // Schedule next monitoring
      this._monitorTimeout = setTimeout(monitor, 60000); // Every minute
    };
    
    // Start monitoring
    monitor();
  }
  
  /**
   * WEBHOOK HANDLERS
   */
  
  async handleStripeWebhook(event) {
    try {
      console.log(`[REVENUE ENGINE] Processing Stripe webhook: ${event.type}`);
      
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event.data.object);
          break;
          
        case 'invoice.payment_succeeded':
          await this.handlePaymentSucceeded(event.data.object);
          break;
          
        case 'invoice.payment_failed':
          await this.handlePaymentFailed(event.data.object);
          break;
          
        case 'customer.subscription.created':
          await this.handleSubscriptionCreated(event.data.object);
          break;
          
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object);
          break;
          
        default:
          console.log(`[REVENUE ENGINE] Unhandled webhook type: ${event.type}`);
      }
      
    } catch (error) {
      console.error('[REVENUE ENGINE] Webhook handling failed:', error.message);
      throw error;
    }
  }
  
  async handleCheckoutCompleted(session) {
    const offerId = session.metadata?.offerId;
    const offerType = session.metadata?.offerType;
    
    console.log(`[REVENUE ENGINE] Checkout completed: ${session.id} (offer: ${offerId})`);
    
    // Update offer status
    if (offerId && this.activeOffers.has(offerId)) {
      const offer = this.activeOffers.get(offerId);
      offer.status = 'converted';
      offer.convertedAt = Date.now();
      offer.checkoutSession = session;
    }
    
    // Store in database
    await this.storeCheckoutInDatabase(session);
    
    this.emit('checkout_completed', { session, offerId, offerType });
  }
  
  async handlePaymentSucceeded(invoice) {
    console.log(`[REVENUE ENGINE] Payment succeeded: ${invoice.id} ($${invoice.amount_paid / 100})`);
    
    // Update revenue
    const amount = invoice.amount_paid / 100;
    this.updateRevenue(amount);
    
    // Store in database
    await this.storePaymentInDatabase(invoice);
    
    this.emit('payment_succeeded', { invoice, amount });
  }
  
  async handlePaymentFailed(invoice) {
    console.log(`[REVENUE ENGINE] Payment failed: ${invoice.id}`);
    
    // Store in database
    await this.storePaymentInDatabase(invoice);
    
    this.emit('payment_failed', { invoice });
  }
  
  async handleSubscriptionCreated(subscription) {
    console.log(`[REVENUE ENGINE] Subscription created: ${subscription.id}`);
    
    // Store in database
    await this.storeSubscriptionInDatabase(subscription);
    
    this.emit('subscription_created', { subscription });
  }
  
  async handleSubscriptionDeleted(subscription) {
    console.log(`[REVENUE ENGINE] Subscription deleted: ${subscription.id}`);
    
    // Store in database
    await this.storeSubscriptionInDatabase(subscription);
    
    this.emit('subscription_deleted', { subscription });
  }
  
  /**
   * UTILITY METHODS
   */
  
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
  
  async generateLandingPage(type, _context) {
    // Generate landing page content
    const templates = {
      new_user: 'Welcome! Get started with HYDI AI at a special price.',
      upgrade: 'Upgrade to unlock more power and features.',
      retention: 'Special offer just for you - don\'t miss out!',
      cross_sell: 'Add these powerful features to your plan.',
      flash_sale: '⚡ Limited time deal - act fast!'
    };
    
    return {
      title: templates[type] || templates.upgrade,
      content: `Personalized offer based on your activity`,
      cta: 'Get Started Now',
      design: 'modern'
    };
  }
  
  async generateEmailTemplate(type, _context) {
    // Generate email template
    const templates = {
      new_user: {
        subject: 'Welcome to HYDI - Special Offer Inside',
        body: 'Thanks for joining! Here\'s a special offer to get you started.'
      },
      upgrade: {
        subject: 'Upgrade Your HYDI Experience',
        body: 'Ready for more power? Upgrade to unlock advanced features.'
      },
      retention: {
        subject: 'A Special Offer Just For You',
        body: 'We\'ve created a special offer to keep you powered with HYDI.'
      },
      cross_sell: {
        subject: 'Expand Your HYDI Capabilities',
        body: 'Add these powerful features to your existing plan.'
      },
      flash_sale: {
        subject: '⚡ FLASH SALE - Limited Time!',
        body: 'Incredible deal on HYDI - act fast before it\'s gone!'
      }
    };
    
    return templates[type] || templates.upgrade;
  }
  
  startConversionTrackingCleanup() {
    const cleanup = async () => {
      try {
        const now = Date.now();
        const cutoff = now - this.config.conversionTrackingWindow;
        
        // Clean up old tracking data
        for (const [sessionId, tracking] of this.conversionTracking) {
          if (tracking.startTime < cutoff) {
            this.conversionTracking.delete(sessionId);
          }
        }
        
      } catch (error) {
        console.error('[REVENUE ENGINE] Conversion tracking cleanup failed:', error.message);
      }
      
      // Schedule next cleanup
      this._cleanupTimeout = setTimeout(cleanup, 300000); // Every 5 minutes
    };
    
    // Start cleanup
    cleanup();
  }
  
  async loadExistingOffers() {
    if (this._offersDbDisabled) return; // schema absent — skip without spamming
    try {
      // Load existing offers from database
      const { data, error } = await supabase
        .from('offers')
        .select('*')
        .eq('status', 'active');

      if (error) throw error;

      for (const offer of data || []) {
        this.activeOffers.set(offer.offer_id, offer.offer_data);
      }

      console.log(`[REVENUE ENGINE] Loaded ${this.activeOffers.size} existing offers`);

    } catch (error) {
      // Disable offers DB access after the first failure (e.g. missing 'offers'
      // table) so it doesn't log every cycle. Apply the migration to enable it.
      this._offersDbDisabled = true;
      console.warn('[REVENUE ENGINE] Offers DB off (apply migration 20260617_heidi_orchestrator_schema.sql):', error.message);
    }
  }
  
  /**
   * DATABASE STORAGE
   */
  
  async storeOfferInDatabase(offer) {
    if (this._offersDbDisabled) return; // schema absent — skip without spamming
    try {
      const { error } = await supabase
        .from('offers')
        .insert({
          offer_id: offer.id,
          offer_data: offer,
          type: offer.type,
          status: 'active',
          created_at: new Date().toISOString()
        });

      if (error) throw error;

    } catch (error) {
      this._offersDbDisabled = true;
      console.warn('[REVENUE ENGINE] Offers DB off (apply migration 20260617_heidi_orchestrator_schema.sql):', error.message);
    }
  }
  
  async storeConversionInDatabase(tracking) {
    try {
      const { error } = await supabase
        .from('conversions')
        .insert({
          session_id: tracking.sessionId,
          conversion_data: tracking,
          created_at: new Date().toISOString()
        });
      
      if (error) throw error;
      
    } catch (error) {
      console.error('[REVENUE ENGINE] Failed to store conversion:', error.message);
    }
  }
  
  async storeABTestInDatabase(test) {
    try {
      const { error } = await supabase
        .from('ab_tests')
        .insert({
          test_id: test.id,
          test_data: test,
          created_at: new Date().toISOString()
        });
      
      if (error) throw error;
      
    } catch (error) {
      console.error('[REVENUE ENGINE] Failed to store A/B test:', error.message);
    }
  }
  
  async storeCheckoutInDatabase(session) {
    try {
      const { error } = await supabase
        .from('checkouts')
        .insert({
          session_id: session.id,
          session_data: session,
          created_at: new Date().toISOString()
        });
      
      if (error) throw error;
      
    } catch (error) {
      console.error('[REVENUE ENGINE] Failed to store checkout:', error.message);
    }
  }
  
  async storePaymentInDatabase(invoice) {
    try {
      const { error } = await supabase
        .from('payments')
        .insert({
          invoice_id: invoice.id,
          invoice_data: invoice,
          created_at: new Date().toISOString()
        });
      
      if (error) throw error;
      
    } catch (error) {
      console.error('[REVENUE ENGINE] Failed to store payment:', error.message);
    }
  }
  
  async storeSubscriptionInDatabase(subscription) {
    try {
      const { error } = await supabase
        .from('subscriptions')
        .insert({
          subscription_id: subscription.id,
          subscription_data: subscription,
          created_at: new Date().toISOString()
        });
      
      if (error) throw error;
      
    } catch (error) {
      console.error('[REVENUE ENGINE] Failed to store subscription:', error.message);
    }
  }
  
  /**
   * STATUS AND MONITORING
   */
  
  getStatus() {
    return {
      revenue: { ...this.revenue },
      metrics: { ...this.metrics },
      activeOffers: this.activeOffers.size,
      conversionTracking: this.conversionTracking.size,
      abTests: this.abTests.size,
      config: this.config
    };
  }
  
  getRevenueReport() {
    return {
      total: this.revenue.total,
      today: this.revenue.today,
      thisWeek: this.revenue.thisWeek,
      thisMonth: this.revenue.thisMonth,
      conversionRate: this.revenue.conversionRate,
      averageOrderValue: this.revenue.averageOrderValue,
      lastRevenue: this.revenue.lastRevenue,
      metrics: {
        offersGenerated: this.metrics.offersGenerated,
        offersConverted: this.metrics.offersConverted,
        pageViews: this.metrics.pageViews,
        checkoutsStarted: this.metrics.checkoutsStarted,
        paymentsCompleted: this.metrics.paymentsCompleted
      }
    };
  }
  
  async reset() {
    // Reset revenue
    this.revenue = {
      total: 0,
      today: 0,
      thisWeek: 0,
      thisMonth: 0,
      lastRevenue: null,
      conversionRate: 0,
      averageOrderValue: 0
    };
    
    // Reset metrics
    this.metrics = {
      offersGenerated: 0,
      offersConverted: 0,
      pageViews: 0,
      checkoutsStarted: 0,
      paymentsCompleted: 0,
      refunds: 0,
      chargebacks: 0
    };
    
    // Clear active offers
    this.activeOffers.clear();
    
    // Clear conversion tracking
    this.conversionTracking.clear();
    
    // Clear A/B tests
    this.abTests.clear();
    
    console.log('[REVENUE ENGINE] Reset completed');
  }
  
  /**
   * Stop all background timeout loops
   */
  stop() {
    if (this._offerGenerationTimeout) {
      clearTimeout(this._offerGenerationTimeout);
      this._offerGenerationTimeout = null;
    }
    if (this._monitorTimeout) {
      clearTimeout(this._monitorTimeout);
      this._monitorTimeout = null;
    }
    if (this._cleanupTimeout) {
      clearTimeout(this._cleanupTimeout);
      this._cleanupTimeout = null;
    }
  }
  
  /**
   * Full teardown
   */
  destroy() {
    this.stop();
    this.removeAllListeners();
  }
}

module.exports = HeidiRevenueEngine;
