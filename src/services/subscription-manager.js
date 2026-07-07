/**
 * Subscription Manager for Ursula Service Bundle
 * Handles Stripe integration, billing, and subscription lifecycle
 */

const Stripe = require('stripe');
// const UrsulaServiceBundle = require('../../modules/ursula-service-bundle'); // Temporarily disabled due to syntax errors
const { supabase } = require('../database');

class SubscriptionManager {
  constructor() {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      console.warn('[SubscriptionManager] STRIPE_SECRET_KEY not set — Stripe features disabled');
    }
    this.stripe = stripeKey ? new Stripe(stripeKey) : null;
    // this.serviceBundle = new UrsulaServiceBundle(); // Temporarily disabled
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers for the service bundle
   */
  setupEventHandlers() {
    // this.serviceBundle.on('service_used', async (data) => {
    //   await this.recordServiceUsage(data);
    // });

    // this.serviceBundle.on('subscription_created', async (data) => {
    //   await this.handleNewSubscription(data);
    // });

    // this.serviceBundle.on('marketing_content_generated', async (data) => {
    //   await this.publishMarketingContent(data);
    // });
  }

  /**
   * Create Stripe checkout session for subscription
   */
  async createCheckoutSession(customerId, tier, successUrl, cancelUrl) {
    const priceMap = {
      starter: process.env.STRIPE_HYDI_STARTER_PRICE_ID,
      pro: process.env.STRIPE_HYDI_PRO_PRICE_ID,
      enterprise: process.env.STRIPE_HYDI_ENTERPRISE_PRICE_ID
    };

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price: priceMap[tier],
        quantity: 1
      }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        tier
      },
      // TAX/VAT PLUMBING: Automatic tax calculation for global compliance
      automatic_tax: {
        enabled: true
      },
      // Collect billing address for tax calculation
      billing_address_collection: 'required',
      // Collect shipping address if needed (for physical goods - not needed for SaaS)
      // shipping_address_collection: { allowed_countries: ['US', 'CA'] }
    });

    return session;
  }

  /**
   * Create customer portal session
   */
  async createPortalSession(customerId) {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.BASE_URL}/account`
    });

    return session;
  }

  /**
   * Record service usage in database
   */
  async recordServiceUsage(data) {
    try {
      const { error } = await supabase
        .from('service_usage')
        .insert({
          id: require('uuid').v4(),
          subscription_id: data.subscriptionId,
          service_id: data.serviceId,
          usage_count: data.usage,
          revenue: data.revenue,
          created_at: data.timestamp
        });

      if (error) throw error;
    } catch (error) {
      console.error('Failed to record usage:', error);
    }
  }

  /**
   * Handle new subscription - with 30-service permission matrix
   */
  async handleNewSubscription(data) {
    // Generate API key with service permissions
    const apiKey = await this.generateApiKey(data.customerId, data.subscriptionId, data.tier);
    
    // DEATH LOOP GUARD: Each Heidi trigger is isolated - one failure doesn't kill the others
    // IMMEDIATE: Send "Keys to the Kingdom" API key delivery
    // This fires the MILLISECOND Stripe checkout.session.completed hook processes
    try {
      await this.triggerHeidiWorkflow('api_key_delivery', {
        customerId: data.customerId,
        tier: data.tier,
        subscriptionId: data.subscriptionId,
        apiKey: apiKey.key,
        apiKeyMasked: `${apiKey.key.substring(0, 8)}...${apiKey.key.substring(apiKey.key.length - 8)}`,
        servicesCount: apiKey.permissions.serviceIds.length,
        priorityAccess: apiKey.permissions.priorityAccess,
        apiLimit: apiKey.permissions.apiLimit,
        dashboardUrl: `${process.env.BASE_URL}/dashboard`,
        apiDocsUrl: `${process.env.BASE_URL}/docs/api`
      });
    } catch (heidiError) {
      console.error(`[DEATH LOOP GUARD] Heidi API key delivery failed for ${data.customerId}:`, heidiError.message);
      // Customer still gets API key - they can find it in dashboard later
    }

    // Send welcome email through Heidi (separate from API key delivery)
    try {
      await this.triggerHeidiWorkflow('welcome_sequence', {
        customerId: data.customerId,
        tier: data.tier,
        subscriptionId: data.subscriptionId,
        apiKey: apiKey.key
      });
    } catch (heidiError) {
      console.error(`[DEATH LOOP GUARD] Heidi welcome sequence failed for ${data.customerId}:`, heidiError.message);
      // Customer still has working subscription - welcome email is non-critical
    }

    // Schedule onboarding emails
    try {
      await this.scheduleOnboarding(data);
    } catch (heidiError) {
      console.error(`[DEATH LOOP GUARD] Heidi onboarding scheduling failed for ${data.customerId}:`, heidiError.message);
      // Onboarding is delayed but subscription is still active
    }
    
    console.log(`[SUBSCRIPTION] New ${data.tier} subscription created for ${data.customerId} with API key ${apiKey.hash.substring(0, 8)}...`);
    console.log(`[HEIDI] 'Keys to the Kingdom' API key delivery triggered immediately for ${data.customerId}`);
  }

  /**
   * Generate API key with 30-service permission matrix
   */
  async generateApiKey(customerId, subscriptionId, tier) {
    const crypto = require('crypto');
    
    // LOCKED: 30-service permission matrix
    const servicePermissions = {
      starter: {
        serviceIds: [1, 2, 3, 4, 5, 6, 7, 8], // Services 1-8
        priorityAccess: false,
        apiLimit: 1000
      },
      pro: {
        serviceIds: Array.from({length: 20}, (_, i) => i + 1), // Services 1-20
        priorityAccess: false,
        apiLimit: 10000
      },
      enterprise: {
        serviceIds: Array.from({length: 30}, (_, i) => i + 1), // All 30 services
        priorityAccess: true,
        apiLimit: Infinity
      }
    };
    
    const permissions = servicePermissions[tier];
    
    // Generate secure API key
    const key = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    
    // Store in Ursula DB
    try {
      await supabase
        .from('api_keys')
        .insert({
          id: require('uuid').v4(),
          subscription_id: subscriptionId,
          customer_id: customerId,
          key_hash: hash,
          name: `${tier.charAt(0).toUpperCase() + tier.slice(1)} API Key`,
          permissions: permissions,
          tier: tier,
          created_at: new Date(),
          expires_at: null // No expiration for active subscriptions
        });
      
      // Update subscription with permissions
      await supabase
        .from('subscriptions')
        .update({
          service_permissions: permissions,
          api_key_hash: hash,
          updated_at: new Date()
        })
        .eq('subscription_id', subscriptionId);
      
      console.log(`[API KEY] Generated ${tier} key with ${permissions.serviceIds.length} services`);
      
      return { key, hash, permissions };
    } catch (error) {
      console.error('Failed to store API key:', error);
      throw error;
    }
  }

  /**
   * Trigger Heidi workflow - DEATH LOOP GUARD at method level
   * All Heidi triggers go through here - if Heidi is down, callers are protected
   */
  async triggerHeidiWorkflow(workflow, data) {
    try {
      // This would integrate with Heidi's workflow system
      console.log(`[HEIDI] Triggering workflow: ${workflow} for ${data.customerId || 'unknown'}`);
      
      // Store in database for Heidi to process
      const { error } = await supabase
        .from('heidi_tasks')
        .insert({
          id: require('uuid').v4(),
          workflow,
          data,
          status: 'pending',
          created_at: new Date()
        });

      if (error) throw error;
      
      console.log(`[HEIDI] Workflow ${workflow} queued successfully`);
    } catch (error) {
      // DEATH LOOP GUARD: Log but NEVER throw - Heidi failures must not crash callers
      console.error(`[DEATH LOOP GUARD] Heidi workflow '${workflow}' failed:`, error.message);
      console.error(`[DEATH LOOP GUARD] Workflow data:`, JSON.stringify(data, null, 2));
      // Swallow the error - callers assume success and continue processing
      // Heidi tasks can be manually replayed from logs if needed
    }
  }

  /**
   * Schedule onboarding sequence
   */
  async scheduleOnboarding(subscriptionData) {
    const onboardingSteps = [
      { delay: 0, template: 'welcome', type: 'email' },
      { delay: 24 * 60 * 60 * 1000, template: 'getting_started', type: 'email' },
      { delay: 3 * 24 * 60 * 60 * 1000, template: 'pro_tips', type: 'email' },
      { delay: 7 * 24 * 60 * 60 * 1000, template: 'advanced_features', type: 'email' }
    ];

    for (const step of onboardingSteps) {
      setTimeout(async () => {
        await this.triggerHeidiWorkflow('send_email', {
          customerId: subscriptionData.customerId,
          template: step.template,
          tier: subscriptionData.tier
        });
      }, step.delay);
    }
  }

  /**
   * Publish marketing content
   */
  async publishMarketingContent(data) {
    // Store marketing content for publication
    try {
      const { error } = await supabase
        .from('marketing_queue')
        .insert({
          id: require('uuid').v4(),
          content: data.content,
          platform: data.platform,
          status: 'scheduled',
          created_at: data.timestamp
        });

      if (error) throw error;
    } catch (error) {
      console.error('Failed to queue marketing content:', error);
    }
  }

  /**
   * Get subscription analytics
   */
  async getSubscriptionAnalytics() {
    try {
      const { data: subscriptions, error } = await supabase
        .from('subscriptions')
        .select('*');

      if (error) throw error;

      const analytics = {
        total: subscriptions.length,
        byTier: {
          starter: subscriptions.filter(s => s.tier === 'starter').length,
          pro: subscriptions.filter(s => s.tier === 'pro').length,
          enterprise: subscriptions.filter(s => s.tier === 'enterprise').length
        },
        mrr: 0,
        services: {}
      };

      // Calculate MRR
      const tierPrices = { starter: 49, pro: 149, enterprise: 499 };
      analytics.mrr = subscriptions.reduce((total, sub) => {
        return total + (tierPrices[sub.tier] || 0);
      }, 0);

      // Get service usage
      const { data: usage } = await supabase
        .from('service_usage')
        .select('service_id, usage_count, revenue');

      if (usage) {
        usage.forEach(u => {
          if (!analytics.services[u.service_id]) {
            analytics.services[u.service_id] = { usage: 0, revenue: 0 };
          }
          analytics.services[u.service_id].usage += u.usage_count;
          analytics.services[u.service_id].revenue += u.revenue;
        });
      }

      return analytics;
    } catch (error) {
      console.error('Failed to get analytics:', error);
      return null;
    }
  }

  /**
   * Handle Stripe webhooks
   */
  async handleWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      event = this.stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.log(`Webhook signature verification failed:`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // DEATH LOOP GUARD: Isolate each event handler so one failure doesn't crash the engine
    try {
      switch (event.type) {
        case 'invoice.payment_failed':
          await this.handlePaymentFailure(event.data.object);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object);
          break;
        default:
          await this.serviceBundle.handleStripeWebhook(event);
      }
    } catch (handlerError) {
      // CRITICAL: Log but NEVER crash the webhook handler - Stripe will retry if needed
      console.error(`[DEATH LOOP GUARD] Webhook handler error (${event.type}):`, handlerError.message);
      console.error('[DEATH LOOP GUARD] Stack trace:', handlerError.stack);
      // Still return 200 to Stripe so it doesn't retry indefinitely
      // The error is logged for manual investigation
    }

    res.json({ received: true });
  }

  /**
   * Handle payment failure with Heidi intervention
   */
  async handlePaymentFailure(invoice) {
    const customerId = invoice.customer;
    const subscriptionId = invoice.subscription;
    
    console.log(`Payment failed for customer ${customerId}, subscription ${subscriptionId}`);
    
    // Get subscription details
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('stripe_subscription_id', subscriptionId)
      .single();
    
    if (subscription) {
      // DEATH LOOP GUARD: Heidi trigger isolated - failure here must NOT crash webhook
      try {
        // Trigger Heidi's payment recovery workflow
        await this.triggerHeidiWorkflow('payment_recovery', {
          customerId,
          subscriptionId: subscription.subscription_id,
          tier: subscription.tier,
          amount: invoice.amount_due / 100,
          nextPaymentAttempt: new Date(invoice.next_payment_attempt * 1000)
        });
      } catch (heidiError) {
        console.error(`[DEATH LOOP GUARD] Heidi payment recovery failed for ${customerId}:`, heidiError.message);
        // Continue processing - Stripe webhook succeeds even if Heidi notification fails
      }
      
      // Update subscription status (critical - always try this even if Heidi fails)
      try {
        await supabase
          .from('subscriptions')
          .update({
            status: 'payment_failed',
            payment_failed_at: new Date(),
            updated_at: new Date()
          })
          .eq('subscription_id', subscription.subscription_id);
      } catch (dbError) {
        console.error(`[DEATH LOOP GUARD] DB update failed for payment failure ${subscription.subscription_id}:`, dbError.message);
        // Log but don't crash - subscription status may be stale but engine stays alive
      }
    }
  }

  /**
   * Handle subscription deletion with final recovery
   */
  async handleSubscriptionDeleted(subscription) {
    const customerId = subscription.customer;
    
    console.log(`Subscription deleted for customer ${customerId}`);
    
    // Get customer details
    const { data: customerSub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('stripe_customer_id', customerId)
      .eq('status', 'active')
      .single();
    
    if (customerSub) {
      // DEATH LOOP GUARD: Heidi trigger isolated - failure must NOT crash subscription deletion processing
      try {
        // Trigger final recovery attempt
        await this.triggerHeidiWorkflow('payment_recovery', {
          customerId,
          subscriptionId: customerSub.subscription_id,
          tier: customerSub.tier,
          finalAttempt: true
        });
      } catch (heidiError) {
        console.error(`[DEATH LOOP GUARD] Heidi final recovery failed for ${customerId}:`, heidiError.message);
        // Continue processing - subscription deletion succeeds even if Heidi notification fails
      }
    }
  }

  /**
   * Upgrade/downgrade subscription
   */
  async updateSubscription(subscriptionId, newTier) {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    
    const priceMap = {
      starter: 'price_1Oxxxx',
      pro: 'price_1Oyyyy',
      enterprise: 'price_1Ozzzz'
    };

    const updatedSubscription = await this.stripe.subscriptions.update(subscriptionId, {
      items: [{
        id: subscription.items.data[0].id,
        price: priceMap[newTier]
      }],
      proration_behavior: 'create_prorations'
    });

    // Update local records
    try {
      await supabase
        .from('subscriptions')
        .update({ tier: newTier })
        .eq('stripe_subscription_id', subscriptionId);
    } catch (error) {
      console.error('Failed to update local subscription:', error);
    }

    return updatedSubscription;
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(subscriptionId) {
    const subscription = await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true
    });

    // Update local records
    try {
      await supabase
        .from('subscriptions')
        .update({ 
          active: false,
          canceled_at: new Date()
        })
        .eq('stripe_subscription_id', subscriptionId);
    } catch (error) {
      console.error('Failed to cancel local subscription:', error);
    }

    return subscription;
  }

  /**
   * Get customer usage report
   */
  async getCustomerUsageReport(customerId) {
    try {
      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('customer_id', customerId)
        .single();

      if (!subscription) return null;

      const metrics = this.serviceBundle.getUsageMetrics(subscription.id);
      
      // Add billing information
      const stripeSubscription = await this.stripe.subscriptions.retrieve(
        subscription.stripe_subscription_id
      );

      return {
        subscription,
        usage: metrics,
        billing: {
          current_period_start: stripeSubscription.current_period_start,
          current_period_end: stripeSubscription.current_period_end,
          amount: stripeSubscription.items.data[0].amount
        }
      };
    } catch (error) {
      console.error('Failed to get usage report:', error);
      return null;
    }
  }
}

module.exports = SubscriptionManager;
