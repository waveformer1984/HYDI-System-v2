/**
 * Heidi Revenue Outreach Logic
 * Monitors leads table and triggers automated welcome events
 */

const { createClient } = require('@supabase/supabase-js');
const HeidiServiceAutomator = require('./heidi-service-automator');
const { LocalModelAdapter } = require('./local-model-adapter');

require('dotenv').config();

class HeidiRevenueOutreach {
  constructor() {
    this.supabase = null;
    this.heidiServiceAutomator = null;
    this.localModelAdapter = null;
    this.isRunning = false;
    this.pollingInterval = null;
    
    this.initialize();
  }
  
  async initialize() {
    // Initialize Supabase
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (supabaseUrl && supabaseKey && !supabaseKey.includes('sb_publishable')) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
      console.log('Heidi Outreach: Supabase connected');
    } else {
      console.log('Heidi Outreach: Running in local mode');
    }
    
    // Initialize Heidi Automator
    try {
      this.heidiServiceAutomator = new HeidiServiceAutomator();
    } catch (error) {
      console.log('Heidi Outreach: Using EventEmitter fallback');
      const EventEmitter = require('events');
      this.heidiServiceAutomator = new EventEmitter();
    }
    
    // Initialize Local Model Adapter
    try {
      this.localModelAdapter = new LocalModelAdapter();
    } catch (error) {
      console.log('Heidi Outreach: Local Model Adapter unavailable');
    }
  }
  
  // Start monitoring leads table
  startMonitoring() {
    if (this.isRunning) {
      console.log('Heidi Outreach: Already monitoring');
      return;
    }
    
    console.log('Heidi Outreach: Starting lead monitoring...');
    this.isRunning = true;
    
    // Poll every 30 seconds for new leads
    this.pollingInterval = setInterval(() => {
      this.checkForNewLeads().catch(err => {
        console.error('Heidi Outreach: Lead check failed:', err.message);
      });
    }, 30000);
    
    // Initial check
    this.checkForNewLeads();
  }
  
  // Stop monitoring
  stopMonitoring() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isRunning = false;
    console.log('Heidi Outreach: Monitoring stopped');
  }
  
  // Check for new leads
  async checkForNewLeads() {
    if (!this.supabase) return;
    
    try {
      // Get leads from the last 5 minutes that haven't been processed
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      
      const { data: newLeads, error } = await this.supabase
        .from('leads')
        .select('*')
        .eq('source', 'heidi_broadcast')
        .gte('created_at', fiveMinutesAgo)
        .is('welcome_sent', null);
      
      if (error) {
        console.error('Heidi Outreach: Failed to fetch leads:', error.message);
        return;
      }
      
      if (newLeads && newLeads.length > 0) {
        console.log(`Heidi Outreach: Processing ${newLeads.length} new leads...`);
        
        for (const lead of newLeads) {
          await this.processNewLead(lead);
        }
      }
    } catch (err) {
      console.error('Heidi Outreach: Lead check exception:', err.message);
    }
  }
  
  // Process a new lead
  async processNewLead(lead) {
    try {
      console.log(`Heidi Outreach: Processing lead ${lead.email}...`);
      
      // 1. Create Heidi memory entry
      await this.createHeidiMemory(lead);
      
      // 2. Generate personalized welcome brief
      const welcomeBrief = await this.generateWelcomeBrief(lead);
      
      // 3. Send welcome event through Agent Bus
      await this.sendWelcomeEvent(lead, welcomeBrief);
      
      // 4. Mark lead as processed
      await this.markLeadProcessed(lead.id);
      
      console.log(`Heidi Outreach: Welcome sent to ${lead.email}`);
      
    } catch (err) {
      console.error(`Heidi Outreach: Failed to process lead ${lead.email}:`, err.message);
    }
  }
  
  // Create Heidi memory entry
  async createHeidiMemory(lead) {
    if (!this.supabase) return;
    
    try {
      await this.supabase
        .from('heidi_memory')
        .upsert({
          user_email: lead.email,
          last_interaction_type: 'welcome_outreach',
          interaction_data: {
            lead_id: lead.id,
            source: lead.source,
            metadata: lead.metadata,
            welcome_sent_at: new Date().toISOString()
          }
        });
    } catch (err) {
      console.warn('Heidi Outreach: Failed to create memory:', err.message);
    }
  }
  
  // Generate personalized welcome brief
  async generateWelcomeBrief(lead) {
    const tier = lead.metadata?.tier || 'starter';
    const interests = lead.metadata?.interests || [];
    
    let personalizedContent = `Welcome to the Forge! You're enrolled in our ${tier.toUpperCase()} tier.\n\n`;
    
    if (interests.length > 0) {
      personalizedContent += `Based on your interest in ${interests.join(', ')}, here's what you can expect:\n\n`;
      
      // Use Local Model Adapter if available for personalization
      if (this.localModelAdapter && interests.length > 0) {
        try {
          const prompt = `Generate a brief, personalized welcome message for a ${tier} tier customer interested in: ${interests.join(', ')}. Keep it under 100 words and focus on value.`;
          
          const response = await this.localModelAdapter.generateResponse(prompt, {
            model: 'gemini-1.5-flash', // Use AI Studio safety valve
            maxTokens: 150,
            temperature: 0.7
          });
          
          if (response && response.trim()) {
            personalizedContent = response.trim();
          }
        } catch (err) {
          console.warn('Heidi Outreach: Local Model Adapter failed, using template');
        }
      }
    } else {
      personalizedContent += 'Your journey into automated excellence begins now. Explore our 30+ services and watch your productivity soar.\n\n';
    }
    
    personalizedContent += `Next steps:\n`;
    personalizedContent += `1. Check your dashboard for service recommendations\n`;
    personalizedContent += `2. Explore our content and data automation tools\n`;
    personalizedContent += `3. Join our community for tips and best practices\n\n`;
    personalizedContent += `Welcome aboard! - Heidi @ The Forge`;
    
    return personalizedContent;
  }
  
  // Send welcome event through Agent Bus
  async sendWelcomeEvent(lead, welcomeBrief) {
    // Emit through Heidi Service Automator
    this.heidiServiceAutomator.emit('lead_welcome', {
      type: 'WELCOME_OUTREACH',
      lead: lead,
      message: welcomeBrief,
      timestamp: new Date().toISOString()
    });
    
    // Store in heidi_memory as well
    if (this.supabase) {
      try {
        await this.supabase
          .from('heidi_memory')
          .update({
            last_interaction_type: 'welcome_sent',
            interaction_data: {
              welcome_message: welcomeBrief,
              sent_at: new Date().toISOString()
            }
          })
          .eq('user_email', lead.email);
      } catch (err) {
        console.warn('Heidi Outreach: Failed to update memory with welcome:', err.message);
      }
    }
  }
  
  // Mark lead as processed
  async markLeadProcessed(leadId) {
    if (!this.supabase) return;
    
    try {
      await this.supabase
        .from('leads')
        .update({ welcome_sent: true })
        .eq('id', leadId);
    } catch (err) {
      console.warn('Heidi Outreach: Failed to mark lead processed:', err.message);
    }
  }
}

module.exports = HeidiRevenueOutreach;
