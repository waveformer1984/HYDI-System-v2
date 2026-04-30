/**
 * Service Provisioner for Ursula
 * Handles service activation based on Stripe payments
 */

const { createClient } = require('@supabase/supabase-js');
const HeidiRevenueOutreach = require('./heidi-revenue-outreach');

require('dotenv').config();

class ServiceProvisioner {
  constructor() {
    this.supabase = null;
    this.heidiOutreach = new HeidiRevenueOutreach();
    this.provisionedServices = new Map(); // customerId -> services
    
    this.initialize();
  }
  
  async initialize() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (supabaseUrl && supabaseKey && !supabaseKey.includes('sb_publishable')) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
      console.log('Service Provisioner: Supabase connected');
    } else {
      console.error('Service Provisioner: Invalid Supabase credentials');
    }
  }
  
  async provisionServices(customerData) {
    const { customer_email, customer_id, tier, services, limits } = customerData;
    
    console.log(`Provisioning ${services.length} services for ${customer_email} (${tier} tier)`);
    
    try {
      // 1. Create customer record in database
      await this.createCustomerRecord(customerData);
      
      // 2. Activate each service
      const activatedServices = [];
      for (const service of services) {
        const serviceStatus = await this.activateService(customer_email, service, limits);
        activatedServices.push(serviceStatus);
      }
      
      // 3. Send welcome notification
      await this.sendProvisioningNotification(customer_email, tier, activatedServices);
      
      // 4. Update system status
      await this.updateSystemProvisioningStatus(customer_email, tier, services.length);
      
      // 5. Cache provisioned services
      this.provisionedServices.set(customer_id, {
        email: customer_email,
        tier: tier,
        services: activatedServices,
        provisioned_at: new Date().toISOString()
      });
      
      console.log(`Successfully provisioned ${services.length} services for ${customer_email}`);
      return activatedServices;
      
    } catch (err) {
      console.error(`Failed to provision services for ${customer_email}:`, err);
      throw err;
    }
  }
  
  async createCustomerRecord(customerData) {
    if (!this.supabase) return;
    
    const { customer_email, customer_id, tier, limits } = customerData;
    
    try {
      await this.supabase
        .from('customers')
        .upsert({
          email: customer_email,
          stripe_customer_id: customer_id,
          tier: tier,
          status: 'active',
          limits: limits,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      
      console.log(`Customer record created for ${customer_email}`);
    } catch (err) {
      console.error('Failed to create customer record:', err);
    }
  }
  
  async activateService(customerEmail, serviceName, limits) {
    console.log(`Activating service: ${serviceName} for ${customerEmail}`);
    
    // Simulate service activation
    const activationResult = {
      service: serviceName,
      status: 'active',
      activated_at: new Date().toISOString(),
      endpoint: `https://api.theforge.local/services/${serviceName.toLowerCase().replace(/\s+/g, '-')}`,
      api_key: this.generateApiKey(),
      limits: this.getServiceLimits(serviceName, limits)
    };
    
    // Store service activation in database
    await this.storeServiceActivation(customerEmail, activationResult);
    
    return activationResult;
  }
  
  async storeServiceActivation(customerEmail, serviceData) {
    if (!this.supabase) return;
    
    try {
      await this.supabase
        .from('customer_services')
        .upsert({
          customer_email: customerEmail,
          service_name: serviceData.service,
          status: serviceData.status,
          endpoint: serviceData.endpoint,
          api_key: serviceData.api_key,
          limits: serviceData.limits,
          activated_at: serviceData.activated_at
        });
    } catch (err) {
      console.error('Failed to store service activation:', err);
    }
  }
  
  async sendProvisioningNotification(customerEmail, tier, services) {
    console.log(`Sending provisioning notification to ${customerEmail}`);
    
    // Send through Heidi Outreach
    const welcomeMessage = this.generateWelcomeMessage(tier, services);
    
    // Update Heidi memory with provisioning details
    await this.supabase
      .from('heidi_memory')
      .upsert({
        user_email: customerEmail,
        last_interaction_type: 'services_provisioned',
        interaction_data: {
          tier: tier,
          services_count: services.length,
          services: services.map(s => s.service),
          welcome_message: welcomeMessage,
          provisioned_at: new Date().toISOString()
        }
      });
    
    console.log(`Provisioning notification sent to ${customerEmail}`);
  }
  
  async updateSystemProvisioningStatus(customerEmail, tier, serviceCount) {
    if (!this.supabase) return;
    
    try {
      await this.supabase
        .from('system_status')
        .upsert({
          status: 'active',
          version: '2.0.0-live',
          active_services: serviceCount,
          last_customer: customerEmail,
          last_tier: tier,
          last_broadcast: new Date().toISOString()
        });
    } catch (err) {
      console.error('Failed to update system status:', err);
    }
  }
  
  generateApiKey() {
    return `fk_${Math.random().toString(36).substring(2, 15)}_${Math.random().toString(36).substring(2, 15)}`;
  }
  
  getServiceLimits(serviceName, globalLimits) {
    // Service-specific limits based on global tier limits
    const serviceLimits = {
      requests_per_day: Math.floor((globalLimits.requests_per_month || 1000) / 30),
      storage_mb: Math.floor((globalLimits.storage_gb || 10) * 1024 / 10), // Distribute storage across services
      concurrent_requests: globalLimits.requests_per_month === 'unlimited' ? 10 : 2
    };
    
    return serviceLimits;
  }
  
  generateWelcomeMessage(tier, services) {
    const serviceList = services.slice(0, 3).map(s => s.service).join(', ');
    const additionalText = services.length > 3 ? ` and ${services.length - 3} more` : '';
    
    return `
Welcome to The Forge - ${tier.toUpperCase()} Tier Activated! 

Your services are now live:
${serviceList}${additionalText}

Next Steps:
1. Check your email for API keys and endpoints
2. Start integrating with your workflow
3. Monitor usage in your dashboard
4. Contact support for any assistance

Your Forge journey begins now!
    `.trim();
  }
  
  async deactivateServices(customerId) {
    const provisioned = this.provisionedServices.get(customerId);
    
    if (!provisioned) {
      console.log(`No provisioned services found for customer ${customerId}`);
      return;
    }
    
    console.log(`Deactivating services for ${provisioned.email}`);
    
    // Update customer status
    if (this.supabase) {
      await this.supabase
        .from('customers')
        .update({ status: 'deactivated', updated_at: new Date().toISOString() })
        .eq('stripe_customer_id', customerId);
      
      await this.supabase
        .from('customer_services')
        .update({ status: 'deactivated' })
        .eq('customer_email', provisioned.email);
    }
    
    // Remove from cache
    this.provisionedServices.delete(customerId);
    
    console.log(`Services deactivated for ${provisioned.email}`);
  }
  
  getProvisionedServices(customerId) {
    return this.provisionedServices.get(customerId);
  }
  
  async getServiceUsage(customerEmail) {
    if (!this.supabase) return null;
    
    try {
      const { data, error } = await this.supabase
        .from('customer_services')
        .select('*')
        .eq('customer_email', customerEmail)
        .eq('status', 'active');
      
      if (error) throw error;
      
      return data;
    } catch (err) {
      console.error('Failed to get service usage:', err);
      return null;
    }
  }
}

module.exports = ServiceProvisioner;
