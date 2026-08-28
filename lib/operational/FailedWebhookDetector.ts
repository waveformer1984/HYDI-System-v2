/**
 * Failed Webhook Retry Detector
 *
 * First real autonomous operations goal #3: failed-webhook retry.
 *
 * Periodically checks for webhooks that failed processing, retries them
 * a bounded number of times (mirroring the stuck-job "retry once, then
 * escalate" pattern), and escalates persistent failures rather than
 * retrying indefinitely.
 *
 * Bounded recovery actions:
 *   - For a failed webhook that has NOT been retried:
 *     Reset status to 'queued' and re-queue it. Bounded to ONE retry.
 *   - For a failed webhook that has already been retried once:
 *     Do NOT retry again. Escalate to a human.
 *   - For webhooks in 'processing' status that are stale (stuck):
 *     Escalate — do NOT auto-reset to queued (this could cause
 *     duplicate processing if the original is still running).
 *
 * Safety boundaries:
 *   - Never modifies payment state directly.
 *   - Never bypasses the existing human-approval gate.
 *   - Never retries a webhook more than once.
 *   - Any action beyond bounded retry requires the one-click Authorize pattern.
 *
 * Uses the existing WebhookQueueAdapter.replayFailedWebhooks() for the
 * actual retry mechanism, but adds the "retry once, then escalate"
 * bounding that the original adapter lacks.
 */

import { EscalationNotifier, getEscalationNotifier } from './EscalationNotifier';
import { getOperationalBoundary, BoundaryResult } from './OperationalBoundary';
import { createClient } from '@supabase/supabase-js';

export interface WebhookRetrySummary {
  timestamp: string;
  totalFailed: number;
  totalStale: number;
  retried: number;
  escalated: number;
  skipped: number;
  observeOnly: boolean;
  details: Array<{
    webhookId: string;
    eventId: string;
    eventType: string;
    action: 'retried' | 'escalated' | 'skipped';
    reason: string;
  }>;
}

export interface WebhookRecord {
  id: string;
  event_id: string;
  type: string;
  status: string;
  payload: any;
  created_at: string;
}

// Threshold for considering a 'processing' webhook as stale (1 hour)
const STALE_PROCESSING_THRESHOLD_MS = 60 * 60 * 1000;

export class FailedWebhookDetector {
  private supabase: any;
  private notifier: EscalationNotifier;
  private observeOnly: boolean;
  private staleThresholdMs: number;

  constructor(options?: {
    supabase?: any;
    observeOnly?: boolean;
    staleThresholdMs?: number;
  }) {
    this.supabase = options?.supabase ?? null;
    this.notifier = getEscalationNotifier(this.supabase);
    this.observeOnly = options?.observeOnly ?? false;
    this.staleThresholdMs = options?.staleThresholdMs ?? STALE_PROCESSING_THRESHOLD_MS;
  }

  /**
   * Run a full detection and recovery cycle.
   */
  async detectAndRecover(): Promise<WebhookRetrySummary> {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Failed Webhook Detector starting`);

    // 0. Fetch the operational boundary (go-live timestamp).
    // Records created before this timestamp are test/qualification data
    // and are excluded from detection to prevent false findings.
    const boundary = await getOperationalBoundary(this.supabase);
    if (boundary.hasBoundary) {
      console.log(`  Operational boundary: go_live_at = ${boundary.goLiveAt}`);
    } else {
      console.log(`  Operational boundary: not set (no filtering)`);
    }

    // 1. Get all failed webhooks (filtered by boundary)
    const failedWebhooks = await this.getWebhooksByStatus('failed', boundary);
    console.log(`  Failed webhooks: ${failedWebhooks.length}`);

    // 2. Get stale 'processing' webhooks (stuck in processing, filtered by boundary)
    const staleWebhooks = await this.getStaleProcessingWebhooks(boundary);
    console.log(`  Stale processing webhooks: ${staleWebhooks.length}`);

    const details: WebhookRetrySummary['details'] = [];
    let retried = 0;
    let escalated = 0;
    let skipped = 0;

    // 3. Process failed webhooks — retry once, then escalate
    for (const webhook of failedWebhooks) {
      const hasBeenRetried = await this.hasBeenRetried(webhook.id);

      if (hasBeenRetried) {
        // Already retried once — escalate, don't retry again
        if (!this.observeOnly) {
          await this.sendEscalation({
            category: 'webhook_retry',
            severity: 'critical',
            title: `Webhook permanently failed: ${webhook.event_id}`,
            body: `Webhook ${webhook.event_id} (type: ${webhook.type}) has failed after retry. The event was received at ${webhook.created_at} and could not be processed.`,
            actionTaken: 'Retried once (bounded), still failing',
            actionRequired: `Investigate webhook ${webhook.event_id}. Determine if the event data is malformed, the handler has a bug, or the downstream service is unavailable. Any corrective action beyond retry requires the one-click Authorize pattern.`,
            metadata: {
              webhookId: webhook.id,
              eventId: webhook.event_id,
              eventType: webhook.type,
              createdAt: webhook.created_at,
            },
          });
          escalated++;
        }
        details.push({
          webhookId: webhook.id,
          eventId: webhook.event_id,
          eventType: webhook.type,
          action: 'escalated',
          reason: 'Already retried once — escalating per bounded retry policy',
        });
      } else {
        // First failure — retry once
        if (!this.observeOnly) {
          const retryResult = await this.retryWebhook(webhook);
          if (retryResult) {
            retried++;
            await this.recordRetry(webhook.id);
          } else {
            escalated++;
          }
        } else {
          skipped++;
        }
        details.push({
          webhookId: webhook.id,
          eventId: webhook.event_id,
          eventType: webhook.type,
          action: this.observeOnly ? 'skipped' : 'retried',
          reason: this.observeOnly
            ? 'Observe-only mode'
            : 'First failure — retrying once (bounded)',
        });
      }
    }

    // 4. Process stale 'processing' webhooks — escalate only, do NOT auto-reset
    for (const webhook of staleWebhooks) {
      if (!this.observeOnly) {
        await this.sendEscalation({
          category: 'webhook_retry',
          severity: 'warning',
          title: `Webhook stuck in processing: ${webhook.event_id}`,
          body: `Webhook ${webhook.event_id} (type: ${webhook.type}) has been in 'processing' status for over ${Math.round(this.staleThresholdMs / 60000)} minutes. This may indicate a hung handler or a crashed worker.`,
          actionTaken: 'None — escalating only (auto-resetting could cause duplicate processing)',
          actionRequired: `Check if the worker processing webhook ${webhook.event_id} is still running. If it has crashed, you may need to manually reset the status to 'queued' through the one-click Authorize pattern.`,
          metadata: {
            webhookId: webhook.id,
            eventId: webhook.event_id,
            eventType: webhook.type,
            createdAt: webhook.created_at,
            staleFor: `${Math.round((Date.now() - new Date(webhook.created_at).getTime()) / 60000)} minutes`,
          },
        });
        escalated++;
      } else {
        skipped++;
      }
      details.push({
        webhookId: webhook.id,
        eventId: webhook.event_id,
        eventType: webhook.type,
        action: this.observeOnly ? 'skipped' : 'escalated',
        reason: `Stuck in processing for >${Math.round(this.staleThresholdMs / 60000)}min — escalating (not auto-resetting to avoid duplicates)`,
      });
    }

    const summary: WebhookRetrySummary = {
      timestamp,
      totalFailed: failedWebhooks.length,
      totalStale: staleWebhooks.length,
      retried,
      escalated,
      skipped,
      observeOnly: this.observeOnly,
      details,
    };

    console.log(`  Retried: ${retried}`);
    console.log(`  Escalated: ${escalated}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`[${timestamp}] Failed Webhook Detector complete`);

