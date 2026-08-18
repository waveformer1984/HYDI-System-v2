import * as fs from 'fs';
import * as path from 'path';

export interface AuditRecord {
  id: string;
  timestamp?: string;
  event_type: string;
  task_id?: string;
  task_type?: string;
  source_agent?: string;
  target_agent?: string;
  payload?: any;
  result?: any;
  success: boolean;
  failure_reason?: string | null;
}

export class AuditLog {
  private logDir: string;
  private logFile: string;
  private enabled: boolean;

  constructor(logDir?: string) {
    this.logDir = logDir || path.join(process.cwd(), 'data', 'pao-audit');
    this.logFile = path.join(this.logDir, 'audit.log.jsonl');
    this.enabled = process.env.PAO_AUDIT_LOG !== 'false';
  }

  async record(record: Omit<AuditRecord, 'id'>): Promise<AuditRecord> {
    const full: AuditRecord = {
      ...record,
      timestamp: record.timestamp || new Date().toISOString(),
      id: this.generateId(),
    };

    if (this.enabled) {
      try {
        if (!fs.existsSync(this.logDir)) {
          fs.mkdirSync(this.logDir, { recursive: true });
        }
        const line = JSON.stringify(this.redact(full)) + '\n';
        fs.appendFileSync(this.logFile, line, 'utf8');
      } catch (error) {
        console.error('[AuditLog] Failed to persist record:', error);
      }
    }

    // Always also keep an in-memory record for testing/observability
    this.inMemory.push(full);
    return full;
  }

  private inMemory: AuditRecord[] = [];

  getRecent(limit = 100): AuditRecord[] {
    return this.inMemory.slice(-limit);
  }

  getByEventType(type: string): AuditRecord[] {
    return this.inMemory.filter(r => r.event_type === type);
  }

  clear(): void {
    this.inMemory = [];
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private redact(record: AuditRecord): AuditRecord {
    const redacted = { ...record };
    if (redacted.payload) {
      redacted.payload = this.redactPayload(redacted.payload);
    }
    if (redacted.result) {
      redacted.result = this.redactPayload(redacted.result);
    }
    return redacted;
  }

  private redactPayload(payload: any): any {
    if (typeof payload !== 'object' || payload === null) return payload;
    const result: any = Array.isArray(payload) ? [] : {};
    for (const [key, value] of Object.entries(payload)) {
      const lower = key.toLowerCase();
      if (lower.includes('secret') || lower.includes('key') || lower.includes('token') || lower.includes('password')) {
        result[key] = '***';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.redactPayload(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
