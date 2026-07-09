/**
 * HEIDI Tool Registry
 * Real capabilities the chat brain can invoke, gated by the agent permission
 * ladder (C:\ProtoForge_Ecosystem\Agent_Sandbox\PERMISSIONS.md).
 *
 * Rule 3 of the ladder: the permission_level stored in agent_registry is the
 * law — every execute() checks it before running the handler. Every execution
 * (allowed or denied) is written to system_state for the audit trail.
 *
 * Levels: 0 observe | 1 read | 2 create | 3 approved commands | 4 full
 */

const SERVICE_PROBES = [
  { name: 'heidi-bridge',   url: 'http://127.0.0.1:5050/health' },
  { name: 'dashboard',      url: 'http://127.0.0.1:3000/' },
  { name: 'mobile-chat',    url: 'http://127.0.0.1:3006/api/health' },
  { name: 'supabase-local', url: 'http://127.0.0.1:54321/rest/v1/' },
  { name: 'ollama',         url: 'http://127.0.0.1:11434/api/tags' },
  { name: 'openvino',       url: 'http://127.0.0.1:11435/' }
];

// 8s: bridge and local Supabase take 3-5s to answer when the box is busy
// with Ollama inference — a 3s timeout falsely reported them DOWN.
async function probe(url, timeoutMs = 8000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    // Any HTTP response means the service is listening; 4xx/5xx on a bare
    // probe URL (missing api key, no route) still proves liveness.
    return { up: true, http: r.status };
  } catch {
    return { up: false };
  }
}

