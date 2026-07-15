/**
 * Stripe Webhook Server
 * Dedicated server for processing Stripe webhooks
 */

const express = require('express');
const { handleStripeWebhook } = require('./api/webhooks/stripe');

const app = express();
const PORT = process.env.STRIPE_WEBHOOK_PORT || 3000;

// Middleware for Stripe webhooks
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

// Stripe webhook endpoint
app.post('/api/webhooks/stripe', async (req, res) => {
  await handleStripeWebhook(req, res);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'stripe-webhook-server',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Stripe webhook server running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/api/webhooks/stripe`);
  console.log('Ready to receive Stripe events...');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down Stripe webhook server...');
  process.exit(0);
});

module.exports = app;
