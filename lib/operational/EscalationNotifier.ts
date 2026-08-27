/**
 * HYDI Escalation Notifier
 *
 * Sends operator-readable escalation notifications through whatever
 * channel is configured:
 *   1. Slack webhook (if SLACK_WEBHOOK_URL is set)
 *   2. Supabase operator_escalations table (durable fallback, always
 *      written if Supabase is available)
 *   3. Console log (always, as a last resort)
 *
 * This closes the gap flagged several rounds back: "no automated
 * Slack/email notification, only log files/DB query." Before this,
 * the EscalationManager created escalation packages but stored them
 * in an in-memory Map — no notification was ever sent to a human.
 *
 * Usage:
 *   const notifier = getEscalationNotifier(supabase);
 *   await notifier.notify({
 *     category: 'stuck_job',
 *     severity: 'warning',
 *     title: 'Job stuck in executing for 6 hours',
 *     body: 'Job abc-123 has been in executing state since...',
 *     actionTaken: 'Retried execution once',
 *     actionRequired: 'Review the job and decide whether to fail it or investigate',
 *     metadata: { jobId: 'abc-123', stuckSince: '...' },
 *   });
 */

export type EscalationSeverity = 'info' | 'warning' | 'critical';

export interface EscalationNotification {
  category: string;
  severity: EscalationSeverity;
  title: string;
  body: string;
  actionTaken?: string;
  actionRequired?: string;
  metadata?: Record<string, unknown>;
}

export interface EscalationResult {
  sent: boolean;
  channels: string[];
  error?: string;
}

// ─── Escalation Notifier ─────────────────────────────────────────────────

export class EscalationNotifier {
  private supabase: any | null;
  private slackWebhookUrl: string | null;

  constructor(supabase?: any) {
    this.supabase = supabase ?? null;
    this.slackWebhookUrl = process.env.SLACK_WEBHOOK_URL || null;
  }

  /**
   * Send an escalation notification through all available channels.
   * Never throws — escalation failure is logged but does not block
   * the calling operation.
   */
  async notify(notification: EscalationNotification): Promise<EscalationResult> {
    const channels: string[] = [];
    let lastError: string | undefined;

    // 1. Always write to console (last resort)
    const consoleMessage = this.formatConsoleMessage(notification);
    if (notification.severity === 'critical') {
      console.error(consoleMessage);
    } else {
      console.warn(consoleMessage);
    }
    channels.push('console');

    // 2. Write to Supabase operator_escalations table (durable fallback)
    if (this.supabase) {
      try {
        const { error } = await this.supabase
          .from('operator_escalations')
          .insert({
            category: notification.category,
            severity: notification.severity,
            title: notification.title,
            body: notification.body,
            action_taken: notification.actionTaken || null,
            action_required: notification.actionRequired || null,
            metadata: notification.metadata || {},
            created_at: new Date().toISOString(),
            resolved: false,
          });
        if (error) {
          lastError = `Supabase insert failed: ${error.message}`;
        } else {
          channels.push('supabase');
        }
      } catch (err) {
        lastError = `Supabase insert threw: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    }

    // 3. Send to Slack webhook (if configured)
    if (this.slackWebhookUrl) {
      try {
        const slackPayload = this.formatSlackPayload(notification);
        const response = await fetch(this.slackWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(slackPayload),
        });
        if (!response.ok) {
          lastError = `Slack webhook returned ${response.status}`;
        } else {
          channels.push('slack');
        }
      } catch (err) {
        lastError = `Slack webhook threw: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    }

    return {
      sent: channels.length > 0,
      channels,
      error: lastError,
    };
  }

  /**
   * Send a test notification to verify the channel is working.
   */
  async sendTest(): Promise<EscalationResult> {
    return this.notify({
      category: 'test',
      severity: 'info',
      title: 'HYDI Escalation Channel Test',
      body: 'This is a test notification to verify the escalation channel is operational.',
      actionTaken: 'None — this is a test',
      actionRequired: 'None — no action needed. If you received this, the channel works.',
      metadata: { test: true, timestamp: new Date().toISOString() },
    });
  }

  private formatConsoleMessage(n: EscalationNotification): string {
    const lines = [
      ``,
      `═══════════════════════════════════════════════════════════`,
      `ESCALATION [${n.severity.toUpperCase()}] — ${n.title}`,
      `═══════════════════════════════════════════════════════════`,
      `Category: ${n.category}`,
      ``,
      `${n.body}`,
      ``,
    ];
    if (n.actionTaken) lines.push(`Action taken: ${n.actionTaken}`);
    if (n.actionRequired) lines.push(`Action required: ${n.actionRequired}`);
    lines.push(`═══════════════════════════════════════════════════════════`);
    return lines.join('\n');
  }

  private formatSlackPayload(n: EscalationNotification): Record<string, unknown> {
    const emoji = n.severity === 'critical' ? '🚨' : n.severity === 'warning' ? '⚠️' : 'ℹ️';
    const color = n.severity === 'critical' ? '#ff0000' : (n.severity === 'warning' ? '#ffaa00' : '#36a64f');

    const fields: Array<{ title: string; value: string; short: boolean }> = [];
    if (n.actionTaken) {
      fields.push({ title: 'Action Taken', value: n.actionTaken, short: false });
    }
    if (n.actionRequired) {
      fields.push({ title: 'Action Required', value: n.actionRequired, short: false });
    }

    return {
      text: `${emoji} ${n.title}`,
      username: 'HYDI Operations',
      attachments: [
        {
          color,
          title: n.title,
          text: n.body,
          fields,
          footer: `Category: ${n.category} | Severity: ${n.severity}`,
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let singleton: EscalationNotifier | null = null;

export function getEscalationNotifier(supabase?: any): EscalationNotifier {
  if (!singleton) {
    singleton = new EscalationNotifier(supabase);
  }
  return singleton;
}

/**
 * Reset the singleton (for testing).
 */
export function resetEscalationNotifier(): void {
  singleton = null;
}
