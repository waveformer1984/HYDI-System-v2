/**
 * Stripe Webhook Handler - Payment → Tier Assignment
 * The only part that matters: money → access
 */

const Stripe = require('stripe');
const { supabase } = require('../database');

// eslint-disable-next-line no-unused-vars -- kept as-is pending maintainer decision on this file's structure (see CLAUDE.md)
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

class StripeWebhookHandler {
  async handleEvent(event) {
    console.log(`[WEBHOOK] Processing ${event.type}`);
    
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object);
        break;
        
      case 'invoice.payment_succeeded':
        await this.handlePaymentSucceeded(event.data.object);
        break;
        
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionChange(event.data.object);
        break;
        
      case 'customer.subscription.deleted':
        await this.handleSubscriptionCanceled(event.data.object);
        break;
        
      default:
        console.log(`[WEBHOOK] Unhandled event type: ${event.type}`);
    }
  }
  
  async handleCheckoutCompleted(session) {
    // New user checkout - create user record
    const { customer_id, metadata } = session;
    const email = metadata?.email || session.customer_details?.email;
    const tier = this.getTierFromPriceId(session.display_items?.[0]?.price?.id);
    
    console.log(`[WEBHOOK] New checkout: ${customer_id} → ${tier}`);
    
    // Upsert user
    const { data: user, error: userError } = await supabase
      .from('users')
      .upsert({
        email,
        stripe_customer_id: customer_id,
        tier,
        subscription_status: 'active'
      }, {
        onConflict: 'stripe_customer_id'
      })
      .select()
      .single();
      
    if (userError) {
      console.error('[WEBHOOK] User creation failed:', userError);
      throw userError;
    }
    
    // Generate API key for immediate access
    await this.generateAPIKey(user.id, tier);
    
    console.log(`[WEBHOOK] User created: ${user.id} (${tier})`);
  }
  
  async handlePaymentSucceeded(invoice) {
    // Payment succeeded - ensure subscription is active
    const { customer } = invoice;
    
    const { data: user, error } = await supabase
      .from('users')
      .update({ 
        subscription_status: 'active',
        updated_at: new Date().toISOString()
      })
      .eq('stripe_customer_id', customer)
      .select()
      .single();
      
    if (error) {
      console.error('[WEBHOOK] Payment update failed:', error);
      return;
    }
    
    console.log(`[WEBHOOK] Payment confirmed: ${customer} → ${user.tier}`);
  }
  
  async handleSubscriptionChange(subscription) {
    // Subscription tier change
    const { customer, id: subscription_id, status, items } = subscription;
    const price_id = items?.data?.[0]?.price?.id;
    const tier = this.getTierFromPriceId(price_id);
    
    const { data: user, error } = await supabase
      .from('users')
      .update({ 
        tier,
        stripe_subscription_id: subscription_id,
        subscription_status: status,
        updated_at: new Date().toISOString()
      })
      .eq('stripe_customer_id', customer)
      .select()
      .single();
      
    if (error) {
      console.error('[WEBHOOK] Subscription update failed:', error);
      return;
    }
    
    // Update API key tier
    await this.updateAPIKeyTier(user.id, tier);
    
    console.log(`[WEBHOOK] Subscription updated: ${customer} → ${tier} (${status})`);
  }
  
  async handleSubscriptionCanceled(subscription) {
    // Subscription canceled - downgrade to starter
    const { customer } = subscription;
    
    const { data: user, error } = await supabase
      .from('users')
      .update({ 
        tier: 'starter',
        subscription_status: 'canceled',
        updated_at: new Date().toISOString()
      })
      .eq('stripe_customer_id', customer)
      .select()
      .single();
      
    if (error) {
      console.error('[WEBHOOK] Cancellation failed:', error);
      return;
    }
    
    // Update API key tier
    await this.updateAPIKeyTier(user.id, 'starter');
    
    console.log(`[WEBHOOK] Subscription canceled: ${customer} → starter`);
  }
  
  getTierFromPriceId(priceId) {
    const priceMap = {
      [process.env.STRIPE_HYDI_STARTER_PRICE_ID]: 'starter',
      [process.env.STRIPE_HYDI_PRO_PRICE_ID]: 'pro',
      [process.env.STRIPE_HYDI_ENTERPRISE_PRICE_ID]: 'enterprise'
    };
    
    return priceMap[priceId] || 'starter';
  }
  
  async generateAPIKey(userId, tier) {
    const crypto = require('crypto');
    const key = crypto.randomBytes(32).toString('hex');
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    
    const { error } = await supabase
      .from('api_keys')
      .insert({
        user_id: userId,
        key_hash: keyHash,
        name: 'Default API Key',
        tier,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() // 1 year
      });
      
    if (error) {
      console.error('[WEBHOOK] API key creation failed:', error);
      return null;
    }
    
    console.log(`[WEBHOOK] API key generated for user ${userId}`);
    return key;
  }
  
  async updateAPIKeyTier(userId, tier) {
    const { error } = await supabase
      .from('api_keys')
      .update({ tier })
      .eq('user_id', userId);
      
    if (error) {
      console.error('[WEBHOOK] API key tier update failed:', error);
    }
  }
}

module.exports = StripeWebhookHandler;
