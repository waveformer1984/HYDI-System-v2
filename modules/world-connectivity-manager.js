/**
 * World Connectivity Manager
 * 
 * Manages HYDI's connections to the external world including:
 * - External API integrations (Stripe, monitoring services, etc.)
 * - Webhook management and processing
 * - External event subscription and publishing
 * - Rate limiting and circuit breaking for external calls
 */

const EventEmitter = require('events');
const fetch = require('node-fetch');
const crypto = require('crypto');

class WorldConnectivityManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      webhook_secret: config.webhook_secret || process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex'),
      api_timeout: config.api_timeout || 30000,
      retry_attempts: config.retry_attempts || 3,
      retry_delay: config.retry_delay || 1000,
      rate_limit_window: config.rate_limit_window || 60000, // 1 minute
      rate_limit_max: config.rate_limit_max || 100,
      circuit_breaker_threshold: config.circuit_breaker_threshold || 5,
      circuit_breaker_timeout: config.circuit_breaker_timeout || 30000,
      ...config
    };
    
    this.connections = new Map();
    this.webhooks = new Map();
    this.rateLimiter = new Map();
    this.circuitBreakers = new Map();
    this.eventQueue = [];
    this.metrics = {
      total_requests: 0,
      successful_requests: 0,
      failed_requests: 0,
      webhooks_received: 0,
      webhooks_processed: 0,
      webhooks_failed: 0
    };
    
    this.isInitialized = false;
  }

  async initialize() {
    console.log('🌍 Initializing World Connectivity Manager...');
    
    try {
      // Initialize external API connections
      await this.initializeAPIConnections();
      
      // Setup webhook handlers
      await this.setupWebhookHandlers();
      
      // Start event processor
      this.startEventProcessor();
      
      // Start metrics collection
      this.startMetricsCollection();
      
      this.isInitialized = true;
      console.log('✅ World Connectivity Manager initialized');
      
      this.emit('world_connectivity_ready', { status: 'connected' });
      return { status: 'connected', connections: this.connections.size };
      
    } catch (error) {
      console.error('❌ World connectivity initialization failed:', error.message);
      this.emit('world_connectivity_error', error);
      throw error;
    }
  }

  async initializeAPIConnections() {
    const apis = [
      {
        name: 'stripe',
        enabled: !!process.env.STRIPE_SECRET_KEY,
        config: {
          secret_key: process.env.STRIPE_SECRET_KEY,
          webhook_secret: process.env.STRIPE_WEBHOOK_SECRET,
          base_url: 'https://api.stripe.com'
        }
      },
      {
        name: 'monitoring',
        enabled: !!process.env.MONITORING_ENDPOINT,
        config: {
          endpoint: process.env.MONITORING_ENDPOINT,
          api_key: process.env.MONITORING_API_KEY
        }
      },
      {
        name: 'notifications',
        enabled: !!process.env.NOTIFICATION_SERVICE_URL,
        config: {
          url: process.env.NOTIFICATION_SERVICE_URL,
          api_key: process.env.NOTIFICATION_API_KEY
        }
      }
    ];

    for (const api of apis) {
      if (api.enabled) {
        try {
          await this.setupAPIConnection(api);
          console.log(`✅ ${api.name} API connection established`);
        } catch (error) {
          console.warn(`⚠️  ${api.name} API connection failed: ${error.message}`);
        }
      }
    }
  }

  async setupAPIConnection(api) {
    const connection = {
      name: api.name,
      config: api.config,
      status: 'connected',
      last_check: new Date().toISOString(),
      error_count: 0,
      circuit_state: 'closed' // closed, open, half-open
    };

    // Test connection
    if (api.name === 'stripe') {
      await this.testStripeConnection(connection);
    } else if (api.name === 'monitoring') {
      await this.testMonitoringConnection(connection);
    } else {
      await this.testGenericConnection(connection);
    }

    this.connections.set(api.name, connection);
    this.emit('api_connected', { name: api.name });
  }

  async testStripeConnection(connection) {
    try {
      const response = await fetch(`${connection.config.base_url}/v1/account`, {
        headers: {
          'Authorization': `Bearer ${connection.config.secret_key}`
        },
        timeout: this.config.api_timeout
      });

      if (!response.ok) {
        throw new Error(`Stripe API error: ${response.status}`);
      }

      const account = await response.json();
      connection.account_id = account.id;
      connection.status = 'connected';
    } catch (error) {
      connection.status = 'error';
      connection.last_error = error.message;
      throw error;
    }
  }

  async testMonitoringConnection(connection) {
    try {
      const response = await fetch(`${connection.config.endpoint}/health`, {
        timeout: this.config.api_timeout,
        headers: connection.config.api_key ? {
          'Authorization': `Bearer ${connection.config.api_key}`
        } : {}
      });

      if (!response.ok) {
        throw new Error(`Monitoring service error: ${response.status}`);
      }

      connection.status = 'connected';
    } catch (error) {
      connection.status = 'error';
      connection.last_error = error.message;
      throw error;
    }
  }

  async testGenericConnection(connection) {
    try {
      const response = await fetch(connection.config.url, {
        timeout: this.config.api_timeout,
        headers: connection.config.api_key ? {
          'Authorization': `Bearer ${connection.config.api_key}`
        } : {}
      });

      connection.status = response.ok ? 'connected' : 'error';
      if (!response.ok) {
        connection.last_error = `HTTP ${response.status}`;
      }
    } catch (error) {
      connection.status = 'error';
      connection.last_error = error.message;
    }
  }

  async setupWebhookHandlers() {
    const webhooks = [
      {
        name: 'stripe',
        path: '/webhooks/stripe',
        secret: process.env.STRIPE_WEBHOOK_SECRET,
        handler: this.handleStripeWebhook.bind(this)
      },
      {
        name: 'github',
        path: '/webhooks/github',
        secret: process.env.GITHUB_WEBHOOK_SECRET,
        handler: this.handleGitHubWebhook.bind(this)
      },
      {
        name: 'generic',
        path: '/webhooks/generic',
        secret: this.config.webhook_secret,
        handler: this.handleGenericWebhook.bind(this)
      }
    ];

    for (const webhook of webhooks) {
      if (webhook.secret || webhook.name === 'generic') {
        this.webhooks.set(webhook.name, webhook);
        console.log(`🪝 Webhook handler registered: ${webhook.path}`);
      }
    }
  }

  async handleStripeWebhook(req, res) {
    try {
      const signature = req.headers['stripe-signature'];
      const payload = req.body;

      // Verify webhook signature
      if (!this.verifyStripeSignature(payload, signature, this.webhooks.get('stripe').secret)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      this.metrics.webhooks_received++;
      
      // Process webhook event
      const event = JSON.parse(payload);
      await this.processStripeEvent(event);
      
      this.metrics.webhooks_processed++;
      res.json({ received: true });
      
    } catch (error) {
      this.metrics.webhooks_failed++;
      console.error('Stripe webhook error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  async handleGitHubWebhook(req, res) {
    try {
      const signature = req.headers['x-hub-signature-256'];
      const payload = JSON.stringify(req.body);

      // Verify webhook signature
      if (!this.verifyGitHubSignature(payload, signature, this.webhooks.get('github').secret)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      this.metrics.webhooks_received++;
      
      // Process webhook event
      await this.processGitHubEvent(req.body);
      
      this.metrics.webhooks_processed++;
      res.json({ received: true });
      
    } catch (error) {
      this.metrics.webhooks_failed++;
      console.error('GitHub webhook error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  async handleGenericWebhook(req, res) {
    try {
      const signature = req.headers['x-hydi-signature'];
      const payload = JSON.stringify(req.body);

      // Verify webhook signature
      if (!this.verifyGenericSignature(payload, signature, this.webhooks.get('generic').secret)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      this.metrics.webhooks_received++;
      
      // Process generic webhook
      await this.processGenericWebhook(req.body);
      
      this.metrics.webhooks_processed++;
      res.json({ received: true });
      
    } catch (error) {
      this.metrics.webhooks_failed++;
      console.error('Generic webhook error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  verifyStripeSignature(payload, signature, secret) {
    try {
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(payload, 'utf8');
      const expectedSignature = `sha256=${hmac.digest('hex')}`;
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch {
      return false;
    }
  }

  verifyGitHubSignature(payload, signature, secret) {
    try {
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(payload, 'utf8');
      const expectedSignature = `sha256=${hmac.digest('hex')}`;
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch {
      return false;
    }
  }

  verifyGenericSignature(payload, signature, secret) {
    try {
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(payload, 'utf8');
      const expectedSignature = hmac.digest('hex');
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch {
      return false;
    }
  }

  async processStripeEvent(event) {
    console.log(`💳 Processing Stripe event: ${event.type}`);
    
    // Emit event for local processing
    this.emit('stripe_event', {
      type: event.type,
      data: event.data,
      timestamp: new Date().toISOString()
    });

    // Add to event queue for async processing
    this.eventQueue.push({
      source: 'stripe',
      type: event.type,
      data: event,
      timestamp: new Date().toISOString()
    });
  }

  async processGitHubEvent(event) {
    console.log(`🐙 Processing GitHub event: ${event.type}`);
    
    this.emit('github_event', {
      type: event.type,
      repository: event.repository?.full_name,
      action: event.action,
      timestamp: new Date().toISOString()
    });

    this.eventQueue.push({
      source: 'github',
      type: event.type,
      data: event,
      timestamp: new Date().toISOString()
    });
  }

  async processGenericWebhook(data) {
    console.log(`📨 Processing generic webhook`);
    
    this.emit('generic_webhook', {
      data: data,
      timestamp: new Date().toISOString()
    });

    this.eventQueue.push({
      source: 'generic',
      type: 'webhook',
      data: data,
      timestamp: new Date().toISOString()
    });
  }

  startEventProcessor() {
    // Process events every 5 seconds
    setInterval(() => {
      this.processEventQueue();
    }, 5000);
  }

  async processEventQueue() {
    if (this.eventQueue.length === 0) return;

    const events = this.eventQueue.splice(0, 10); // Process up to 10 events
    
    for (const event of events) {
      try {
        await this.processEvent(event);
      } catch (error) {
        console.error(`Failed to process event: ${error.message}`);
      }
    }
  }

  async processEvent(event) {
    // Route event to appropriate processor
    switch (event.source) {
      case 'stripe':
        await this.processStripeEventAsync(event);
        break;
      case 'github':
        await this.processGitHubEventAsync(event);
        break;
      default:
        await this.processGenericEventAsync(event);
    }
  }

  async processStripeEventAsync(event) {
    // Handle specific Stripe events
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentSuccess(event);
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentFailure(event);
        break;
      case 'customer.subscription.created':
        await this.handleSubscriptionCreated(event);
        break;
      default:
        console.log(`Unhandled Stripe event: ${event.type}`);
    }
  }

  async handlePaymentSuccess(event) {
    const payment = event.data.object;
    console.log(`💰 Payment succeeded: $${payment.amount / 100} for ${payment.customer}`);
    
    this.emit('payment_success', {
      payment_id: payment.id,
      amount: payment.amount,
      customer: payment.customer,
      metadata: payment.metadata
    });
  }

  async handlePaymentFailure(event) {
    const payment = event.data.object;
    console.log(`❌ Payment failed: $${payment.amount / 100} for ${payment.customer}`);
    
    this.emit('payment_failure', {
      payment_id: payment.id,
      amount: payment.amount,
      customer: payment.customer,
      last_payment_error: payment.last_payment_error
    });
  }

  async handleSubscriptionCreated(event) {
    const subscription = event.data.object;
    console.log(`📋 Subscription created: ${subscription.id} for ${subscription.customer}`);
    
    this.emit('subscription_created', {
      subscription_id: subscription.id,
      customer: subscription.customer,
      plan: subscription.plan,
      status: subscription.status
    });
  }

  async processGitHubEventAsync(event) {
    // Handle GitHub events
    switch (event.type) {
      case 'push':
        await this.handleGitHubPush(event);
        break;
      case 'pull_request':
        await this.handleGitHubPullRequest(event);
        break;
      default:
        console.log(`Unhandled GitHub event: ${event.type}`);
    }
  }

  async handleGitHubPush(event) {
    const push = event.data;
    console.log(`📤 GitHub push to ${push.repository.full_name}: ${push.ref}`);
    
    this.emit('github_push', {
      repository: push.repository.full_name,
      ref: push.ref,
      commits: push.commits.length,
      pusher: push.pusher.name
    });
  }

  async handleGitHubPullRequest(event) {
    const pr = event.data;
    console.log(`🔀 GitHub PR ${pr.action}: ${pr.number} in ${pr.repository.full_name}`);
    
    this.emit('github_pull_request', {
      action: pr.action,
      repository: pr.repository.full_name,
      pull_request: pr.number,
      title: pr.pull_request.title,
      author: pr.pull_request.user.login
    });
  }

  async processGenericEventAsync(event) {
    console.log(`📨 Processing generic event from ${event.source}`);
    this.emit('generic_event', event);
  }

  // API calling methods with rate limiting and circuit breaking
  async callAPI(apiName, endpoint, options = {}) {
    const connection = this.connections.get(apiName);
    
    if (!connection) {
      throw new Error(`API connection not found: ${apiName}`);
    }

    // Check rate limit
    if (!this.checkRateLimit(apiName)) {
      throw new Error(`Rate limit exceeded for ${apiName}`);
    }

    // Check circuit breaker
    if (!this.checkCircuitBreaker(apiName)) {
      throw new Error(`Circuit breaker open for ${apiName}`);
    }

    try {
      this.metrics.total_requests++;
      
      const response = await this.makeAPIRequest(connection, endpoint, options);
      
      this.metrics.successful_requests++;
      this.recordSuccess(apiName);
      
      return response;
      
    } catch (error) {
      this.metrics.failed_requests++;
      this.recordFailure(apiName);
      throw error;
    }
  }

  async makeAPIRequest(connection, endpoint, options) {
    const url = endpoint.startsWith('http') ? endpoint : `${connection.config.base_url}${endpoint}`;
    
    const requestOptions = {
      timeout: this.config.api_timeout,
      headers: {
        'User-Agent': 'HYDI-WorldConnectivity/1.0',
        ...options.headers
      },
      ...options
    };

    // Add authentication
    if (connection.config.secret_key) {
      requestOptions.headers['Authorization'] = `Bearer ${connection.config.secret_key}`;
    } else if (connection.config.api_key) {
      requestOptions.headers['Authorization'] = `Bearer ${connection.config.api_key}`;
    }

    const response = await fetch(url, requestOptions);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  checkRateLimit(apiName) {
    const now = Date.now();
    const window = this.rateLimiter.get(apiName) || { count: 0, reset_time: now + this.config.rate_limit_window };
    
    if (now > window.reset_time) {
      // Reset window
      this.rateLimiter.set(apiName, { count: 1, reset_time: now + this.config.rate_limit_window });
      return true;
    }
    
    if (window.count >= this.config.rate_limit_max) {
      return false;
    }
    
    window.count++;
    return true;
  }

  checkCircuitBreaker(apiName) {
    const breaker = this.circuitBreakers.get(apiName) || { state: 'closed', failures: 0, last_failure: 0 };
    
    if (breaker.state === 'open') {
      const now = Date.now();
      if (now - breaker.last_failure > this.config.circuit_breaker_timeout) {
        // Try half-open state
        breaker.state = 'half-open';
        this.circuitBreakers.set(apiName, breaker);
        return true;
      }
      return false;
    }
    
    return true;
  }

  recordSuccess(apiName) {
    // Reset circuit breaker on success
    const breaker = this.circuitBreakers.get(apiName) || { state: 'closed', failures: 0, last_failure: 0 };
    breaker.failures = 0;
    breaker.state = 'closed';
    this.circuitBreakers.set(apiName, breaker);
  }

  recordFailure(apiName) {
    const breaker = this.circuitBreakers.get(apiName) || { state: 'closed', failures: 0, last_failure: 0 };
    breaker.failures++;
    breaker.last_failure = Date.now();
    
    if (breaker.failures >= this.config.circuit_breaker_threshold) {
      breaker.state = 'open';
    }
    
    this.circuitBreakers.set(apiName, breaker);
  }

  startMetricsCollection() {
    // Collect metrics every minute
    setInterval(() => {
      this.emit('metrics_update', this.getMetrics());
    }, 60000);
  }

  getMetrics() {
    return {
      ...this.metrics,
      connections: this.connections.size,
      webhooks: this.webhooks.size,
      event_queue_size: this.eventQueue.length,
      circuit_breakers: Array.from(this.circuitBreakers.entries()).map(([name, breaker]) => ({
        api: name,
        state: breaker.state,
        failures: breaker.failures
      })),
      timestamp: new Date().toISOString()
    };
  }

  // Public API methods
  getConnectionStatus() {
    return Array.from(this.connections.entries()).map(([name, connection]) => ({
      name,
      status: connection.status,
      last_check: connection.last_check,
      error_count: connection.error_count
    }));
  }

  getWebhookStatus() {
    return Array.from(this.webhooks.entries()).map(([name, webhook]) => ({
      name,
      path: webhook.path,
      has_secret: !!webhook.secret
    }));
  }

  async sendWebhook(url, payload, options = {}) {
    try {
      const signature = this.generateWebhookSignature(payload, options.secret || this.config.webhook_secret);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HYDI-Signature': signature,
          ...options.headers
        },
        body: JSON.stringify(payload),
        timeout: this.config.api_timeout
      });

      if (!response.ok) {
        throw new Error(`Webhook delivery failed: ${response.status}`);
      }

      return { success: true, status: response.status };
    } catch (error) {
      console.error('Webhook delivery error:', error);
      throw error;
    }
  }

  generateWebhookSignature(payload, secret) {
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload), 'utf8');
    return hmac.digest('hex');
  }

  async shutdown() {
    console.log('🛑 Shutting down World Connectivity Manager...');
    
    // Process remaining events
    while (this.eventQueue.length > 0) {
      await this.processEventQueue();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    this.isInitialized = false;
    console.log('✅ World connectivity shutdown completed');
  }
}

module.exports = WorldConnectivityManager;