class ToolRegistry {
  /**
   * @param {HeidiMemory} memory  initialized sqlite store (agent_registry + missions live here)
   * @param {object} opts  { ollamaUrl, selfStatus: () => object, actions: ActionExecutor }
   */
  constructor(memory, opts = {}) {
    this.memory = memory;
    this.ollamaUrl = opts.ollamaUrl || process.env.OLLAMA_URL || 'http://localhost:11434';
    this.selfStatus = opts.selfStatus || (() => ({}));
    // Shared with /act and the mission worker -- one executor, one allowlist,
    // one place that enforces "no git push/merge" (see action-executor.js).
    this.actions = opts.actions || null;

    this.tools = {
      system_status: {
        level: 1,
        description: 'Check live health of all HYDI services (heidi-core, bridge, dashboard, mobile chat, local Supabase, Ollama, OpenVINO). Use whenever asked about system status or health.',
        parameters: { type: 'object', properties: {}, required: [] },
        handler: async () => {
          // Flat strings, not nested objects — small local models summarize
          // "dashboard: UP" reliably; they misread {up:true,http:200}.
          const services = { 'heidi-core': 'UP' };
          let models = [];
          await Promise.all(SERVICE_PROBES.map(async (s) => {
            const p = await probe(s.url);
            services[s.name] = p.up ? 'UP' : 'DOWN';
          }));
          try {
            const r = await fetch(`${this.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
            if (r.ok) models = ((await r.json()).models || []).map(m => m.name);
          } catch {}
          return {
            hydi_services: services,
            ollama_models_installed: models,
            note: 'UP means the service responded. This IS the connected HYDI system.'
          };
        }
      },

      list_models: {
        level: 1,
        description: 'List AI models installed in Ollama and which are currently loaded in memory.',
        parameters: { type: 'object', properties: {}, required: [] },
        handler: async () => {
          const out = { installed: [], loaded: [] };
          try {
            const r = await fetch(`${this.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
            if (r.ok) {
              const d = await r.json();
              out.installed = (d.models || []).map(m => ({
                name: m.name,
                size_gb: m.size ? Math.round(m.size / 1e8) / 10 : null
              }));
            }
          } catch (e) { out.error = 'ollama unreachable'; }
          try {
            const r = await fetch(`${this.ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(3000) });
            if (r.ok) {
              const d = await r.json();
              out.loaded = (d.models || []).map(m => m.name);
            }
          } catch {}
          return out;
        }
      },

      list_agents: {
        level: 1,
        description: 'List all registered HYDI agents with their roles and permission levels.',
        parameters: { type: 'object', properties: {}, required: [] },
        handler: async () => {
          const agents = await this.memory.listAgents(false);
          return agents.map(a => ({
            name: a.name, role: a.role,
            permission_level: a.permission_level, enabled: !!a.enabled
          }));
        }
      },

      list_missions: {
        level: 1,
        description: 'List missions from the persistent mission queue, optionally filtered by status (pending, active, blocked, completed, failed, cancelled).',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Optional status filter' },
            limit: { type: 'integer', description: 'Max rows, default 20' }
          },
          required: []
        },
        handler: async (args = {}) =>
          this.memory.getMissions(args.status || null, args.limit || 20)
      },

      create_mission: {
        level: 2,
        description: 'Add a new mission (persistent goal) to the queue. Priority: 0 low, 1 normal, 2 high, 3 critical. Optionally attach a structured action (type: run_command|run_script, plus its fields) and assign it to an agent -- the mission worker only ever executes it for real if that agent independently already holds permission_level >= 3 (proposing work here does not grant it). Without a structured action, missions are informational only and the worker leaves them alone.',
        parameters: {
          type: 'object',
          properties: {
            goal: { type: 'string', description: 'What should be accomplished' },
            priority: { type: 'integer', description: '0-3, default 1' },
            action: { type: 'object', description: 'Optional structured action for the mission worker, e.g. {"type":"restart_service","service":"heidi-mobile-chat"} or {"type":"run_command","command":"git","args":["status"]}' },
            assigned_agent: { type: 'string', description: 'Agent name whose permission_level gates execution of the action' }
          },
          required: ['goal']
        },
        handler: async (args = {}) => {
          if (!args.goal) return { error: 'goal is required' };
          if (args.action && !args.assigned_agent) return { error: 'assigned_agent is required when attaching an action' };
          const context = args.action ? { action: args.action } : null;
          const id = await this.memory.createMission(args.goal, args.priority ?? 1, context, args.assigned_agent ?? null);
          return { created: true, mission_id: id };
        }
      },

      update_mission: {
        level: 2,
        description: 'Update a mission status (pending, active, blocked, completed, failed, cancelled), optionally recording a result.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'Mission id' },
            status: { type: 'string', description: 'New status' },
            result: { type: 'string', description: 'Optional outcome note' }
          },
          required: ['id', 'status']
        },
        handler: async (args = {}) => {
          const changes = await this.memory.updateMission(args.id, args.status, args.result ?? null);
          return changes ? { updated: true } : { error: `mission ${args.id} not found` };
        }
      },

      search_memory: {
        level: 1,
        description: 'Keyword-search Heidi\'s long-term memory for stored facts.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search terms' } },
          required: ['query']
        },
        handler: async (args = {}) => this.memory.searchFacts(args.query || '', 5)
      },

      remember_fact: {
        level: 2,
        description: 'Store an important fact in Heidi\'s persistent long-term memory.',
        parameters: {
          type: 'object',
          properties: {
            fact: { type: 'string', description: 'The fact to remember' },
            category: { type: 'string', description: 'Category, default general' }
          },
          required: ['fact']
        },
        handler: async (args = {}) => {
          if (!args.fact) return { error: 'fact is required' };
          const id = await this.memory.storeFact(args.fact, args.category || 'general', 0.7);
          return { stored: true, fact_id: id };
        }
      },

      // ── Level 3: approved commands. Reached via /chat-tools, which the
      // general middleware above already requires HEIDI_SECRET (or localhost)
      // for -- so a remote caller needs both the secret AND permission_level
      // >= 3 on the acting agent. Both back onto the SAME ActionExecutor /act
      // uses, including its git push/merge refusal. ──

      run_command: {
        level: 3,
        description: 'Run an approved command (git, npm, node, powershell, echo, cat, ls, dir) and return its output. git push and git merge are always refused -- landing changes on a remote or protected branch requires a human.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Bare executable name, e.g. "git" or "npm"' },
            args: { type: 'array', items: { type: 'string' }, description: 'Arguments' }
          },
          required: ['command']
        },
        handler: async (args = {}) => {
          if (!this.actions) return { error: 'run_command unavailable: no ActionExecutor configured' };
          if (!args.command) return { error: 'command is required' };
          try {
            const { result } = await this.actions.execute({ type: 'run_command', command: args.command, args: args.args || [] });
            return result;
          } catch (e) {
            return { error: e.message };
          }
        }
      },

      restart_service: {
        level: 3,
        description: 'Restart one supervised HYDI module (see boot.config.json for ids, e.g. "heidi-mobile-chat", "protoforge-core", "heidi-web"). Stops only the PID bound to that module\'s own port, then re-launches it via boot-agent -- never a blanket process kill.',
        parameters: {
          type: 'object',
          properties: {
            service: { type: 'string', description: 'Module id from boot.config.json' }
          },
          required: ['service']
        },
        handler: async (args = {}) => {
          if (!this.actions) return { error: 'restart_service unavailable: no ActionExecutor configured' };
          if (!args.service) return { error: 'service is required' };
          try {
            const { result } = await this.actions.execute({
              type: 'run_script',
              target: 'scripts/restart-module.js',
              args: [args.service]
            });
            return result;
          } catch (e) {
            return { error: e.message };
          }
        }
      }
    };
  }

  /** Ollama /api/chat `tools` array */
  toOllamaTools() {
    return Object.entries(this.tools).map(([name, t]) => ({
      type: 'function',
      function: { name, description: t.description, parameters: t.parameters }
    }));
  }

  /** Execute a tool as the named agent, enforcing the permission ladder. */
  async execute(name, args = {}, agentName = 'Heidi') {
    const tool = this.tools[name];
    if (!tool) return { error: `unknown tool: ${name}` };

    let agent = null;
    try { agent = await this.memory.getAgent(agentName); } catch {}
    const level = agent && agent.enabled ? agent.permission_level : 0;
    const allowed = level >= tool.level;

    // Audit trail — PERMISSIONS.md rule 5
    this.memory.storeSystemState('tool_execution', {
      tool: name, agent: agentName, agent_level: level,
      required_level: tool.level, allowed, args
    }, allowed ? 'info' : 'warning').catch(() => {});

    if (!allowed) {
      return {
        error: `permission denied: ${agentName} is level ${level}, ${name} requires level ${tool.level}`
      };
    }

    try {
      return await tool.handler(args);
    } catch (e) {
      return { error: `${name} failed: ${e.message}` };
    }
  }
}

module.exports = ToolRegistry;
