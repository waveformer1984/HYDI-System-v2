/**
 * HEIDI Core Server
 * The heartbeat of the system
 *
 * Simple loop: listen → retrieve → generate → store → reflect → act
 */

require('dotenv').config(); // load .env before any module reads process.env
const express = require('express');
const OllamaClient = require('./brain/ollama-client');

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

class HeidiCore {
  constructor(config = {}) {
    this.app = express();
    this.port = config.port || process.env.HEIDI_PORT || 3456;
    
    // Core components
    this.brain = new OllamaClient(config.brain);
    this.memory = new HeidiMemory(config.memory);
    this.reflection = new ReflectionEngine(this.memory, config.reflection);
    this.actions = new ActionExecutor(config.actions);

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

        // 1. RETRIEVE context from memory
        let memoryContext;
        try {
          memoryContext = await this.memory.buildContext(input);
        } catch (error) {
          console.error('[HEIDI] Memory retrieval failed:', error.message);
          memoryContext = { recent_interactions: [], relevant_facts: [], recent_reflections: [], system_health: [] };
        }

        // 2. GENERATE response with timeout and error handling
        let response;
        let generationStatus = 'success';
        try {
          const prompt = this.buildPrompt(input, memoryContext, context);
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

        // 3. STORE in memory
        const confidence = this.estimateConfidence(response.text, memoryContext);
        await this.memory.storeShortTerm(input, response.text, context, confidence);

        // 4. REFLECT (async, don't block response)
        if (confidence > 0.7) {
          this.reflection.reflect(input, response.text, confidence).then(insight => {
            if (insight) this.stats.reflections++;
          });
        }

        // 5. CHECK for action triggers
        const action = this.detectAction(input, response.text);
        if (action && this.actions.isSafe(action)) {
          // Queue action for execution (don't block response)
          this.executeActionAsync(action);
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
  }

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

  getSystemPersonality() {
    return `You are Heidi, the ProtoForge contextual conscience and system health advisor.

Your traits:
- Helpful and knowledgeable about the HYDI system
- Calm and reassuring during issues
- Clear and concise in your responses
- Slightly warm and friendly

You have access to:
- System health monitoring
- Memory of past interactions
- Reflections on patterns and insights
- Ability to execute approved actions

Be direct. Don't over-explain. Focus on what matters.`;
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
    await heidi.memory.close();
    process.exit(0);
  });
}

module.exports = HeidiCore;
