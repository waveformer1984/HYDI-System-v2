/**
 * ProtoForge Event Bus - The Heart of Everything
 * 
 * Redis/Kafka-style event streaming with priority queuing,
 * persistence, and agent routing capabilities.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

export interface EventSchema {
  id: string;
  type: string;
  source_agent: string;
  target_agent: string | 'broadcast';
  priority: 'low' | 'medium' | 'high' | 'critical';
  payload: any;
  timestamp: string;
  correlation_id?: string;
  retry_count?: number;
  ttl?: number;
}

export interface EventSubscription {
  agent_id: string;
  event_types: string[];
  handler: (event: EventSchema) => Promise<void>;
}

export class EventBus extends EventEmitter {
  private subscriptions: Map<string, EventSubscription[]> = new Map();
  private eventHistory: EventSchema[] = [];
  private priorityQueues: Map<string, EventSchema[]> = new Map();
  private deadLetterQueue: EventSchema[] = [];
  private maxHistorySize = 10000;
  private processing = false;

  constructor() {
    super();
    this.initializePriorityQueues();
    this.startEventProcessor();
  }

  private initializePriorityQueues(): void {
    this.priorityQueues.set('critical', []);
    this.priorityQueues.set('high', []);
    this.priorityQueues.set('medium', []);
    this.priorityQueues.set('low', []);
  }

  /**
   * Publish an event to the bus
   */
  async publish(event: Omit<EventSchema, 'id' | 'timestamp'>): Promise<string> {
    const fullEvent: EventSchema = {
      ...event,
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      retry_count: 0,
      ttl: event.ttl || 24 * 60 * 60 * 1000 // 24 hours default
    };

    // Validate event schema
    this.validateEvent(fullEvent);

    // Add to appropriate priority queue
    this.priorityQueues.get(fullEvent.priority)!.push(fullEvent);

    // Store in history
    this.addToHistory(fullEvent);

    // Emit for immediate processing
    this.emit('event_published', fullEvent);

    console.log(`[EVENT BUS] Published: ${fullEvent.type} from ${fullEvent.source_agent} to ${fullEvent.target_agent}`);

    return fullEvent.id;
  }

  /**
   * Subscribe an agent to specific event types
   */
  subscribe(subscription: EventSubscription): void {
    const agentSubscriptions = this.subscriptions.get(subscription.agent_id) || [];
    agentSubscriptions.push(subscription);
    this.subscriptions.set(subscription.agent_id, agentSubscriptions);

    console.log(`[EVENT BUS] ${subscription.agent_id} subscribed to: ${subscription.event_types.join(', ')}`);
  }

  /**
   * Unsubscribe an agent from event types
   */
  unsubscribe(agent_id: string, event_types?: string[]): void {
    if (event_types) {
      const agentSubscriptions = this.subscriptions.get(agent_id) || [];
      const filtered = agentSubscriptions.filter(sub => 
        !event_types.includes(sub.event_types[0])
      );
      this.subscriptions.set(agent_id, filtered);
    } else {
      this.subscriptions.delete(agent_id);
    }
  }

  /**
   * Get events for a specific agent
   */
  getAgentEvents(agent_id: string, limit = 100): EventSchema[] {
    return this.eventHistory
      .filter(event => event.target_agent === agent_id || event.target_agent === 'broadcast')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Get events by type
   */
  getEventsByType(type: string, limit = 100): EventSchema[] {
    return this.eventHistory
      .filter(event => event.type === type)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Start the event processor
   */
  private startEventProcessor(): void {
    setInterval(() => {
      this.processEvents();
    }, 100); // Process every 100ms
  }

  /**
   * Process events from priority queues
   */
  private async processEvents(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      // Process in priority order: critical -> high -> medium -> low
      const priorities = ['critical', 'high', 'medium', 'low'];
      
      for (const priority of priorities) {
        const queue = this.priorityQueues.get(priority)!;
        
        while (queue.length > 0) {
          const event = queue.shift()!;
          await this.deliverEvent(event);
        }
      }
    } catch (error) {
      console.error('[EVENT BUS] Processing error:', error);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Deliver event to subscribed agents
   */
  private async deliverEvent(event: EventSchema): Promise<void> {
    const targetAgents = event.target_agent === 'broadcast' 
      ? this.getSubscribedAgents(event.type)
      : [event.target_agent];

    const deliveryPromises = targetAgents.map(async (agentId) => {
      const subscriptions = this.subscriptions.get(agentId) || [];
      const relevantSubscriptions = subscriptions.filter(sub => 
        sub.event_types.includes(event.type) || sub.event_types.includes('*')
      );

      for (const subscription of relevantSubscriptions) {
        try {
          await subscription.handler(event);
        } catch (error) {
          console.error(`[EVENT BUS] Delivery failed to ${agentId}:`, error);
          // error is unknown in strict mode -- normalize instead of blindly
          // asserting it's an Error, so handleDeliveryFailure's declared
          // `error: Error` parameter is never a lie.
          const normalizedError = error instanceof Error
            ? error
            : new Error(typeof error === 'string' ? error : 'Unknown error');
          await this.handleDeliveryFailure(event, agentId, normalizedError);
        }
      }
    });

    await Promise.allSettled(deliveryPromises);
  }

  /**
   * Handle event delivery failure
   */
  private async handleDeliveryFailure(event: EventSchema, agentId: string, error: Error): Promise<void> {
    event.retry_count = (event.retry_count || 0) + 1;

    if (event.retry_count < 3) {
      // Retry with exponential backoff
      const delay = Math.pow(2, event.retry_count) * 1000;
      setTimeout(() => {
        this.priorityQueues.get(event.priority)!.push(event);
      }, delay);
    } else {
      // Move to dead letter queue
      this.deadLetterQueue.push(event);
      console.error(`[EVENT BUS] Event moved to dead letter queue: ${event.id}`);
    }
  }

  /**
   * Get agents subscribed to an event type
   */
  private getSubscribedAgents(eventType: string): string[] {
    const agents: string[] = [];
    
    for (const [agentId, subscriptions] of this.subscriptions.entries()) {
      const hasSubscription = subscriptions.some(sub => 
        sub.event_types.includes(eventType) || sub.event_types.includes('*')
      );
      
      if (hasSubscription) {
        agents.push(agentId);
      }
    }
    
    return agents;
  }

  /**
   * Add event to history
   */
  private addToHistory(event: EventSchema): void {
    this.eventHistory.push(event);
    
    // Maintain history size
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Validate event schema
   */
  private validateEvent(event: EventSchema): void {
    const required = ['id', 'type', 'source_agent', 'target_agent', 'priority', 'payload', 'timestamp'];
    
    for (const field of required) {
      if (!(field in event)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    const validPriorities = ['low', 'medium', 'high', 'critical'];
    if (!validPriorities.includes(event.priority)) {
      throw new Error(`Invalid priority: ${event.priority}`);
    }
  }

  /**
   * Get system statistics
   */
  getStats(): any {
    return {
      total_events: this.eventHistory.length,
      dead_letter_count: this.deadLetterQueue.length,
      subscriptions: Object.fromEntries(
        Array.from(this.subscriptions.entries()).map(([agent, subs]) => [
          agent, 
          subs.length
        ])
      ),
      queue_depths: Object.fromEntries(
        Array.from(this.priorityQueues.entries()).map(([priority, queue]) => [
          priority,
          queue.length
        ])
      )
    };
  }

  /**
   * Clear old events
   */
  clearOldEvents(olderThanHours: number = 24): void {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    
    this.eventHistory = this.eventHistory.filter(event => 
      new Date(event.timestamp) > cutoff
    );
    
    console.log(`[EVENT BUS] Cleared events older than ${olderThanHours} hours`);
  }
}

// Singleton instance
export const eventBus = new EventBus();
