/**
 * Event Bus Worker (Ursula Nervous System)
 * Central nervous system for all event publishing and subscriptions
 * Connects all ecosystems
 */

const QueueManager = require('./QueueManager');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const EventEmitter = require('events');
const logger = require('../lib/structured-logger').child({ component: 'EventBusWorker' });

class EventBusWorker extends EventEmitter {
    constructor(workerId = null) {
        super();
        this.workerId = workerId || `event-bus-${Date.now()}`;
        this.queue = new QueueManager();
        this.supabase = null;
        this.running = false;
        this.pollInterval = 1000; // 1 second - very fast for event handling
        this.pollTimer = null;
        
        // Event subscriptions
        this.subscriptions = new Map(); // eventType -> Set of subscribers
        this.eventHistory = new Map(); // eventType -> Array of recent events
        this.maxHistorySize = 1000;
        
        // Event patterns for wildcards
        this.patternSubscriptions = new Map(); // pattern -> Set of subscribers
        
        // Metrics
        this.metrics = {
            eventsPublished: 0,
            eventsDelivered: 0,
            eventsFailed: 0,
            subscribersCount: 0,
            startTime: null
        };
    }

    async initialize() {
        // Initialize Supabase
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
        
        if (!supabaseUrl || !supabaseKey) {
            throw new Error('Missing Supabase credentials');
        }
        
        this.supabase = createClient(supabaseUrl, supabaseKey);
        
        // Register worker
        await this.queue.registerWorker('event_bus', this.workerId);
        await this.queue.updateHeartbeat('idle');
        
        // Load existing subscriptions
        await this.loadSubscriptions();
        
        logger.info('Event Bus initialized', { workerId: this.workerId });
    }

    async start() {
        if (this.running) {
            logger.info('Event Bus already running');
            return;
        }

        await this.initialize();
        this.running = true;
        this.metrics.startTime = new Date();
        this.queue.startHeartbeat();

        logger.info('Starting to process events');
        
        // Start polling
        this.poll();
        
        // Start metrics reporting
        this.startMetricsReporting();
    }

    async stop() {
        this.running = false;
        
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = null;
        }
        
        this.subscriptions.clear();
        this.eventHistory.clear();
        this.patternSubscriptions.clear();
        this.removeAllListeners();
        
