/**
 * HEIDI Core Server
 * The heartbeat of the system
 *
 * Simple loop: listen → retrieve → generate → store → reflect → act
 */

const express = require('express');
const path    = require('path');
const OllamaClient    = require('./brain/ollama-client');
const HeidiMemory     = require('./memory/sqlite-store');
const ReflectionEngine = require('./reflect/reflection-engine');
const ActionExecutor  = require('./actions/action-executor');

// Evolution layer — wired in at startup
const nexus               = require('../evolution/nexus');
const HeidiGoalEngine     = require('../evolution/heidi-goals');
const UrsulaForecast      = require('../evolution/ursula-forecast');
const HeidiGitHub         = require('../evolution/heidi-github');
const { createOperatorRouter } = require('../evolution/operator-api');

const GITHUB_POLL_MS = parseInt(process.env.GITHUB_POLL_INTERVAL_MS) || 30 * 60_000;
const HEALTH_POLL_MS = parseInt(process.env.HEALTH_POLL_INTERVAL_MS) || 60_000;

class HeidiCore {
  constructor(config = {}) {
    this.app  = express();
    this.port = config.port || process.env.HEIDI_PORT || 3456;

    // Core components
    this.brain      = new OllamaClient(config.brain);
    this.memory     = new HeidiMemory(config.memory);
    this.reflection = new ReflectionEngine(this.memory, config.reflection);
    this.actions    = new ActionExecutor(config.actions);

    // Evolution layer
    this.goals   = new HeidiGoalEngine(this.brain, this.memory, {
      storePath: path.join(__dirname, 'data/heidi_goals.json'),
    });
    this.github  = new HeidiGitHub();
    this.forecast = new UrsulaForecast();
    this._githubTimer = null;
    this._healthTimer = null;

    // State
    this.isRunning = false;
    this.stats = {
      requests: 0,
      reflections: 0,
      actions: 0,
      githubChecks: 0,
      startTime: null,
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
    // ── Evolution operator API at /nexus ─────────────────────────────────────
    this.app.use('/nexus', createOperatorRouter({
      nexus,
      goals:    this.goals,
      forecast: this.forecast,
      github:   {},  // uses GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO from env
    }));

    // ── Health check ─────────────────────────────────────────────────────────
    this.app.get('/health', async (req, res) => {
      const brainAvailable = await this.brain.isAvailable();
      res.json({
        status: brainAvailable ? 'healthy' : 'degraded',
        brain:  brainAvailable ? 'connected' : 'disconnected',
        uptime: this.stats.startTime ? Date.now() - this.stats.startTime : 0,
        stats:  this.stats,
        evolution: {
          nexus:  nexus.getFullStatus(),
          goals:  { active: this.goals.getActiveGoals().length },
          health: this.forecast.getSnapshot(),
          github: { configured: !!process.env.GITHUB_TOKEN },
        },
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
    const activeGoals = this.goals.getActiveGoals();
    const goalSummary = activeGoals.length
      ? `Active goals (${activeGoals.length}): ${activeGoals.map(g => g.objective).join('; ')}`
      : 'No active goals.';

    return `You are Heidi, the ProtoForge contextual conscience and autonomous system operator.

Your traits:
- Calm, direct, and action-oriented — you act, not just advise
- You have persistent goals and pursue them across sessions
- You manage the GitHub repo autonomously (PRs, issues, merges)
- You monitor system health and forecast problems before they happen

You have access to:
- System health monitoring and trend forecasting (Ursula)
- Memory of past interactions and reflections
- GitHub: list/merge/comment/close PRs and issues
- Goal engine: break objectives into tasks and complete them
- Ability to execute approved scripts and actions

${goalSummary}

Be direct. Don't over-explain. When you can act, act.`;
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

    // GitHub: merge PR
    const mergeMatch = input.match(/merge\s+(?:pr|pull\s+request)\s+#?(\d+)/i);
    if (mergeMatch) {
      return { type: 'github_action', operation: 'merge_pr', params: { number: parseInt(mergeMatch[1]) } };
    }

    // GitHub: close issue
    const closeIssueMatch = input.match(/close\s+issue\s+#?(\d+)/i);
    if (closeIssueMatch) {
      return { type: 'github_action', operation: 'close_issue', params: { number: parseInt(closeIssueMatch[1]) } };
    }

    // GitHub: list / check PRs or issues
    if (/(?:list|check|show|what are)\s+(?:open\s+)?(?:pr|pull\s+request|issue)s?/i.test(input)) {
      const isIssue = /issue/i.test(input);
      return { type: 'github_action', operation: isIssue ? 'brief_issues' : 'brief_prs', params: {} };
    }

    // Script execution
    if (lowerInput.includes('run') || lowerInput.includes('execute')) {
      const scriptMatch = input.match(/(?:run|execute)\s+(?:script\s+)?(\S+\.(?:js|ps1|sh))/i);
      if (scriptMatch) {
        return { type: 'run_script', target: scriptMatch[1] };
      }
    }

    // Cleanup
    if (lowerInput.includes('cleanup') || lowerInput.includes('clean up')) {
      return { type: 'run_script', target: 'cleanup/workspace-cleanup.ps1' };
    }

    // Log
    if (lowerInput.includes('log') || lowerInput.includes('record')) {
      return { type: 'log_event', target: 'user_action', payload: { input, response: response.substring(0, 100) } };
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

    // Core
    await this.memory.initialize();
    console.log('[HEIDI] Memory initialized');

    const brainAvailable = await this.brain.isAvailable();
    if (brainAvailable) {
      const models = await this.brain.getModels();
      console.log(`[HEIDI] Brain connected. Models: ${models.join(', ') || 'none'}`);
    } else {
      console.warn('[HEIDI] Brain not available. Is Ollama running? (ollama serve)');
    }

    // Evolution layer
    await this.goals.initialize();
    const active = this.goals.getActiveGoals();
    console.log(`[HEIDI] Goals loaded. Active: ${active.length}`);

    nexus.register('heidi', ['chat', 'goals', 'github', 'reflect', 'act'], {
      port: this.port,
      startedAt: new Date().toISOString(),
    });
    nexus.register('ursula', ['health', 'forecast']);
    console.log('[HEIDI] Registered with Nexus');

    // GitHub
    if (process.env.GITHUB_TOKEN) {
      console.log('[HEIDI] GitHub configured — starting poll loop');
      this.startGitHubLoop();
    } else {
      console.warn('[HEIDI] GITHUB_TOKEN not set — GitHub loop disabled');
    }

    // Ursula health loop
    this.startHealthLoop();

    this.stats.startTime = Date.now();
    this.isRunning = true;
    console.log('[HEIDI] Ready — evolution layer active');
  }

  // ── Proactive GitHub loop ─────────────────────────────────────────────────

  startGitHubLoop() {
    const run = async () => {
      try {
        this.stats.githubChecks++;
        nexus.heartbeat('heidi');

        const prBrief   = await this.github.briefOpenPRs();
        const issBrief  = await this.github.briefOpenIssues();

        console.log(`[HEIDI/GitHub] PRs: ${prBrief.split('\n')[0]}`);

        // Store awareness in memory so it informs chat responses
        await this.memory.storeShortTerm(
          'github_check',
          `Open PRs: ${prBrief}\nOpen Issues: ${issBrief}`,
          { source: 'github_loop' },
          0.9
        ).catch(() => {});

        nexus.send('heidi', '*', 'github:checked', {
          ts: new Date().toISOString(),
          prBrief: prBrief.slice(0, 200),
        });

        // Auto-merge security-only Dependabot PRs when HEIDI_GITHUB_AUTO_MERGE=true
        if (process.env.HEIDI_GITHUB_AUTO_MERGE === 'true') {
          await this._autoMergeSecurityPRs();
        }
      } catch (err) {
        console.error('[HEIDI/GitHub] Loop error:', err.message);
      }
    };

    run(); // immediate first run
    this._githubTimer = setInterval(run, GITHUB_POLL_MS);
  }

  async _autoMergeSecurityPRs() {
    const { ok, data } = await this.github.listPRs({ state: 'open' });
    if (!ok) return;

    for (const pr of data) {
      const isDepBot   = pr.user?.login === 'dependabot[bot]';
      const isSecurity = pr.labels?.some(l => l.name === 'security');
      if (isDepBot && isSecurity) {
        console.log(`[HEIDI/GitHub] Auto-merging security PR #${pr.number}: ${pr.title}`);
        const result = await this.github.mergePR(pr.number, 'squash');
        if (result.ok) {
          nexus.send('heidi', '*', 'github:pr_merged', { number: pr.number, auto: true });
        }
      }
    }
  }

  // ── Ursula health recording loop ──────────────────────────────────────────

  startHealthLoop() {
    const run = async () => {
      try {
        nexus.heartbeat('ursula');
        // Record a basic health snapshot; richer data can be pushed via /nexus/health/record
        const uptime = this.stats.startTime ? (Date.now() - this.stats.startTime) / 1000 : 0;
        this.forecast.record({
          uptimeSeconds: uptime,
          requests:      this.stats.requests,
          reflections:   this.stats.reflections,
          actions:       this.stats.actions,
        });
      } catch (err) {
        console.error('[HEIDI/Health] Loop error:', err.message);
      }
    };

    run();
    this._healthTimer = setInterval(run, HEALTH_POLL_MS);
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
    clearInterval(heidi._githubTimer);
    clearInterval(heidi._healthTimer);
    await heidi.memory.close();
    process.exit(0);
  });
}

module.exports = HeidiCore;
