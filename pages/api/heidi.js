/**
 * Heidi API Endpoint - Contextual Conscience with Local Models
 * Serves POST /api/heidi from the Next.js pages router.
 * Handles chat requests, health integration, and local model switching.
 *
 * Requires a service or device credential with 'heidi:chat': this route
 * forwards prompts to a model backend and can switch the active model, and
 * was previously reachable with no auth or rate limit at all (ISSUES_FOUND.md
 * #53 — the unbridged api/heidi/route.js copy was archived, but this live
 * duplicate had been missed).
 */

import { createClient } from '@supabase/supabase-js';
import { HeidiLocalHandler } from '../../api/local-model';
import { requireAuth } from '../../lib/auth/requireAuth';

// Lazy client for requireAuth's device-token lookup and audit log.
let _supabase = null;
function getSupabase() {
  if (!_supabase && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}

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
    console.log('[Heidi] Initialized successfully');
  } catch (error) {
    initError = error.message;
    console.error('[Heidi] Initialization failed:', error);
  }
}

// Initialize in background
initializeHeidi();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res, getSupabase(), { permission: 'heidi:chat', routeName: 'heidi-chat', rateMax: 30 });
  if (!auth.ok) return;

  try {
    const { message, context, model, action } = req.body || {};

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
    console.error('[Heidi] Handler error:', error);
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