    return summary;
  }

  /**
   * Get webhooks by status.
   * If a boundary is set, only webhooks created at or after the boundary
   * are returned (pre-boundary webhooks are test/qualification data).
   */
  private async getWebhooksByStatus(status: string, boundary: BoundaryResult): Promise<WebhookRecord[]> {
    if (!this.supabase) return [];
    let query = this.supabase
      .from('webhook_events')
      .select('id, event_id, type, status, payload, created_at')
      .eq('status', status);
    if (boundary.hasBoundary && boundary.goLiveAt) {
      query = query.gte('created_at', boundary.goLiveAt);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error || !data) {
      console.error(`  Webhook query (status=${status}) failed:`, error?.message);
      return [];
    }
    return data as WebhookRecord[];
  }

  /**
   * Get webhooks stuck in 'processing' status beyond the stale threshold.
   * If a boundary is set, only webhooks created at or after the boundary
   * are returned (pre-boundary webhooks are test/qualification data).
   */
  private async getStaleProcessingWebhooks(boundary: BoundaryResult): Promise<WebhookRecord[]> {
    if (!this.supabase) return [];
    const cutoff = new Date(Date.now() - this.staleThresholdMs).toISOString();
    let query = this.supabase
      .from('webhook_events')
      .select('id, event_id, type, status, payload, created_at')
      .eq('status', 'processing')
      .lt('created_at', cutoff);
    if (boundary.hasBoundary && boundary.goLiveAt) {
      query = query.gte('created_at', boundary.goLiveAt);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error || !data) {
      console.error('  Stale processing query failed:', error?.message);
      return [];
    }
    return data as WebhookRecord[];
  }

  /**
   * Check if a webhook has already been retried.
   * Uses the webhook_retry_log table (created by migration) to track retries.
   */
  private async hasBeenRetried(webhookId: string): Promise<boolean> {
    if (!this.supabase) return false;
    const { data, error } = await this.supabase
      .from('webhook_retry_log')
      .select('id')
      .eq('webhook_id', webhookId)
      .limit(1);
    if (error) {
      // Table might not exist yet — treat as not retried
      return false;
    }
    return data && data.length > 0;
  }

  /**
   * Record that a webhook has been retried.
   */
  private async recordRetry(webhookId: string): Promise<void> {
    if (!this.supabase) return;
    try {
      await this.supabase.from('webhook_retry_log').insert({
        webhook_id: webhookId,
        retried_at: new Date().toISOString(),
      });
    } catch {
      // Non-fatal — the retry itself succeeded, we just can't track it
    }
  }

  /**
   * Retry a failed webhook by resetting its status to 'queued'.
   * This mirrors WebhookQueueAdapter.replayFailedWebhooks() but for a
   * single webhook, and with the retry-count bounding.
   */
  private async retryWebhook(webhook: WebhookRecord): Promise<boolean> {
    if (!this.supabase) return false;
    try {
      const { error } = await this.supabase
        .from('webhook_events')
        .update({ status: 'queued' })
        .eq('id', webhook.id);
      if (error) {
        console.error(`  Retry failed for ${webhook.event_id}:`, error.message);
        return false;
      }
      console.log(`  Retried webhook ${webhook.event_id} (reset to queued)`);
      return true;
    } catch (err) {
      console.error(`  Retry threw for ${webhook.event_id}:`, err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Send an escalation notification.
   */
  private async sendEscalation(notification: {
    category: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    body: string;
    actionTaken?: string;
    actionRequired?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const result = await this.notifier.notify(notification);
      if (!result.sent) {
        console.error(`  Escalation failed to send: ${result.error}`);
      }
    } catch (err) {
      console.error('  Escalation threw:', err instanceof Error ? err.message : 'Unknown error');
    }
  }
}
