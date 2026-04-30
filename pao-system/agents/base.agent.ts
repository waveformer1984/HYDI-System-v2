export class BaseAgent {
  id: string;
  capabilities: string[];

  constructor(id: string, capabilities: string[] = []) {
    this.id = id;
    this.capabilities = capabilities;
  }

  /**
   * Handle an incoming event
   * @param event The event to handle
   */
  async handle_event(event: any): Promise<void> {
    throw new Error('handle_event method must be implemented by subclass');
  }

  /**
   * Emit an event to the event bus
   * @param type The type of event to emit
   * @param payload The payload of the event
   */
  emit_event(type: string, payload: any, targetAgent: string = 'broadcast', priority: 'low' | 'medium' | 'high' | 'critical' = 'medium'): void {
    // In a real implementation, this would use the event bus
    // For this boilerplate, we'll just log it
    console.log(`[${this.id}] Emitting event: ${type}`, {
      targetAgent,
      priority,
      payload
    });
  }

  /**
   * Execute the agent's main logic for an event
   * @param event The event to execute on
   */
  async execute(event: any): Promise<void> {
    try {
      await this.handle_event(event);
    } catch (error) {
      console.error(`[${this.id}] Error handling event:`, error);
      // Emit error event or handle as needed
      this.emit_event('AGENT_ERROR', {
        agent_id: this.id,
        original_event: event,
        error: error.message
      }, 'broadcast', 'high');
    }
  }
}