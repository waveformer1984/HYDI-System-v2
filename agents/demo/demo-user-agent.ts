/**
 * demo-user-agent.ts
 *
 * Self-contained demo agent that walks through the HYDI/Heidi system as a
 * simulated user.  Runs every major interaction path: briefing → chat →
 * status → task creation → approval → swarm → revenue query → session summary.
 *
 * Usage:
 *   npx ts-node agents/demo/demo-user-agent.ts              # mock mode
 *   npx ts-node agents/demo/demo-user-agent.ts --live       # live servers
 *   npx ts-node agents/demo/demo-user-agent.ts --live --portal  # heidi portal (3003)
 *   npx ts-node agents/demo/demo-user-agent.ts --scenario health
 *
 * Available scenarios:  full | health | tasks | revenue | swarm
 */

import { createHmac, randomBytes } from 'crypto'
import { EventEmitter } from 'events'

// ── Types (mirrored from types/index.ts) ──────────────────────────────────────

interface SessionState {
  session_id: string
  tone: 'neutral' | 'focused' | 'degraded' | 'recovery'
  active_model: 'local' | 'api'
  last_action_status: 'success' | 'failure' | 'pending'
}

interface ActionLog {
  type: string
  status: 'pending' | 'completed' | 'failed'
  created_at: string
  payload?: Record<string, unknown>
}

type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
type TaskType =
  | 'chat' | 'copilot_suggestion' | 'autopilot_plan' | 'ursula_handoff'
  | 'suggestion' | 'workflow' | 'proposal' | 'testing' | 'system_config'
  | 'user_management' | 'data_deletion' | 'payment_processing' | 'security_change'

interface LocalTask {
  taskId: string
  userId?: string
  title: string
  type: TaskType
  summary: string
  arguments: Record<string, unknown>
  priority: TaskPriority
  confidence: number
  approvalRequired: boolean
  originIntent: string
  status: string
  traceId: string
  createdAt: string
  updatedAt: string
  lastError: string | null
  retryCount?: number
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  actions?: Record<string, unknown>[]
}

// ── Config ─────────────────────────────────────────────────────────────────────

interface DemoConfig {
  mode: 'mock' | 'live'
  dashboardUrl: string
  portalUrl: string
  usePortal: boolean
  scenario: 'full' | 'health' | 'tasks' | 'revenue' | 'swarm'
  userId: string
  serviceSecret: string
  verbose: boolean
}

function parseArgs(): DemoConfig {
  const args = process.argv.slice(2)
  return {
    mode: args.includes('--live') ? 'live' : 'mock',
    dashboardUrl: process.env.HYDI_DASHBOARD_URL ?? 'http://localhost:3000',
    portalUrl: process.env.HEIDI_PORTAL_URL ?? 'http://localhost:3003',
    usePortal: args.includes('--portal'),
    scenario: (args.find(a => a.startsWith('--scenario='))?.split('=')[1] as DemoConfig['scenario']) ?? 'full',
    userId: process.env.DEMO_USER_ID ?? 'demo-user-001',
    serviceSecret: process.env.HYDI_SERVICE_SECRET ?? 'demo-secret-key-for-local-testing',
    verbose: args.includes('--verbose'),
  }
}

// ── Logger ────────────────────────────────────────────────────────────────────

const RESET = '\x1b[0m'
const BOLD  = '\x1b[1m'
const DIM   = '\x1b[2m'
const GREEN = '\x1b[32m'
const CYAN  = '\x1b[36m'
const YELLOW = '\x1b[33m'
const RED   = '\x1b[31m'
const MAGENTA = '\x1b[35m'
const BLUE  = '\x1b[34m'

class DemoLogger {
  private stepCount = 0

  step(label: string) {
    this.stepCount++
    console.log(`\n${BOLD}${CYAN}[Step ${this.stepCount}]${RESET} ${BOLD}${label}${RESET}`)
  }

  send(text: string) {
    console.log(`  ${YELLOW}▶ User:${RESET}  ${text}`)
  }

  recv(text: string) {
    const lines = text.split('\n')
    const prefix = `  ${GREEN}◀ Heidi:${RESET} `
    console.log(prefix + lines[0])
    for (const line of lines.slice(1)) {
      console.log(' '.repeat(11) + line)
    }
  }

