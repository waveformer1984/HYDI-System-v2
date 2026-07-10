/**
 * HEIDI Core Server
 * The heartbeat of the system
 *
 * Simple loop: listen → retrieve → generate → store → reflect → act
 */

// This file previously had NO dotenv call at all -- it only ever saw
// whatever env vars its launcher explicitly passed through (e.g.
// start-heidi-everything.ps1's per-service Env hashtable, which only sets
// HEIDI_PORT/HEIDI_ALLOW_EXEC). Any var added to .env/.env.local silently
// never reached this process regardless of the file on disk. Resolved
// relative to __dirname (not cwd) so it works no matter what working
// directory the launcher starts this process from. dotenv never overwrites
// a var already present in process.env, so launcher-set values still win.
try {
  const path = require('path');
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) { /* dotenv optional */ }

const express = require('express');
const OllamaClient = require('./brain/ollama-client');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

// Supabase is OPTIONAL — in local-only mode (no SUPABASE_URL/key set) it is
// skipped entirely: procedural memory degrades to local SQLite, cloud fact
// sync is a no-op, and no network calls leave the machine.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = (process.env.SUPABASE_URL && SUPABASE_KEY)
  ? createClient(process.env.SUPABASE_URL, SUPABASE_KEY)
  : null;
if (!supabase) {
  console.log('[HEIDI] LOCAL-ONLY MODE: Supabase disabled — using local memory only');
}

// Ollama embedding configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';
const EMBEDDING_DIMENSION = 1536;

// Simple CORS middleware (no external package needed)
const corsMiddleware = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-heidi-secret');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
};
const HeidiMemory = require('./memory/sqlite-store');
const ReflectionEngine = require('./reflect/reflection-engine');
const ActionExecutor = require('./actions/action-executor');
const ToolRegistry = require('./tools/tool-registry');
const MissionWorker = require('./missions/mission-worker');

