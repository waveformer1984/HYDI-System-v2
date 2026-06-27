// CANONICAL SNAPSHOT SYSTEM - Real checkpoints with sequence anchoring

import { TaskState } from './task-state-projection.js';
import { createHash } from 'crypto';

export interface CanonicalSnapshot {
  snapshot_id: string;
  sequence_number: number; // Exact event boundary
  state_hash: string;
  task_count: number;
  created_at: string;
  compressed: boolean;
  size_bytes: number;
  version: number;
}

export interface SnapshotMetadata {
  last_snapshot_sequence: number;
  snapshot_interval: number;
  compression_enabled: boolean;
  max_snapshots_retained: number;
}

export class CanonicalSnapshotManager {
  private readonly snapshotFile: string;
  private readonly metadataFile: string;
  private metadata: SnapshotMetadata;

  constructor(basePath: string = './data') {
    this.snapshotFile = `${basePath}/snapshots.jsonl`;
    this.metadataFile = `${basePath}/snapshot-metadata.json`;
    this.metadata = {
      last_snapshot_sequence: 0,
      snapshot_interval: 100, // Every 100 events
      compression_enabled: true,
      max_snapshots_retained: 10
    };
  }

  /**
   * Create snapshot at exact sequence boundary
   */
  async createSnapshot(
    tasks: TaskState[], 
    sequenceNumber: number,
    force: boolean = false
  ): Promise<CanonicalSnapshot> {
    // Check if we should snapshot
    if (!force && !this.shouldSnapshot(sequenceNumber)) {
      throw new Error(`Snapshot not required at sequence ${sequenceNumber}`);
    }

    // Sort tasks for deterministic ordering
    const sortedTasks = tasks.sort((a, b) => a.task_id.localeCompare(b.task_id));
    
    // Create canonical state representation
    const canonicalState = {
      version: 1,
      sequence_number: sequenceNumber,
      tasks: sortedTasks.map(task => ({
        id: task.task_id,
        title: task.title,
        status: task.status,
        version: task.state_version,
        created_at: task.created_at,
        updated_at: task.updated_at
      }))
    };

    // Calculate hash of canonical state
    const stateString = JSON.stringify(canonicalState);
    const stateHash = createHash('sha256').update(stateString).digest('hex');

    // Compress if enabled
    const compressed = this.metadata.compression_enabled;
    const snapshotData = compressed ? this.compress(stateString) : stateString;

    // Create snapshot object
    const snapshot: CanonicalSnapshot = {
      snapshot_id: `snap_${sequenceNumber}_${Date.now()}`,
      sequence_number: sequenceNumber,
      state_hash: stateHash,
      task_count: tasks.length,
      created_at: new Date().toISOString(),
      compressed,
      size_bytes: Buffer.byteLength(snapshotData, 'utf8'),
      version: 1
    };

    // Persist snapshot
    await this.persistSnapshot(snapshot, snapshotData);

    // Update metadata
    this.metadata.last_snapshot_sequence = sequenceNumber;
    await this.saveMetadata();

    // Cleanup old snapshots
    await this.cleanupOldSnapshots();

    return snapshot;
  }

  /**
   * Load snapshot at or before sequence number
   */
  async loadSnapshot(atOrBeforeSequence: number): Promise<{
    snapshot: CanonicalSnapshot;
    tasks: TaskState[];
  } | null> {
    const fs = await import('fs/promises');
    
    try {
      const data = await fs.readFile(this.snapshotFile, 'utf-8');
      const lines = data.trim().split('\n').filter(line => line.length > 0);
      
      let bestSnapshot: CanonicalSnapshot | null = null;
      
      // Find the most recent snapshot at or before target sequence
      for (const line of lines) {
        try {
          const snapshotMeta = JSON.parse(line) as CanonicalSnapshot;
          if (snapshotMeta.sequence_number <= atOrBeforeSequence) {
            if (!bestSnapshot || snapshotMeta.sequence_number > bestSnapshot.sequence_number) {
              bestSnapshot = snapshotMeta;
            }
          }
        } catch {
          // Skip malformed lines
        }
      }

      if (!bestSnapshot) {
        return null;
      }

      // Load snapshot data
      const snapshotDataPath = this.getSnapshotDataPath(bestSnapshot.snapshot_id);
      const compressedData = await fs.readFile(snapshotDataPath, 'utf-8');
      const stateString = bestSnapshot.compressed 
        ? this.decompress(compressedData)
        : compressedData;

      // Reconstruct tasks
      const canonicalState = JSON.parse(stateString);
      const tasks: TaskState[] = canonicalState.tasks.map((t: any) => ({
        task_id: t.id,
        title: t.title,
        status: t.status,
        state_version: t.version,
        created_at: t.created_at,
        updated_at: t.updated_at,
        // Fill required fields with defaults
        source: 'snapshot',
        system: 'unknown',
        type: 'unknown',
        description: '',
        inputs: {},
        outputs_expected: {},
        dependencies: [],
        priority: 1,
        urgency: 1,
        revenue_impact: { stage: 'partial', value: 50 },
        retry_count: 0,
        max_retries: 3,
        fix_attempts: 0,
        max_fix_attempts: 3,
        execution_mode: 'file' as const
      }));

      return {
        snapshot: bestSnapshot,
        tasks
      };

    } catch (error) {
      console.error('Failed to load snapshot:', error);
      return null;
    }
  }

