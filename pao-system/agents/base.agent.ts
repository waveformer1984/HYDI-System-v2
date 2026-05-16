export class BaseAgent {
  id: string;
  capabilities: string[];

  constructor(id: string, capabilities: string[] = []) {
    this.id = id;
    this.capabilities = capabilities;
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

  async execute(event: any): Promise<void> {
    try {
      await this.handle_event(event);
    } catch (error) {
      console.error(`[${this.id}] Error handling event:`, error);
      this.emit_event('AGENT_ERROR', {
        agent_id: this.id,
        original_event: event,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'broadcast', 'high');
    }
  }
}