  info(text: string) {
    console.log(`  ${BLUE}ℹ${RESET}  ${text}`)
  }

  warn(text: string) {
    console.log(`  ${YELLOW}⚠${RESET}  ${text}`)
  }

  ok(text: string) {
    console.log(`  ${GREEN}✓${RESET}  ${text}`)
  }

  fail(text: string) {
    console.log(`  ${RED}✗${RESET}  ${text}`)
  }

  task(t: LocalTask) {
    console.log(`  ${MAGENTA}📋 Task created${RESET}`)
    console.log(`     ID:       ${t.taskId}`)
    console.log(`     Title:    ${t.title}`)
    console.log(`     Type:     ${t.type}`)
    console.log(`     Priority: ${t.priority}`)
    console.log(`     Status:   ${t.status}`)
    console.log(`     Approval: ${t.approvalRequired ? 'REQUIRED' : 'not required'}`)
  }

  divider(label?: string) {
    const line = '─'.repeat(60)
    if (label) {
      const pad = Math.max(0, 60 - label.length - 4) / 2
      console.log(`\n${DIM}${'─'.repeat(Math.floor(pad))} ${label} ${'─'.repeat(Math.ceil(pad))}${RESET}`)
    } else {
      console.log(`\n${DIM}${line}${RESET}`)
    }
  }

  header(text: string) {
    console.log(`\n${BOLD}${MAGENTA}${'═'.repeat(60)}${RESET}`)
    console.log(`${BOLD}${MAGENTA}  ${text}${RESET}`)
    console.log(`${BOLD}${MAGENTA}${'═'.repeat(60)}${RESET}`)
  }

  summary(stats: Record<string, unknown>) {
    console.log(`\n${BOLD}Demo Summary${RESET}`)
    for (const [k, v] of Object.entries(stats)) {
      console.log(`  ${DIM}${k.padEnd(22)}${RESET}${v}`)
    }
  }
}

// ── HMAC Service Token ────────────────────────────────────────────────────────

function makeServiceToken(service: string, secret: string): string {
  const ts = Date.now().toString()
  const requestId = randomBytes(8).toString('hex')
  const payload = `${ts}:${requestId}:${service}`
  const sig = createHmac('sha256', secret).update(payload).digest('hex')
  return `${ts}.${requestId}.${service}.${sig}`
}

// ── Mock Response Library ────────────────────────────────────────────────────

const MOCK_DELAY_MS = 400

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const MOCK_RESPONSES: Record<string, string> = {
  greeting:
    "Hey there! I'm Heidi, the AI operator for ProtoForge Industries. The system is healthy and I have 2 tasks awaiting your approval. What would you like to work on?",

  status:
    "✅ HYDI Status: operational\n📈 Trend: stable\n\n• Pipeline determinism: 0.98 (24h window)\n• Active tasks: 3\n• Pending approvals: 2\n• Memory connected: true\n• Active model: claude-opus-4-7 (API)",

  pipeline_health:
    "Pipeline Health — last 24h:\n\n  Determinism score:  0.978\n  Events processed:   1,204\n  Classification acc: 99.1%\n  Drift events:       0\n  Avg latency:        142ms\n\nAll layers operating within normal parameters.",

  task_queued:
    "Got it. I've created a workflow task to analyze the revenue pipeline for Q2. It's been queued with high priority. I'll ping you when it's complete — or you can check the task queue.",

  approvals:
    "You have 2 tasks pending approval:\n\n  1. [task-abc-001] Deploy billing-retry-worker (high priority)\n     Created 18m ago · Risk: medium\n\n  2. [task-abc-002] Revenue analysis: Q2 pipeline (high priority)\n     Created just now · Risk: low\n\nWould you like to approve them?",

  approve:
    "Task approved and queued for execution. I'll notify you when it completes. Anything else?",

  swarm:
    "Swarm triggered. I've decomposed 'Optimize Q2 revenue pipeline' into 4 parallel sub-tasks:\n\n  1. revenue_agent    → Analyze current revenue mix\n  2. marketing_agent  → Identify top-funnel gaps\n  3. finance_agent    → Model pricing adjustment impact\n  4. outreach_agent   → Surface partnership opportunities\n\nAll 4 agents are now running. ETA ~3 minutes. I'll consolidate the results and brief you.",

  revenue:
    "Revenue snapshot — last 30 days:\n\n  rezonate:              $4,210 net\n  waveformer_studio:     $2,880 net\n  galactic_bytes:        $1,540 net\n  detailer_bot:          $920 net\n  lipi_v2:               $610 net\n  protogrance_aromatics: $380 net\n\n  Total net:             $10,540\n  Platform fees earned:  $641\n  Agent fees earned:     $1,283",

  session_summary:
    "Session summary:\n\n  • 7 messages exchanged\n  • 2 tasks created (1 approved, 1 queued)\n  • 1 swarm triggered across 4 agents\n  • Pipeline health confirmed: determinism 0.978\n  • No drift events detected\n\nSession memory saved. See you next time.",
}