  /**
   * Verify snapshot integrity
   */
  async verifySnapshot(snapshotId: string): Promise<boolean> {
    const fs = await import('fs/promises');
    
    try {
      // Find snapshot metadata
      const data = await fs.readFile(this.snapshotFile, 'utf-8');
      const lines = data.trim().split('\n').filter(line => line.length > 0);
      
      let targetSnapshot: CanonicalSnapshot | null = null;
      
      for (const line of lines) {
        const snapshot = JSON.parse(line) as CanonicalSnapshot;
        if (snapshot.snapshot_id === snapshotId) {
          targetSnapshot = snapshot;
          break;
        }
      }

      if (!targetSnapshot) {
        return false;
      }

      // Load and verify data
      const snapshotDataPath = this.getSnapshotDataPath(snapshotId);
      const compressedData = await fs.readFile(snapshotDataPath, 'utf-8');
      const stateString = targetSnapshot.compressed 
        ? this.decompress(compressedData)
        : compressedData;

      // Recalculate hash
      const expectedHash = createHash('sha256').update(stateString).digest('hex');
      
      return expectedHash === targetSnapshot.state_hash;

    } catch {
      return false;
    }
  }

  /**
   * Check if snapshot should be created
   */
  private shouldSnapshot(sequenceNumber: number): boolean {
    const eventsSinceLastSnapshot = sequenceNumber - this.metadata.last_snapshot_sequence;
    return eventsSinceLastSnapshot >= this.metadata.snapshot_interval;
  }

  /**
   * Persist snapshot metadata and data
   */
  private async persistSnapshot(snapshot: CanonicalSnapshot, data: string): Promise<void> {
    const fs = await import('fs/promises');
    
    // Ensure directory exists
    await fs.mkdir('./data/snapshots', { recursive: true });
    
    // Write metadata
    const metaLine = JSON.stringify(snapshot) + '\n';
    await fs.appendFile(this.snapshotFile, metaLine);
    
    // Write data
    const snapshotDataPath = this.getSnapshotDataPath(snapshot.snapshot_id);
    await fs.writeFile(snapshotDataPath, data);
  }

  /**
   * Get path to snapshot data file
   */
  private getSnapshotDataPath(snapshotId: string): string {
    return `./data/snapshots/${snapshotId}.dat`;
  }

  /**
   * Clean up old snapshots
   */
  private async cleanupOldSnapshots(): Promise<void> {
    const fs = await import('fs/promises');
    
    try {
      const data = await fs.readFile(this.snapshotFile, 'utf-8');
      const lines = data.trim().split('\n').filter(line => line.length > 0);
      
      const snapshots = lines.map(line => JSON.parse(line) as CanonicalSnapshot);
      snapshots.sort((a, b) => b.sequence_number - a.sequence_number);
      
      // Keep only the most recent snapshots
      const toKeep = snapshots.slice(0, this.metadata.max_snapshots_retained);
      const toRemove = snapshots.slice(this.metadata.max_snapshots_retained);
      
      // Remove old snapshot files
      for (const oldSnapshot of toRemove) {
        try {
          await fs.unlink(this.getSnapshotDataPath(oldSnapshot.snapshot_id));
        } catch {
          // Ignore errors
        }
      }
      
      // Rewrite metadata file with only kept snapshots
      const metaLines = toKeep.map(s => JSON.stringify(s)).join('\n') + '\n';
      await fs.writeFile(this.snapshotFile, metaLines);
      
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Save metadata
   */
  private async saveMetadata(): Promise<void> {
    const fs = await import('fs/promises');
    await fs.writeFile(this.metadataFile, JSON.stringify(this.metadata, null, 2));
  }

  /**
   * Load metadata
   */
  async loadMetadata(): Promise<SnapshotMetadata> {
    const fs = await import('fs/promises');
    
    try {
      const data = await fs.readFile(this.metadataFile, 'utf-8');
      this.metadata = { ...this.metadata, ...JSON.parse(data) };
    } catch {
      // Use defaults
    }
    
    return this.metadata;
  }

  /**
   * Simple compression (placeholder - replace with real compression)
   */
  private compress(data: string): string {
    // In production, use zlib or similar
    return data;
  }

  /**
   * Simple decompression (placeholder - replace with real decompression)
   */
  private decompress(data: string): string {
    // In production, use zlib or similar
    return data;
  }
}
