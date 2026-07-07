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
   * @param {object} opts  { ollamaUrl, selfStatus: () => object }
   */
  constructor(memory, opts = {}) {
    this.memory = memory;
    this.ollamaUrl = opts.ollamaUrl || process.env.OLLAMA_URL || 'http://localhost:11434';
    this.selfStatus = opts.selfStatus || (() => ({}));

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
        description: 'Add a new mission (persistent goal) to the queue. Priority: 0 low, 1 normal, 2 high, 3 critical.',
        parameters: {
          type: 'object',
          properties: {
            goal: { type: 'string', description: 'What should be accomplished' },
            priority: { type: 'integer', description: '0-3, default 1' }
          },
          required: ['goal']
        },
        handler: async (args = {}) => {
          if (!args.goal) return { error: 'goal is required' };
          const id = await this.memory.createMission(args.goal, args.priority ?? 1);
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
