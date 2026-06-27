// EVENT SOURCED LEDGER - Single-Writer Event System
// Primary Architecture: File-based deterministic execution

export interface TaskEvent {
  event_id: string;
  event_type: 'task_created' | 'task_updated' | 'task_claimed' | 'task_completed' | 'task_failed';
  task_id: string;
  timestamp: string;
  data: any;
  worker_id?: string;
  sequence_number: number;
}

export interface CommitMarker {
  commit_id: string;
  sequence_start: number;
  sequence_end: number;
  timestamp: string;
  checksum: string;
}

export class EventSourcedLedger {
  private readonly eventsFile: string;
  private readonly commitsFile: string;
  private readonly bufferFile: string;
  private writeBuffer: TaskEvent[] = [];
  private lastSequenceNumber: number = 0;

  constructor(basePath: string = './data') {
    this.eventsFile = `${basePath}/events.log`;
    this.commitsFile = `${basePath}/commits.log`;
    this.bufferFile = `${basePath}/write_buffer.tmp`;
  }

  async initialize(): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');

    // Ensure data directory exists
    await fs.mkdir(path.dirname(this.eventsFile), { recursive: true });

    // Load last sequence number
    await this.loadLastSequenceNumber();
  }

  private async loadLastSequenceNumber(): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const data = await fs.readFile(this.eventsFile, 'utf-8');
      const lines = data.trim().split('\n').filter(line => line.length > 0);

      if (lines.length > 0) {
        const lastEvent = JSON.parse(lines[lines.length - 1]) as TaskEvent;
        this.lastSequenceNumber = lastEvent.sequence_number;
      }
    } catch (error) {
      // File doesn't exist or is empty - start at 0
      this.lastSequenceNumber = 0;
    }
  }

  async appendEvent(eventType: TaskEvent['event_type'], taskId: string, data: any, workerId?: string): Promise<TaskEvent> {
    const event: TaskEvent = {
      event_id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      event_type: eventType,
      task_id: taskId,
      timestamp: new Date().toISOString(),
      data,
      worker_id: workerId,
      sequence_number: this.lastSequenceNumber + 1
    };

    // Add to write buffer
    this.writeBuffer.push(event);
    this.lastSequenceNumber = event.sequence_number;

    return event;
  }

  async commit(): Promise<CommitMarker> {
    if (this.writeBuffer.length === 0) {
      throw new Error('No events to commit');
    }

    const fs = await import('fs/promises');
    const crypto = await import('crypto');

    const commitId = `commit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sequenceStart = this.writeBuffer[0].sequence_number;
    const sequenceEnd = this.writeBuffer[this.writeBuffer.length - 1].sequence_number;

    // Calculate checksum
    const eventText = this.writeBuffer.map(e => JSON.stringify(e)).join('\n');
    const checksum = crypto.createHash('sha256').update(eventText).digest('hex');

    // Write to buffer file first (write-ahead logging)
    const bufferData = {
      commit_id: commitId,
      events: this.writeBuffer,
      timestamp: new Date().toISOString()
    };

    await fs.writeFile(this.bufferFile, JSON.stringify(bufferData, null, 2));

    try {
      // Append to events file (append-only)
      const eventLines = this.writeBuffer.map(event => JSON.stringify(event)).join('\n') + '\n';
      await fs.appendFile(this.eventsFile, eventLines);

      // Write commit marker
      const commitMarker: CommitMarker = {
        commit_id: commitId,
        sequence_start: sequenceStart,
        sequence_end: sequenceEnd,
        timestamp: new Date().toISOString(),
        checksum
      };

      const commitLine = JSON.stringify(commitMarker) + '\n';
      await fs.appendFile(this.commitsFile, commitLine);

      // Clear buffer and remove temp file
      this.writeBuffer = [];
      await fs.unlink(this.bufferFile);

      return commitMarker;

    } catch (error) {
      // If commit fails, we keep the buffer file for recovery
      console.error('Commit failed, buffer preserved for recovery:', error);
      throw error;
    }
  }

  async replayEvents(fromSequence: number = 0): Promise<TaskEvent[]> {
    const fs = await import('fs/promises');

    try {
      const data = await fs.readFile(this.eventsFile, 'utf-8');
      const lines = data.trim().split('\n').filter(line => line.length > 0);

      const events: TaskEvent[] = [];
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as TaskEvent;
          if (event.sequence_number >= fromSequence) {
            events.push(event);
          }
        } catch (parseError) {
          console.error('Failed to parse event line:', line, parseError);
        }
      }

      return events;
    } catch (error) {
      console.error('Failed to replay events:', error);
      return [];
    }
  }

  async getCommits(): Promise<CommitMarker[]> {
    const fs = await import('fs/promises');

    try {
      const data = await fs.readFile(this.commitsFile, 'utf-8');
      const lines = data.trim().split('\n').filter(line => line.length > 0);

      const commits: CommitMarker[] = [];
      for (const line of lines) {
        try {
          const commit = JSON.parse(line) as CommitMarker;
          commits.push(commit);
        } catch (parseError) {
          console.error('Failed to parse commit line:', line, parseError);
        }
      }

      return commits;
    } catch (error) {
      console.error('Failed to load commits:', error);
      return [];
    }
  }

  async recoverFromBuffer(): Promise<boolean> {
    const fs = await import('fs/promises');

    try {
      const bufferData = await fs.readFile(this.bufferFile, 'utf-8');
      const buffer = JSON.parse(bufferData);

      if (buffer.events && Array.isArray(buffer.events)) {
        this.writeBuffer = buffer.events;
        console.log(`Recovered ${this.writeBuffer.length} events from buffer`);
        return true;
      }
    } catch (error) {
      // No buffer file or corrupted - nothing to recover
    }

    return false;
  }

  async verifyIntegrity(): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];

    try {
      const commits = await this.getCommits();
      const events = await this.replayEvents();

      // Check sequence continuity
      for (let i = 1; i < events.length; i++) {
        if (events[i].sequence_number !== events[i - 1].sequence_number + 1) {
          issues.push(`Sequence gap at ${events[i - 1].sequence_number} -> ${events[i].sequence_number}`);
        }
      }

      // Verify commit checksums
      for (const commit of commits) {
        const commitEvents = events.filter(
          e => e.sequence_number >= commit.sequence_start &&
            e.sequence_number <= commit.sequence_end
        );

        const crypto = await import('crypto');
        const eventText = commitEvents.map(e => JSON.stringify(e)).join('\n');
        const expectedChecksum = crypto.createHash('sha256').update(eventText).digest('hex');

        if (expectedChecksum !== commit.checksum) {
          issues.push(`Checksum mismatch for commit ${commit.commit_id}`);
        }
      }

    } catch (error) {
      issues.push(`Integrity check failed: ${error}`);
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }
}