        await this.queue.shutdown();
        logger.info('Event Bus stopped');
    }

    poll() {
        if (!this.running) return;
        
        this.processNextEvent()
            .catch(err => {
                logger.error('Event Bus error in poll', { error: err });
                this.metrics.eventsFailed++;
            })
            .finally(() => {
                // Schedule next poll
                this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
            });
    }

    async processNextEvent() {
        const taskId = await this.queue.dequeue('event_bus');
        
        if (!taskId) {
            return; // No events available
        }
        
        try {
            const task = await this.queue.getTask(taskId);
            if (!task) {
                logger.error('Event not found', { taskId });
                return;
            }

            const event = task.payload;
            logger.info('Processing event', { eventType: event.type });
            
            // Store event in history
            this.storeEvent(event);
            
            // Deliver to subscribers
            await this.deliverEvent(event);
            
            // Emit to local listeners
            this.emit(event.type, event);
            
            // Mark task as completed
            await this.queue.completeTask(taskId, true);
            
            this.metrics.eventsPublished++;
            this.metrics.eventsDelivered += this.getSubscriberCount(event.type);
            
        } catch (err) {
            logger.error('Event failed', { taskId, error: err });
            await this.queue.completeTask(taskId, false, err.message);
            this.metrics.eventsFailed++;
        }
    }

    /**
     * Publish an event to the bus
     */
    async publish(event) {
        const enrichedEvent = {
            id: this.generateEventId(),
            timestamp: new Date().toISOString(),
            ...event
        };
        
        // Add to queue for processing
        await this.queue.enqueue('event_bus', enrichedEvent, 5);
        
        return enrichedEvent.id;
    }

    /**
     * Subscribe to events
     */
    async subscribe(eventType, subscriber) {
        if (!this.subscriptions.has(eventType)) {
            this.subscriptions.set(eventType, new Set());
        }
        
        this.subscriptions.get(eventType).add(subscriber);
        this.metrics.subscribersCount++;
        
        // Store subscription in database
        await this.storeSubscription(eventType, subscriber);
        
        logger.info('New subscription', { subscriber, eventType });
    }

    /**
     * Subscribe to event patterns (wildcards)
     */
    async subscribePattern(pattern, subscriber) {
        if (!this.patternSubscriptions.has(pattern)) {
            this.patternSubscriptions.set(pattern, new Set());
        }
        
        this.patternSubscriptions.get(pattern).add(subscriber);
        this.metrics.subscribersCount++;
        
        logger.info('New pattern subscription', { subscriber, pattern });
    }

    /**
     * Unsubscribe from events
     */
    async unsubscribe(eventType, subscriber) {
        if (this.subscriptions.has(eventType)) {
            this.subscriptions.get(eventType).delete(subscriber);
            this.metrics.subscribersCount--;
        }
        
        // Remove from database
        await this.removeSubscription(eventType, subscriber);
    }

    /**
     * Deliver event to all subscribers
     */
    async deliverEvent(event) {
        const eventType = event.type;
        const delivered = [];
        const failed = [];
        
        // Direct subscribers
        if (this.subscriptions.has(eventType)) {
            for (const subscriber of this.subscriptions.get(eventType)) {
                try {
                    await this.deliverToSubscriber(subscriber, event);
                    delivered.push(subscriber);
                } catch (err) {
                    logger.error('Delivery failed', { subscriber, error: err });
                    failed.push({ subscriber, error: err.message });
                }
            }
        }
        
        // Pattern subscribers
        for (const [pattern, subscribers] of this.patternSubscriptions) {
            if (this.matchesPattern(eventType, pattern)) {
                for (const subscriber of subscribers) {
                    try {
                        await this.deliverToSubscriber(subscriber, event);
                        delivered.push(subscriber);
                    } catch (err) {
                        logger.error('Delivery failed', { subscriber, error: err });
                        failed.push({ subscriber, error: err.message });
                    }
                }
            }
        }
        
        // Log delivery results
        await this.logDelivery(event, delivered, failed);
    }

    /**
     * Deliver event to a specific subscriber
     */
    async deliverToSubscriber(subscriber, event) {
        // If subscriber is a queue, enqueue there
        if (subscriber.startsWith('queue:')) {
            const queueName = subscriber.replace('queue:', '');
            await this.queue.enqueue(queueName, event, event.priority || 3);
        }
        // If subscriber is a webhook, send HTTP request
        else if (subscriber.startsWith('http')) {
            await this.sendWebhook(subscriber, event);
        }
        // If subscriber is a worker, send directly
        else if (subscriber.startsWith('worker:')) {
            await this.sendToWorker(subscriber, event);
        }
        // Otherwise, emit locally
        else {
            this.emit(`subscriber:${subscriber}`, event);
        }
    }

    /**
     * Send event via webhook
     */
    async sendWebhook(url, event) {
        const fetch = require('node-fetch');
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Event-Type': event.type,
                'X-Event-ID': event.id
            },
            body: JSON.stringify(event),
            timeout: 5000
        });
        
        if (!response.ok) {
            throw new Error(`Webhook failed: ${response.status}`);
        }
    }

    /**
     * Send event to specific worker
     */
    async sendToWorker(workerId, event) {
        // Queue directly to worker's personal queue
        await this.queue.enqueue(`worker:${workerId}`, event, event.priority || 3);
    }

    /**
     * Store event in history
     */
    storeEvent(event) {
        const eventType = event.type;
        
        if (!this.eventHistory.has(eventType)) {
            this.eventHistory.set(eventType, []);
        }
        
        const history = this.eventHistory.get(eventType);
        history.push(event);
        
        // Trim history if needed
        if (history.length > this.maxHistorySize) {
            history.shift();
        }
    }

    /**
     * Check if event type matches pattern
     */
    matchesPattern(eventType, pattern) {
        // Simple glob matching
        const regex = new RegExp(
            '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
        );
        return regex.test(eventType);
    }

    /**
     * Get subscriber count for event type
     */
    getSubscriberCount(eventType) {
        let count = 0;
        
        if (this.subscriptions.has(eventType)) {
            count += this.subscriptions.get(eventType).size;
        }
        
        for (const pattern of this.patternSubscriptions.keys()) {
            if (this.matchesPattern(eventType, pattern)) {
                count += this.patternSubscriptions.get(pattern).size;
            }
        }
        
        return count;
    }

    /**
     * Store subscription in database
     */
    async storeSubscription(eventType, subscriber) {
        await this.supabase
            .from('event_subscriptions')
            .upsert({
                event_type: eventType,
                subscriber: subscriber,
                created_at: new Date().toISOString()
            });
    }

    /**
     * Remove subscription from database
     */
    async removeSubscription(eventType, subscriber) {
        await this.supabase
            .from('event_subscriptions')
            .delete()
            .eq('event_type', eventType)
            .eq('subscriber', subscriber);
    }

    /**
     * Load existing subscriptions from database
     */
    async loadSubscriptions() {
        const { data, error } = await this.supabase
            .from('event_subscriptions')
            .select('event_type, subscriber');
        
        if (error) throw error;
        
        for (const sub of data || []) {
            if (!this.subscriptions.has(sub.event_type)) {
                this.subscriptions.set(sub.event_type, new Set());
            }
            this.subscriptions.get(sub.event_type).add(sub.subscriber);
        }
        
        logger.info('Loaded subscriptions', { count: data?.length || 0 });
    }

    /**
     * Log delivery results
     */
    async logDelivery(event, delivered, failed) {
        await this.supabase
            .from('event_delivery_logs')
            .insert({
                event_id: event.id,
                event_type: event.type,
                delivered_count: delivered.length,
                failed_count: failed.length,
                failed_details: failed.length > 0 ? failed : null,
                created_at: new Date().toISOString()
            });
    }

    /**
     * Start metrics reporting
     */
    startMetricsReporting() {
        this.metricsInterval = setInterval(async () => {
            const uptime = Date.now() - this.metrics.startTime.getTime();
            const rate = this.metrics.eventsPublished / (uptime / 1000);
            
            logger.info('Event Bus metrics', { eventsPublished: this.metrics.eventsPublished, eventsPerSecond: Number(rate.toFixed(2)), subscribersCount: this.metrics.subscribersCount });
            
            // Store metrics in database
            await this.supabase
                .from('event_bus_metrics')
                .insert({
                    worker_id: this.workerId,
                    events_published: this.metrics.eventsPublished,
                    events_delivered: this.metrics.eventsDelivered,
                    events_failed: this.metrics.eventsFailed,
                    subscribers_count: this.metrics.subscribersCount,
                    events_per_second: rate,
                    created_at: new Date().toISOString()
                });
        }, 60000); // Every minute
    }

    /**
     * Generate unique event ID
     */
    generateEventId() {
        return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get recent events for a type
     */
    getRecentEvents(eventType, limit = 100) {
        const history = this.eventHistory.get(eventType) || [];
        return history.slice(-limit);
    }

    /**
     * Get bus statistics
     */
    getStats() {
        return {
            ...this.metrics,
            uptime: this.metrics.startTime ? Date.now() - this.metrics.startTime.getTime() : 0,
            subscriptionCount: this.subscriptions.size,
            patternSubscriptionCount: this.patternSubscriptions.size,
            eventTypes: Array.from(this.eventHistory.keys())
        };
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new EventBusWorker();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        logger.info('Event Bus shutting down');
        await worker.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        logger.info('Event Bus shutting down');
        await worker.stop();
        process.exit(0);
    });

    // Start worker
    worker.start().catch(err => {
        logger.error('Event Bus failed to start', { error: err });
        process.exit(1);
    });
}

module.exports = EventBusWorker;
