export class BaseAgent {
  id: string;
  capabilities: string[];
  status: 'active' | 'busy' | 'offline';
  load: number;

  // How many events this agent will process concurrently before it
  // reports itself as 'busy' (load reaches 1.0). Not currently
  // configurable per-agent-type; a subclass can override in its own
  // constructor if it needs a different ceiling.
  private maxConcurrency: number;
  private activeTaskCount: number;

  constructor(id: string, capabilities: string[] = [], maxConcurrency: number = 5) {
    this.id = id;
    this.capabilities = capabilities;
    this.status = 'active';
    this.load = 0;
    this.maxConcurrency = maxConcurrency;
    this.activeTaskCount = 0;
  }

  async handle_event(event: any): Promise<void> {
    throw new Error('handle_event method must be implemented by subclass');
  }

  emit_event(type: string, payload: any, targetAgent: string = 'broadcast', priority: 'low' | 'medium' | 'high' | 'critical' = 'medium'): void {
    console.log(`[${this.id}] Emitting event: ${type}`, {
      targetAgent,
      priority,
      payload
    });
  }

  /** Recompute load/status from the current in-flight task count. */
  private refreshAvailability(): void {
    if (this.status === 'offline') return; // offline is an explicit external state, not derived
    this.load = Math.min(1, this.activeTaskCount / this.maxConcurrency);
    this.status = this.activeTaskCount >= this.maxConcurrency ? 'busy' : 'active';
  }

  /** Mark this agent unavailable regardless of current load (e.g. a failed health check). */
  setOffline(): void {
    this.status = 'offline';
  }

  /** Clear an explicit offline mark and recompute status from real load. */
  setOnline(): void {
    this.status = 'active';
    this.refreshAvailability();
  }

  async execute(event: any): Promise<void> {
    this.activeTaskCount++;
    this.refreshAvailability();
    try {
      await this.handle_event(event);
    } catch (error) {
      console.error(`[${this.id}] Error handling event:`, error);
      this.emit_event('AGENT_ERROR', {
        agent_id: this.id,
        original_event: event,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'broadcast', 'high');
    } finally {
      this.activeTaskCount--;
      this.refreshAvailability();
    }
  }
}
