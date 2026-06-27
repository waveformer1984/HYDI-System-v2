#!/usr/bin/env node

/**
 * PRODUCT WRAPPER: API Gateway
 * 
 * Wraps the core API Gateway for revenue generation
 * Adds logging, usage metrics, billing integration, rate limiting
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

class ProductizedAPIGateway {
  constructor(options = {}) {
    this.app = express();
    this.usageMetrics = new Map(); // userId -> usage data
    this.revenueTracker = new Map(); // usageId -> revenue data
    this.config = {
      rateLimitWindow: options.rateLimitWindow || 60000, // 1 minute
      rateLimitMax: options.rateLimitMax || 100,
      pricing: {
        perCall: options.perCallPrice || 0.01,
        subscription: options.subscriptionPrice || 29.99
      }
    };
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupBilling();
  }

  setupMiddleware() {
    // Rate limiting
    const limiter = rateLimit({
      windowMs: this.config.rateLimitWindow,
      max: this.config.rateLimitMax,
      message: { error: 'Rate limit exceeded' }
    });
    
    this.app.use(limiter);
    this.app.use(express.json());
    
    // Request logging middleware
    this.app.use((req, res, next) => {
      const usageId = uuidv4();
      req.usageId = usageId;
      
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - UsageID: ${usageId}`);
      
      // Track usage
      this.trackUsage(req, usageId);
      
      next();
    });
  }

  setupRoutes() {
    // Health check (free)
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });

    // Core automation API (paid)
    this.app.post('/api/v1/automate', async (req, res) => {
      try {
        const { intent, parameters, userId } = req.body;
        
        if (!intent || !userId) {
          return res.status(400).json({ 
            error: 'Missing required fields: intent, userId' 
          });
        }

        // Execute automation
        const result = await this.executeAutomation(intent, parameters, userId, req.usageId);
        
        // Track revenue
        this.trackRevenue(req.usageId, 'automation', this.config.pricing.perCall);
        
        res.json({
          success: true,
          usageId: req.usageId,
          result: result,
          cost: this.config.pricing.perCall
        });
        
      } catch (error) {
        console.error(`Automation error [${req.usageId}]:`, error);
        res.status(500).json({ 
          error: 'Automation failed',
          usageId: req.usageId,
          details: error.message 
        });
      }
    });

    // Task generation API (paid)
    this.app.post('/api/v1/generate-tasks', async (req, res) => {
      try {
        const { goal, constraints, userId } = req.body;
        
        if (!goal || !userId) {
          return res.status(400).json({ 
            error: 'Missing required fields: goal, userId' 
          });
        }

        // Generate tasks
        const tasks = await this.generateTasks(goal, constraints, userId, req.usageId);
        
        // Track revenue
        this.trackRevenue(req.usageId, 'task_generation', this.config.pricing.perCall);
        
        res.json({
          success: true,
          usageId: req.usageId,
          tasks: tasks,
          cost: this.config.pricing.perCall
        });
        
      } catch (error) {
        console.error(`Task generation error [${req.usageId}]:`, error);
        res.status(500).json({ 
          error: 'Task generation failed',
          usageId: req.usageId,
          details: error.message 
        });
      }
    });

    // Content generation API (paid)
    this.app.post('/api/v1/generate', async (req, res) => {
      try {
        const { type, prompt, options, userId } = req.body;
        
        if (!type || !prompt || !userId) {
          return res.status(400).json({ 
            error: 'Missing required fields: type, prompt, userId' 
          });
        }

        // Generate content
        const content = await this.generateContent(type, prompt, options, userId, req.usageId);
        
        // Track revenue (content generation might cost more)
        const contentCost = this.getContentGenerationCost(type, options);
        this.trackRevenue(req.usageId, 'content_generation', contentCost);
        
        res.json({
          success: true,
          usageId: req.usageId,
          content: content,
          cost: contentCost
        });
        
      } catch (error) {
        console.error(`Content generation error [${req.usageId}]:`, error);
        res.status(500).json({ 
          error: 'Content generation failed',
          usageId: req.usageId,
          details: error.message 
        });
      }
    });

    // Usage metrics API (paid)
    this.app.get('/api/v1/usage/:userId', (req, res) => {
      const { userId } = req.params;
      const usage = this.getUserUsage(userId);
      
      res.json({
        userId: userId,
        usage: usage,
        generatedAt: new Date().toISOString()
      });
    });

    // Billing API (internal)
    this.app.get('/api/v1/billing/:userId', (req, res) => {
      const { userId } = req.params;
      const billing = this.getUserBilling(userId);
      
      res.json({
        userId: userId,
        billing: billing,
        generatedAt: new Date().toISOString()
      });
    });
  }

  setupBilling() {
    // Simulate billing integration
    // In real implementation, this would connect to Stripe or payment processor
    
    setInterval(() => {
      this.processBilling();
    }, 60000); // Process billing every minute
  }

  // CORE BUSINESS METHODS

  async executeAutomation(intent, parameters, userId, usageId) {
    console.log(`Executing automation [${usageId}]: ${intent}`);
    
    // Simulate automation execution
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
      intent: intent,
      parameters: parameters,
      executedAt: new Date().toISOString(),
      result: `Automation completed for: ${intent}`,
      executionId: uuidv4()
    };
  }

  async generateTasks(goal, constraints, userId, usageId) {
    console.log(`Generating tasks [${usageId}]: ${goal}`);
    
    // Simulate task generation
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return {
      goal: goal,
      constraints: constraints || [],
      tasks: [
        { id: 'task-1', description: 'Analyze requirements', priority: 'high' },
        { id: 'task-2', description: 'Implement solution', priority: 'medium' },
        { id: 'task-3', description: 'Test and validate', priority: 'high' }
      ],
      generatedAt: new Date().toISOString(),
      planId: uuidv4()
    };
  }

  async generateContent(type, prompt, options, userId, usageId) {
    console.log(`Generating content [${usageId}]: ${type}`);
    
    // Simulate content generation
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const content = this.generateMockContent(type, prompt, options);
    
    return {
      type: type,
      prompt: prompt,
      content: content,
      generatedAt: new Date().toISOString(),
      contentId: uuidv4()
    };
  }

  generateMockContent(type, prompt, options) {
    switch (type) {
      case 'text':
        return `Generated text content based on: "${prompt}". This is high-quality AI-generated content that meets your requirements.`;
      
      case 'code':
        return `// Generated code for: ${prompt}\nfunction execute() {\n  // Implementation here\n  return "success";\n}`;
      
      case 'email':
        return `Subject: Regarding ${prompt}\n\nDear User,\n\nThis is AI-generated email content addressing your request.\n\nBest regards,\nAI Assistant`;
      
      default:
        return `Generated ${type} content for: ${prompt}`;
    }
  }

  // USAGE AND REVENUE TRACKING

  trackUsage(req, usageId) {
    const userId = req.body.userId || req.query.userId || 'anonymous';
    const endpoint = req.path;
    
    if (!this.usageMetrics.has(userId)) {
      this.usageMetrics.set(userId, {
        totalCalls: 0,
        endpoints: new Map(),
        totalCost: 0,
        firstSeen: new Date(),
        lastSeen: new Date()
      });
    }
    
    const userUsage = this.usageMetrics.get(userId);
    userUsage.totalCalls++;
    userUsage.lastSeen = new Date();
    
    if (!userUsage.endpoints.has(endpoint)) {
      userUsage.endpoints.set(endpoint, { count: 0, cost: 0 });
    }
    
    userUsage.endpoints.get(endpoint).count++;
  }

  trackRevenue(usageId, service, cost) {
    this.revenueTracker.set(usageId, {
      service: service,
      cost: cost,
      timestamp: new Date(),
      billed: false
    });
  }

  getContentGenerationCost(type, options) {
    // Different content types have different costs
    const baseCosts = {
      'text': 0.02,
      'code': 0.03,
      'email': 0.015,
      'summary': 0.025
    };
    
    let cost = baseCosts[type] || 0.02;
    
    // Add cost for premium options
    if (options && options.premium) {
      cost *= 1.5;
    }
    
    if (options && options.length && options.length > 1000) {
      cost *= 1.2;
    }
    
    return cost;
  }

  getUserUsage(userId) {
    return this.usageMetrics.get(userId) || {
      totalCalls: 0,
      endpoints: new Map(),
      totalCost: 0,
      firstSeen: null,
      lastSeen: null
    };
  }

  getUserBilling(userId) {
    const usage = this.getUserUsage(userId);
    const userRevenue = Array.from(this.revenueTracker.values())
      .filter(record => !record.billed)
      .reduce((total, record) => total + record.cost, 0);
    
    return {
      currentUsage: usage.totalCalls,
      currentCost: userRevenue,
      subscriptionActive: true, // In real implementation, check subscription status
      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
    };
  }

  processBilling() {
    // Simulate billing processing
    let totalRevenue = 0;
    let billedCount = 0;
    
    for (const [usageId, record] of this.revenueTracker.entries()) {
      if (!record.billed) {
        totalRevenue += record.cost;
        record.billed = true;
        billedCount++;
      }
    }
    
    if (billedCount > 0) {
      console.log(`[BILLING] Processed ${billedCount} records, total revenue: $${totalRevenue.toFixed(2)}`);
    }
  }

  // SERVER START
  start(port = 3000) {
    this.app.listen(port, () => {
      console.log(`Productized API Gateway running on port ${port}`);
      console.log(`Pricing: $${this.config.pricing.perCall} per call, $${this.config.pricing.subscription}/month subscription`);
      console.log(`Rate limit: ${this.config.rateLimitMax} calls per ${this.config.rateLimitWindow/1000} seconds`);
    });
  }

  // METRICS ENDPOINTS
  getMetrics() {
    const totalUsers = this.usageMetrics.size;
    const totalCalls = Array.from(this.usageMetrics.values())
      .reduce((sum, usage) => sum + usage.totalCalls, 0);
    
    const totalRevenue = Array.from(this.revenueTracker.values())
      .reduce((sum, record) => sum + record.cost, 0);
    
    return {
      totalUsers: totalUsers,
      totalCalls: totalCalls,
      totalRevenue: totalRevenue,
      averageRevenuePerCall: totalCalls > 0 ? totalRevenue / totalCalls : 0,
      uptime: process.uptime()
    };
  }
}

// DEMONSTRATION
async function demonstrateProductizedGateway() {
  console.log('=== PRODUCTIZED API GATEWAY DEMONSTRATION ===\n');
  
  const gateway = new ProductizedAPIGateway({
    rateLimitWindow: 60000,
    rateLimitMax: 50,
    perCallPrice: 0.02,
    subscriptionPrice: 29.99
  });
  
  // Start server
  gateway.start(3000);
  
  // Simulate some API calls
  console.log('Simulating API calls...\n');
  
  // Wait a bit for server to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  try {
    // Simulate automation call
    const response1 = await fetch('http://localhost:3000/api/v1/automate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'create user account',
        parameters: { name: 'John', email: 'john@example.com' },
        userId: 'user-123'
      })
    });
    
    const result1 = await response1.json();
    console.log('Automation result:', result1);
    
    // Simulate content generation call
    const response2 = await fetch('http://localhost:3000/api/v1/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'email',
        prompt: 'Welcome message for new user',
        userId: 'user-123'
      })
    });
    
    const result2 = await response2.json();
    console.log('Content generation result:', result2);
    
    // Check usage metrics
    const usageResponse = await fetch('http://localhost:3000/api/v1/usage/user-123');
    const usage = await usageResponse.json();
    console.log('Usage metrics:', usage);
    
    // Check billing
    const billingResponse = await fetch('http://localhost:3000/api/v1/billing/user-123');
    const billing = await billingResponse.json();
    console.log('Billing info:', billing);
    
    // Show overall metrics
    console.log('\n=== GATEWAY METRICS ===\n');
    const metrics = gateway.getMetrics();
    console.log(JSON.stringify(metrics, null, 2));
    
  } catch (error) {
    console.error('Demo error:', error);
  }
}

// Run demonstration
if (require.main === module) {
  demonstrateProductizedGateway().catch(console.error);
}

module.exports = ProductizedAPIGateway;
