/**
 * EVENT VERSIONING - Prevent old webhooks from overwriting correct state
 * Handle late, out-of-order, and duplicate events safely
 */

export interface VersionedEvent {
  id: string;
  type: string;
  taskId: string;
  version: number;
  timestamp: string;
  data: any;
  processed: boolean;
}

export interface StateTransition {
  taskId: string;
  fromVersion: number;
  toVersion: number;
  transition: string;
  timestamp: string;
}

export class EventVersioning {
  
  /**
   * Apply state change only if event version is newer
   */
  static async applyStateChange(
    currentTask: any,
    incomingEvent: VersionedEvent
  ): Promise<{
    shouldApply: boolean;
    reason: string;
    updatedTask?: any;
  }> {
    const currentVersion = currentTask.state_version || 0;
    const incomingVersion = incomingEvent.version;

    // Rule 1: Only apply if incoming version is newer
    if (incomingVersion <= currentVersion) {
      return {
        shouldApply: false,
        reason: `Stale event: incoming version ${incomingVersion} <= current version ${currentVersion}`,
      };
    }

    // Rule 2: Check for duplicate event IDs
    if (currentTask.last_processed_event_id === incomingEvent.id) {
      return {
        shouldApply: false,
        reason: `Duplicate event: ${incomingEvent.id} already processed`,
      };
    }

    // Rule 3: Validate event timestamp isn't too old (protect against clock drift)
    const eventTime = new Date(incomingEvent.timestamp).getTime();
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    if (now - eventTime > maxAge) {
      return {
        shouldApply: false,
        reason: `Event too old: ${new Date(eventTime).toISOString()} is more than 24 hours ago`,
      };
    }

    // Apply the state change
    const updatedTask = {
      ...currentTask,
      ...incomingEvent.data,
      state_version: incomingVersion,
      last_processed_event_id: incomingEvent.id,
      last_processed_at: new Date().toISOString(),
    };

    return {
      shouldApply: true,
      reason: `State updated from version ${currentVersion} to ${incomingVersion}`,
      updatedTask,
    };
  }

  /**
   * Create versioned event for state changes
   */
  static createVersionedEvent(
    taskId: string,
    eventType: string,
    data: any,
    currentVersion: number = 0
  ): VersionedEvent {
    return {
      id: `${taskId}-${eventType}-${Date.now()}`,
      type: eventType,
      taskId,
      version: currentVersion + 1,
      timestamp: new Date().toISOString(),
      data,
      processed: false,
    };
  }

  /**
   * Detect and handle out-of-order events
   */
  static async handleOutOfOrderEvent(
    event: VersionedEvent,
    currentTask: any
  ): Promise<{
    action: 'queue' | 'ignore' | 'apply';
    reason: string;
  }> {
    const currentVersion = currentTask.state_version || 0;
    
    // Event is newer but we're missing intermediate versions
    if (event.version > currentVersion + 1) {
      // Queue for later processing when missing events arrive
      return {
        action: 'queue',
        reason: `Out-of-order: event version ${event.version} > current version ${currentVersion} + 1`,
      };
    }

    // Event is exactly what we expect
    if (event.version === currentVersion + 1) {
      return {
        action: 'apply',
        reason: `Expected next version: ${event.version}`,
      };
    }

    // Event is stale
    return {
      action: 'ignore',
      reason: `Stale event: version ${event.version} <= current version ${currentVersion}`,
    };
  }

  /**
   * Reconcile queued events when missing versions arrive
   */
  static async reconcileQueuedEvents(
    taskId: string,
    currentVersion: number,
    queuedEvents: VersionedEvent[]
  ): Promise<VersionedEvent[]> {
    // Filter events that can now be applied
    const applicableEvents = queuedEvents.filter(event => 
      event.version === currentVersion + 1
    );

    // Sort by version to ensure correct order
    applicableEvents.sort((a, b) => a.version - b.version);

    return applicableEvents;
  }

  /**
   * Audit trail for state transitions
   */
  static createTransitionRecord(
    taskId: string,
    fromVersion: number,
    toVersion: number,
    transition: string
  ): StateTransition {
    return {
      taskId,
      fromVersion,
      toVersion,
      transition,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Validate event sequence integrity
   */
  static validateEventSequence(events: VersionedEvent[]): {
    isValid: boolean;
    issues: string[];
    gaps: number[];
  } {
    const issues: string[] = [];
    const gaps: number[] = [];
    
    if (events.length === 0) {
      return { isValid: true, issues, gaps };
    }

    // Sort events by version
    const sortedEvents = [...events].sort((a, b) => a.version - b.version);
    
    // Check for gaps in version sequence
    for (let i = 1; i < sortedEvents.length; i++) {
      const current = sortedEvents[i];
      const previous = sortedEvents[i - 1];
      
      if (current.version !== previous.version + 1) {
        gaps.push(previous.version + 1);
        issues.push(`Version gap: missing version ${previous.version + 1} between ${previous.version} and ${current.version}`);
      }
    }

    // Check for duplicate versions
    const versionCounts = new Map<number, number>();
    for (const event of sortedEvents) {
      const count = versionCounts.get(event.version) || 0;
      versionCounts.set(event.version, count + 1);
      
      if (count > 0) {
        issues.push(`Duplicate version ${event.version} found`);
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
      gaps,
    };
  }
}