// ── HTTP Client ───────────────────────────────────────────────────────────────

interface ApiResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  latencyMs?: number
}

class HydiApiClient {
  private readonly config: DemoConfig
  private readonly log: DemoLogger
  constructor(config: DemoConfig, log: DemoLogger) {
    this.config = config
    this.log = log
  }

  private get baseUrl(): string {
    return this.config.usePortal ? this.config.portalUrl : this.config.dashboardUrl
  }

  async post<T>(path: string, body: unknown, service = 'heidi'): Promise<ApiResponse<T>> {
    if (this.config.mode === 'mock') {
      await delay(MOCK_DELAY_MS)
      return { ok: true, data: { mock: true } as T, latencyMs: MOCK_DELAY_MS }
    }
    const url = `${this.baseUrl}${path}`
    const token = makeServiceToken(service, this.config.serviceSecret)
    try {
      const start = Date.now()
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': this.config.userId,
          'x-hydi-service-token': token,
        },
        body: JSON.stringify(body),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        return { ok: false, error: `HTTP ${res.status}: ${text}`, latencyMs }
      }
      const data = (await res.json()) as T
      return { ok: true, data, latencyMs }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'network error' }
    }
  }

  async get<T>(path: string): Promise<ApiResponse<T>> {
    if (this.config.mode === 'mock') {
      await delay(MOCK_DELAY_MS)
      return { ok: true, data: { mock: true } as T, latencyMs: MOCK_DELAY_MS }
    }
    const url = `${this.baseUrl}${path}`
    try {
      const start = Date.now()
      const res = await fetch(url, {
        headers: { 'x-user-id': this.config.userId },
      })
      const latencyMs = Date.now() - start
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      return { ok: true, data: (await res.json()) as T, latencyMs }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'network error' }
    }
  }
}

// ── Demo User Session ─────────────────────────────────────────────────────────

interface DemoStats {
  messagesExchanged: number
  tasksCreated: number
  tasksApproved: number
  swarmsTriggered: number
  apiCallsTotal: number
  apiCallsFailed: number
  totalLatencyMs: number
}

class DemoUserSession extends EventEmitter {
  readonly sessionId: string
  private history: ChatMessage[] = []
  private tasks: LocalTask[] = []
  private stats: DemoStats = {
    messagesExchanged: 0,
    tasksCreated: 0,
    tasksApproved: 0,
    swarmsTriggered: 0,
    apiCallsTotal: 0,
    apiCallsFailed: 0,
    totalLatencyMs: 0,
  }

  readonly config: DemoConfig
  private readonly api: HydiApiClient
  private readonly log: DemoLogger
  constructor(config: DemoConfig, api: HydiApiClient, log: DemoLogger) {
    super()
    this.config = config
    this.api = api
    this.log = log
    this.sessionId = `demo-session-${randomBytes(6).toString('hex')}`
  }

  // ── Core chat ──────────────────────────────────────────────────────────────

  async chat(userMessage: string, system = 'heidi'): Promise<string> {
    this.log.send(userMessage)
    this.history.push({
      id: randomBytes(4).toString('hex'),
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    })

    let responseText: string

    if (this.config.mode === 'mock') {
      await delay(MOCK_DELAY_MS)
      responseText = this.selectMockResponse(userMessage, system)
    } else {
      const result = await this.api.post<{ response: string; system: string }>(
        '/api/chat',
        {
          message: userMessage,
          session_id: this.sessionId,
          user_id: this.config.userId,
          system,
        },
        system,
      )
      this.recordApiCall(result)
      if (!result.ok || !result.data) {
        responseText = `[API error: ${result.error ?? 'no response'}]`
      } else {
        responseText = result.data.response ?? JSON.stringify(result.data)
      }
    }

    this.history.push({
      id: randomBytes(4).toString('hex'),
      role: 'assistant',
      content: responseText,
      timestamp: new Date(),
    })
    this.stats.messagesExchanged++
    this.log.recv(responseText)
    return responseText
  }

