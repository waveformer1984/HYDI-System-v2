/**
 * Heidi API Endpoint - Contextual Conscience with Local Models
 * Handles chat requests, health integration, and local model switching
 */

const { HeidiLocalHandler } = require('../local-model');
const { rateLimit } = require('../../lib/rate-limit');
const logger = require('../../lib/structured-logger').child({ component: 'HeidiRoute' });

// Initialize Heidi handler
const heidiHandler = new HeidiLocalHandler({
  baseURL: process.env.LOCAL_MODEL_URL || 'http://localhost:11434',
  model: process.env.LOCAL_MODEL_NAME || 'llama2',
  provider: process.env.LOCAL_MODEL_PROVIDER || 'ollama'
});

// Initialize on startup
let isInitialized = false;
let initError = null;

async function initializeHeidi() {
  if (isInitialized) return;
  
  try {
    await heidiHandler.initialize();
    isInitialized = true;
    logger.info('[Heidi] Initialized successfully');
  } catch (error) {
    initError = error.message;
    logger.error('[Heidi] Initialization failed', { error });
  }
}

// Initialize in background
initializeHeidi();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!rateLimit(req, res, { name: 'heidi-chat', windowMs: 60 * 1000, max: 30 })) {
    return;
  }

  try {
    const { message, context, model, action } = req.body;
    
    // Handle special actions
    if (action === 'status') {
      return handleStatusRequest(res);
    }
    
    if (action === 'models') {
      return handleModelsRequest(res);
    }
    
    if (action === 'switch_model' && model) {
      return handleModelSwitch(model, res);
    }
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // Get response from Heidi
    const response = await heidiHandler.handleMessage(message, context);
    
    return res.status(200).json({
      response: response.text,
      model: response.model,
      provider: response.provider,
      healthContext: response.healthContext,
      usage: response.usage,
      fallback: response.fallback,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Heidi] Handler error', { error });
    return res.status(500).json({
      error: error.message,
      initialized: isInitialized,
      initError: initError
    });
  }
}

/**
 * Handle status requests
 */
async function handleStatusRequest(res) {
  const available = await heidiHandler.client.isAvailable();
  const models = available ? await heidiHandler.client.getModels() : [];
  
  return res.status(200).json({
    initialized: isInitialized,
    available,
    currentModel: heidiHandler.client.model,
    provider: heidiHandler.client.provider,
    availableModels: models,
    initError: initError,
    timestamp: new Date().toISOString()
  });
}

/**
 * Handle available models request
 */
async function handleModelsRequest(res) {
  try {
    const models = await heidiHandler.client.getModels();
    
    return res.status(200).json({
      models,
      current: heidiHandler.client.model,
      provider: heidiHandler.client.provider,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

/**
 * Handle model switching
 */
async function handleModelSwitch(modelName, res) {
  try {
    await heidiHandler.switchModel(modelName);
    
    return res.status(200).json({
      message: `Switched to model: ${modelName}`,
      currentModel: heidiHandler.client.model,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}
