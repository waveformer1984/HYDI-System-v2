const { createClient } = require('@supabase/supabase-js');
const QueueManager = require('./QueueManager');
require('dotenv').config();
const logger = require('../lib/structured-logger').child({ component: 'NotificationWorker' });

class NotificationWorker {
    constructor(workerId) {
        this.workerId = workerId || `notification-worker-${Date.now()}`;
        this.running = false;
        this.pollInterval = 5000;
        this.pollTimer = null;
        this.supabase = null;
        this.queue = new QueueManager();
        this.notificationChannels = {
            realtime: { enabled: true },
            discord: { enabled: !!process.env.DISCORD_WEBHOOK_URL, webhook_url: process.env.DISCORD_WEBHOOK_URL, username: 'ProtoForge', avatar_url: '' },
            webhooks: { enabled: false, endpoints: [] },
            email: { enabled: !!process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM || 'noreply@theforge.local' },
            ui: { enabled: true }
        };
        this.templates = {};

        this.initialize = function() {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');
            this.supabase = createClient(supabaseUrl, supabaseKey);
            this.queue.registerWorker('notification', this.workerId);
            this.queue.updateHeartbeat('idle');
            logger.info('Initialized', { workerId: this.workerId });
        };

        this.start = async function() {
            if (this.running) return;
            await this.initialize();
            this.running = true;
            this.queue.startHeartbeat();
            this.poll();
        };

        this.stop = async function() {
            this.running = false;
            if (this.pollTimer) clearTimeout(this.pollTimer);
            await this.queue.shutdown();
        };

        this.poll = function() {
            if (!this.running) return;
            this.processNextTask()
                .catch(err => logger.error('Poll error', { error: err }))
                .finally(() => { this.pollTimer = setTimeout(() => this.poll(), this.pollInterval); });
        };

        this.processNextTask = async function() {
            const taskId = await this.queue.dequeue('notification');
            if (!taskId) return;
            try {
                const task = await this.queue.getTask(taskId);
                if (!task) return;
                switch (task.payload.event_type) {
                    case 'notification.send': await this.sendNotification(task.payload); break;
                    case 'notification.summary': await this.generateSummary(task.payload); break;
                    default: logger.info('Unhandled event type', { eventType: task.payload.event_type });
                }
                await this.queue.completeTask(taskId, true);
            } catch (err) {
                await this.queue.completeTask(taskId, false, err.message);
            }
        };

        this.sendNotification = async function(payload) {
            const { recipient, template, data, priority } = payload.data;
            logger.info('Sending notification', { template, recipient });
            const channels = this.getChannelsForPriority(priority || 5);
            for (const channel of channels) {
                try { await this.sendViaChannel(channel, { recipient, template, data, priority }); } catch (e) { /* channel failed, continue */ }
            }
        };

        this.generateSummary = async function(payload) {
            const { time_period } = payload.data || {};
            logger.info('Generating summary', { timePeriod: time_period });
        };

        this.getChannelsForPriority = function(priority) {
            if (priority >= 8) return ['realtime', 'discord', 'email'];
            if (priority >= 5) return ['realtime', 'discord'];
            return ['realtime'];
        };

                this.sendViaChannel = async function(channel, notificationData) {
            switch (channel) {
                case 'realtime':
                    return await this.sendRealtimeNotification(notificationData);
                    
                case 'discord':
                    return await this.sendDiscordNotification(notificationData);
                    
                case 'webhooks':
                    return await this.sendWebhookNotifications(notificationData);
                    
                case 'email':
                    return await this.sendEmailNotification(notificationData);
                    
                case 'ui':
                    return await this.sendUINotification(notificationData);
                    
                default:
                    throw new Error(`Unknown notification channel: ${channel}`);
            }
        };

        this.sendRealtimeNotification = async function(notificationData) {
            // In a real implementation, this would send via WebSocket or SSE
            // For now, we'll log and store in database for polling
            await this.supabase
                .from('realtime_notifications')
                .insert({
                    recipient: notificationData.recipient,
                    template: notificationData.template,
                    data: notificationData.data,
                    priority: notificationData.priority,
                    sent_at: new Date(),
                    channel: 'realtime'
                });
                
            logger.info('Realtime notification stored', { recipient: notificationData.recipient });
        };

        this.sendDiscordNotification = async function(notificationData) {
            if (!this.notificationChannels.discord.enabled) {
                throw new Error('Discord notifications not enabled');
            }
            
            const fetch = require('node-fetch');
            
            const discordMessage = {
                username: this.notificationChannels.discord.username,
                avatar_url: this.notificationChannels.discord.avatar_url,
                embeds: [{
                    title: notificationData.template.replace('.', ' ').replace(/\b\w/g, c => c.toUpperCase()),
                    description: JSON.stringify(notificationData.data, null, 2),
                    color: notificationData.priority === 'high' ? 0xff0000 : 
                             notificationData.priority === 'medium' ? 0xffff00 : 0x00ff00,
                    timestamp: new Date().toISOString()
                }]
            };
            
            const response = await fetch(this.notificationChannels.discord.webhook_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(discordMessage)
            });
            
            if (!response.ok) {
                throw new Error(`Discord webhook failed: ${response.status}`);
            }
            
            await this.supabase
                .from('notification_log')
                .insert({
                    recipient: notificationData.recipient,
                    template: notificationData.template,
                    data: notificationData.data,
                    priority: notificationData.priority,
                    sent_at: new Date(),
                    channel: 'discord',
                    status: 'sent'
                });
        };