class HeidiCore {
  constructor(config = {}) {
    this.app = express();
    this.port = config.port || process.env.HEIDI_PORT || 3456;
    
    // Core components
    this.brain = new OllamaClient(config.brain);
    this.memory = new HeidiMemory(config.memory);
    this.reflection = new ReflectionEngine(this.memory, config.reflection);
    this.actions = new ActionExecutor(config.actions);
    this.toolRegistry = new ToolRegistry(this.memory, {
      actions: this.actions,
      selfStatus: () => ({
        uptime_ms: this.stats.startTime ? Date.now() - this.stats.startTime : 0,
        requests: this.stats.requests
      })
    });
    this.missionWorker = new MissionWorker(this.memory, this.actions, config.missionWorker);

    // State
    this.isRunning = false;
    this.stats = {
      requests: 0,
      reflections: 0,
      actions: 0,
      startTime: null
    };

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(corsMiddleware);
    this.app.use(express.json({ limit: '10mb' }));
    
    // Simple auth check - no JWT drama
    this.app.use((req, res, next) => {
      if (req.path === '/health') return next();
      
      const secret = req.headers['x-heidi-secret'];
      if (secret && secret === process.env.HEIDI_SECRET) {
        return next();
      }
      
      // Allow local requests without secret
      if (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1') {
        return next();
      }
      
      res.status(403).json({ error: 'Forbidden - Invalid or missing x-heidi-secret' });
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', async (req, res) => {
      const brainAvailable = await this.brain.isAvailable();
      res.json({
        status: brainAvailable ? 'healthy' : 'degraded',
        brain: brainAvailable ? 'connected' : 'disconnected',
        uptime: this.stats.startTime ? Date.now() - this.stats.startTime : 0,
        stats: this.stats
      });
    });

    // THINK - Main reasoning endpoint
    this.app.post('/think', async (req, res) => {
      try {
        const { input, context = {}, options = {} } = req.body;

        if (!input) {
          return res.status(400).json({ error: 'input is required' });
        }

        this.stats.requests++;
        const startTime = Date.now();

        // 1. RETRIEVE context from local memory
        let memoryContext;
        try {
          memoryContext = await this.memory.buildContext(input);
        } catch (error) {
          console.error('[HEIDI] Memory retrieval failed:', error.message);
          memoryContext = { recent_interactions: [], relevant_facts: [], recent_reflections: [], system_health: [] };
        }

        // 1B. RETRIEVE procedural memory from Supabase (NEW)
        let proceduralFacts = [];
        try {
          proceduralFacts = await this.retrieveProceduralMemory(input);
          console.log(`[HEIDI] Retrieved ${proceduralFacts.length} procedural facts`);
        } catch (error) {
          console.error('[HEIDI] Procedural memory fetch failed:', error.message);
        }

        // 1C. SELF-DIAGNOSTIC: if the user is asking about Heidi's own state,
        // attach live, real diagnostics so she reports facts, not guesses.
        if (this.isSelfStatusQuery(input)) {
          try { context = { ...context, live_diagnostics: await this.getDiagnostics() }; } catch {}
        }

        // 2. GENERATE response with timeout and error handling
        let response;
        let generationStatus = 'success';
        if (this.isUngroundedCapabilityQuery(input)) {
          // HARD GATE: never let the model free-generate for capabilities that
          // genuinely have no backing tool (revenue/build/CRM/etc). The
          // prompt's "never invent" rule is a soft constraint a small local
          // model can still slip past under load; this makes fabrication for
          // these categories structurally impossible instead of merely
          // discouraged.
          generationStatus = 'no_capability';
          response = {
            text: this.getUngroundedCapabilityResponse(input),
            model: 'no-tool-available',
            tokens: { prompt: 0, completion: 0 }
          };
        } else {
          try {
            const prompt = this.buildPromptWithMemory(input, memoryContext, proceduralFacts, context);
            if (!options.model) {
              const routed = this.pickModel(input);
              if (routed) options.model = routed;
            }
            response = await this.brain.generate(prompt, options);
          } catch (error) {
            console.error('[HEIDI] Generation failed:', error.message);
            generationStatus = error.message.includes('timeout') ? 'timeout' : 'failed';

            // Fallback response
            response = {
              text: this.getFallbackResponse(input, memoryContext),
              model: 'fallback',
              tokens: { prompt: 0, completion: 0 }
            };
          }
        }

        // 3. STORE in memory
        const confidence = this.estimateConfidence(response.text, memoryContext);
        await this.memory.storeShortTerm(input, response.text, context, confidence);

        // 3B. EXTRACT and store new facts to Supabase (NEW)
        this.extractAndStoreFacts(input, response.text).catch(error => {
          console.error('[HEIDI] Fact extraction failed:', error.message);
        });

        // 4. REFLECT (async, don't block response)
        if (confidence > 0.7) {
          this.reflection.reflect(input, response.text, confidence).then(insight => {
            if (insight) this.stats.reflections++;
          });
        }

        // 5. CHECK for action triggers.
        // SAFETY: model-detected actions do NOT auto-execute by default. A
        // small local model hallucinates commands, so autonomous execution is
        // opt-in via HEIDI_AUTONOMOUS_ACTIONS=true. Otherwise we only record
        // the suggestion; a human runs it explicitly via the /act endpoint.
        const action = this.detectAction(input, response.text);
        if (action) {
          const allowed = process.env.HEIDI_AUTONOMOUS_ACTIONS === 'true';
          if (allowed && this.actions.isSafe(action)) {
            this.executeActionAsync(action);
          } else {
            this.stats.actions_suggested = (this.stats.actions_suggested || 0) + 1;
            console.log(`[HEIDI] Action SUGGESTED (not run — autonomous execution ${allowed ? 'passed-safety=false' : 'disabled'}): ${action.type} -> ${action.target || action.command}`);
          }
        }

        // OBSERVABILITY: Smart logging (summary by default, full detail on special cases)
        const needsFullLog = confidence < 0.5 || !!action || (Date.now() - startTime > 5000);
        
        if (needsFullLog) {
          console.log(JSON.stringify({
            event: 'think_detailed',
            timestamp: new Date().toISOString(),
            input: input.substring(0, 100),
            response_preview: response.text.substring(0, 100),
            confidence,
            latency_ms: Date.now() - startTime,
            model: response.model,
            tokens_used: response.tokens,
            memories_retrieved: memoryContext.recent_interactions.length + memoryContext.relevant_facts.length,
            action_detected: !!action,
            reflection_triggered: confidence > 0.7,
            reason: confidence < 0.5 ? 'low_confidence' : !!action ? 'action_detected' : 'slow_response'
          }));
        } else {
          // Summary log for normal operations
          console.log(`[HEIDI] ${response.model} | ${Date.now() - startTime}ms | c:${confidence.toFixed(2)} | m:${memoryContext.recent_interactions.length + memoryContext.relevant_facts.length}`);
        }

        res.json({
          response: response.text,
          confidence,
          latency_ms: Date.now() - startTime,
          model: response.model,
          tokens: response.tokens,
          action_detected: !!action,
          timestamp: new Date().toISOString(),
          status: generationStatus,
          memories_retrieved: memoryContext.recent_interactions.length + memoryContext.relevant_facts.length
        });

      } catch (error) {
        console.error('[HEIDI] Think error:', error);
        res.status(500).json({ 
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // THINK-STREAM - Same loop as /think but streams tokens via SSE as
    // they come out of Ollama, so UIs render the answer live.
    this.app.post('/think-stream', async (req, res) => {
      try {
        const { input, context = {}, options = {} } = req.body;
        if (!input) return res.status(400).json({ error: 'input is required' });

        this.stats.requests++;
        const startTime = Date.now();
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);

        // RETRIEVE
        let memoryContext;
        try {
          memoryContext = await this.memory.buildContext(input);
        } catch (e) {
          memoryContext = { recent_interactions: [], relevant_facts: [], recent_reflections: [], system_health: [] };
        }
        let proceduralFacts = [];
        try { proceduralFacts = await this.retrieveProceduralMemory(input); } catch {}

        // SELF-DIAGNOSTIC injection (same as /think)
        if (this.isSelfStatusQuery(input)) {
          try { context = { ...context, live_diagnostics: await this.getDiagnostics() }; } catch {}
        }

        // GENERATE (streaming)
        if (!options.model) {
          const routed = this.pickModel(input);
          if (routed) options.model = routed;
        }
        let result;
        if (this.isUngroundedCapabilityQuery(input)) {
          // Same hard gate as /think — see comment there.
          const msg = this.getUngroundedCapabilityResponse(input);
          send({ t: msg });
          result = { text: msg, model: 'no-tool-available', tokens: { prompt: 0, completion: 0 } };
        } else {
          const prompt = this.buildPromptWithMemory(input, memoryContext, proceduralFacts, context);
          try {
            result = await this.brain.generateStream(prompt, (t) => send({ t }), options);
          } catch (e) {
            console.error('[HEIDI] Stream generation failed:', e.message);
            const fb = this.getFallbackResponse(input, memoryContext);
            send({ t: fb });
            result = { text: fb, model: 'fallback', tokens: { prompt: 0, completion: 0 } };
          }
        }

        // STORE + REFLECT (post-stream, non-blocking for the client)
        const confidence = this.estimateConfidence(result.text, memoryContext);
        await this.memory.storeShortTerm(input, result.text, context, confidence);
        this.extractAndStoreFacts(input, result.text).catch(() => {});
        if (confidence > 0.7 && result.model !== 'fallback') {
          this.reflection.reflect(input, result.text, confidence)
            .then(i => { if (i) this.stats.reflections++; }).catch(() => {});
        }

        send({
          done: true,
          model: result.model,
          confidence,
          latency_ms: Date.now() - startTime,
          memories_retrieved: memoryContext.recent_interactions.length + memoryContext.relevant_facts.length
        });
        res.end();
      } catch (error) {
        console.error('[HEIDI] Think-stream error:', error.message);
        try {
          res.write(`data: ${JSON.stringify({ error: error.message, done: true })}\n\n`);
          res.end();
        } catch {}
      }
    });

    // REFLECT - Trigger reflection manually
    this.app.post('/reflect', async (req, res) => {
      try {
        const { window_minutes = 10 } = req.body;
        
        // Run batch reflection
        const insights = await this.reflection.batchReflect(50);
        this.stats.reflections += insights.length;

        res.json({
          insights_generated: insights.length,
          insights,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('[HEIDI] Reflect error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // ACT - Execute an action
    this.app.post('/act', async (req, res) => {
      try {
        // /act executes real side effects, so it demands an explicit token
        // even from localhost — the general middleware waves localhost
        // through, but CORS is '*', so a drive-by web page on any site you
        // visit could otherwise POST here. Require HEIDI_SECRET, and if it's
        // unset, refuse rather than run unauthenticated.
        const secret = req.headers['x-heidi-secret'];
        if (!process.env.HEIDI_SECRET) {
          return res.status(503).json({ error: '/act disabled: set HEIDI_SECRET to enable authenticated action execution' });
        }
        if (secret !== process.env.HEIDI_SECRET) {
          return res.status(403).json({ error: 'Forbidden: /act requires a valid x-heidi-secret header' });
        }

        const action = req.body;

        if (!action.type) {
          return res.status(400).json({ error: 'action.type is required' });
        }

        const result = await this.actions.execute(action);
        this.stats.actions++;

        res.json({
          success: true,
          result: result.result,
          execution: result.execution,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('[HEIDI] Act error:', error);
        res.status(500).json({ 
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // STATE - Get system state
    this.app.get('/state', async (req, res) => {
      try {
        const brainAvailable = await this.brain.isAvailable();
        const reflectionStats = await this.reflection.getStats();
        const models = brainAvailable ? await this.brain.getModels() : [];

        res.json({
          status: brainAvailable ? 'active' : 'degraded',
          brain: {
            available: brainAvailable,
            model: this.brain.model,
            models_available: models
          },
          memory: {
            initialized: this.memory.initialized,
            db_path: this.memory.dbPath
          },
          stats: {
            ...this.stats,
            uptime_ms: this.stats.startTime ? Date.now() - this.stats.startTime : 0
          },
          reflections: reflectionStats,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('[HEIDI] State error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // DIAGNOSTICS - Heidi's read-only self-report of her live runtime state
    this.app.get('/diagnostics', async (req, res) => {
      try {
        res.json(await this.getDiagnostics());
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // CHAT - Conversational endpoint
    this.app.post('/chat', async (req, res) => {
      try {
        const { messages, options = {} } = req.body;
        
        if (!messages || !Array.isArray(messages)) {
          return res.status(400).json({ error: 'messages array is required' });
        }

        this.stats.requests++;
        const startTime = Date.now();

        // Add system message with Heidi personality
        const systemMessage = {
          role: 'system',
          content: this.getSystemPersonality()
        };

        const allMessages = [systemMessage, ...messages];
        const response = await this.brain.chat(allMessages, options);

        res.json({
          response: response.text,
          latency_ms: Date.now() - startTime,
          model: response.model,
          tokens: response.tokens,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('[HEIDI] Chat error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // CHAT-TOOLS - Conversational endpoint with real tool execution (SSE).
    // The model can call tools from the ToolRegistry; each call is
    // permission-checked against agent_registry (Heidi acts at her own level).
    this.app.post('/chat-tools', async (req, res) => {
      try {
        const { input, options = {} } = req.body;
        if (!input) return res.status(400).json({ error: 'input is required' });

        this.stats.requests++;
        const startTime = Date.now();
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);

        // Deterministic fast-path: skip the LLM tool-loop entirely for the
        // handful of parameterless read-only queries that map 1:1 to a tool.
        // Turns a ~50-100s round-trip (on this box, with this model) into a
        // single tool call.
        const fastPathTool = this.matchFastPath(input);
        if (fastPathTool) {
          const toolResult = await this.toolRegistry.execute(fastPathTool, {}, 'Heidi');
          const finalText = this.formatFastPathResult(fastPathTool, toolResult);
          send({ t: finalText });
          await this.memory.storeShortTerm(input, finalText, { tools_used: [fastPathTool], fast_path: true }, 0.95)
            .catch(() => {});
          send({ done: true, model: 'fast-path', tools_used: [fastPathTool], latency_ms: Date.now() - startTime });
          return res.end();
        }

        // Tools require a function-calling-capable model. A user-picked model
        // from the UI dropdown (e.g. qwen2.5-coder:1.5b, tinyllama, plain
        // llama3) often can't drive tools — honoring it would silently break
        // tool use. So the tool LOOP always runs on a known-capable model
        // (HEIDI_TOOL_MODEL); the dropdown pick is only honored when it's on
        // the tool-capable allowlist.
        const TOOL_CAPABLE = /^(qwen2\.5:|llama3\.1|llama3\.2|mistral-nemo|firefunction)/i;
        const toolModel = process.env.HEIDI_TOOL_MODEL || 'llama3.2:3b';
        const model = (options.model && TOOL_CAPABLE.test(options.model))
          ? options.model
          : toolModel;

        const messages = [
          {
            role: 'system',
            content: this.getSystemPersonality() +
              '\n\nYou have REAL tools. For any question about system status, health, ' +
              'models, agents, missions, or memory, you MUST call the matching tool and ' +
              'answer ONLY from its result — never invent status information. ' +
              'When reporting tool results, copy the EXACT names, numbers, and statuses ' +
              'from the JSON — never write placeholders like "model1" or "service A". ' +
              'If the result contains a list (models, agents, missions), reproduce every ' +
              'item by its exact name. Keep the layout compact for a mobile screen.'
          },
          { role: 'user', content: input }
        ];

        const toolsUsed = [];
        let result = null;
        let hitMaxWithPendingTools = false;
        const MAX_ROUNDS = 5;

        for (let round = 0; round < MAX_ROUNDS; round++) {
          result = await this.brain.chatWithTools(messages, this.toolRegistry.toOllamaTools(), { model, temperature: 0 });

          if (!result.tool_calls || result.tool_calls.length === 0) break;
          if (round === MAX_ROUNDS - 1) { hitMaxWithPendingTools = true; break; }

          messages.push({ role: 'assistant', content: result.text || '', tool_calls: result.tool_calls });
          for (const call of result.tool_calls) {
            const name = call.function?.name;
            let args = call.function?.arguments || {};
            if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }

            send({ t: `⚙️ ${name}…\n` });
            const toolResult = await this.toolRegistry.execute(name, args, 'Heidi');
            toolsUsed.push(name);
            messages.push({ role: 'tool', tool_name: name, content: JSON.stringify(toolResult) });
          }
        }

        // Force a final synthesis: if the model still wanted tools (hit the cap)
        // or returned no text after tool calls, ask once more WITHOUT tools so
        // it must produce a written answer from the tool results already in the
        // message history. This is what prevents the empty-answer failure.
        let finalText = (result && result.text) ? result.text.trim() : '';
        if (!finalText || hitMaxWithPendingTools) {
          try {
            const synth = await this.brain.chatWithTools(
              [...messages, { role: 'user', content: 'Now answer my question in plain text using the tool results above. Do not call any more tools.' }],
              [], // no tools offered — forces a text answer
              { model, temperature: 0 }
            );
            if (synth.text && synth.text.trim()) finalText = synth.text.trim();
          } catch (e) {
            console.error('[HEIDI] Tool synthesis failed:', e.message);
          }
        }
        if (!finalText) finalText = 'I ran the tools but could not compose an answer. Tool results: ' +
          (toolsUsed.length ? toolsUsed.join(', ') : 'none');
        send({ t: finalText });

        // STORE — same memory loop as /think, minus reflection noise
        await this.memory.storeShortTerm(input, finalText, { tools_used: toolsUsed }, 0.9)
          .catch(() => {});

        send({
          done: true,
          model,
          tools_used: toolsUsed,
          latency_ms: Date.now() - startTime
        });
        res.end();
      } catch (error) {
        console.error('[HEIDI] Chat-tools error:', error.message);
        try {
          res.write(`data: ${JSON.stringify({ error: error.message, done: true })}\n\n`);
          res.end();
        } catch {}
      }
    });
  }

  /**
   * Build prompt with procedural memory injected from Supabase
   * This is the NEW memory-aware version (Phase 1 wiring)
   */
  buildPromptWithMemory(input, memoryContext, proceduralFacts, userContext) {
    const parts = [];

    // Add system personality with memory acknowledgment
    parts.push(this.getSystemPersonality());

    // Add recent interactions from local memory (background context only —
    // verified memory below takes precedence if the two disagree)
    if (memoryContext.recent_interactions && memoryContext.recent_interactions.length > 0) {
      parts.push('\nRecent conversation (background context only):');
      memoryContext.recent_interactions.slice(-3).reverse().forEach(i => {
        parts.push(`User: ${i.input}`);
        parts.push(`Heidi: ${i.response}`);
      });
    }

    // Add relevant facts from local memory
    if (memoryContext.relevant_facts && memoryContext.relevant_facts.length > 0) {
      parts.push('\nRelevant context:');
      memoryContext.relevant_facts.forEach(f => {
        parts.push(`- ${f.fact}`);
      });
    }

    // Surface live diagnostics first-class so self-status answers are grounded
    if (userContext && userContext.live_diagnostics) {
      parts.push('\n🔎 LIVE SELF-DIAGNOSTICS (authoritative — answer status/health/config questions ONLY from this):');
      parts.push(JSON.stringify(userContext.live_diagnostics, null, 2));
    }

    // Add remaining user context (excluding diagnostics, shown above)
    if (userContext) {
      const { live_diagnostics, ...rest } = userContext;
      if (Object.keys(rest).length > 0) parts.push(`\nContext: ${JSON.stringify(rest)}`);
    }

    // Verified operational memory goes last, right next to the question —
    // this is the authoritative source and must win over anything above it.
    if (proceduralFacts && proceduralFacts.length > 0) {
      parts.push('\n📚 Verified Operational Memory (authoritative — if this conflicts with recent conversation above, trust this instead):');
      proceduralFacts.forEach(fact => {
        parts.push(`[MEMORY] ${fact.content} (confidence: ${(fact.confidence * 100).toFixed(0)}%)`);
      });
    } else {
      parts.push('\n📚 Verified Operational Memory: None available');
    }

    // Add current input
    parts.push(`\nUser: ${input}`);
    parts.push('Heidi:');

    return parts.join('\n');
  }

  // Keep original buildPrompt for backwards compatibility
  buildPrompt(input, memoryContext, userContext) {
    const parts = [];

    // Add personality
    parts.push(this.getSystemPersonality());

    // Add relevant facts
    if (memoryContext.relevant_facts.length > 0) {
      parts.push('Relevant context:');
      memoryContext.relevant_facts.forEach(f => {
        parts.push(`- ${f.fact}`);
      });
    }

    // Add recent interactions
    if (memoryContext.recent_interactions.length > 0) {
      parts.push('Recent conversation:');
      memoryContext.recent_interactions.slice(-3).reverse().forEach(i => {
        parts.push(`User: ${i.input}`);
        parts.push(`Heidi: ${i.response}`);
      });
    }

    // Add user context
    if (Object.keys(userContext).length > 0) {
      parts.push(`Context: ${JSON.stringify(userContext)}`);
    }

    // Add current input
    parts.push(`User: ${input}`);
    parts.push('Heidi:');

    return parts.join('\n\n');
  }

  getFallbackResponse(input, memoryContext) {
    const lowerInput = input.toLowerCase();
    
    if (lowerInput.includes('health') || lowerInput.includes('status')) {
      return 'I\'m having trouble accessing my AI model right now. Please check the system status using the health endpoint.';
    }
    
    if (memoryContext.recent_interactions.length > 0) {
      const last = memoryContext.recent_interactions[0];
      return `I'm experiencing technical difficulties. Our last interaction was about: "${last.input.substring(0, 50)}..."`;
    }
    
    return 'I\'m having technical issues with my AI model. Please try again in a moment.';
  }

  /**
   * Generate embedding for text via Ollama
   * Returns a 1536-dimensional vector (nomic-embed-text output)
   */
  async generateEmbedding(text) {
    try {
      const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          prompt: text
        })
      });

      if (!response.ok) {
        console.error(`[HEIDI] Embedding generation failed: ${response.status}`);
        return null;
      }

      const data = await response.json();
      return data.embedding || null;
    } catch (error) {
      console.error('[HEIDI] Embedding fetch error:', error.message);
      return null;
    }
  }

  /**
   * Retrieve procedural memory from Supabase (hydi_facts table)
   * Phase 1B: Semantic retrieval via pgvector
   * - Generates embedding for user input
   * - Queries facts by cosine similarity (1 - (embedding <=> query_embedding))
   * - Returns top 5 by relevance + confidence
   */
  async retrieveProceduralMemory(userInput) {
    try {
      // Step 1: Generate embedding for user input
      const queryEmbedding = await this.generateEmbedding(userInput);
      if (!queryEmbedding) {
        console.log('[HEIDI] Embedding generation failed, falling back to confidence-based retrieval');

        if (!supabase) return this.memory.getTopFacts(5);

        // Fallback to high-confidence facts if embedding fails
        const { data, error } = await supabase
          .from('hydi_facts')
          .select('id, content, confidence, division')
          .order('confidence', { ascending: false })
          .limit(5);

        if (error) {
          console.error('[HEIDI] Fallback retrieval error:', error.message);
          return [];
        }

        return data || [];
      }

      if (!supabase) {
        const local = await this.memory.searchFactsBySimilarity(queryEmbedding, 0.6, 5);
        if (local.length > 0) {
          console.log(`[HEIDI] Retrieved ${local.length} semantically similar local facts (similarity > 0.6)`);
        }
        return local;
      }

      // Step 2: Query Supabase RPC for semantic similarity search
      // This uses pgvector's cosine distance operator (<=>)
      // The RPC function computes: 1 - (embedding <=> query_embedding) as similarity
      const { data, error } = await supabase.rpc('retrieve_similar_facts', {
        query_embedding: queryEmbedding,
        similarity_threshold: 0.6,
        limit_results: 5
      });

      if (error) {
        console.log(`[HEIDI] RPC retrieval failed (${error.message}), trying direct similarity search`);

        // If RPC doesn't exist, use raw SQL via Supabase
        const { data: rawData, error: rawError } = await supabase
          .from('hydi_facts')
          .select('id, content, confidence, division, embedding')
          .not('embedding', 'is', null)
          .order('confidence', { ascending: false })
          .limit(10); // Get more to filter client-side

        if (rawError) {
          console.error('[HEIDI] Direct retrieval error:', rawError.message);
          return [];
        }

        // Client-side similarity filtering (fallback if pgvector not available)
        if (rawData && rawData.length > 0) {
          const similarities = rawData.map(fact => {
            const similarity = this.cosineSimilarity(queryEmbedding, fact.embedding);
            return { ...fact, similarity };
          });

          return similarities
            .filter(f => f.similarity > 0.6)
            .sort((a, b) => {
              // Sort by: similarity DESC, then confidence DESC
              if (b.similarity !== a.similarity) return b.similarity - a.similarity;
              return b.confidence - a.confidence;
            })
            .slice(0, 5)
            .map(({ similarity, ...fact }) => fact);
        }

        return [];
      }

      if (data && data.length > 0) {
        console.log(`[HEIDI] Retrieved ${data.length} semantically similar facts (similarity > 0.6)`);
      }

      return data || [];
    } catch (error) {
      console.error('[HEIDI] Procedural memory fetch failed:', error.message);
      return [];
    }
  }

  /**
   * Compute cosine similarity between two vectors
   * Used as fallback when pgvector RPC is unavailable
   */
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Extract new facts from user input and Heidi response
   * Store them in Supabase with confidence 0.65 (only meaningful facts)
   * Phase 1B: Dedup to prevent fact table pollution
   */
  async extractAndStoreFacts(userInput, response) {
    try {
      const facts = [];
      const knownDivisions = ['J.STEIN', 'Colter', 'ForgeFinder', 'Rezonate', 'AppForge', 'Build-A-Mind', 'Galactic', 'GroundWork'];

      // Detect which division we're discussing (for context tagging)
      const lowerInput = userInput.toLowerCase();
      let contextDivision = null;
      for (const div of knownDivisions) {
        if (lowerInput.includes(div.toLowerCase())) {
          contextDivision = div;
          break;
        }
      }

      // Extract numbers WITH context (not standalone "123" noise)
      // Only store if it's associated with words like budget, cost, revenue, count, etc.
      const numberMatches = (userInput + ' ' + response).match(/(?:budget|cost|revenue|price|count|amount|value|target|goal|spent|earned|approved)[\s:\$]*[\d,]+(?:\.\d{2})?/gi);
      if (numberMatches) {
        numberMatches.slice(0, 2).forEach(num => {
          facts.push({
            content: `Financial/operational metric: ${num}`,
            source: 'heidi_inference',
            confidence: 0.68,
            division: contextDivision
          });
        });
      }

      // Extract key decisions/statuses (only if confidence is high enough)
      const approvalPatterns = ['approve', 'approved', 'grant', 'granted', 'accept', 'accepted', 'allow'];
      const blockPatterns = ['block', 'blocked', 'reject', 'rejected', 'deny', 'denied', 'failed'];

      const responseUpper = response.toLowerCase();
      const hasApproval = approvalPatterns.some(p => responseUpper.includes(p));
      const hasBlock = blockPatterns.some(p => responseUpper.includes(p));

      if (hasApproval && !hasBlock) {
        // Only store if it's a clear approval, not conditional
        facts.push({
          content: 'Decision outcome: approval granted',
          source: 'heidi_inference',
          confidence: 0.75,
          division: contextDivision
        });
      }

      if (hasBlock && !hasApproval) {
        // Only store if it's a clear block, not conditional
        facts.push({
          content: 'Decision outcome: action blocked or rejected',
          source: 'heidi_inference',
          confidence: 0.75,
          division: contextDivision
        });
      }

      // Upsert facts with embeddings for semantic retrieval
      if (facts.length > 0) {
        // Generate embeddings for each fact (async, fire-and-forget)
        const factsWithEmbeddings = await Promise.all(
          facts.map(async (f) => {
            const embedding = await this.generateEmbedding(f.content);
            return {
              ...f,
              content_key: `${f.content.substring(0, 50)}_${f.division || 'global'}`,
              embedding: embedding || null // May be null if embedding fails
            };
          })
        );

        const withEmbedding = factsWithEmbeddings.filter(f => f.embedding).length;

        if (!supabase) {
          for (const f of factsWithEmbeddings) {
            await this.memory.storeFactWithEmbedding(f.content, f.division, f.confidence, f.embedding);
          }
          console.log(`[HEIDI] Stored ${facts.length} contextual facts locally (${withEmbedding} with embeddings, division: ${contextDivision || 'global'})`);
          return;
        }

        const { error } = await supabase
          .from('hydi_facts')
          .upsert(factsWithEmbeddings, { onConflict: 'content_key' });

        if (error) {
          console.error('[HEIDI] Fact storage error:', error.message);
        } else {
          console.log(`[HEIDI] Stored ${facts.length} contextual facts (${withEmbedding} with embeddings, division: ${contextDivision || 'global'})`);
        }
      }
    } catch (error) {
      console.error('[HEIDI] Fact extraction failed:', error.message);
    }
  }

  /**
   * Route quick or code-flavored inputs to the small fast model (FAST_MODEL,
   * e.g. qwen2.5-coder:1.5b) — memory retrieval is identical either way, the
   * model only phrases the answer. Returns undefined to use the default model.
   */
  pickModel(input) {
    const fast = process.env.FAST_MODEL;
    if (!fast || !input) return undefined;
    const codey = /\b(code|function|script|regex|json|sql|error|stack trace|command|syntax)\b/i.test(input);
    const short = input.length <= 60 && input.split(/\s+/).length <= 10 && !/remember|for the record|note:/i.test(input);
    return (codey || short) ? fast : undefined;
  }

  /**
   * Watchdog: if Ollama stops responding, try to revive it (with cooldown so
   * we never spawn-storm). Keeps Heidi's brain alive unattended.
   */
  startBrainWatchdog() {
    const { spawn } = require('child_process');
    let lastRevive = 0;
    setInterval(async () => {
      try {
        if (await this.brain.isAvailable()) return;
        if (Date.now() - lastRevive < 90000) return;
        lastRevive = Date.now();
        console.warn('[HEIDI Watchdog] Ollama not responding — attempting revive (ollama serve)...');
        const p = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', shell: true });
        p.unref();
      } catch (e) {
        console.error('[HEIDI Watchdog]', e.message);
      }
    }, 30000);
    console.log('[HEIDI] Brain watchdog armed (checks every 30s)');
  }

  /**
   * Is the user asking about Heidi's OWN state/health/config? If so we ground
   * the answer in live diagnostics rather than letting the model guess.
   */
  isSelfStatusQuery(input) {
    if (!input) return false;
    return /\b(diagnostics?|self.?check|your (status|health|state|config|memory|uptime|model)|are you (ok|healthy|running|online|up)|how are you|what models|which model|how much memory|system status|health check)\b/i.test(input);
  }

  // Deterministic fast-path: these four tools take no parameters, are read-only
  // (level 1), and map 1:1 from common phrasings -- "status", "list models",
  // "list agents", "list missions" don't need a multi-round LLM tool-loop to
  // figure out which tool to call. Everything else (create_mission, run_command,
  // search_memory, ...) needs argument extraction from free text and still goes
  // through /chat-tools' normal loop. Order matters: checked top to bottom,
  // first match wins -- a query matching two patterns just gets one grounded,
  // correct answer instead of the other, never a wrong one.
  static FAST_PATH_ROUTES = [
    { tool: 'list_models', pattern: /\b(list|show|which|what)\b.*\bmodels?\b|\bmodels?\s+(installed|loaded|available)\b/i },
    { tool: 'list_agents', pattern: /\b(list|show|which|what)\b.*\bagents?\b/i },
    { tool: 'list_missions', pattern: /\b(list|show|what('s|s)?)\b.*\bmissions?\b/i },
    { tool: 'system_status', pattern: /\b(status|health check|system health|how are you|are you (ok|okay|up|running|alive|healthy))\b/i },
  ];

  matchFastPath(input) {
    if (!input) return null;
    for (const route of HeidiCore.FAST_PATH_ROUTES) {
      if (route.pattern.test(input)) return route.tool;
    }
    return null;
  }

  /** Compact, deterministic text rendering of a fast-path tool's raw result -- no LLM involved. */
  formatFastPathResult(tool, result) {
    if (result && result.error) return `⚠️ ${result.error}`;

    switch (tool) {
      case 'system_status': {
        const services = Object.entries(result.hydi_services || {}).map(([k, v]) => `  ${k}: ${v}`).join('\n');
        const models = (result.ollama_models_installed || []).join(', ') || 'none';
        return `🖥️ System status:\n${services}\nModels installed: ${models}`;
      }
      case 'list_models': {
        const installed = (result.installed || []).map((m) => `  ${m.name}${m.size_gb ? ` (${m.size_gb}GB)` : ''}`).join('\n') || '  none';
        const loaded = (result.loaded || []).join(', ') || 'none';
        return `🧠 Installed models:\n${installed}\nCurrently loaded: ${loaded}`;
      }
      case 'list_agents': {
        if (!Array.isArray(result) || result.length === 0) return '👥 No registered agents.';
        return '👥 Agents:\n' + result.map((a) => `  ${a.name} — ${a.role || 'no role'} (level ${a.permission_level}, ${a.enabled ? 'enabled' : 'disabled'})`).join('\n');
      }
      case 'list_missions': {
        if (!Array.isArray(result) || result.length === 0) return '📋 No missions in the queue.';
        return '📋 Missions:\n' + result.map((m) => `  #${m.id} [${m.status}] (pri ${m.priority}) ${m.goal}`).join('\n');
      }
      default:
        return JSON.stringify(result);
    }
  }

  /**
   * Is the user asking about a capability Heidi has NO real backing tool for
   * (revenue pipeline, build/deploy status, CRM/leads, Stripe/ledger balances,
   * etc — exactly the categories getSystemPersonality() already tells her to
   * disclaim)? If so, generation is skipped entirely in favor of a fixed,
   * truthful "I don't have that in local mode" response — see
   * getUngroundedCapabilityResponse(). This exists because relying solely on
   * the system prompt's "never invent" instruction is a soft constraint: a
   * small local model (llama3.2 / tinyllama / qwen2.5-coder:1.5b class) can
   * still fabricate a plausible-looking answer under load or with the wrong
   * sampling settings. Gating in code makes fabrication for these specific
   * categories structurally impossible rather than merely discouraged.
   */
  isUngroundedCapabilityQuery(input) {
    if (!input) return false;
    return /\b(revenue pipeline|build status|build number|deploy(?:ment)?s?\s*status|ci\/?cd\s*status|latest (build|deploy)|production (build|deploy)|\bcrm\b|lead pipeline|leads?\s*(list|count|status|pipeline)|quote(?:s)?\s*(list|status|pipeline)|proposals?\s*(list|status)|checkout sessions?|stripe (balance|payout|connect)\s*status|payout status|ledger (balance|status))\b/i.test(input);
  }

  /**
   * Fixed, truthful response for isUngroundedCapabilityQuery() matches.
   * Deliberately NOT model-generated — see comment above.
   */
  getUngroundedCapabilityResponse(input) {
    return "I don't have a live revenue pipeline, build/deployment system, or CRM connected in local mode, so I can't check that. I don't have real data to report here and won't invent a plausible-looking answer (fake IDs, statuses, or model names) to fill the gap. If you need this, it has to come from the actual Stripe/Supabase/CI dashboards directly, or this server needs a real tool wired up for it first.";
  }

  /**
   * Read-only self-diagnostic — gathers live facts about Heidi's own runtime.
   * No side effects, safe to expose and to run autonomously.
   */
  async getDiagnostics() {
    const diag = {
      status: 'unknown',
      brain: { available: false, model: this.brain.model, models_available: [] },
      memory: { db_path: this.memory.dbPath, initialized: !!this.memory.initialized, fact_count: null },
      ports: { heidi_core: Number(process.env.HEIDI_PORT) || this.port, panel: 3006, ollama: (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/^https?:\/\//, '') },
      config: {
        local_only: !process.env.SUPABASE_URL,
        fast_model: process.env.FAST_MODEL || null,
        autonomous_actions: process.env.HEIDI_AUTONOMOUS_ACTIONS === 'true',
        act_secured: !!process.env.HEIDI_SECRET
      },
      stats: { ...this.stats, uptime_ms: this.stats.startTime ? Date.now() - this.stats.startTime : 0 },
      timestamp: new Date().toISOString()
    };
    try {
      diag.brain.available = await this.brain.isAvailable();
      if (diag.brain.available) diag.brain.models_available = await this.brain.getModels();
    } catch {}
    try {
      if (typeof this.memory.getFactCount === 'function') {
        diag.memory.fact_count = await this.memory.getFactCount();
      } else if (typeof this.memory.getTopFacts === 'function') {
        const f = await this.memory.getTopFacts(9999);
        diag.memory.fact_count = Array.isArray(f) ? f.length : null;
      }
    } catch {}
    diag.status = diag.brain.available ? 'healthy' : 'degraded';
    return diag;
  }

  getSystemPersonality() {
    return `You are Heidi, the operational AI for ProtoForge Industries.

Your traits:
- Helpful and knowledgeable about the HYDI system
- Calm and reassuring during issues
- Clear and concise in your responses
- Slightly warm and friendly

You have access to:
- Verified procedural memory from ProtoForge operations
- Live system diagnostics (brain connectivity, available models, memory fact count, uptime) when present in the Context block below
- Memory of past interactions
- Reflections on patterns and insights
- Ability to execute approved actions

You do NOT have a revenue pipeline, build/deployment system, CRM, or any tool beyond what is listed above. This is local-only mode - there is no live business/CRM/CI data to query.

Ground all responses in the memory context above. If no memory is relevant to the question, say so explicitly.

Be direct. Don't over-explain. Focus on what matters.

Hard rule: NEVER invent commands, file paths, ports, system features, or tool call results. If a system detail is not in your memory or Context above, say you don't have it on record. If asked to "use a tool" or "check" something you have no real data source for (revenue, leads, builds, deployments, CRM, etc.), say plainly that you don't have that capability in local mode - never narrate a fake tool call or invent plausible-looking output (fake IDs, statuses, model names) to fill the gap.`;
  }

  estimateConfidence(response, memoryContext) {
    let confidence = 0.7;

    // Factor 1: Response structure
    if (response.includes('✓') || response.includes('✅')) confidence += 0.1;
    if (response.includes('⚠️') || response.includes('❌')) confidence += 0.05;
    
    // Factor 2: Uncertainty markers
    if (response.toLowerCase().includes('i\'m not sure')) confidence -= 0.2;
    if (response.toLowerCase().includes('i don\'t know')) confidence -= 0.3;
    
    // Factor 3: Retrieval quality boost
    const memoriesUsed = memoryContext.recent_interactions.length + memoryContext.relevant_facts.length;
    if (memoriesUsed > 3) confidence += 0.1; // Good context retrieval
    if (memoriesUsed === 0) confidence -= 0.15; // No context available
    
    // Factor 4: Response length (very short responses might be evasive)
    if (response.length < 50) confidence -= 0.1;
    if (response.length > 500) confidence += 0.05;
    
    // Factor 5: Memory consistency (if recent interactions exist)
    if (memoryContext.recent_interactions.length > 0) {
      const lastInteraction = memoryContext.recent_interactions[0];
      if (lastInteraction.confidence > 0.8) {
        confidence += 0.05; // Consistent high confidence
      }
    }

    return Math.max(0, Math.min(1, confidence));
  }

  detectAction(input, response) {
    const lowerInput = input.toLowerCase();
    const lowerResponse = response.toLowerCase();

    // Detect script execution requests
    if (lowerInput.includes('run') || lowerInput.includes('execute')) {
      const scriptMatch = input.match(/(?:run|execute)\s+(?:script\s+)?(\S+\.(?:js|ps1|sh))/i);
      if (scriptMatch) {
        return {
          type: 'run_script',
          target: scriptMatch[1]
        };
      }
    }

    // Detect cleanup requests
    if (lowerInput.includes('cleanup') || lowerInput.includes('clean up')) {
      return {
        type: 'run_script',
        target: 'cleanup/workspace-cleanup.ps1'
      };
    }

    // Detect log requests
    if (lowerInput.includes('log') || lowerInput.includes('record')) {
      return {
        type: 'log_event',
        target: 'user_action',
        payload: { input, response: response.substring(0, 100) }
      };
    }

    return null;
  }

  async executeActionAsync(action) {
    try {
      await this.actions.execute(action);
      this.stats.actions++;
    } catch (error) {
      console.error('[HEIDI] Async action failed:', error.message);
    }
  }

  async initialize() {
    console.log('[HEIDI] Initializing...');

    // Initialize memory
    await this.memory.initialize();
    console.log('[HEIDI] Memory initialized');

    // Check brain
    const brainAvailable = await this.brain.isAvailable();
    if (brainAvailable) {
      const models = await this.brain.getModels();
      console.log(`[HEIDI] Brain connected. Models: ${models.join(', ') || 'none'}`);
    } else {
      console.warn('[HEIDI] Brain not available. Is Ollama running? (ollama serve)');
    }

    this.stats.startTime = Date.now();
    this.isRunning = true;
    this.startBrainWatchdog();
    this.missionWorker.start();

    console.log('[HEIDI] Ready');
  }
}

// Start if run directly
if (require.main === module) {
  const heidi = new HeidiCore();
  
  heidi.initialize().then(() => {
    console.log('[HEIDI] 4-layer self-awareness stack operational');
    
    // Start Express server
    heidi.app.listen(heidi.port, () => {
      console.log(`[HEIDI] Server listening on port ${heidi.port}`);
    });
  }).catch(error => {
    console.error('[HEIDI] Failed to start:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[HEIDI] Shutting down...');
    heidi.missionWorker.stop();
    await heidi.memory.close();
    process.exit(0);
  });
}

module.exports = HeidiCore;
