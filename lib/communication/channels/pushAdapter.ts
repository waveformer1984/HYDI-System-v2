/**
 * Push Notification Channel Adapter
 *
 * Wraps the existing web-push notification framework from
 * lib/notifications/notify.js. Preserves the working provider while
 * routing through the CommunicationLayer's authorization and audit
 * pipeline.
 *
 * The underlying framework uses VAPID web-push against the
 * push_subscriptions table. It degrades gracefully when VAPID keys
 * are not configured — the notification row is still created and
 * readable in-app, it just isn't pushed to a device.
 */

import type { ChannelId, ChannelDescriptor } from '../types';

export interface PushAdapterConfig {
  // Allows injecting a custom supabase client for testing
  supabase?: unknown;
}

export interface PushSendRequest {
  category: string;
  title: string;
  body?: string;
  deviceId?: string;
  metadata?: Record<string, unknown>;
}

export interface PushSendResult {
  success: boolean;
  notificationId: string | null;
  pushed: boolean;
  provider: string;
  error: string | null;
}

// Mirror of CATEGORIES from lib/notifications/notify.js
const VALID_CATEGORIES = [
  'worker_failure', 'security_event', 'deployment_failure', 'agent_crash',
  'task_completed', 'document_generated', 'build_completed', 'deployment_completed',
  'approval_required', 'destructive_action_confirmation',
];

export class PushAdapter {
  readonly channelId: ChannelId = 'notification';
  private notifyModule: { createNotification: (supabase: unknown, input: unknown) => Promise<{ id: string }>; configureVapid: () => boolean; CATEGORIES: string[] } | null = null;
  private supabase: unknown;
  private loadAttempted = false;

  constructor(config?: PushAdapterConfig) {
    this.supabase = config?.supabase || null;
  }

  private async loadNotifyModule(): Promise<void> {
    if (this.loadAttempted) return;
    this.loadAttempted = true;
    try {
      // Dynamic require — this is a CommonJS module
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.notifyModule = require('../../notifications/notify.js');
    } catch {
      this.notifyModule = null;
    }
  }

  getDescriptor(): ChannelDescriptor {
    const vapidConfigured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
    return {
      channelId: 'notification',
      name: 'Web Push Notifications',
      direction: 'outbound',
      status: vapidConfigured ? 'active' : 'degraded',
      inboundSupport: false,
      outboundSupport: true,
      persistenceSupport: true, // notifications table
      credentialsConfigured: vapidConfigured,
      runtimeReachable: true, // always reachable — degrades to in-app
      autonomySupport: true,
      blocker: vapidConfigured ? null : 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY not set — push degrades to in-app only',
      metadata: { provider: 'web-push' },
    };
  }

  async checkReachability(): Promise<boolean> {
    await this.loadNotifyModule();
    return this.notifyModule !== null;
  }

  validateCategory(category: string): boolean {
    return VALID_CATEGORIES.includes(category);
  }

  async send(request: PushSendRequest): Promise<PushSendResult> {
    await this.loadNotifyModule();

    if (!this.notifyModule) {
      return {
        success: false,
        notificationId: null,
        pushed: false,
        provider: 'web-push',
        error: 'Notification module not available',
      };
    }

    if (!this.validateCategory(request.category)) {
      return {
        success: false,
        notificationId: null,
        pushed: false,
        provider: 'web-push',
        error: `Invalid notification category: ${request.category}`,
      };
    }

    if (!request.title) {
      return {
        success: false,
        notificationId: null,
        pushed: false,
        provider: 'web-push',
        error: 'Notification title is required',
      };
    }

    if (!this.supabase) {
      return {
        success: false,
        notificationId: null,
        pushed: false,
        provider: 'web-push',
        error: 'Supabase client not configured',
      };
    }

    try {
      const notification = await this.notifyModule.createNotification(this.supabase, {
        category: request.category,
        title: request.title,
        body: request.body,
        device_id: request.deviceId,
        metadata: request.metadata,
      });

      const pushed = this.notifyModule.configureVapid();

      return {
        success: true,
        notificationId: notification.id,
        pushed,
        provider: 'web-push',
        error: null,
      };
    } catch (e) {
      return {
        success: false,
        notificationId: null,
        pushed: false,
        provider: 'web-push',
        error: e instanceof Error ? e.message : 'Unknown error',
      };
    }
  }
}
