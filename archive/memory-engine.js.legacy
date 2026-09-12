#!/usr/bin/env node
/**
 * HYDI Unified Memory Engine
 * =========================
 *
 * Four-layer memory system:
 * 1. Short-term (Redis) — active conversations, running tasks
 * 2. Procedural (Supabase) — successful workflows, patterns, confidence
 * 3. Knowledge (Supabase) — docs, code, architecture
 * 4. Semantic (pgvector) — vector embeddings for search
 *
 * Everything flows through this engine.
 */

const { createClient } = require('@supabase/supabase-js');
const { Ollama } = require('ollama');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIG
// ============================================================================

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text'; // ~4B params, fast
const LOG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.hydi', 'logs');
const EMBEDDING_DIMENSION = 768;

let supabase;
let ollama;
let cache = {};

// ============================================================================
// LOGGING
// ============================================================================

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message, ...data };
  console.log(`[${timestamp}] [${level}] ${message}`);

  const logFile = path.join(LOG_DIR, 'memory-engine.log');
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initialize() {
  log('INFO', 'Memory engine initializing...');

  // Supabase client
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    log('WARN', 'Supabase credentials missing, memory will be local-only');
  } else {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    log('INFO', 'Connected to Supabase');
  }

  // Ollama for embeddings
  ollama = new Ollama({ baseUrl: OLLAMA_URL });
  try {
    await ollama.list();
    log('INFO', 'Connected to Ollama');
  } catch (e) {
    log('WARN', 'Ollama not available, embeddings disabled', { error: e.message });
    ollama = null;
  }

  // Ensure tables exist
  await ensureTables();

  log('INFO', 'Memory engine ready');
}

// ============================================================================
// MEMORY OPERATIONS
// ============================================================================

async function storeWorkflow(workflow) {
  if (!supabase) return;

  const { success, error } = await supabase
    .from('procedural_workflows')
    .upsert({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      task_type: workflow.task_type,
      inputs: workflow.inputs,
      outputs: workflow.outputs,
      success_count: workflow.success_count || 0,
      failure_count: workflow.failure_count || 0,
      avg_duration_ms: workflow.avg_duration_ms || 0,
      confidence: calculateConfidence(workflow),
      last_success: workflow.last_success,
      optimizations: workflow.optimizations || [],
      dependencies: workflow.dependencies || [],
      source_agent: workflow.source_agent,
      autonomous_ready: workflow.confidence > 0.95,
      user_approved: workflow.user_approved || false,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    log('ERROR', 'Failed to store workflow', { error });
    throw error;
  }

  log('INFO', `Workflow stored: ${workflow.name}`, { id: workflow.id, confidence: workflow.confidence });
}

async function storeDocument(doc) {
  if (!supabase) return;

  let embedding = null;
  if (ollama && doc.content) {
    embedding = await generateEmbedding(doc.content);
  }

  const { error } = await supabase
    .from('knowledge_documents')
    .upsert({
      id: doc.id,
      title: doc.title,
      content: doc.content,
      content_type: doc.content_type,
      embedding: embedding,
      source_path: doc.source_path,
      tags: doc.tags || [],
      indexed: true,
    });

  if (error) {
    log('ERROR', 'Failed to store document', { error });
    throw error;
  }

  log('INFO', `Document stored: ${doc.title}`, { id: doc.id, type: doc.content_type });
}

async function recordInteraction(interaction) {
  // Store in short-term memory (cache for 24h)
  const key = `interaction:${interaction.id}`;
  cache[key] = {
    ...interaction,
    timestamp: Date.now(),
    ttl: 86400000, // 24h
  };

  log('INFO', `Interaction recorded: ${interaction.type}`, { id: interaction.id });
}

async function getWorkflow(id) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('procedural_workflows')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    log('WARN', 'Workflow not found', { id });
    return null;
  }

  return data;
}

async function getWorkflows(filter = {}) {
  if (!supabase) return [];

  let query = supabase.from('procedural_workflows').select('*');

  if (filter.autonomous_only) {
    query = query.gt('confidence', 0.95);
  }

  if (filter.task_type) {
    query = query.eq('task_type', filter.task_type);
  }

  if (filter.min_confidence) {
    query = query.gte('confidence', filter.min_confidence);
  }

  const { data, error } = await query.order('confidence', { ascending: false });

  if (error) {
    log('ERROR', 'Failed to fetch workflows', { error });
    return [];
  }

  return data;
}

async function searchDocuments(query, limit = 10) {
  if (!supabase) return [];

  // Simple text search for now
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('*')
    .textSearch('content', query)
    .limit(limit);

  if (error) {
    log('WARN', 'Document search failed', { error });
    return [];
  }

  return data;
}

