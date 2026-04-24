/**
 * API Routes for Ursula Service Bundle
 * RESTful endpoints for service execution, subscriptions, and management
 */

const express = require('express');
const SubscriptionManager = require('../../services/subscription-manager');
const { authenticateToken } = require('../../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const subscriptionManager = new SubscriptionManager();

// Rate limiting for API calls
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: 'Too many API requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

router.use(apiLimiter);

/**
 * Get all available services
 */
router.get('/services', authenticateToken, async (req, res) => {
  try {
    const { tier = 'starter' } = req.query;
    const services = subscriptionManager.serviceBundle.getServicesByTier(tier);
    
    res.json({
      success: true,
      data: services,
      count: services.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Tiered permission middleware - enforces service access by subscription tier
 * Returns 403 Forbidden if user tries to access a service above their tier
 */
const checkServicePermission = (req, res, next) => {
  const userTier = req.user?.tier || 'starter';
  const serviceId = req.params?.serviceId || req.body?.serviceId;
  
  if (!serviceId) {
    return res.status(400).json({
      success: false,
      error: 'Service ID is required'
    });
  }
  
  // Get service tier requirement
  const service = subscriptionManager.serviceBundle.services.get(serviceId);
  if (!service) {
    return res.status(404).json({
      success: false,
      error: 'Service not found'
    });
  }
  
  // Tier hierarchy: starter(0) < pro(1) < enterprise(2)
  const tierHierarchy = { starter: 0, pro: 1, enterprise: 2 };
  const userTierLevel = tierHierarchy[userTier] ?? 0;
  const requiredTierLevel = tierHierarchy[service.tier] ?? 0;
  
  if (userTierLevel < requiredTierLevel) {
    // 403 Forbidden - user doesn't have permission for this service tier
    return res.status(403).json({
      success: false,
      error: 'Access denied: This service requires a higher subscription tier',
      currentTier: userTier,
      requiredTier: service.tier,
      serviceId: serviceId,
      upgradeUrl: `${process.env.BASE_URL}/subscriptions/upgrade?tier=${service.tier}`
    });
  }
  
  // User has permission, attach service info to request
  req.serviceInfo = service;
  next();
};

/**
 * Execute a service
 */
router.post('/services/:serviceId/execute', authenticateToken, checkServicePermission, async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { input } = req.body;
    const subscriptionId = req.user.subscriptionId;

    // Validate input
    if (!input) {
      return res.status(400).json({
        success: false,
        error: 'Input is required'
      });
    }

    // Execute service
    const result = await subscriptionManager.serviceBundle.executeService(
      serviceId,
      input,
      subscriptionId
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get service usage metrics
 */
router.get('/usage', authenticateToken, async (req, res) => {
  try {
    const subscriptionId = req.user.subscriptionId;
    const metrics = subscriptionManager.serviceBundle.getUsageMetrics(subscriptionId);

    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Create subscription checkout session
 */
router.post('/subscriptions/checkout', authenticateToken, async (req, res) => {
  try {
    const { tier } = req.body;
    const customerId = req.user.stripeCustomerId;

    if (!['starter', 'pro', 'enterprise'].includes(tier)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid tier'
      });
    }

    const session = await subscriptionManager.createCheckoutSession(
      customerId,
      tier,
      `${process.env.BASE_URL}/account?success=true`,
      `${process.env.BASE_URL}/pricing?canceled=true`
    );

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        url: session.url
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Create customer portal session
 */
router.post('/subscriptions/portal', authenticateToken, async (req, res) => {
  try {
    const customerId = req.user.stripeCustomerId;
    const session = await subscriptionManager.createPortalSession(customerId);

    res.json({
      success: true,
      data: {
        url: session.url
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get subscription details
 */
router.get('/subscriptions', authenticateToken, async (req, res) => {
  try {
    const subscriptionId = req.user.subscriptionId;
    const report = await subscriptionManager.getCustomerUsageReport(
      req.user.id
    );

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Upgrade/downgrade subscription
 */
router.put('/subscriptions', authenticateToken, async (req, res) => {
  try {
    const { newTier } = req.body;
    const subscriptionId = req.user.subscriptionId;

    if (!['starter', 'pro', 'enterprise'].includes(newTier)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid tier'
      });
    }

    const updatedSubscription = await subscriptionManager.updateSubscription(
      subscriptionId,
      newTier
    );

    res.json({
      success: true,
      data: updatedSubscription
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Cancel subscription
 */
router.delete('/subscriptions', authenticateToken, async (req, res) => {
  try {
    const subscriptionId = req.user.subscriptionId;
    const canceledSubscription = await subscriptionManager.cancelSubscription(
      subscriptionId
    );

    res.json({
      success: true,
      data: {
        message: 'Subscription canceled at end of period',
        cancelAtPeriodEnd: canceledSubscription.cancel_at_period_end
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Stripe webhook endpoint
 */
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  await subscriptionManager.handleWebhook(req, res);
});

/**
 * Get service bundle information
 */
router.get('/bundle', async (req, res) => {
  try {
    const bundle = subscriptionManager.serviceBundle.exportBundle();
    
    res.json({
      success: true,
      data: bundle
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get analytics (admin only)
 */
router.get('/analytics', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const analytics = await subscriptionManager.getSubscriptionAnalytics();
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Trigger self-marketing (admin only)
 */
router.post('/marketing/trigger', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    await subscriptionManager.serviceBundle.selfMarketing();
    
    res.json({
      success: true,
      message: 'Self-marketing triggered'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