        this.sendWebhookNotifications = async function(notificationData) {
            if (!this.notificationChannels.webhooks.enabled || 
                this.notificationChannels.webhooks.endpoints.length === 0) {
                throw new Error('No webhook endpoints configured');
            }
            
            const fetch = require('node-fetch');
            
            const webhookPromises = this.notificationChannels.webhooks.endpoints.map(async (endpoint) => {
                try {
                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            recipient: notificationData.recipient,
                            template: notificationData.template,
                            data: notificationData.data,
                            priority: notificationData.priority,
                            timestamp: new Date().toISOString()
                        })
                    });
                    
                    if (!response.ok) {
                        throw new Error(`Webhook failed: ${response.status}`);
                    }
                    
                    await this.supabase
                        .from('notification_log')
                        .insert({
                            recipient: notificationData.recipient,
                            template: notificationData.template,
                            data: notificationData.data,
                            priority: notificationData.priority,
                            sent_at: new Date(),
                            channel: 'webhook',
                            endpoint: endpoint,
                            status: 'sent'
                        });
                } catch (error) {
                    await this.supabase
                        .from('notification_log')
                        .insert({
                            recipient: notificationData.recipient,
                            template: notificationData.template,
                            data: notificationData.data,
                            priority: notificationData.priority,
                            sent_at: new Date(),
                            channel: 'webhook',
                            endpoint: endpoint,
                            status: 'failed',
                            error: error.message
                        });
                    throw error;
                }
            });
            
            await Promise.all(webhookPromises);
        };

        this.sendEmailNotification = async function(notificationData) {
            if (!this.notificationChannels.email.enabled) {
                throw new Error('Email notifications not enabled');
            }
            
            const nodemailer = require('nodemailer');
            
            // Create transporter
            let transporter;
            if (process.env.NODE_ENV === 'development') {
                // Ethereal for testing in development
                transporter = await nodemailer.createTestAccount();
                transporter = nodemailer.createTransport({
                    host: transporter.host,
                    port: transporter.port,
                    secure: transporter.secure,
                    auth: {
                        user: transporter.user,
                        pass: transporter.pass
                    }
                });
            } else {
                // Real SMTP in production
                transporter = nodemailer.createTransport({
                    host: this.notificationChannels.email.host,
                    port: this.notificationChannels.email.port,
                    secure: this.notificationChannels.email.port === 465,
                    auth: {
                        user: this.notificationChannels.email.user,
                        pass: this.notificationChannels.email.pass
                    }
                });
            }
            
            // Email content
            const mailOptions = {
                from: this.notificationChannels.email.from,
                to: notificationData.recipient,
                subject: `ProtoForge Notification: ${notificationData.template.replace('.', ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
                text: this.generateEmailText(notificationData),
                html: this.generateEmailHTML(notificationData)
            };
            
            // Send email
            const info = await transporter.sendMail(mailOptions);
            
            logger.info('Email sent', { messageId: info.messageId });
            
            // Log sent notification
            await this.supabase
                .from('notification_log')
                .insert({
                    recipient: notificationData.recipient,
                    template: notificationData.template,
                    data: notificationData.data,
                    priority: notificationData.priority,
                    sent_at: new Date(),
                    channel: 'email',
                    message_id: info.messageId,
                    status: 'sent'
                });
        };

        this.sendUINotification = async function(notificationData) {
            // Store UI notification in database for frontend to fetch
            await this.supabase
                .from('ui_notifications')
                .insert({
                    recipient: notificationData.recipient,
                    template: notificationData.template,
                    data: notificationData.data,
                    priority: notificationData.priority,
                    sent_at: new Date(),
                    read: false,
                    expires_at: new Date(Date.now() + (this.notificationChannels.ui.retention_hours * 60 * 60 * 1000))
                });
                
            logger.info('UI notification stored', { recipient: notificationData.recipient });
        };

        this.generateEmailText = function(notificationData) {
            return `
ProtoForge Notification

Template: ${notificationData.template}
Priority: ${notificationData.priority}
Time: ${new Date().toISOString()}

Data:
${JSON.stringify(notificationData.data, null, 2)}

This is an automated message from ProtoForge.
            `.trim();
        };

        this.generateEmailHTML = function(notificationData) {
            return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>ProtoForge Notification</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #4a90e2; color: white; padding: 15px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background-color: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; }
        .data { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #4a90e2; font-family: monospace; }
        .footer { text-align: center; margin-top: 20px; font-size: 0.9em; color: #666; }
    </style>
</head>
<body>
    <div class="header">
        <h1>ProtoForge Notification</h1>
    </div>
    <div class="content">
        <p><strong>Template:</strong> ${notificationData.template}</p>
        <p><strong>Priority:</strong> <span style="color: ${notificationData.priority === 'high' ? '#ff0000' : notificationData.priority === 'medium' ? '#ff9900' : '#00cc00'}">${notificationData.priority}</span></p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        
        <div class="data">
            <strong>Data:</strong><br>
            ${JSON.stringify(notificationData.data, null, 2).replace(/\n/g, '<br>').replace(/ {2}/g, '&nbsp;&nbsp;')}
        </div>
        
        <p>This is an automated message from ProtoForge.</p>
    </div>
    <div class="footer">
        © ${new Date().getFullYear()} ProtoForge. All rights reserved.
    </div>
</body>
</html>
            `.trim();
        };

        this.logNotificationFailure = async function(recipient, template, channel, error) {
            await this.supabase
                .from('notification_log')
                .insert({
                    recipient: recipient,
                    template: template,
                    data: {},
                    priority: 'unknown',
                    sent_at: new Date(),
                    channel: channel,
                    status: 'failed',
                    error: error
                });
        };

        this.generateNotificationSummary = async function(summary_type, time_period) {
            logger.info('Generating summary', { summaryType: summary_type, timePeriod: time_period });
            
            let startDate;
            if (time_period === 'today') {
                startDate = new Date();
                startDate.setHours(0, 0, 0, 0);
            } else if (time_period === 'yesterday') {
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 1);
                startDate.setHours(0, 0, 0, 0);
            } else if (time_period === 'week') {
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 7);
            } else if (time_period === 'month') {
                startDate = new Date();
                startDate.setMonth(startDate.getMonth() - 1);
            } else {
                // Default to last 24 hours
                startDate = new Date();
                startDate.setHours(startDate.getHours() - 24);
            }
            
            switch (summary_type) {
                case 'activity':
                    return await this.generateActivitySummary(startDate);
                    
                case 'errors':
                    return await this.generateErrorSummary(startDate);
                    
                case 'performance':
                    return await this.generatePerformanceSummary(startDate);
                    
                case 'usage':
                    return await this.generateUsageSummary(startDate);
                    
                default:
                    return {
                        summary_type: summary_type,
                        time_period: time_period,
                        generated_at: new Date().toISOString(),
                        message: 'Summary type not implemented'
                    };
            }
        };

        this.generateActivitySummary = async function(startDate) {
            const { data: notifications } = await this.supabase
                .from('notification_log')
                .select('*')
                .gte('sent_at', startDate.toISOString());
            
            const byChannel = notifications.reduce((acc, curr) => {
                acc[curr.channel] = (acc[curr.channel] || 0) + 1;
                return acc;
            }, {});
            
            const byPriority = notifications.reduce((acc, curr) => {
                acc[curr.priority] = (acc[curr.priority] || 0) + 1;
                return acc;
            }, {});
            
            return {
                summary_type: 'activity',
                time_period: `${startDate.toISOString()} to ${new Date().toISOString()}`,
                total_notifications: notifications.length,
                by_channel: byChannel,
                by_priority: byPriority,
                generated_at: new Date().toISOString()
            };
        };

        this.generateErrorSummary = async function(startDate) {
            const { data: failedNotifications } = await this.supabase
                .from('notification_log')
                .select('*')
                .gte('sent_at', startDate.toISOString())
                .eq('status', 'failed');
            
            const byChannel = failedNotifications.reduce((acc, curr) => {
                acc[curr.channel] = (acc[curr.channel] || 0) + 1;
                return acc;
            }, {});
            
            const byErrorType = failedNotifications.reduce((acc, curr) => {
                const errorType = curr.error ? curr.error.split(':')[0] : 'Unknown';
                acc[errorType] = (acc[errorType] || 0) + 1;
                return acc;
            }, {});
            
            return {
                summary_type: 'errors',
                time_period: `${startDate.toISOString()} to ${new Date().toISOString()}`,
                total_failed: failedNotifications.length,
                by_channel: byChannel,
                by_error_type: byErrorType,
                generated_at: new Date().toISOString()
            };
        };

        this.generatePerformanceSummary = async function(startDate) {
            const { data: notifications } = await this.supabase
                .from('notification_log')
                .select('*')
                .gte('sent_at', startDate.toISOString());
            
            // Calculate average sending time (simplified)
            const avgProcessingTimeMs = 50; // Placeholder
            
            return {
                summary_type: 'performance',
                time_period: `${startDate.toISOString()} to ${new Date().toISOString()}`,
                total_sent: notifications.length,
                average_processing_time_ms: avgProcessingTimeMs,
                generated_at: new Date().toISOString()
            };
        };

        this.generateUsageSummary = async function(startDate) {
            const { data: notifications } = await this.supabase
                .from('notification_log')
                .select('*')
                .gte('sent_at', startDate.toISOString());
            
            const byTemplate = notifications.reduce((acc, curr) => {
                acc[curr.template] = (acc[curr.template] || 0) + 1;
                return acc;
            }, {});
            
            const topTemplates = Object.entries(byTemplate)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .reduce((acc, [template, count]) => {
                    acc[template] = count;
                    return acc;
                }, {});
            
            return {
                summary_type: 'usage',
                time_period: `${startDate.toISOString()} to ${new Date().toISOString()}`,
                total_notifications: notifications.length,
                by_template: byTemplate,
                top_templates: topTemplates,
                generated_at: new Date().toISOString()
            };
        };
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new NotificationWorker();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        logger.info('Shutting down');
        await worker.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        logger.info('Shutting down');
        await worker.stop();
        process.exit(0);
    });

    // Start worker
    worker.start().catch(err => {
        logger.error('Failed to start', { error: err });
        process.exit(1);
    });
}

module.exports = NotificationWorker;