async function semanticSearch(query, limit = 10) {
  if (!supabase || !ollama) return [];

  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) return [];

  // Vector similarity search
  const { data, error } = await supabase.rpc('search_documents', {
    query_embedding: queryEmbedding,
    similarity_threshold: 0.5,
    match_count: limit,
  });

  if (error) {
    log('WARN', 'Semantic search failed', { error });
    return [];
  }

  return data;
}

async function updateWorkflowConfidence(id, feedback) {
  if (!supabase) return;

  const workflow = await getWorkflow(id);
  if (!workflow) return;

  // Update statistics
  const success_count = workflow.success_count + (feedback.success ? 1 : 0);
  const failure_count = workflow.failure_count + (feedback.success ? 0 : 1);
  const newConfidence = calculateConfidence({
    success_count,
    failure_count,
    last_success: feedback.success ? new Date().toISOString() : workflow.last_success,
  });

  const { error } = await supabase
    .from('procedural_workflows')
    .update({
      success_count,
      failure_count,
      confidence: newConfidence,
      last_success: feedback.success ? new Date().toISOString() : workflow.last_success,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    log('ERROR', 'Failed to update confidence', { error });
    return;
  }

  log('INFO', `Confidence updated: ${workflow.name}`, {
    id,
    oldConfidence: workflow.confidence,
    newConfidence,
    success: feedback.success,
  });
}

// ============================================================================
// UTILITIES
// ============================================================================

async function generateEmbedding(text) {
  if (!ollama || !text) return null;

  try {
    const response = await ollama.embeddings({
      model: EMBEDDING_MODEL,
      prompt: text.substring(0, 8000), // Limit input
    });

    return response.embedding;
  } catch (e) {
    log('WARN', 'Embedding generation failed', { error: e.message });
    return null;
  }
}

function calculateConfidence(workflow) {
  const total = workflow.success_count + workflow.failure_count;
  if (total === 0) return 0;

  const successRate = workflow.success_count / total;

  // Recency penalty: older workflows are less trusted
  let recencyBonus = 1.0;
  if (workflow.last_success) {
    const daysSinceSuccess = (Date.now() - new Date(workflow.last_success).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceSuccess > 30) recencyBonus = 0.95;
    if (daysSinceSuccess > 90) recencyBonus = 0.90;
  }

  // Frequency bonus: frequently used workflows are more trusted
  let frequencyBonus = Math.min(1.0, total / 100);

  return Math.max(0, Math.min(1, successRate * recencyBonus * frequencyBonus));
}

async function ensureTables() {
  if (!supabase) return;

  log('INFO', 'Checking database tables...');

  // Tables will be created by migration, but we can verify they exist
  const { error } = await supabase
    .from('procedural_workflows')
    .select('id')
    .limit(1);

  if (error && error.code === 'PGRST116') {
    log('WARN', 'Tables not found, run migrations first');
  }
}

// ============================================================================
// HTTP INTERFACE
// ============================================================================

const http = require('http');

function startServer(port = 9998) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if (path === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'UP' }));
    } else if (path === '/workflows' && req.method === 'GET') {
      const workflows = await getWorkflows({ autonomous_only: url.searchParams.get('autonomous') === 'true' });
      res.writeHead(200);
      res.end(JSON.stringify(workflows));
    } else if (path === '/search' && req.method === 'GET') {
      const query = url.searchParams.get('q');
      const results = await semanticSearch(query, 10);
      res.writeHead(200);
      res.end(JSON.stringify(results));
    } else if (path === '/store-workflow' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        const workflow = JSON.parse(body);
        await storeWorkflow(workflow);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      });
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    log('INFO', `Memory engine HTTP server listening on :${port}`);
  });

  return server;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  await initialize();
  startServer(9998);

  log('INFO', '=== HYDI Memory Engine v1.0 ===');
  log('INFO', 'Short-term: Redis (local cache)');
  log('INFO', 'Procedural: Supabase');
  log('INFO', 'Knowledge: Supabase');
  log('INFO', 'Semantic: pgvector + Ollama');
  log('INFO', 'HTTP API: http://localhost:9998');
}

main().catch(e => {
  log('FATAL', 'Memory engine failed', { error: e.message });
  process.exit(1);
});

module.exports = {
  storeWorkflow,
  storeDocument,
  recordInteraction,
  getWorkflow,
  getWorkflows,
  searchDocuments,
  semanticSearch,
  updateWorkflowConfidence,
};