  // ── Briefing ───────────────────────────────────────────────────────────────

  async loadBriefing(): Promise<void> {
    if (this.config.mode === 'mock') {
      await delay(MOCK_DELAY_MS)
      this.log.recv(MOCK_RESPONSES['greeting']!)
      return
    }
    const result = await this.api.get<{ ok: boolean; briefingText?: string }>('/api/briefing')
    this.recordApiCall(result)
    if (result.ok && result.data?.briefingText) {
      this.log.recv(result.data.briefingText)
    } else {
      this.log.warn('Briefing unavailable — using fallback greeting')
      this.log.recv("Hi, I'm Heidi. How can I help you today?")
    }
  }

  // ── Task creation ──────────────────────────────────────────────────────────

  async createTask(opts: {
    title: string
    type?: TaskType
    summary?: string
    priority?: TaskPriority
    confidence?: number
    approvalRequired?: boolean
    originIntent?: string
    args?: Record<string, unknown>
  }): Promise<LocalTask | null> {
    const {
      title, type = 'workflow', summary = '', priority = 'medium',
      confidence = 0.8, approvalRequired = false, originIntent = title,
      args = {},
    } = opts

    if (this.config.mode === 'mock') {
      await delay(MOCK_DELAY_MS)
      const fakeTask: LocalTask = {
        taskId: `task-${randomBytes(5).toString('hex')}`,
        userId: this.config.userId,
        title,
        type,
        summary,
        arguments: args,
        priority,
        confidence,
        approvalRequired,
        originIntent,
        status: approvalRequired ? 'needs_approval' : 'queued',
        traceId: randomBytes(8).toString('hex'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastError: null,
      }
      this.tasks.push(fakeTask)
      this.stats.tasksCreated++
      this.log.task(fakeTask)
      return fakeTask
    }

    const result = await this.api.post<{ ok: boolean; task: LocalTask }>(
      '/api/tasks/create',
      {
        userId: this.config.userId,
        title,
        type,
        summary,
        priority,
        confidence,
        approvalRequired,
        originIntent,
        arguments: args,
      },
    )
    this.recordApiCall(result)
    if (!result.ok || !result.data?.task) {
      this.log.fail(`Task creation failed: ${result.error ?? 'unknown error'}`)
      return null
    }
    const task = result.data.task
    this.tasks.push(task)
    this.stats.tasksCreated++
    this.log.task(task)
    return task
  }

  // ── Approvals ──────────────────────────────────────────────────────────────

  async approveTask(taskId: string, reason?: string): Promise<boolean> {
    this.log.info(`Approving task ${taskId}…`)

    if (this.config.mode === 'mock') {
      await delay(MOCK_DELAY_MS / 2)
      this.stats.tasksApproved++
      this.log.ok(`Task ${taskId} approved (mock)`)
      return true
    }

    const result = await this.api.post<{ ok: boolean }>(
      `/api/approvals/${taskId}`,
      { action: 'approve', reason: reason ?? 'demo approval' },
    )
    this.recordApiCall(result)
    if (result.ok) {
      this.stats.tasksApproved++
      this.log.ok(`Task ${taskId} approved (${result.latencyMs}ms)`)
      return true
    }
    this.log.fail(`Approval failed: ${result.error}`)
    return false
  }

  async rejectTask(taskId: string, reason: string): Promise<boolean> {
    this.log.info(`Rejecting task ${taskId}…`)

    if (this.config.mode === 'mock') {
      await delay(MOCK_DELAY_MS / 2)
      this.log.ok(`Task ${taskId} rejected (mock)`)
      return true
    }

    const result = await this.api.post<{ ok: boolean }>(
      `/api/approvals/${taskId}`,
      { action: 'deny', reason },
    )
    this.recordApiCall(result)
    if (result.ok) {
      this.log.ok(`Task ${taskId} rejected`)
      return true
    }
    this.log.fail(`Rejection failed: ${result.error}`)
    return false
  }

  // ── System health ──────────────────────────────────────────────────────────

  async checkHealth(): Promise<void> {
    if (this.config.mode === 'mock') {
      await delay(MOCK_DELAY_MS / 2)
      this.log.ok('Health: operational (mock)')
      return
    }
    const result = await this.api.get('/api/health')
    this.recordApiCall(result)
    if (result.ok) {
      this.log.ok(`Health OK (${result.latencyMs}ms)`)
      if (this.config.verbose) this.log.info(JSON.stringify(result.data, null, 2))
    } else {
      this.log.warn(`Health check returned error: ${result.error}`)
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private recordApiCall(result: ApiResponse) {
    this.stats.apiCallsTotal++
    if (!result.ok) this.stats.apiCallsFailed++
    if (result.latencyMs) this.stats.totalLatencyMs += result.latencyMs
  }

  private selectMockResponse(message: string, system: string): string {
    const m = message.toLowerCase()
    // System-specific routing takes priority
    if (system === 'ursula')        return MOCK_RESPONSES['status']!
    if (system === 'hyve')          return '🐝 Hyve: 3 optimization opportunities detected\n\n  1. Rezonate subscription upgrade rate is 12% below benchmark\n  2. Galactic Bytes has untapped enterprise segment\n  3. Waveformer Studio has 4 pending artist onboards stalled'
    if (system === 'kilo')          return '🔧 KILO — Hypotheses generated:\n\n  H1: Redis connection pool exhaustion (confidence: 0.82)\n     Suggested fix: Increase pool size from 10→25 in billing-retry-worker config\n\n  H2: Supabase RPC timeout under load (confidence: 0.71)\n     Suggested fix: Add retry with exponential backoff in edge function\n\n  H3: Memory leak in long-running worker process (confidence: 0.54)\n     Suggested fix: Add process restart schedule every 6 hours'
    if (system === 'cascade')       return '⚡ CASCADE — Event classified:\n\n  Classification: PAYMENT_PROCESSING_FAILURE\n  Sub-class:      CARD_DECLINED_HARD\n  Confidence:     0.94\n  Matched rules:  [stripe_error_codes, retry_policy, revenue_impact]\n  Recommended:    retry=false, notify_customer=true, escalate=false'
    if (system === 'protoforge')    return '🌐 ProtoForge — Policy validation result:\n\n  Policy:   rush_order_pricing\n  Stream:   galactic_bytes\n  Result:   APPROVED\n  Applied:  1.3× base rate multiplier\n  Rationale: Rush order policy v2.1 active — multiplier within allowed range (1.0–1.5)'
    if (system === 'infrastructure') return '🔧 Infrastructure status:\n\n  Vercel:    deployed (last: 2h ago)\n  Supabase:  healthy (42/42 edge functions active)\n  Redis:     connected (latency 2ms)\n  Stripe:    webhooks active (last event: 4m ago)'
    // Message content routing
    if (m.includes('pipeline') || m.includes('health') || m.includes('determinism')) return MOCK_RESPONSES['pipeline_health']!
    if (m.includes('approv') && (m.includes('list') || m.includes('waiting') || m.includes('pending'))) return MOCK_RESPONSES['approvals']!
    if (m.includes('swarm') || m.includes('autopilot') || m.includes('optim')) return MOCK_RESPONSES['swarm']!
    if (m.includes('revenue') || m.includes('earn') || m.includes('stream') || m.includes('net')) return MOCK_RESPONSES['revenue']!
    if (m.includes('task') || m.includes('creat') || m.includes('analy')) return MOCK_RESPONSES['task_queued']!
    if (m.includes('summar') || m.includes('wrap') || m.includes('done')) return MOCK_RESPONSES['session_summary']!
    if (m.includes('approv') && m.includes('yes')) return MOCK_RESPONSES['approve']!
    return MOCK_RESPONSES['greeting']!
  }

  getStats(): DemoStats { return { ...this.stats } }
  getTasks(): LocalTask[] { return [...this.tasks] }
  getHistory(): ChatMessage[] { return [...this.history] }
}

// ── Scenario Definitions ─────────────────────────────────────────────────────

type Scenario = (session: DemoUserSession, log: DemoLogger) => Promise<void>

const SCENARIOS: Record<string, Scenario> = {

  // ── health ─────────────────────────────────────────────────────────────────
  health: async (session, log) => {
    log.divider('System Health Check')

    log.step('Load system briefing')
    await session.loadBriefing()

    log.step('Ask Ursula for current status')
    await session.chat('What is the current system status?', 'ursula')

    log.step('Ask Heidi for pipeline health metrics')
    await session.chat('Show me the pipeline health for the last 24 hours')

    log.step('Verify health endpoint directly')
    await session.checkHealth()
  },

  // ── tasks ──────────────────────────────────────────────────────────────────
  tasks: async (session, log) => {
    log.divider('Task Creation & Approval')

    log.step('Create a low-risk workflow task')
    const taskA = await session.createTask({
      title: 'Generate Q2 revenue analysis report',
      type: 'workflow',
      summary: 'Compile revenue data across all 6 streams for Q2 2026. Include fee breakdown and net totals.',
      priority: 'high',
      confidence: 0.9,
      approvalRequired: false,
      originIntent: 'Analyze Q2 revenue performance',
      args: { streams: ['rezonate', 'waveformer_studio', 'galactic_bytes'], period: 'Q2-2026' },
    })

    log.step('Create a task that requires approval')
    const taskB = await session.createTask({
      title: 'Deploy billing-retry-worker edge function',
      type: 'system_config',
      summary: 'Deploy updated billing-retry-worker to Supabase production. Includes schema patch v3.',
      priority: 'high',
      confidence: 0.85,
      approvalRequired: true,
      originIntent: 'Deploy billing worker update',
      args: { function: 'billing-retry-worker', environment: 'production', version: '3.1.0' },
    })

    log.step('Ask Heidi what needs approval')
    await session.chat('What tasks are waiting for my approval?')

    if (taskB) {
      log.step('Approve the deployment task')
      await session.approveTask(taskB.taskId, 'Reviewed schema patch — safe to deploy')
      await session.chat('Task approved. Confirm it is queued.', 'ursula')
    }

    if (taskA) {
      log.step('Reject a duplicate task')
      await session.rejectTask(taskA.taskId, 'Duplicate — manual report already in progress')
    }
  },

  // ── revenue ────────────────────────────────────────────────────────────────
  revenue: async (session, log) => {
    log.divider('Revenue Operations')

    log.step('Check revenue across all streams')
    await session.chat('Show me revenue totals for the last 30 days across all streams')

    log.step('Ask about a specific stream')
    await session.chat('Break down the rezonate revenue — how many transactions?')

    log.step('Create a revenue analysis task')
    await session.createTask({
      title: 'Revenue gap analysis: detailer_bot vs target',
      type: 'workflow',
      summary: 'Compare detailer_bot actual revenue against Q2 target. Identify underperformance drivers.',
      priority: 'medium',
      confidence: 0.75,
      args: { stream: 'detailer_bot', compareTarget: 2000, period: 'Q2-2026' },
    })

    log.step('Route to ProtoForge for policy check')
    await session.chat('Validate pricing policy for detailer_bot rush orders', 'protoforge')
  },

  // ── swarm ──────────────────────────────────────────────────────────────────
  swarm: async (session, log) => {
    log.divider('Autopilot Swarm Execution')

    log.step('Describe a multi-agent goal to Heidi')
    await session.chat(
      'Autopilot: Optimize Q2 revenue pipeline — analyze current mix, identify top-funnel gaps, model pricing adjustment impact, surface new partnership opportunities'
    )

    log.step('Ask Hyve for opportunity signals')
    await session.chat('Are there any opportunities detected in the pipeline right now?', 'hyve')

    log.step('Ask KILO to hypothesize about the revenue gap')
    await session.chat('KILO: Generate hypotheses for why detailer_bot revenue is below target', 'kilo')

    log.step('Ask CASCADE to classify an incoming event')
    await session.chat(
      'Classify this event: payment_processing_delay on galactic_bytes, 3 retries, Stripe error code card_declined',
      'cascade'
    )
  },

  // ── full ───────────────────────────────────────────────────────────────────
  full: async (session, log) => {
    log.divider('Opening Session')

    log.step('Load system briefing')
    await session.loadBriefing()

    log.step('Verify health endpoint')
    await session.checkHealth()

    log.divider('Conversational Interaction')

    log.step('Ask for system status')
    await session.chat('What is the current system status?', 'ursula')

    log.step('Pipeline health check')
    await session.chat('Show me pipeline health for the last 24 hours')

    log.divider('Task Lifecycle')

    log.step('Create a workflow task')
    const taskA = await session.createTask({
      title: 'Analyze rezonate revenue mix for Q2',
      type: 'workflow',
      summary: 'Pull all rezonate transactions for Q2, compute net after fees, compare with Q1.',
      priority: 'high',
      confidence: 0.88,
      originIntent: 'Understand rezonate Q2 performance',
      args: { stream: 'rezonate', period: 'Q2-2026', comparePeriod: 'Q1-2026' },
    })

    log.step('Create a task requiring approval')
    const taskB = await session.createTask({
      title: 'Deploy revenue-tracker edge function v2.1',
      type: 'system_config',
      summary: 'Update revenue-tracker Supabase edge function. Adds multi-currency support.',
      priority: 'high',
      confidence: 0.92,
      approvalRequired: true,
      originIntent: 'Deploy revenue-tracker update',
      args: { function: 'revenue-tracker', version: '2.1.0', environment: 'production' },
    })

    log.step('List pending approvals')
    await session.chat('List all tasks waiting for approval')

    if (taskB) {
      log.step('Approve the deployment')
      await session.approveTask(taskB.taskId, 'Multi-currency support reviewed — approved for production')
    }

    log.divider('Revenue & Business')

    log.step('Revenue snapshot')
    await session.chat('Give me revenue totals for the last 30 days across all 6 streams')

    log.step('ProtoForge policy check')
    await session.chat('Validate rush-order pricing policy for galactic_bytes', 'protoforge')

    log.divider('Swarm & Multi-Agent')

    log.step('Trigger an autopilot swarm')
    await session.chat(
      'Autopilot: Identify top 3 revenue growth opportunities across all active streams and draft an action plan'
    )

    log.step('Hyve opportunity scan')
    await session.chat('What opportunities has Hyve detected recently?', 'hyve')

    log.step('KILO hypothesis on infrastructure')
    await session.chat('KILO: What could cause intermittent billing-retry-worker failures?', 'kilo')

    log.divider('Session Close')

    log.step('Request session summary')
    await session.chat('Wrap up this session — give me a summary of what we did')
  },
}

// ── Main Entrypoint ───────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs()
  const log = new DemoLogger()
  const api = new HydiApiClient(config, log)
  const session = new DemoUserSession(config, api, log)

  log.header('HYDI / Heidi — Demo User Agent')
  log.info(`Mode:      ${config.mode}`)
  log.info(`Scenario:  ${config.scenario}`)
  log.info(`User ID:   ${config.userId}`)
  log.info(`Session:   ${session.sessionId}`)
  if (config.mode === 'live') {
    log.info(`Target:    ${config.usePortal ? config.portalUrl : config.dashboardUrl}`)
  }

  const scenarioFn = SCENARIOS[config.scenario]
  if (!scenarioFn) {
    log.fail(`Unknown scenario "${config.scenario}". Available: ${Object.keys(SCENARIOS).join(', ')}`)
    process.exitCode = 1
    return
  }

  const startTime = Date.now()

  try {
    await scenarioFn(session, log)
  } catch (err) {
    log.fail(`Scenario crashed: ${err instanceof Error ? err.message : String(err)}`)
    if (config.verbose && err instanceof Error) console.error(err.stack)
    process.exitCode = 1
    return
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  const stats = session.getStats()
  const tasks = session.getTasks()

  log.divider()
  log.summary({
    'Scenario':          config.scenario,
    'Duration':          `${elapsed}s`,
    'Mode':              config.mode,
    'Messages':          stats.messagesExchanged,
    'Tasks created':     stats.tasksCreated,
    'Tasks approved':    stats.tasksApproved,
    'Swarms triggered':  stats.swarmsTriggered,
    'API calls':         `${stats.apiCallsTotal} total (${stats.apiCallsFailed} failed)`,
    'Avg latency':       stats.apiCallsTotal > 0
      ? `${Math.round(stats.totalLatencyMs / stats.apiCallsTotal)}ms`
      : 'n/a (mock)',
    'Task IDs':          tasks.map(t => t.taskId).join(', ') || 'none',
  })

  if (process.exitCode !== 1) {
    log.ok('Demo completed successfully.')
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
