/**
 * Webhook Queue Adapter
 * Bridges Stripe webhooks to the worker queue system
 * Replaces synchronous processing with immediate queuing
 */

const QueueManager = require('./QueueManager');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const logger = require('../lib/structured-logger').child({ component: 'WebhookQueueAdapter' });
const { getStripeMode } = require('../lib/revenue/stripe-mode');

class WebhookQueueAdapter {
    constructor() {
        this.queue = new QueueManager();
        this.supabase = null;
        this.initialized = false;
    }

    async initialize() {
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
            throw new Error('Missing Supabase credentials');
        }

        this.supabase = createClient(supabaseUrl, supabaseKey);
        this.initialized = true;
    }

    /**
     * Handle incoming webhook - queues immediately for processing
     */
    async handleWebhook(event) {
        if (!this.initialized) await this.initialize();

        logger.info('Queueing event', { eventType: event.type });

        // Validate webhook (basic checks)
        if (!event.id || !event.type) {
            throw new Error('Invalid webhook event structure');
        }

        // Check for duplicates using idempotency
        // NOTE: The webhook_events table uses 'event_id' (not 'stripe_event_id').
        // The claim_webhook_event() RPC in the handler already inserts into
        // webhook_events with event_id, so this duplicate check is a second
        // layer of protection for the async queue path.
        const { data: existing } = await this.supabase
            .from('webhook_events')
            .select('id')
            .eq('event_id', event.id)
            .maybeSingle();

        if (existing) {
            logger.info('Duplicate event', { eventId: event.id });
            return { status: 'duplicate', eventId: existing.id };
        }

        // Store webhook event for tracking
        // Stamp is_test_mode at insert time based on the system's current Stripe mode.
        // This makes every record self-describing — the detector doesn't need to
        // check the runtime mode later (which would break at go-live).
        const stripeMode = getStripeMode();
        const { data: webhookRecord, error: webhookError } = await this.supabase
            .from('webhook_events')
            .insert({
                event_id: event.id,
                type: event.type,
                status: 'queued',
                payload: event,
                created_at: new Date().toISOString(),
                is_test_mode: stripeMode.mode === 'test'
            })
            .select()
            .single();

        if (webhookError) throw webhookError;

        // Enqueue to task router for intelligent routing
        const taskId = await this.queue.enqueue('task_routing', {
            type: 'stripe.webhook',
            source: 'stripe_webhook',
            event_id: event.id,
            event_type: event.type,
            data: event.data,
            webhook_record_id: webhookRecord.id,
            received_at: new Date().toISOString(),
            priority: this.getEventPriority(event.type)
        }, this.getEventPriority(event.type));

        logger.info('Event queued', { eventType: event.type, taskId });

        return {
            status: 'queued',
            eventId: webhookRecord.id,
            taskId: taskId
        };
    }

    /**
     * Get priority based on event type
     */
    getEventPriority(eventType) {
        // High priority events
        if (eventType.includes('payment') ||
            eventType.includes('checkout.completed') ||
            eventType.includes('invoice.payment_succeeded')) {
            return 10;
        }

        // Medium priority events
        if (eventType.includes('subscription') ||
            eventType.includes('customer')) {
            return 7;
        }

        // Low priority events
        return 3;
    }

    /**
     * Get webhook processing status
     */
    async getWebhookStatus(eventId) {
        if (!this.initialized) await this.initialize();

        const { data, error } = await this.supabase
            .from('webhook_events')
            .select('*')
            .eq('event_id', eventId)
            .single();

        if (error && error.code !== 'PGRST116') throw error;

        return data;
    }

    /**
     * Get queue statistics
     */
    async getQueueStats() {
        if (!this.initialized) await this.initialize();

        const stats = await this.queue.getQueueStats();

        // Add webhook-specific stats
        const { data: webhookStats } = await this.supabase
            .from('webhook_events')
            .select('status, count(*)')
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .group('status');

        const webhookStatsMap = {};
        webhookStats?.forEach(stat => {
            webhookStatsMap[stat.status] = stat.count;
        });

        return {
            queues: stats,
            webhooks: webhookStatsMap
        };
    }

    /**
     * Replay failed webhooks
     */
    async replayFailedWebhooks(limit = 10) {
        if (!this.initialized) await this.initialize();

        const { data: failedWebhooks } = await this.supabase
            .from('webhook_events')
            .select('*')
            .eq('status', 'failed')
            .order('created_at', { ascending: false })
            .limit(limit);

        const replayed = [];

        for (const webhook of failedWebhooks || []) {
            try {
                // Reset status
                await this.supabase
                    .from('webhook_events')
                    .update({ status: 'queued' })
                    .eq('id', webhook.id);

                // Re-queue
                await this.queue.enqueue('task_routing', {
                    type: 'stripe.webhook',
                    source: 'stripe_webhook_replay',
                    event_id: webhook.event_id,
                    event_type: webhook.type,
                    data: webhook.payload.data,
                    webhook_record_id: webhook.id,
                    received_at: new Date().toISOString(),
                    priority: 5
                }, 5);

                replayed.push(webhook.id);
            } catch (err) {
                logger.error('Failed to replay webhook', { webhookId: webhook.id, error: err });
            }
        }

        logger.info('Replayed failed webhooks', { replayedCount: replayed.length });
        return replayed;
    }

    /**
     * Cleanup old webhook records
     */
    async cleanup(daysOld = 30) {
        if (!this.initialized) await this.initialize();

        const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

        const { error } = await this.supabase
            .from('webhook_events')
            .delete()
            .lt('created_at', cutoffDate.toISOString())
            .in('status', ['completed', 'failed']);

        if (error) throw error;

        logger.info('Cleaned up old webhooks', { daysOld });
    }
}

module.exports = WebhookQueueAdapter;
