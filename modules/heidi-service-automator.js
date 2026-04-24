/**
 * Heidi Service Automator
 * Automates operations for the Ursula Service Bundle
 * Handles customer onboarding, support, and retention
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../src/database');

class HeidiServiceAutomator extends EventEmitter {
  constructor() {
    super();
    this.workflows = new Map();
    this.taskQueue = [];
    this.running = false;
    this.initializeWorkflows();
  }

  /**
   * Initialize all automated workflows
   */
  initializeWorkflows() {
    // Onboarding workflow
    this.workflows.set('welcome_sequence', {
      steps: [
        { delay: 0, action: 'send_welcome_email' },
        { delay: 5 * 60 * 1000, action: 'send_getting_started_guide' },
        { delay: 24 * 60 * 60 * 1000, action: 'send_first_service_recommendation' },
        { delay: 3 * 24 * 60 * 60 * 1000, action: 'send_pro_tips' },
        { delay: 7 * 24 * 60 * 60 * 1000, action: 'send_advanced_features' },
        { delay: 14 * 24 * 60 * 60 * 1000, action: 'request_feedback' }
      ]
    });

    // Engagement workflow
    this.workflows.set('engagement_boost', {
      steps: [
        { delay: 0, action: 'analyze_usage_patterns' },
        { delay: 1000, action: 'generate_personalized_recommendations' },
        { delay: 2000, action: 'send_engagement_email' }
      ]
    });

    // Usage-to-Upsell trigger workflow
    this.workflows.set('usage_to_upsell', {
      steps: [
        { delay: 0, action: 'check_usage_threshold' },
        { delay: 1000, action: 'analyze_top_services' },
        { delay: 2000, action: 'generate_upsell_pitch' },
        { delay: 3000, action: 'send_upsell_email' }
      ]
    });

    // Payment recovery workflow
    this.workflows.set('payment_recovery', {
      steps: [
        { delay: 0, action: 'initiate_grace_period' },
        { delay: 1000, action: 'prepare_recovery_offer' },
        { delay: 2000, action: 'send_grace_period_notice' },
        { delay: 24 * 60 * 60 * 1000, action: 'follow_up_recovery' },
        { delay: 3 * 24 * 60 * 60 * 1000, action: 'final_recovery_attempt' }
      ]
    });

    // API Key Delivery - "Keys to the Kingdom" immediate delivery
    this.workflows.set('api_key_delivery', {
      steps: [
        { delay: 0, action: 'send_api_key_email' },
        { delay: 5000, action: 'send_api_setup_guide' },
        { delay: 30000, action: 'send_first_api_example' }
      ]
    });

    // Retention workflow
    this.workflows.set('retention_warning', {
      steps: [
        { delay: 0, action: 'identify_at_risk_customers' },
        { delay: 1000, action: 'prepare_retention_offer' },
        { delay: 2000, action: 'send_retention_email' },
        { delay: 24 * 60 * 60 * 1000, action: 'follow_up_if_no_response' }
      ]
    });

    // Support workflow
    this.workflows.set('support_escalation', {
      steps: [
        { delay: 0, action: 'analyze_support_ticket' },
        { delay: 1000, action: 'suggest_solutions' },
        { delay: 2000, action: 'escalate_if_needed' },
        { delay: 5000, action: 'notify_customer' }
      ]
    });

    // Success workflow
    this.workflows.set('success_story', {
      steps: [
        { delay: 0, action: 'identify_success_metrics' },
        { delay: 1000, action: 'generate_case_study_outline' },
        { delay: 2000, action: 'request_customer_testimonial' },
        { delay: 7 * 24 * 60 * 60 * 1000, action: 'publish_success_story' }
      ]
    });
  }

  /**
   * Start the automator
   */
  start() {
    if (this.running) return;
    
    this.running = true;
    console.log('Heidi Service Automator started');
    
    // Process task queue
    this.processQueue();
    
    // Schedule periodic tasks
    this.schedulePeriodicTasks();
  }

  /**
   * Stop the automator
   */
  stop() {
    this.running = false;
    console.log('Heidi Service Automator stopped');
  }

  /**
   * Process the task queue
   */
  async processQueue() {
    while (this.running) {
      if (this.taskQueue.length > 0) {
        const task = this.taskQueue.shift();
        await this.executeTask(task);
      } else {
        await this.sleep(1000);
      }
    }
  }

  /**
   * Execute a task
   */
  async executeTask(task) {
    try {
      console.log(`Executing task: ${task.action} for ${task.customerId}`);
      
      switch (task.action) {
        case 'send_welcome_email':
          await this.sendWelcomeEmail(task);
          break;
        case 'send_getting_started_guide':
          await this.sendGettingStartedGuide(task);
          break;
        case 'send_first_service_recommendation':
          await this.sendFirstServiceRecommendation(task);
          break;
        case 'send_pro_tips':
          await this.sendProTips(task);
          break;
        case 'send_advanced_features':
          await this.sendAdvancedFeatures(task);
          break;
        case 'request_feedback':
          await this.requestFeedback(task);
          break;
        case 'analyze_usage_patterns':
          await this.analyzeUsagePatterns(task);
          break;
        case 'generate_personalized_recommendations':
          await this.generatePersonalizedRecommendations(task);
          break;
        case 'send_engagement_email':
          await this.sendEngagementEmail(task);
          break;
        case 'check_usage_threshold':
          await this.checkUsageThreshold(task);
          break;
        case 'analyze_top_services':
          await this.analyzeTopServices(task);
          break;
        case 'generate_upsell_pitch':
          await this.generateUpsellPitch(task);
          break;
        case 'send_upsell_email':
          await this.sendUpsellEmail(task);
          break;
        case 'initiate_grace_period':
          await this.initiateGracePeriod(task);
          break;
        case 'prepare_recovery_offer':
          await this.prepareRecoveryOffer(task);
          break;
        case 'send_grace_period_notice':
          await this.sendGracePeriodNotice(task);
          break;
        case 'follow_up_recovery':
          await this.followUpRecovery(task);
          break;
        case 'final_recovery_attempt':
          await this.finalRecoveryAttempt(task);
          break;
        case 'identify_at_risk_customers':
          await this.identifyAtRiskCustomers(task);
          break;
        case 'prepare_retention_offer':
          await this.prepareRetentionOffer(task);
          break;
        case 'send_retention_email':
          await this.sendRetentionEmail(task);
          break;
        case 'follow_up_if_no_response':
          await this.followUpIfNoResponse(task);
          break;
        case 'send_api_key_email':
          await this.sendApiKeyEmail(task);
          break;
        case 'send_api_setup_guide':
          await this.sendApiSetupGuide(task);
          break;
        case 'send_first_api_example':
          await this.sendFirstApiExample(task);
          break;
        case 'analyze_support_ticket':
          await this.analyzeSupportTicket(task);
          break;
        case 'suggest_solutions':
          await this.suggestSolutions(task);
          break;
        case 'escalate_if_needed':
          await this.escalateIfNeeded(task);
          break;
        case 'notify_customer':
          await this.notifyCustomer(task);
          break;
        case 'identify_success_metrics':
          await this.identifySuccessMetrics(task);
          break;
        case 'generate_case_study_outline':
          await this.generateCaseStudyOutline(task);
          break;
        case 'request_customer_testimonial':
          await this.requestCustomerTestimonial(task);
          break;
        case 'publish_success_story':
          await this.publishSuccessStory(task);
          break;
        default:
          console.log(`Unknown task action: ${task.action}`);
      }
      
      // Update task status
      await this.updateTaskStatus(task.id, 'completed');
      
    } catch (error) {
      console.error(`Task execution failed:`, error);
      await this.updateTaskStatus(task.id, 'failed', error.message);
    }
  }

  /**
   * Trigger a workflow
   */
  async triggerWorkflow(workflowName, data) {
    const workflow = this.workflows.get(workflowName);
    if (!workflow) {
      throw new Error(`Workflow ${workflowName} not found`);
    }

    // Create workflow instance
    const workflowId = uuidv4();
    
    // Schedule all steps
    for (const step of workflow.steps) {
      const task = {
        id: uuidv4(),
        workflowId,
        workflowName,
        action: step.action,
        data,
        scheduledAt: new Date(Date.now() + step.delay),
        customerId: data.customerId,
        createdAt: new Date()
      };
      
      if (step.delay === 0) {
        this.taskQueue.push(task);
      } else {
        setTimeout(() => {
          this.taskQueue.push(task);
        }, step.delay);
      }
    }

    // Store workflow instance
    await this.storeWorkflowInstance(workflowId, workflowName, data);
    
    this.emit('workflow_triggered', { workflowId, workflowName, data });
  }

  /**
   * Send welcome email
   */
  async sendWelcomeEmail(task) {
    const { customerId, tier } = task.data;
    
    const email = {
      to: customerId,
      subject: `Welcome to Ursula Service Bundle - ${tier.charAt(0).toUpperCase() + tier.slice(1)} Plan`,
      template: 'welcome',
      data: {
        tier,
        loginUrl: `${process.env.BASE_URL}/login`,
        supportEmail: 'support@ursula.ai'
      }
    };
    
    await this.sendEmail(email);
    console.log(`Welcome email sent to ${customerId}`);
  }

  /**
   * Send getting started guide
   */
  async sendGettingStartedGuide(task) {
    const { customerId } = task.data;
    
    const email = {
      to: customerId,
      subject: 'Getting Started with Ursula Services',
      template: 'getting_started',
      data: {
        guideUrl: `${process.env.BASE_URL}/guide`,
        videoUrl: `${process.env.BASE_URL}/tutorial`,
        popularServices: ['seo-article-generator', 'social-post-creator', 'document-summarizer']
      }
    };
    
    await this.sendEmail(email);
  }

  /**
   * Send first service recommendation
   */
  async sendFirstServiceRecommendation(task) {
    const { customerId, tier } = task.data;
    
    // Analyze customer profile
    const recommendations = await this.getServiceRecommendations(customerId, tier);
    
    const email = {
      to: customerId,
      subject: 'Your First Service Recommendations',
      template: 'service_recommendations',
      data: {
        recommendations: recommendations.slice(0, 3),
        tryNowUrl: `${process.env.BASE_URL}/services`
      }
    };
    
    await this.sendEmail(email);
  }

  /**
   * Send pro tips
   */
  async sendProTips(task) {
    const { customerId, tier } = task.data;
    
    const tips = tier === 'pro' || tier === 'enterprise' ? [
      'Use batch processing for multiple documents',
      'Set up automated workflows for repetitive tasks',
      'Integrate with your existing tools via API'
    ] : [
      'Upgrade to Pro for advanced features',
      'Schedule content generation in advance',
      'Track your usage analytics'
    ];
    
    const email = {
      to: customerId,
      subject: 'Pro Tips to Maximize Your Value',
      template: 'pro_tips',
      data: { tips }
    };
    
    await this.sendEmail(email);
  }

  /**
   * Send advanced features
   */
  async sendAdvancedFeatures(task) {
    const { customerId, tier } = task.data;
    
    const features = tier === 'enterprise' ? [
      'Custom model training',
      'Dedicated support channel',
      'Advanced security features',
      'SLA guarantees'
    ] : tier === 'pro' ? [
      'Priority support',
      'Custom integrations',
      'Advanced analytics',
      'Team collaboration'
    ] : [
      'Upgrade to unlock more features',
      'API access for developers',
      'Priority email support'
    ];
    
    const email = {
      to: customerId,
      subject: 'Unlock Advanced Features',
      template: 'advanced_features',
      data: { features, tier }
    };
    
    await this.sendEmail(email);
  }

  /**
   * Request feedback
   */
  async requestFeedback(task) {
    const { customerId } = task.data;
    
    const email = {
      to: customerId,
      subject: 'How are we doing? Your feedback matters',
      template: 'feedback_request',
      data: {
        feedbackUrl: `${process.env.BASE_URL}/feedback`,
        incentive: tier === 'enterprise' ? '$50 credit' : '10% discount'
      }
    };
    
    await this.sendEmail(email);
  }

  /**
   * Check usage threshold for upsell trigger
   */
  async checkUsageThreshold(task) {
    const { customerId } = task.data;
    
    // Get current usage
    const usage = await this.getCurrentUsage(customerId);
    const subscription = await this.getSubscription(customerId);
    
    const tierLimits = {
      starter: 1000,
      pro: 10000,
      enterprise: Infinity
    };
    
    const limit = tierLimits[subscription.tier];
    const usagePercentage = (usage.current / limit) * 100;
    
    if (usagePercentage >= 80 && subscription.tier !== 'enterprise') {
      task.data.triggerUpsell = true;
      task.data.usagePercentage = usagePercentage;
      task.data.currentUsage = usage.current;
      task.data.limit = limit;
    }
  }

  /**
   * Analyze top services for upsell
   */
  async analyzeTopServices(task) {
    if (!task.data.triggerUpsell) return;
    
    const { customerId } = task.data;
    const usage = await this.getServiceUsageBreakdown(customerId);
    
    // Sort by usage and get top 3
    const topServices = usage
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    
    task.data.topServices = topServices;
  }

  /**
   * Generate upsell pitch
   */
  async generateUpsellPitch(task) {
    if (!task.data.triggerUpsell) return;
    
    const { topServices, tier } = task.data;
    
    // Service to feature mapping
    const serviceFeatures = {
      'seo-article-generator': {
        pro: 'Automated Social Ghostwriter to promote your articles instantly',
        enterprise: 'Multi-language SEO optimization and global keyword research'
      },
      'social-post-creator': {
        pro: 'Advanced analytics and A/B testing for posts',
        enterprise: 'White-label reporting and team collaboration'
      },
      'document-summarizer': {
        pro: 'Batch processing for up to 100 documents',
        enterprise: 'Custom summarization models and API access'
      },
      'lead-qualifier': {
        pro: 'CRM integration and lead scoring',
        enterprise: 'Predictive lead scoring and custom qualification rules'
      },
      'code-reviewer': {
        pro: 'Multi-language support and security scanning',
        enterprise: 'Custom rule sets and enterprise integrations'
      }
    };
    
    const topService = topServices[0];
    const feature = serviceFeatures[topService.service_id]?.[tier === 'starter' ? 'pro' : 'enterprise'] 
      || 'advanced analytics and priority support';
    
    task.data.upsellPitch = {
      serviceUsed: topService.service_name,
      feature,
      upgradeTo: tier === 'starter' ? 'Pro' : 'Enterprise',
      savings: tier === 'starter' ? 'Save 40% with annual billing' : 'Custom enterprise pricing available'
    };
  }

  /**
   * Send upsell email with 24h cooldown to prevent spam
   */
  async sendUpsellEmail(task) {
    if (!task.data.triggerUpsell) return;
    
    const { customerId, upsellPitch, usagePercentage, tier } = task.data;
    
    // HEIDI RATE LIMIT: Check if we already notified this customer in last 24 hours
    const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
    const lastNotification = await this.getHeidiLastAction(customerId, 'upsell_email_sent', COOLDOWN_MS);
    
    if (lastNotification) {
      const hoursSince = (Date.now() - new Date(lastNotification.created_at).getTime()) / (1000 * 60 * 60);
      console.log(`[HEIDI] ⏸️ Upsell email suppressed for ${customerId}: notified ${hoursSince.toFixed(1)}h ago (24h cooldown active)`);
      return;
    }
    
    const email = {
      to: customerId,
      subject: `You're using ${usagePercentage.toFixed(0)}% of your plan - Unlock more power!`,
      template: 'upsell_opportunity',
      data: {
        currentUsage: usagePercentage.toFixed(0),
        serviceUsed: upsellPitch.serviceUsed,
        feature: upsellPitch.feature,
        upgradeTo: upsellPitch.upgradeTo,
        savings: upsellPitch.savings,
        upgradeUrl: `${process.env.BASE_URL}/subscriptions/upgrade?tier=${upsellPitch.upgradeTo.toLowerCase()}`
      }
    };
    
    await this.sendEmail(email);
    
    // Log to memory forge to enforce cooldown
    await this.logHeidiAction(customerId, 'upsell_email_sent', {
      tier,
      usagePercentage,
      targetTier: upsellPitch.upgradeTo,
      triggeredBy: task.data.triggerService || 'api_usage'
    });
    
    console.log(`[HEIDI] 📧 Upsell email sent to ${customerId} for ${upsellPitch.upgradeTo} tier (24h cooldown set)`);
  }

  /**
   * Multi-layer notification rate limiter - prevents Heidi from becoming a digital telemarketer
   * Rules:
   * 1. cooldown_until: Absolute time-based block
   * 2. notification_count_24h: Max 3 notifications per 24h
   * 3. same_notification_type_within_12h: Block same type within 12h
   */
  async checkNotificationThrottle(customerId, notificationType, options = {}) {
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    
    // Layer 1: Check explicit cooldown_until timestamp
    const { data: cooldownData } = await supabase
      .from('heidi_memory')
      .select('context')
      .eq('customer_id', customerId)
      .eq('action_type', 'cooldown_until')
      .single();
    
    if (cooldownData?.context?.cooldown_until && now < cooldownData.context.cooldown_until) {
      const minutesRemaining = Math.ceil((cooldownData.context.cooldown_until - now) / (60 * 1000));
      return {
        allowed: false,
        reason: 'cooldown_active',
        layer: 'cooldown_until',
        minutesRemaining
      };
    }
    
    // Layer 2: Check notification count in last 24h (max 3)
    const since24h = new Date(now - DAY).toISOString();
    const { data: recentNotifications, error: countError } = await supabase
      .from('heidi_memory')
      .select('id')
      .eq('customer_id', customerId)
      .gte('created_at', since24h);
    
    const notificationCount24h = recentNotifications?.length || 0;
    const MAX_DAILY_NOTIFICATIONS = options.maxDaily || 3;
    
    if (notificationCount24h >= MAX_DAILY_NOTIFICATIONS) {
      return {
        allowed: false,
        reason: 'daily_limit_exceeded',
        layer: 'notification_count_24h',
        count: notificationCount24h,
        limit: MAX_DAILY_NOTIFICATIONS
      };
    }
    
    // Layer 3: Check same notification type within 12h
    const since12h = new Date(now - (12 * HOUR)).toISOString();
    const { data: sameTypeNotifications } = await supabase
      .from('heidi_memory')
      .select('*')
      .eq('customer_id', customerId)
      .eq('action_type', notificationType)
      .gte('created_at', since12h)
      .order('created_at', { ascending: false });
    
    if (sameTypeNotifications && sameTypeNotifications.length > 0) {
      const lastSameType = sameTypeNotifications[0];
      const hoursSince = (now - new Date(lastSameType.created_at).getTime()) / HOUR;
      return {
        allowed: false,
        reason: 'same_type_cooldown',
        layer: 'same_notification_type_within_12h',
        lastNotificationType: notificationType,
        hoursSince: hoursSince.toFixed(1),
        cooldownHours: 12
      };
    }
    
    // All checks passed - allow notification
    return {
      allowed: true,
      notificationCount24h,
      remainingDaily: MAX_DAILY_NOTIFICATIONS - notificationCount24h
    };
  }

  /**
   * Set explicit cooldown until timestamp (for grace periods, etc.)
   */
  async setCooldownUntil(customerId, untilTimestamp, reason = '') {
    await supabase
      .from('heidi_memory')
      .upsert({
        customer_id: customerId,
        action_type: 'cooldown_until',
        context: { cooldown_until: untilTimestamp, reason },
        created_at: new Date().toISOString()
      });
  }

  /**
   * Legacy simple cooldown - kept for backward compatibility
   */
  async checkNotificationCooldown(customerId, notificationType, cooldownHours = 24) {
    const throttle = await this.checkNotificationThrottle(customerId, notificationType, { maxDaily: 100 }); // High limit for legacy
    if (!throttle.allowed && throttle.reason === 'same_type_cooldown') {
      return { allowed: false, reason: 'cooldown_active' };
    }
    return throttle;
  }

  /**
   * Initiate grace period for payment failure
   */
  async initiateGracePeriod(task) {
    const { customerId, subscriptionId } = task.data;
    
    // Update subscription with grace period
    await supabase
      .from('subscriptions')
      .update({
        status: 'grace_period',
        grace_period_ends: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        updated_at: new Date()
      })
      .eq('subscription_id', subscriptionId);
    
    task.data.gracePeriodEnds = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  /**
   * Prepare recovery offer
   */
  async prepareRecoveryOffer(task) {
    const { customerId, tier } = task.data;
    
    // Generate recovery offer based on tier
    const offers = {
      starter: {
        type: 'credit',
        value: 20,
        message: 'Here\'s $20 in credit to get you back on track'
      },
      pro: {
        type: 'discount',
        value: 0.5,
        duration: 2,
        message: 'Get 50% off your next 2 months'
      },
      enterprise: {
        type: 'personal',
        message: 'Your account manager will contact you shortly'
      }
    };
    
    task.data.recoveryOffer = offers[tier];
  }

  /**
   * Send grace period notice
   */
  async sendGracePeriodNotice(task) {
    const { customerId, recoveryOffer, gracePeriodEnds } = task.data;
    
    const email = {
      to: customerId,
      subject: 'Payment Issue - We\'ve got you covered',
      template: 'grace_period',
      data: {
        offerMessage: recoveryOffer.message,
        gracePeriodEnds: gracePeriodEnds.toLocaleDateString(),
        updatePaymentUrl: `${process.env.BASE_URL}/billing/update`,
        supportUrl: `${process.env.BASE_URL}/support`
      }
    };
    
    await this.sendEmail(email);
  }

  /**
   * Follow up on recovery
   */
  async followUpRecovery(task) {
    const { customerId } = task.data;
    
    // Check if payment is still failed
    const subscription = await this.getSubscription(task.data.customerId);
    
    if (subscription.status === 'grace_period') {
      const email = {
        to: customerId,
        subject: 'Your grace period ends soon',
        template: 'grace_period_followup',
        data: {
          daysLeft: Math.ceil((new Date(subscription.grace_period_ends) - new Date()) / (1000 * 60 * 60 * 24)),
          downgradeUrl: `${process.env.BASE_URL}/subscriptions/downgrade`
        }
      };
      
      await this.sendEmail(email);
    }
  }

  /**
   * Final recovery attempt
   */
  async finalRecoveryAttempt(task) {
    const { customerId, tier } = task.data;
    
    // Last attempt before suspension
    const email = {
      to: customerId,
      subject: 'Last chance to save your account',
      template: 'final_recovery',
      data: {
        tier,
        downsellOption: tier === 'enterprise' ? 'Pro ($149/month)' : 'Starter ($49/month)',
        immediateActionRequired: true
      }
    };
    
    await this.sendEmail(email);
  }

  /**
   * Get current usage for customer
   */
  async getCurrentUsage(customerId) {
    const { data } = await supabase
      .from('service_usage')
      .select('usage_count')
      .eq('customer_id', customerId)
      .gte('period_start', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());
    
    const total = data?.reduce((sum, row) => sum + row.usage_count, 0) || 0;
    
    return { current: total };
  }

  /**
   * Get service usage breakdown
   */
  async getServiceUsageBreakdown(customerId) {
    const { data } = await supabase
      .from('usage_logs')
      .select('service_id')
      .eq('customer_id', customerId)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    
    const counts = {};
    data?.forEach(log => {
      counts[log.service_id] = (counts[log.service_id] || 0) + 1;
    });
    
    return Object.entries(counts).map(([service_id, count]) => ({
      service_id,
      service_name: service_id.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      count
    }));
  }

  /**
   * Get subscription details
   */
  async getSubscription(customerId) {
    const { data } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('customer_id', customerId)
      .single();
    
    return data;
  }

  /**
   * Send API key email - "Keys to the Kingdom" immediate delivery
   */
  async sendApiKeyEmail(task) {
    const { customerId, tier, apiKey, apiKeyMasked, servicesCount, priorityAccess, apiLimit, dashboardUrl, apiDocsUrl } = task.data;
    
    const email = {
      to: customerId,
      subject: '🗝️ Your Keys to the Kingdom - Ursula Service Bundle API Access',
      template: 'api_key_delivery',
      data: {
        tier: tier.charAt(0).toUpperCase() + tier.slice(1),
        apiKey: apiKeyMasked,
        fullApiKey: apiKey, // Only for secure delivery
        servicesCount,
        priorityAccess: priorityAccess ? 'Yes - Real-time processing' : 'No - Batched processing',
        apiLimit: apiLimit === Infinity ? 'Unlimited' : apiLimit.toLocaleString(),
        dashboardUrl,
        apiDocsUrl,
        setupUrl: `${process.env.BASE_URL}/quickstart`,
        supportUrl: `${process.env.BASE_URL}/support`
      }
    };
    
    await this.sendEmail(email);
    console.log(`[HEIDI] 🔑 'Keys to the Kingdom' API key email sent to ${customerId}`);
  }

  /**
   * Send API setup guide
   */
  async sendApiSetupGuide(task) {
    const { customerId, tier, apiKey, apiDocsUrl } = task.data;
    
    const email = {
      to: customerId,
      subject: '⚡ Quick Start: Using Your Ursula API',
      template: 'api_setup_guide',
      data: {
        tier: tier.charAt(0).toUpperCase() + tier.slice(1),
        apiDocsUrl,
        examplesUrl: `${process.env.BASE_URL}/docs/examples`,
        postmanCollectionUrl: `${process.env.BASE_URL}/docs/postman`,
        codeSnippets: {
          curl: `curl -X POST ${process.env.BASE_URL}/api/services/seo-article-generator/execute \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"input": {"topic": "AI Automation", "keywords": ["efficiency"]}}'`,
          javascript: `const response = await fetch('${process.env.BASE_URL}/api/services/seo-article-generator/execute', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    input: { topic: 'AI Automation', keywords: ['efficiency'] }
  })
});
const result = await response.json();`,
          python: `import requests

response = requests.post(
    '${process.env.BASE_URL}/api/services/seo-article-generator/execute',
    headers={
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json'
    },
    json={
        'input': {'topic': 'AI Automation', 'keywords': ['efficiency']}
    }
)
result = response.json()`
        }
      }
    };
    
    await this.sendEmail(email);
    console.log(`[HEIDI] 📘 API setup guide sent to ${customerId}`);
  }

  /**
   * Send first API example
   */
  async sendFirstApiExample(task) {
    const { customerId, tier } = task.data;
    
    // Pick a recommended first service based on tier
    const recommendedServices = {
      starter: 'social-post-creator',
      pro: 'seo-article-generator',
      enterprise: 'code-reviewer'
    };
    
    const serviceId = recommendedServices[tier] || 'document-summarizer';
    
    const email = {
      to: customerId,
      subject: `🚀 Try Your First API Call: ${serviceId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
      template: 'first_api_example',
      data: {
        serviceId,
        serviceName: serviceId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        apiUrl: `${process.env.BASE_URL}/api/services/${serviceId}/execute`,
        examplePayload: this.getExamplePayload(serviceId),
        expectedOutput: this.getExpectedOutput(serviceId),
        sandboxUrl: `${process.env.BASE_URL}/sandbox?service=${serviceId}`
      }
    };
    
    await this.sendEmail(email);
    console.log(`[HEIDI] 🚀 First API example sent to ${customerId} for ${serviceId}`);
  }

  /**
   * Get example payload for a service
   */
  getExamplePayload(serviceId) {
    const examples = {
      'social-post-creator': {
        platform: 'linkedin',
        topic: 'AI-powered business automation',
        tone: 'professional'
      },
      'seo-article-generator': {
        topic: 'The Future of AI in Business',
        keywords: ['AI', 'automation', 'business growth'],
        length: 1500
      },
      'code-reviewer': {
        code: 'function greet(name) { return "Hello, " + name; }',
        language: 'javascript',
        standards: ['clean-code', 'security']
      },
      'document-summarizer': {
        document: 'Lorem ipsum dolor sit amet...',
        summaryLength: 'short'
      }
    };
    
    return examples[serviceId] || { test: true };
  }

  /**
   * Get expected output for a service
   */
  getExpectedOutput(serviceId) {
    const outputs = {
      'social-post-creator': {
        description: 'A ready-to-post LinkedIn update with hashtags and engagement hooks'
      },
      'seo-article-generator': {
        description: 'A 1500-word SEO-optimized article with meta description and keyword density analysis'
      },
      'code-reviewer': {
        description: 'Security scan results, code quality score, and suggested improvements'
      },
      'document-summarizer': {
        description: 'A concise summary with key points extracted and sentiment analysis'
      }
    };
    
    return outputs[serviceId] || { description: 'Structured JSON response' };
  }

  /**
   * Analyze usage patterns
   */
  async analyzeUsagePatterns(task) {
    const { customerId } = task.data;
    
    // Get usage data
    const { data: usage } = await supabase
      .from('usage_logs')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(100);
    
    // Analyze patterns
    const patterns = {
      mostUsedServices: this.getMostUsedServices(usage),
      peakUsageTimes: this.getPeakUsageTimes(usage),
      averageProcessingTime: this.getAverageProcessingTime(usage),
      errorRate: this.getErrorRate(usage)
    };
    
    // Store analysis
    await this.storeAnalysis(customerId, 'usage_patterns', patterns);
    
    task.data.patterns = patterns;
  }

  /**
   * Generate personalized recommendations
   */
  async generatePersonalizedRecommendations(task) {
    const { customerId, patterns } = task.data;
    
    const recommendations = [];
    
    // Based on usage patterns
    if (patterns.mostUsedServices.includes('seo-article-generator')) {
      recommendations.push({
        service: 'keyword-researcher',
        reason: 'Complement your SEO articles with keyword research'
      });
    }
    
    if (patterns.errorRate > 0.1) {
      recommendations.push({
        service: 'code-reviewer',
        reason: 'Reduce errors in your code with automated reviews'
      });
    }
    
    // Store recommendations
    await this.storeAnalysis(customerId, 'recommendations', recommendations);
    
    task.data.recommendations = recommendations;
  }

  /**
   * Send engagement email
   */
  async sendEngagementEmail(task) {
    const { customerId, recommendations } = task.data;
    
    const email = {
      to: customerId,
      subject: 'Personalized Service Recommendations',
      template: 'personalized_recommendations',
      data: { recommendations }
    };
    
    await this.sendEmail(email);
  }

  /**
   * Identify at-risk customers
   */
  async identifyAtRiskCustomers(task) {
    // Get all subscriptions with declining usage
    const { data: subscriptions } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('status', 'active');
    
    const atRisk = [];
    
    for (const sub of subscriptions) {
      const usage = await this.getRecentUsage(sub.customer_id);
      
      if (usage.declineRate > 0.5 || usage.lastUsed > 7) {
        atRisk.push({
          customerId: sub.customer_id,
          tier: sub.tier,
          reason: usage.declineRate > 0.5 ? 'declining_usage' : 'inactive'
        });
      }
    }
    
    task.data.atRiskCustomers = atRisk;
  }

  /**
   * Prepare retention offer
   */
  async prepareRetentionOffer(task) {
    const offers = [];
    
    for (const customer of task.data.atRiskCustomers) {
      let offer;
      
      if (customer.reason === 'declining_usage') {
        offer = {
          type: 'discount',
          value: '30%',
          duration: 3,
          message: 'We noticed you haven\'t been using our services as much. Here\'s 30% off for 3 months!'
        };
      } else {
        offer = {
          type: 'free_credits',
          value: 100,
          message: 'We miss you! Here\'s $100 in free credits to get you started again.'
        };
      }
      
      offers.push({ ...customer, offer });
    }
    
    task.data.offers = offers;
  }

  /**
   * Send retention emails
   */
  async sendRetentionEmail(task) {
    for (const { customerId, offer } of task.data.offers) {
      const email = {
        to: customerId,
        subject: 'A special offer just for you',
        template: 'retention_offer',
        data: { offer }
      };
      
      await this.sendEmail(email);
    }
  }

  /**
   * Get service recommendations
   */
  async getServiceRecommendations(customerId, tier) {
    // Mock recommendations - would use ML model
    const allServices = [
      'seo-article-generator',
      'social-post-creator',
      'document-summarizer',
      'lead-qualifier',
      'email-automator',
      'code-reviewer'
    ];
    
    return allServices.slice(0, Math.floor(Math.random() * 4) + 2);
  }

  /**
   * Get most used services
   */
  getMostUsedServices(usage) {
    const counts = {};
    
    usage.forEach(log => {
      counts[log.service_id] = (counts[log.service_id] || 0) + 1;
    });
    
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([service]) => service);
  }

  /**
   * Get peak usage times
   */
  getPeakUsageTimes(usage) {
    const hours = new Array(24).fill(0);
    
    usage.forEach(log => {
      const hour = new Date(log.created_at).getHours();
      hours[hour]++;
    });
    
    return hours
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
  }

  /**
   * Get average processing time
   */
  getAverageProcessingTime(usage) {
    const times = usage
      .filter(log => log.processing_time)
      .map(log => log.processing_time);
    
    return times.length > 0 
      ? times.reduce((a, b) => a + b, 0) / times.length 
      : 0;
  }

  /**
   * Get error rate
   */
  getErrorRate(usage) {
    const errors = usage.filter(log => log.status === 'error').length;
    return usage.length > 0 ? errors / usage.length : 0;
  }

  /**
   * Get recent usage
   */
  async getRecentUsage(customerId) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const { data: usage } = await supabase
      .from('usage_logs')
      .select('*')
      .eq('customer_id', customerId)
      .gte('created_at', thirtyDaysAgo.toISOString());
    
    // Calculate metrics
    const dailyUsage = {};
    usage.forEach(log => {
      const day = new Date(log.created_at).toDateString();
      dailyUsage[day] = (dailyUsage[day] || 0) + 1;
    });
    
    const days = Object.keys(dailyUsage).sort();
    const declineRate = days.length > 1 
      ? (dailyUsage[days[0]] - dailyUsage[days[days.length - 1]]) / dailyUsage[days[0]]
      : 0;
    
    const lastUsed = days.length > 0
      ? Math.floor((Date.now() - new Date(days[days.length - 1])) / (24 * 60 * 60 * 1000))
      : 30;
    
    return { declineRate, lastUsed };
  }

  /**
   * Send email
   */
  async sendEmail(email) {
    // Store in outbox
    await supabase
      .from('email_outbox')
      .insert({
        id: uuidv4(),
        to: email.to,
        subject: email.subject,
        template: email.template,
        data: email.data,
        status: 'pending',
        created_at: new Date()
      });
  }

  /**
   * Store workflow instance
   */
  async storeWorkflowInstance(workflowId, workflowName, data) {
    await supabase
      .from('workflow_instances')
      .insert({
        id: workflowId,
        workflow_name: workflowName,
        data,
        status: 'running',
        created_at: new Date()
      });
  }

  /**
   * Store analysis
   */
  async storeAnalysis(customerId, type, data) {
    await supabase
      .from('customer_analysis')
      .insert({
        id: uuidv4(),
        customer_id: customerId,
        analysis_type: type,
        data,
        created_at: new Date()
      });
  }

  /**
   * Update task status
   */
  async updateTaskStatus(taskId, status, error = null) {
    await supabase
      .from('heidi_tasks')
      .update({ 
        status, 
        error_message: error,
        updated_at: new Date()
      })
      .eq('id', taskId);
  }

  /**
   * Generate weekly System Wins report for admin dashboard
   */
  async generateWeeklySystemWins() {
    console.log('[HEIDI] Generating weekly System Wins report...');
    
    try {
      // Get top 5 performing services by revenue
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const { data: topServices } = await supabase
        .from('service_usage')
        .select('service_id, usage_count, revenue')
        .gte('period_start', sevenDaysAgo.toISOString())
        .order('revenue', { ascending: false })
        .limit(5);
      
      // Get new subscriptions this week
      const { data: newSubs } = await supabase
        .from('subscriptions')
        .select('*')
        .gte('created_at', sevenDaysAgo.toISOString());
      
      // Get churned subscriptions this week
      const { data: churnedSubs } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('status', 'canceled')
        .gte('canceled_at', sevenDaysAgo.toISOString());
      
      // Calculate metrics
      const totalRevenue = topServices?.reduce((sum, s) => sum + (parseFloat(s.revenue) || 0), 0) || 0;
      const totalUsage = topServices?.reduce((sum, s) => sum + (s.usage_count || 0), 0) || 0;
      const newCount = newSubs?.length || 0;
      const churnedCount = churnedSubs?.length || 0;
      const netGrowth = newCount - churnedCount;
      
      // Generate the report
      const report = {
        period: 'weekly',
        week_start: sevenDaysAgo.toISOString(),
        week_end: new Date().toISOString(),
        top_services: topServices?.map(s => ({
          service_id: s.service_id,
          service_name: s.service_id.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          usage_count: s.usage_count,
          revenue: parseFloat(s.revenue) || 0
        })) || [],
        metrics: {
          total_revenue: totalRevenue,
          total_usage: totalUsage,
          new_subscriptions: newCount,
          churned_subscriptions: churnedCount,
          net_growth: netGrowth,
          churn_rate: newCount > 0 ? (churnedCount / newCount) * 100 : 0
        },
        highlights: [
          `Top performer: ${topServices?.[0]?.service_id || 'N/A'} generated $${parseFloat(topServices?.[0]?.revenue || 0).toFixed(2)}`,
          `Net growth: ${netGrowth > 0 ? '+' : ''}${netGrowth} subscribers this week`,
          `Total API calls: ${totalUsage.toLocaleString()}`
        ]
      };
      
      // Store in system_wins_reports table
      await supabase
        .from('system_wins_reports')
        .insert({
          id: uuidv4(),
          report_type: 'weekly_system_wins',
          report_data: report,
          created_at: new Date()
        });
      
      console.log(`[HEIDI] ✅ System Wins report generated: $${totalRevenue.toFixed(2)} revenue, ${newCount} new subs`);
      
      // Also emit for dashboard real-time update
      this.emit('system_wins_report', {
        report,
        timestamp: new Date()
      });
      
      return report;
    } catch (error) {
      console.error('[HEIDI] ❌ System Wins report generation failed:', error.message);
      return null;
    }
  }

  /**
   * Schedule periodic tasks
   */
  schedulePeriodicTasks() {
    // Daily engagement check
    setInterval(async () => {
      await this.triggerWorkflow('engagement_boost', { customerId: 'all' });
    }, 24 * 60 * 60 * 1000);
    
    // Weekly retention check
    setInterval(async () => {
      await this.triggerWorkflow('retention_warning', { customerId: 'all' });
    }, 7 * 24 * 60 * 60 * 1000);
    
    // Weekly System Wins report for admin dashboard
    setInterval(async () => {
      await this.generateWeeklySystemWins();
    }, 7 * 24 * 60 * 60 * 1000);
    
    // Monthly success stories
    setInterval(async () => {
      await this.triggerWorkflow('success_story', { customerId: 'all' });
    }, 30 * 24 * 60 * 60 * 1000);
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = HeidiServiceAutomator;
